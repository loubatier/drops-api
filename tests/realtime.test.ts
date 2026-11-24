import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, bearer } from './helpers.js';
import {
  type TestServer,
  connectAs,
  handshake,
  login,
  openSocket,
  startServer,
  ticketFor,
} from './ws-helpers.js';

const ADMIN = { 'X-Admin-Key': 'teacher-key' };
const dropBody = { title: 'Un drop en direct', content: 'Salut la classe', category: 'note', lat: 47.4955, lng: 6.8053 };

let server: TestServer | null = null;
afterEach(async () => {
  vi.useRealTimers();
  await server?.stop();
  server = null;
});

describe('réglages et documentation', () => {
  it('chaque route figure dans /openapi.json', async () => {
    const { api, app } = buildTestApp();
    const doc = (await api.get('/openapi.json')).body;
    const documented = new Set<string>();
    for (const [path, ops] of Object.entries<any>(doc.paths)) {
      for (const method of Object.keys(ops)) documented.add(`${method} ${path}`);
    }
    const routers = [app.locals.apiRouter];
    let count = 0;
    for (const router of routers) {
      for (const layer of router.stack) {
        if (!layer.route) continue;
        for (const method of Object.keys(layer.route.methods)) {
          count += 1;
          expect(documented.has(`${method} ${String(layer.route.path).replace(/:(\w+)/g, '{$1}')}`)).toBe(true);
        }
      }
    }
    expect(documented.size).toBe(count);
  });
});

describe('ticket', () => {
  it('exige un token et renvoie 201 avec un ticket opaque', async () => {
    server = await startServer();
    expect((await server.api.post('/realtime/ticket')).status).toBe(401);
    const { token } = await login(server, 'demo');
    const res = await server.api.post('/realtime/ticket').set(bearer(token));
    expect(res.status).toBe(201);
    expect(res.body.ticket).toMatch(/^wst_[A-Za-z0-9_-]{32,}$/);
    expect(res.body.url).toContain(`/ws?ticket=${res.body.ticket}`);
    expect(res.body.url).toMatch(/^wss?:\/\//);
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('est à usage unique', async () => {
    server = await startServer();
    const { token } = await login(server, 'demo');
    const { ticket } = await ticketFor(server, token);
    await openSocket(server, ticket);
    const second = await handshake(server, `?ticket=${ticket}`);
    expect(second.status).toBe(401);
    expect(second.body.error).toMatchObject({ status: 401, code: 'invalid_token', simulated: false });
    expect(second.body.error.requestId).toMatch(/^req_/);
  });

  it('expire', async () => {
    server = await startServer({ wsTicketTtlSeconds: 1 });
    const { token } = await login(server, 'demo');
    const { ticket } = await ticketFor(server, token);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const res = await handshake(server, `?ticket=${ticket}`);
    expect(res.status).toBe(401);
  });

  it('est refusé sans ticket ou avec un faux ticket, au format d’erreur', async () => {
    server = await startServer();
    for (const query of ['', '?ticket=', '?ticket=wst_inconnu']) {
      const res = await handshake(server, query);
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
      expect(res.body.error.fields).toEqual({});
    }
  });

  it('est refusé si le JWT a été révoqué entre-temps', async () => {
    server = await startServer();
    const { token } = await login(server, 'demo');
    const { ticket } = await ticketFor(server, token);
    await server.api.post('/auth/logout').set(bearer(token));
    const res = await handshake(server, `?ticket=${ticket}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('token_revoked');
  });

  it('accepte ?delay et ?fail', async () => {
    server = await startServer();
    const { token } = await login(server, 'demo');
    const res = await server.api.post('/realtime/ticket?fail=503').set(bearer(token));
    expect(res.status).toBe(503);
    expect(res.body.error.simulated).toBe(true);
  });
});

describe('WebSocket', () => {
  it('envoie hello puis répond à ping', async () => {
    server = await startServer();
    const { client, user } = await connectAs(server, 'demo');
    const hello = client.messages[0]!;
    expect(hello.type).toBe('hello');
    expect(hello.data.user).toEqual({ id: user.id, username: 'demo', displayName: user.displayName, avatarUrl: null });
    expect(hello.data).not.toHaveProperty('lockMode');
    expect(new Date(hello.data.serverTime).getTime()).not.toBeNaN();
    client.send('ping');
    expect((await client.next('pong')).data.serverTime).toBeTypeOf('string');
  });

  it('un drop créé par A arrive chez B, et chez A', async () => {
    server = await startServer();
    const a = await connectAs(server, 'demo');
    const b = await connectAs(server, 'lea');
    const created = await server.api.post('/drops').set(bearer(a.token)).send(dropBody);
    const atB = await b.client.next('drop:created');
    expect(atB.data.drop).toMatchObject({ id: created.body.id, title: 'Un drop en direct', isMine: false });
    const atA = await a.client.next('drop:created');
    expect(atA.data.drop.isMine).toBe(true);

    await server.api.patch(`/drops/${created.body.id}`).set(bearer(a.token)).send({ title: 'Titre modifié' });
    expect((await b.client.next('drop:updated')).data.drop.title).toBe('Titre modifié');
    await server.api.delete(`/drops/${created.body.id}`).set(bearer(a.token));
    expect((await b.client.next('drop:deleted')).data).toEqual({ dropId: created.body.id });
  });

  it('diffuse les likes, commentaires et suppressions de commentaires', async () => {
    server = await startServer();
    const a = await connectAs(server, 'demo');
    const b = await connectAs(server, 'lea');
    const drop = (await server.api.post('/drops').set(bearer(a.token)).send(dropBody)).body;
    await server.api.post(`/drops/${drop.id}/like`).set(bearer(b.token));
    expect((await a.client.next('like:updated')).data).toEqual({ dropId: drop.id, likesCount: 1, dislikesCount: 0 });
    const comment = (await server.api.post(`/drops/${drop.id}/comments`).set(bearer(b.token)).send({ content: 'Top' })).body;
    const received = await a.client.next('comment:created');
    expect(received.data.comment).toMatchObject({ id: comment.id, dropId: drop.id, isMine: false });
    expect((await b.client.next('comment:created')).data.comment.isMine).toBe(true);
    await server.api.delete(`/comments/${comment.id}`).set(bearer(b.token));
    expect((await a.client.next('comment:deleted')).data).toEqual({ dropId: drop.id, commentId: comment.id });
  });

  it('présence en ligne et par drop', async () => {
    server = await startServer();
    const a = await connectAs(server, 'demo');
    const online = await a.client.waitFor((m) => m.type === 'presence:online');
    expect(online.data.users.map((u: any) => u.username)).toEqual(['demo']);
    const b = await connectAs(server, 'lea');
    await a.client.waitFor((m) => m.type === 'presence:online' && m.data.users.length === 2);
    const drop = (await server.api.post('/drops').set(bearer(a.token)).send(dropBody)).body;

    b.client.send('presence:view', { dropId: drop.id });
    const viewing = await a.client.waitFor((m) => m.type === 'presence:drop' && m.data.viewers.length === 1);
    expect(viewing.data.dropId).toBe(drop.id);
    expect(viewing.data.viewers[0].username).toBe('lea');
    expect((await server.api.get('/admin/realtime').set(ADMIN)).body.viewers).toEqual([{ dropId: drop.id, count: 1 }]);

    b.client.send('presence:leave');
    await a.client.waitFor((m) => m.type === 'presence:drop' && m.data.viewers.length === 0);
    b.client.ws.close();
    await a.client.waitFor((m) => m.type === 'presence:online' && m.data.users.length === 1);
  });

  it('presence:view remplace le drop précédent et refuse un drop inconnu', async () => {
    server = await startServer();
    const a = await connectAs(server, 'demo');
    const one = (await server.api.post('/drops').set(bearer(a.token)).send(dropBody)).body;
    const two = (await server.api.post('/drops').set(bearer(a.token)).send(dropBody)).body;
    a.client.send('presence:view', { dropId: one.id });
    a.client.send('presence:view', { dropId: two.id });
    await a.client.waitFor((m) => m.type === 'presence:drop' && m.data.dropId === two.id && m.data.viewers.length === 1);
    expect((await server.api.get('/admin/realtime').set(ADMIN)).body.viewers).toEqual([{ dropId: two.id, count: 1 }]);
    a.client.send('presence:view', { dropId: 999999 });
    expect((await a.client.next('error')).data.code).toBe('drop_not_found');
  });

  it('notifications reçues uniquement par l’auteur, jamais pour ses propres actions', async () => {
    server = await startServer();
    const a = await connectAs(server, 'demo');
    const b = await connectAs(server, 'lea');
    const c = await connectAs(server, 'zoe');
    const drop = (await server.api.post('/drops').set(bearer(a.token)).send(dropBody)).body;

    await server.api.post(`/drops/${drop.id}/like`).set(bearer(b.token));
    await server.api.post(`/drops/${drop.id}/comments`).set(bearer(c.token)).send({ content: 'Bien vu' });
    const liked = await a.client.waitFor((m) => m.type === 'notification' && m.data.kind === 'drop_liked');
    expect(liked.data).toMatchObject({ dropId: drop.id, dropTitle: 'Un drop en direct', by: { username: 'lea' } });
    const commented = await a.client.waitFor((m) => m.type === 'notification' && m.data.kind === 'drop_commented');
    expect(commented.data.by.username).toBe('zoe');

    await server.api.delete(`/drops/${drop.id}/like`).set(bearer(b.token));
    await server.api.post(`/drops/${drop.id}/like`).set(bearer(a.token));
    await server.api.post(`/drops/${drop.id}/comments`).set(bearer(a.token)).send({ content: 'Merci' });
    await a.client.next('comment:created');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(a.client.count('notification')).toBe(2);
    expect(b.client.count('notification')).toBe(0);
    expect(c.client.count('notification')).toBe(0);
  });

  it('un message invalide reçoit error sans fermer la connexion', async () => {
    server = await startServer();
    const { client } = await connectAs(server, 'demo');
    client.sendRaw('pas du json');
    expect((await client.next('error')).data.code).toBe('bad_message');
    client.send('inconnu');
    await client.waitFor((m) => m.type === 'error' && /inconnu/.test(m.data.message));
    client.sendRaw('[1,2]');
    client.sendRaw(JSON.stringify({ type: 'presence:view', data: { dropId: 'x' } }));
    await client.waitFor((m) => m.type === 'error' && /dropId/.test(m.data.message));
    expect(client.closed).toBeNull();
    client.send('ping');
    await client.next('pong');
  });

  it('ferme avec 4008 en cas de rafale', async () => {
    server = await startServer({ wsMessagesPer10s: 5 });
    const { client } = await connectAs(server, 'demo');
    for (let i = 0; i < 8; i++) client.send('ping');
    expect(await client.waitClosed()).toEqual({ code: 4008, reason: 'rate_limited' });
  });

  it('ferme la plus ancienne connexion avec 4009 au-delà de 5', async () => {
    server = await startServer();
    const { token } = await login(server, 'demo');
    const clients = [];
    for (let i = 0; i < 6; i++) {
      const { ticket } = await ticketFor(server, token);
      clients.push(await openSocket(server, ticket));
    }
    expect(await clients[0]!.waitClosed()).toEqual({ code: 4009, reason: 'too_many_connections' });
    expect(clients.slice(1).every((c) => c.closed === null)).toBe(true);
    const stats = (await server.api.get('/admin/realtime').set(ADMIN)).body;
    expect(stats.connections).toBe(5);
    expect(stats.byUser[0]).toMatchObject({ connections: 5, user: { username: 'demo' } });
  });

  it('ferme avec 4001 après un logout', async () => {
    server = await startServer();
    const { client, token } = await connectAs(server, 'demo');
    await server.api.post('/auth/logout').set(bearer(token));
    server.realtime.checkSessions();
    expect(await client.waitClosed()).toEqual({ code: 4001, reason: 'session_expired' });
  });

  it('ferme avec 4001 quand le JWT d’origine expire (horloge simulée)', async () => {
    server = await startServer();
    const { client } = await connectAs(server, 'demo', 10);
    server.realtime.checkSessions();
    expect(client.closed).toBeNull();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 11_000);
    server.realtime.checkSessions();
    expect(await client.waitClosed()).toEqual({ code: 4001, reason: 'session_expired' });
  });

  it('vérifie les sessions périodiquement', async () => {
    server = await startServer({}, { presenceDebounceMs: 30, sessionCheckMs: 50 });
    const { client, token } = await connectAs(server, 'demo');
    await server.api.post('/auth/logout').set(bearer(token));
    expect((await client.waitClosed()).code).toBe(4001);
  });

  it('ferme avec 4011 sur disconnect-all', async () => {
    server = await startServer();
    const a = await connectAs(server, 'demo');
    const b = await connectAs(server, 'lea');
    const res = await server.api.post('/admin/realtime/disconnect-all').set(ADMIN);
    expect(res.body).toEqual({ disconnected: 2 });
    expect(await a.client.waitClosed()).toEqual({ code: 4011, reason: 'admin_disconnect' });
    expect((await b.client.waitClosed()).code).toBe(4011);
  });

  it('ferme avec 4010 à l’arrêt propre', async () => {
    server = await startServer();
    const { client } = await connectAs(server, 'demo');
    await server.realtime.close();
    expect(await client.waitClosed()).toEqual({ code: 4010, reason: 'server_restart' });
  });

  it('GET /admin/realtime exige la clé admin', async () => {
    server = await startServer();
    expect((await server.api.get('/admin/realtime')).status).toBe(403);
  });
});

describe('sérialisation par destinataire', () => {
  it('un drop masqué n’est diffusé qu’à son auteur, les autres reçoivent drop:deleted', async () => {
    server = await startServer({ reportHideThreshold: 1 });
    const a = await connectAs(server, 'demo');
    const b = await connectAs(server, 'lea');
    const drop = (await server.api.post('/drops').set(bearer(a.token)).send(dropBody)).body;
    await b.client.next('drop:created');
    await server.api.post(`/drops/${drop.id}/report`).set(bearer(b.token)).send({ reason: 'spam' });
    expect((await b.client.next('drop:deleted')).data).toEqual({ dropId: drop.id });
    const update = await a.client.waitFor((m) => m.type === 'drop:updated');
    expect(update.data.drop.hidden).toBe(true);
    await server.api.post(`/admin/drops/${drop.id}/unhide`).set(ADMIN);
    expect((await b.client.next('drop:updated')).data.drop.hidden).toBe(false);
  });
});
