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

  send(type: string, data: unknown = {}) {
    this.ws.send(JSON.stringify({ type, data }));
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
    id: 0,
  }));
  const [a, b] = accounts as [(typeof accounts)[number], (typeof accounts)[number]];
  const state: { socketA: Socket | null; socketB: Socket | null } = { socketA: null, socketB: null };
  const created: { id: number; token: string }[] = [];
  let dropOne = 0;

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
      name: 'deux comptes, deux WebSocket : le drop de A arrive chez B',
      run: async () => {
        for (const account of accounts) {
          const reg = await call('POST', '/auth/register', {
            body: { username: account.username, email: account.email, password: account.password, displayName: 'Smoke 2' },
          });
          expectStatus(reg.status, 201, 'POST /auth/register');
          account.token = reg.json.token;
          account.id = reg.json.user.id;
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
        const near = await call('GET', `/drops?near=${ZONE.lat},${ZONE.lng}&radius=200&pageSize=50`, { token: b.token });
        expectStatus(near.status, 200, 'GET /drops?near');
        const hit = near.json.items.find((d: any) => d.id === dropOne);
        if (!hit || typeof hit.distanceM !== 'number') throw new Error('drop absent de near, ou distanceM manquant');
        const d = 0.002;
        const bbox = await call('GET', `/drops?bbox=${ZONE.lng - d},${ZONE.lat - d},${ZONE.lng + d},${ZONE.lat + d}&pageSize=200`, { token: b.token });
        expectStatus(bbox.status, 200, 'GET /drops?bbox');
        if (!bbox.json.items.some((x: any) => x.id === dropOne)) throw new Error('drop absent de bbox');
      },
    },
    {
      name: 'B dislike le drop de A : A reçoit like:updated avec dislikesCount, puis B répond à un commentaire',
      run: async () => {
        const dislike = await call('POST', `/drops/${dropOne}/dislike`, { token: b.token });
        expectStatus(dislike.status, 200, 'POST dislike');
        if (dislike.json.disliked !== true || dislike.json.dislikesCount !== 1) throw new Error('état du dislike inattendu');
        await state.socketA!.next(
          (m) => m.type === 'like:updated' && m.data.dropId === dropOne && m.data.dislikesCount === 1,
          'like:updated chez A',
        );
        const root = await call('POST', `/drops/${dropOne}/comments`, { token: a.token, body: { content: 'Racine' } });
        expectStatus(root.status, 201, 'POST commentaire');
        const reply = await call('POST', `/drops/${dropOne}/comments`, { token: b.token, body: { content: 'Réponse', parentId: root.json.id } });
        expectStatus(reply.status, 201, 'POST réponse');
        if (reply.json.parentId !== root.json.id) throw new Error('parentId attendu sur la réponse');
      },
    },
    {
      name: '/dataset/points contient plus de 1 000 points',
      run: async () => {
        const res = await call('GET', '/dataset/points', { token: b.token });
        expectStatus(res.status, 200, 'GET /dataset/points');
        if (!(res.json.count > 1000) || res.json.points.length !== res.json.count) throw new Error('jeu de données trop petit');
      },
    },
    {
      name: 'présence : A seul, puis A et B, puis A seul après le départ de B',
      run: async () => {
        const socketA = state.socketA!;
        const socketB = state.socketB!;
        const ours = new Set([a.id, b.id]);
        const only = (m: Message, wanted: number[]) =>
          m.type === 'presence:drop' &&
          m.data.dropId === dropOne &&
          JSON.stringify(m.data.viewers.map((u: any) => u.id).filter((id: number) => ours.has(id))) === JSON.stringify(wanted);
        socketA.send('presence:view', { dropId: dropOne });
        await socketA.next((m) => only(m, [a.id]), 'instantané de A avec lui seul', 1500);
        const sizeA = socketA.messages.length;
        socketB.send('presence:view', { dropId: dropOne });
        await socketB.next((m) => only(m, [a.id, b.id]), 'B reçoit [A, B]');
        await socketA.next((m) => socketA.messages.indexOf(m) >= sizeA && only(m, [a.id, b.id]), 'A reçoit [A, B]');
        const sizeAfter = socketA.messages.length;
        socketB.close();
        await socketA.next((m) => socketA.messages.indexOf(m) >= sizeAfter && only(m, [a.id]), 'A reçoit [A] après le départ de B');
      },
    },
    {
      name: '/ws-playground répond 200',
      run: async () => {
        const res = await fetch(`${base}/ws-playground`);
        expectStatus(res.status, 200, 'GET /ws-playground');
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
    for (const drop of created) {
      const del = await call('DELETE', `/drops/${drop.id}`, { token: drop.token });
      expectStatus(del.status, 204, 'DELETE drop');
    }
    log('✅ drops supprimés (les deux comptes de fumée restent en base)');
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
