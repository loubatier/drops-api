import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

type Step = { name: string; run: () => Promise<void> };
type Message = { type: string; data: any };

const ZONE = { lat: 47.495472, lng: 6.805279 };
const M_PER_DEG = (Math.PI * 6371008.8) / 180;

class Socket {
  messages: Message[] = [];
  private waiters: (() => void)[] = [];

  private constructor(private ws: WebSocket) {
    ws.on('message', (raw) => {
      this.messages.push(JSON.parse(raw.toString()));
      for (const w of this.waiters.splice(0)) w();
    });
  }

  static connect(url: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const socket = new Socket(ws);
      ws.once('open', () => resolve(socket));
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, res) => reject(new Error(`handshake refusé : HTTP ${res.statusCode}`)));
    });
  }

  async next(predicate: (m: Message) => boolean, label: string, ms = 5000): Promise<Message> {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = this.messages.find(predicate);
      if (found) return found;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`${label} : message non reçu en ${ms} ms`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  close() {
    this.ws.close();
  }
}

export async function runSmokeBlock2(
  baseUrl: string,
  adminKey: string,
  log: (line: string) => void = console.log,
): Promise<boolean> {
  const base = baseUrl.replace(/\/+$/, '');
  const wsBase = base.replace(/^http/, 'ws');
  if (!base.includes('staging')) {
    log('⚠️  Cette URL ne contient pas « staging ». Ne lancez jamais ce script contre la production pendant un cours.');
  }
  const suffix = randomBytes(4).toString('hex');
  const accounts = ['a', 'b'].map((k) => ({
    username: `sm2${k}_${suffix}`,
    email: `sm2${k}_${suffix}@example.com`,
    password: 'smoke-password-1',
    token: '',
  }));
  const [a, b] = accounts as [(typeof accounts)[number], (typeof accounts)[number]];
  const state: {
    initial: { block2Enabled: boolean; lockMode: 'on' | 'off' } | null;
    socketA: Socket | null;
    socketB: Socket | null;
  } = { initial: null, socketA: null, socketB: null };
  const created: { id: number; token: string }[] = [];
  let dropOne = 0;
  let dropTwo = 0;

  const call = async (method: string, path: string, options: { body?: unknown; token?: string; admin?: boolean } = {}) => {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.admin) headers['X-Admin-Key'] = adminKey;
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, headers: res.headers };
  };

  const expectStatus = (actual: number, expected: number, label: string) => {
    if (actual !== expected) throw new Error(`${label} : ${expected} attendu, ${actual} reçu`);
  };

  const connect = async (account: typeof a) => {
    const ticket = await call('POST', '/realtime/ticket', { token: account.token });
    expectStatus(ticket.status, 201, 'POST /realtime/ticket');
    const socket = await Socket.connect(`${wsBase}/ws?ticket=${ticket.json.ticket}`);
    await socket.next((m) => m.type === 'hello', 'hello');
    return socket;
  };

  const createDrop = async (account: typeof a, title: string, northM = 0) => {
    const res = await call('POST', '/drops', {
      token: account.token,
      body: { title, content: 'Créé par smoke:block2.', category: 'note', lat: ZONE.lat + northM / M_PER_DEG, lng: ZONE.lng },
    });
    expectStatus(res.status, 201, 'POST /drops');
    created.push({ id: res.json.id, token: account.token });
    return res.json as { id: number; location: { lat: number; lng: number } };
  };

  const steps: Step[] = [
    {
      name: 'réglages lus, bloc 2 activé si besoin',
      run: async () => {
        const res = await call('GET', '/admin/settings', { admin: true });
        expectStatus(res.status, 200, 'GET /admin/settings');
        const initial = { block2Enabled: res.json.block2Enabled as boolean, lockMode: res.json.lockMode as 'on' | 'off' };
        state.initial = initial;
        if (!initial.block2Enabled) {
          const patch = await call('PATCH', '/admin/settings', { admin: true, body: { block2Enabled: true } });
          expectStatus(patch.status, 200, 'PATCH /admin/settings');
        }
        if (initial.lockMode === 'on') {
          const patch = await call('PATCH', '/admin/settings', { admin: true, body: { lockMode: 'off' } });
          expectStatus(patch.status, 200, 'PATCH lockMode off');
        }
      },
    },
    {
      name: 'deux comptes, deux WebSocket : le drop de A arrive chez B',
      run: async () => {
        for (const account of accounts) {
          const reg = await call('POST', '/auth/register', {
            body: { username: account.username, email: account.email, password: account.password, displayName: 'Smoke 2' },
          });
          expectStatus(reg.status, 201, 'POST /auth/register');
          account.token = reg.json.token;
        }
        state.socketA = await connect(a);
        state.socketB = await connect(b);
        const drop = await createDrop(a, 'Drop de fumée 1');
        dropOne = drop.id;
        const received = await state.socketB.next((m) => m.type === 'drop:created' && m.data.drop.id === dropOne, 'drop:created chez B');
        if (received.data.drop.isMine !== false) throw new Error('isMine devrait valoir false chez B');
      },
    },
    {
      name: 'near et bbox renvoient ce drop',
      run: async () => {
        const near = await call('GET', `/drops?near=${ZONE.lat},${ZONE.lng}&radius=200&pageSize=50`);
        expectStatus(near.status, 200, 'GET /drops?near');
        const hit = near.json.items.find((d: any) => d.id === dropOne);
        if (!hit || typeof hit.distanceM !== 'number') throw new Error('drop absent de near, ou distanceM manquant');
        const d = 0.002;
        const bbox = await call('GET', `/drops?bbox=${ZONE.lng - d},${ZONE.lat - d},${ZONE.lng + d},${ZONE.lat + d}&pageSize=200`);
        expectStatus(bbox.status, 200, 'GET /drops?bbox');
        if (!bbox.json.items.some((x: any) => x.id === dropOne)) throw new Error('drop absent de bbox');
      },
    },
    {
      name: 'B ouvre de près (200), puis de loin sur un autre drop (403 too_far)',
      run: async () => {
        const open = await call('POST', `/drops/${dropOne}/open`, { token: b.token, body: { lat: ZONE.lat, lng: ZONE.lng } });
        expectStatus(open.status, 200, 'open de près');
        if (open.json.openedByMe !== true) throw new Error('openedByMe attendu');
        const second = await createDrop(a, 'Drop de fumée 2');
        dropTwo = second.id;
        const far = await call('POST', `/drops/${dropTwo}/open`, {
          token: b.token,
          body: { lat: ZONE.lat + 500 / M_PER_DEG, lng: ZONE.lng },
        });
        expectStatus(far.status, 403, 'open de loin');
        if (far.json?.error?.code !== 'too_far' || !far.json?.error?.meta?.distanceM) throw new Error('too_far avec meta attendu');
      },
    },
    {
      name: 'lockMode on : B reçoit settings:updated et un drop non ouvert est verrouillé',
      run: async () => {
        const patch = await call('PATCH', '/admin/settings', { admin: true, body: { lockMode: 'on' } });
        expectStatus(patch.status, 200, 'PATCH lockMode on');
        await state.socketB!.next((m) => m.type === 'settings:updated' && m.data.lockMode === 'on', 'settings:updated');
        const locked = await call('GET', `/drops/${dropTwo}`, { token: b.token });
        expectStatus(locked.status, 200, 'GET drop verrouillé');
        if (locked.json.locked !== true || locked.json.content !== null) throw new Error('drop non verrouillé');
        const opened = await call('GET', `/drops/${dropOne}`, { token: b.token });
        if (opened.json.locked !== false) throw new Error('le drop ouvert par B devrait être déverrouillé');
      },
    },
    {
      name: '/dataset/points contient plus de 1 000 points',
      run: async () => {
        const res = await call('GET', '/dataset/points');
        expectStatus(res.status, 200, 'GET /dataset/points');
        if (!(res.json.count > 1000) || res.json.points.length !== res.json.count) throw new Error('jeu de données trop petit');
      },
    },
  ];

  let ok = true;
  for (const step of steps) {
    try {
      await step.run();
      log(`✅ ${step.name}`);
    } catch (err) {
      ok = false;
      log(`❌ ${step.name} : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  try {
    state.socketA?.close();
    state.socketB?.close();
    const initial = state.initial;
    if (initial) {
      const restore = await call('PATCH', '/admin/settings', { admin: true, body: { lockMode: 'off' } });
      expectStatus(restore.status, 200, 'restauration de lockMode');
      if (initial.lockMode === 'on' || !initial.block2Enabled) {
        const final = await call('PATCH', '/admin/settings', {
          admin: true,
          body: { block2Enabled: initial.block2Enabled, ...(initial.block2Enabled ? { lockMode: initial.lockMode } : {}) },
        });
        expectStatus(final.status, 200, 'restauration des réglages');
      }
    }
    for (const drop of created) {
      const del = await call('DELETE', `/drops/${drop.id}`, { token: drop.token });
      expectStatus(del.status, 204, 'DELETE drop');
    }
    log('✅ réglages restaurés et drops supprimés (les deux comptes de fumée restent en base)');
  } catch (err) {
    ok = false;
    log(`❌ restauration : ${err instanceof Error ? err.message : String(err)}`);
  }
  return ok;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const url = process.argv[2];
  const adminKey = process.env.ADMIN_KEY;
  if (!url || !adminKey) {
    console.error('Usage : ADMIN_KEY=… npm run smoke:block2 -- https://url-de-staging');
    process.exit(2);
  }
  runSmokeBlock2(url, adminKey).then((ok) => process.exit(ok ? 0 : 1));
}
