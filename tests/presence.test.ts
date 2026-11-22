import { afterEach, describe, expect, it } from 'vitest';
import { bearer, buildTestApp } from './helpers.js';
import {
  type Client,
  type TestServer,
  connectAs,
  login,
  openSocket,
  startServer,
  ticketFor,
} from './ws-helpers.js';
import type { SimulatorControl } from '../src/simulator.js';

const ADMIN = { 'X-Admin-Key': 'teacher-key' };
const dropBody = { title: 'Un drop en direct', content: 'Salut la classe', category: 'note', lat: 47.4955, lng: 6.8053 };

let server: TestServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
});

const createDrop = async (s: TestServer, token: string) =>
  (await s.api.post('/drops').set(bearer(token)).send(dropBody)).body as { id: number };

const extraTab = async (s: TestServer, token: string) => openSocket(s, (await ticketFor(s, token)).ticket);

const pub = (u: { id: number; username: string; displayName: string; avatarUrl: string | null }) => ({
  id: u.id,
  username: u.username,
  displayName: u.displayName,
  avatarUrl: u.avatarUrl,
});
const ids = (m: { data: { viewers: { id: number }[] } }) => m.data.viewers.map((u) => u.id);
const lastDrop = (c: Client) => [...c.messages].reverse().find((m) => m.type === 'presence:drop');
const settled = () => new Promise((resolve) => setTimeout(resolve, 150));

describe('instantané de présence', () => {
  it('répond tout de suite à presence:view, y compris quand la liste ne change pas', async () => {
    server = await startServer({}, { presenceDebounceMs: 1000 });
    const a = await connectAs(server, 'demo');
    const drop = await createDrop(server, a.token);
    const started = Date.now();
    a.client.send('presence:view', { dropId: drop.id });
    const first = await a.client.next('presence:drop');
    expect(Date.now() - started).toBeLessThan(200);
    expect(ids(first as any)).toEqual([a.user.id]);

    const tab = await extraTab(server, a.token);
    const before = Date.now();
    tab.send('presence:view', { dropId: drop.id });
    const second = await tab.next('presence:drop');
    expect(Date.now() - before).toBeLessThan(200);
    expect(second.data).toEqual({ dropId: drop.id, viewers: [pub(a.user)] });
  });

  it('hello.data.online contient soi-même et les autres connectés', async () => {
    server = await startServer();
    const a = await connectAs(server, 'demo');
    expect((await a.client.next('hello')).data.online).toEqual([pub(a.user)]);
    const b = await connectAs(server, 'lea');
    const hello = await b.client.next('hello');
    expect(hello.data.online.map((u: { id: number }) => u.id).sort()).toEqual([a.user.id, b.user.id].sort());
  });
});

describe('un lecteur est un utilisateur', () => {
  it('dédoublonne les onglets et garde le lecteur tant qu’un onglet reste', async () => {
    server = await startServer();
    const a = await connectAs(server, 'demo');
    const b = await connectAs(server, 'lea');
    const drop = await createDrop(server, a.token);
    const tab = await extraTab(server, b.token);
    b.client.send('presence:view', { dropId: drop.id });
    tab.send('presence:view', { dropId: drop.id });
    await a.client.waitFor((m) => m.type === 'presence:drop' && ids(m as any).length === 1);
    await settled();
    expect(ids(lastDrop(a.client) as any)).toEqual([b.user.id]);

    b.client.ws.close();
    await b.client.waitClosed();
    await settled();
    expect(ids(lastDrop(a.client) as any)).toEqual([b.user.id]);

    tab.ws.close();
    await a.client.waitFor((m) => m.type === 'presence:drop' && ids(m as any).length === 0);
  });

  it('garde l’ordre d’arrivée, stable avec un deuxième onglet', async () => {
    server = await startServer();
    const a = await connectAs(server, 'demo');
    const b = await connectAs(server, 'lea');
    const c = await connectAs(server, 'zoe');
    const drop = await createDrop(server, a.token);
    c.client.send('presence:view', { dropId: drop.id });
    await c.client.next('presence:drop');
    a.client.send('presence:view', { dropId: drop.id });
    await a.client.waitFor((m) => m.type === 'presence:drop' && ids(m as any).length === 2);
    b.client.send('presence:view', { dropId: drop.id });
    await b.client.waitFor((m) => m.type === 'presence:drop' && ids(m as any).length === 3);
    expect(ids(lastDrop(b.client) as any)).toEqual([c.user.id, a.user.id, b.user.id]);

    const tab = await extraTab(server, c.token);
    tab.send('presence:view', { dropId: drop.id });
    expect(ids((await tab.next('presence:drop')) as any)).toEqual([c.user.id, a.user.id, b.user.id]);
  });
});

describe('une fermeture vaut un départ', () => {
  const watchThenLeave = async (leave: (b: { client: Client }) => void, options = { presenceDebounceMs: 30 } as any) => {
    server = await startServer({}, options);
    const a = await connectAs(server, 'demo');
    const b = await connectAs(server, 'lea');
    const drop = await createDrop(server, a.token);
    a.client.send('presence:view', { dropId: drop.id });
    b.client.send('presence:view', { dropId: drop.id });
    await a.client.waitFor((m) => m.type === 'presence:drop' && ids(m as any).length === 2);
    await a.client.waitFor((m) => m.type === 'presence:online' && m.data.users.length === 2);
    leave(b);
    await a.client.waitFor((m) => m.type === 'presence:drop' && ids(m as any).length === 1 && m.data.dropId === drop.id && a.client.messages.indexOf(m) > a.client.messages.findIndex((x) => x.type === 'presence:drop' && ids(x as any).length === 2));
    await a.client.waitFor((m) => m.type === 'presence:online' && m.data.users.length === 1);
  };

  it('fermeture normale', async () => {
    await watchThenLeave((b) => b.client.ws.close(1000));
  });

  it('coupure réseau', async () => {
    await watchThenLeave((b) => b.client.ws.terminate());
  });

  it('heartbeat sans réponse', async () => {
    await watchThenLeave((b) => {
      b.client.ws.pong = () => undefined;
    }, { presenceDebounceMs: 30, heartbeatMs: 100 });
  });
});

describe('validation de presence:view', () => {
  it('refuse un dropId invalide et un drop inconnu ou masqué sans changer l’état', async () => {
    server = await startServer();
    const a = await connectAs(server, 'demo');
    const b = await connectAs(server, 'lea');
    const drop = await createDrop(server, a.token);
    const hidden = await createDrop(server, b.token);
    server.db.prepare('UPDATE drops SET hidden = 1 WHERE id = ?').run(hidden.id);
    a.client.send('presence:view', { dropId: drop.id });
    await a.client.next('presence:drop');

    for (const bad of [{}, { dropId: '1' }, { dropId: 1.5 }, { dropId: 0 }, { dropId: -3 }]) {
      a.client.send('presence:view', bad);
    }
    await a.client.waitFor(() => a.client.count('error') === 5);
    for (const m of a.client.messages.filter((x) => x.type === 'error')) {
      expect(m.data).toEqual({ code: 'bad_message', message: 'dropId doit être un entier positif.' });
    }

    a.client.send('presence:view', { dropId: 999999 });
    a.client.send('presence:view', { dropId: hidden.id });
    await a.client.waitFor(() => a.client.count('error') === 7);
    for (const m of a.client.messages.filter((x) => x.type === 'error').slice(5)) {
      expect(m.data).toEqual({ code: 'drop_not_found', message: "Ce drop n'existe pas." });
    }
    expect((await server.api.get('/admin/realtime').set(ADMIN)).body.viewers).toEqual([{ dropId: drop.id, count: 1 }]);
  });

  it('accepte un drop verrouillé', async () => {
    server = await startServer();
    const a = await connectAs(server, 'demo');
    const b = await connectAs(server, 'lea');
    const drop = await createDrop(server, a.token);
    await server.api.patch('/admin/settings').set(ADMIN).send({ lockMode: 'on' });
    b.client.send('presence:view', { dropId: drop.id });
    expect(ids((await b.client.next('presence:drop')) as any)).toEqual([b.user.id]);
    expect(b.client.count('error')).toBe(0);
  });

  it('ferme en 4008 une rafale de presence:view', async () => {
    server = await startServer({ wsMessagesPer10s: 5 });
    const a = await connectAs(server, 'demo');
    const drop = await createDrop(server, a.token);
    for (let i = 0; i < 10; i++) a.client.send('presence:view', { dropId: drop.id });
    expect(await a.client.waitClosed()).toEqual({ code: 4008, reason: 'rate_limited' });
  });
});

describe('page de démonstration', () => {
  it('404 avec le bloc 2 désactivé, 200 activé, hors de /openapi.json, script autorisé par la CSP', async () => {
    const off = buildTestApp({ block2Enabled: false });
    for (const path of ['/ws-playground', '/ws-playground.js']) {
      const res = await off.api.get(path);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    }
    const on = buildTestApp({ block2Enabled: true });
    const page = await on.api.get('/ws-playground');
    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.text).toContain('<script src="/ws-playground.js"></script>');
    expect(page.text).not.toMatch(/https?:\/\/(?!localhost)/);
    const csp = page.headers['content-security-policy'];
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self' wss:");
    const script = await on.api.get('/ws-playground.js');
    expect(script.status).toBe(200);
    expect(script.headers['content-type']).toMatch(/javascript/);
    expect(script.text).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    const doc = (await on.api.get('/openapi.json')).body;
    expect(Object.keys(doc.paths).some((p) => p.includes('ws-playground'))).toBe(false);
    expect((await on.api.get('/contract.md')).text).toContain('/ws-playground');
    expect((await on.api.get('/openapi.json')).body.tags.find((t: any) => t.name === 'Temps réel').description).toContain(
      '/ws-playground',
    );
    expect((await off.api.get('/openapi.json')).text).not.toContain('ws-playground');
  });
});

describe('contrat', () => {
  it('/contract.md contient les types WebSocket à jour, sans marqueur non résolu', async () => {
    const { api } = buildTestApp({ block2Enabled: true });
    const text = (await api.get('/contract.md')).text;
    expect(text).not.toContain('${');
    expect(text).toContain("online: PublicUser[]");
    expect(text).toContain("'bad_message' | 'drop_not_found'");
  });
});

describe('présence simulée', () => {
  const timing = { tickMs: 20, minStayMs: 60, maxStayMs: 120 };

  it('fait apparaître 3 utilisateurs en ligne, les envoie sur un drop regardé, puis les fait partir', async () => {
    server = await startServer({}, { presenceDebounceMs: 20 }, { presenceTiming: timing, rng: () => 0.2 });
    const a = await connectAs(server, 'demo');
    const drop = await createDrop(server, a.token);
    a.client.send('presence:view', { dropId: drop.id });
    await a.client.next('presence:drop');

    const start = await server.api.post('/admin/simulator').set(ADMIN).send({ enabled: true, intervalSeconds: 3600 });
    expect(start.body).toEqual({ enabled: true, intervalSeconds: 3600, presence: true });
    const online = await a.client.waitFor((m) => m.type === 'presence:online' && m.data.users.length === 4);
    expect(online.data.users.map((u: { username: string }) => u.username)).toContain('demo');

    const stats = (await server.api.get('/admin/realtime').set(ADMIN)).body;
    expect(stats.simulated.online).toHaveLength(3);
    expect(stats.connections).toBe(1);
    expect(stats.byUser.map((u: any) => u.user.username)).toEqual(['demo']);
    expect(stats.simulated.online.map((u: any) => u.username)).not.toContain('demo');
    expect((await server.api.get('/admin/settings').set(ADMIN)).body.simulator.presence).toBe(true);

    const joined = await a.client.waitFor((m) => m.type === 'presence:drop' && ids(m as any).length >= 2);
    expect(joined.data.dropId).toBe(drop.id);
    const viewing = (await server.api.get('/admin/realtime').set(ADMIN)).body;
    expect(viewing.viewers).toEqual([{ dropId: drop.id, count: 1 }]);

    await server.api.post('/admin/simulator').set(ADMIN).send({ enabled: false });
    await a.client.waitFor(
      (m) => m.type === 'presence:online' && m.data.users.length === 1 && a.client.messages.indexOf(m) > a.client.messages.indexOf(online),
    );
    const after = (await server.api.get('/admin/realtime').set(ADMIN)).body;
    expect(after.simulated).toEqual({ online: [], viewing: [] });
  });

  it('un tick fait regarder un drop et le départ suit', async () => {
    server = await startServer({}, { presenceDebounceMs: 20 }, { presenceTiming: { tickMs: 3_600_000, minStayMs: 80, maxStayMs: 80 }, rng: () => 0.2 });
    const a = await connectAs(server, 'demo');
    const drop = await createDrop(server, a.token);
    a.client.send('presence:view', { dropId: drop.id });
    await a.client.next('presence:drop');
    const sim = server.app.locals.simulator as SimulatorControl;
    sim.configure(true, 3600);
    expect(sim.presenceTick()).toMatch(/^view:\d+:/);
    const stats = (await server.api.get('/admin/realtime').set(ADMIN)).body;
    expect(stats.simulated.viewing).toHaveLength(1);
    expect(stats.simulated.viewing[0].dropId).toBe(drop.id);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await server.api.get('/admin/realtime').set(ADMIN)).body.simulated.viewing).toEqual([]);
  });

  it('presence: false ne fait venir personne, et le désactiver à chaud retire les simulés', async () => {
    server = await startServer({}, { presenceDebounceMs: 20 }, { presenceTiming: timing });
    await server.api.post('/admin/simulator').set(ADMIN).send({ enabled: true, presence: false });
    expect((await server.api.get('/admin/realtime').set(ADMIN)).body.simulated.online).toEqual([]);
    expect((await server.api.get('/admin/settings').set(ADMIN)).body.simulator.presence).toBe(false);
    await server.api.post('/admin/simulator').set(ADMIN).send({ enabled: true });
    expect((await server.api.get('/admin/realtime').set(ADMIN)).body.simulated.online).toHaveLength(3);
    await server.api.patch('/admin/settings').set(ADMIN).send({ block2Enabled: false });
    await server.api.patch('/admin/settings').set(ADMIN).send({ block2Enabled: true });
    expect((await server.api.get('/admin/realtime').set(ADMIN)).body.simulated.online).toEqual([]);
  });
});
