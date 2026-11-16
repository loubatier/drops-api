import { afterEach, describe, expect, it, vi } from 'vitest';
import { foldText } from '../src/db/index.js';
import { events } from '../src/events.js';
import { haversineMeters } from '../src/geo.js';
import { bearer } from './helpers.js';
import { type TestServer, connectAs, login, startServer } from './ws-helpers.js';

const ADMIN = { 'X-Admin-Key': 'teacher-key' };
const CENTER = { lat: 47.495472, lng: 6.805279 };
const M_PER_DEG = (Math.PI * 6371008.8) / 180;
const northOf = (lat: number, meters: number) => lat + meters / M_PER_DEG;

let server: TestServer | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await server?.stop();
  server = null;
});

interface Row {
  id: number;
  title: string;
  content: string;
  lat: number;
  lng: number;
  author_id: number;
  category: string;
  username: string;
}

const allDrops = (s: TestServer) =>
  s.db
    .prepare('SELECT d.*, u.username FROM drops d JOIN users u ON u.id = d.author_id WHERE d.hidden = 0')
    .all() as Row[];

async function createDrop(s: TestServer, token: string, lat: number, lng: number, extra: Record<string, unknown> = {}) {
  const res = await s.api
    .post('/drops')
    .set(bearer(token))
    .send({ title: 'Drop de test', content: 'Contenu de test', category: 'note', lat, lng, ...extra });
  expect(res.status).toBe(201);
  return res.body as { id: number; location: { lat: number; lng: number } };
}

describe('recherche géographique : near et radius', () => {
  it('ne renvoie que les drops du rayon, avec distanceM, triés par distance par défaut', async () => {
    server = await startServer();
    const near = `${CENTER.lat},${CENTER.lng}`;
    const res = await server.api.get(`/drops?near=${near}&radius=600&pageSize=50`);
    expect(res.status).toBe(200);
    const expected = allDrops(server).filter((d) => haversineMeters(CENTER.lat, CENTER.lng, d.lat, d.lng) <= 600);
    expect(res.body.total).toBe(expected.length);
    expect(expected.length).toBeGreaterThan(3);
    const distances = res.body.items.map((d: any) => d.distanceM);
    expect(distances.every((n: unknown) => Number.isInteger(n))).toBe(true);
    expect(distances).toEqual([...distances].sort((a: number, b: number) => a - b));
    expect(Math.max(...distances)).toBeLessThanOrEqual(600);
    const byId = new Map(allDrops(server).map((d) => [d.id, d]));
    for (const item of res.body.items) {
      const row = byId.get(item.id)!;
      expect(item.distanceM).toBe(Math.round(haversineMeters(CENTER.lat, CENTER.lng, row.lat, row.lng)));
    }
  });

  it('radius vaut 1000 par défaut, et distanceM est absent sans near', async () => {
    server = await startServer();
    const near = `${CENTER.lat},${CENTER.lng}`;
    const implicit = await server.api.get(`/drops?near=${near}&pageSize=50`);
    const explicit = await server.api.get(`/drops?near=${near}&radius=1000&pageSize=50`);
    expect(implicit.body).toEqual(explicit.body);
    const plain = await server.api.get('/drops');
    expect(plain.body.items.every((d: any) => !('distanceM' in d))).toBe(true);
    const detail = await server.api.get('/drops/1');
    expect('distanceM' in detail.body).toBe(false);
  });

  it('sort=recent et sort=popular restent possibles avec near', async () => {
    server = await startServer();
    const near = `${CENTER.lat},${CENTER.lng}`;
    const recent = await server.api.get(`/drops?near=${near}&radius=1500&sort=recent&pageSize=50`);
    const dates = recent.body.items.map((d: any) => d.createdAt);
    expect(dates).toEqual([...dates].sort().reverse());
    const popular = await server.api.get(`/drops?near=${near}&radius=1500&sort=popular&pageSize=50`);
    const likes = popular.body.items.map((d: any) => d.likesCount);
    expect(likes).toEqual([...likes].sort((a: number, b: number) => b - a));
    expect(popular.body.items[0]).toHaveProperty('distanceM');
  });

  it('se combine avec q, category, author et la pagination', async () => {
    server = await startServer();
    const near = `${CENTER.lat},${CENTER.lng}`;
    const all = await server.api.get(`/drops?near=${near}&radius=3000&pageSize=50`);
    const tips = await server.api.get(`/drops?near=${near}&radius=3000&category=tip&pageSize=50`);
    const expectedTips = allDrops(server).filter(
      (d) => d.category === 'tip' && haversineMeters(CENTER.lat, CENTER.lng, d.lat, d.lng) <= 3000,
    );
    expect(tips.body.total).toBe(expectedTips.length);
    const page1 = await server.api.get(`/drops?near=${near}&radius=3000&pageSize=10&page=1`);
    const page2 = await server.api.get(`/drops?near=${near}&radius=3000&pageSize=10&page=2`);
    expect(page1.body.items).toHaveLength(10);
    expect(page2.body.items.map((d: any) => d.id)).toEqual(all.body.items.slice(10, 20).map((d: any) => d.id));
    expect(page1.body.totalPages).toBe(Math.ceil(all.body.total / 10));
    const author = all.body.items[0].author.username;
    const mine = await server.api.get(`/drops?near=${near}&radius=3000&author=${author}&pageSize=50`);
    expect(mine.body.items.every((d: any) => d.author.username === author)).toBe(true);
    const title = all.body.items[0].title.split(' ')[0];
    const search = await server.api.get(`/drops?near=${near}&radius=3000&q=${encodeURIComponent(title)}&pageSize=50`);
    expect(search.body.items.map((d: any) => d.id)).toContain(all.body.items[0].id);
    const beyond = await server.api.get(`/drops?near=${near}&radius=3000&page=99`);
    expect(beyond.body.items).toEqual([]);
  });

  it('exclut les drops masqués', async () => {
    server = await startServer();
    server.db.prepare('UPDATE drops SET hidden = 1 WHERE id = 1').run();
    const row = server.db.prepare('SELECT lat, lng FROM drops WHERE id = 1').get() as { lat: number; lng: number };
    const res = await server.api.get(`/drops?near=${row.lat},${row.lng}&radius=5&pageSize=50`);
    expect(res.body.items.map((d: any) => d.id)).not.toContain(1);
  });

  it('refuse les valeurs invalides sous la clé du paramètre', async () => {
    server = await startServer();
    for (const near of ['abc', '1,2,3', '91,0', '0,181', '47.4,', ',6.8', '47.4;6.8']) {
      const res = await server.api.get(`/drops?near=${encodeURIComponent(near)}`);
      expect(res.status, near).toBe(422);
      expect(res.body.error.fields.near).toHaveLength(1);
    }
    for (const radius of ['0', '5001', 'x', '1.5', '-3']) {
      const res = await server.api.get(`/drops?near=47.4,6.8&radius=${radius}`);
      expect(res.status, radius).toBe(422);
      expect(res.body.error.fields.radius).toBeDefined();
    }
  });

  it('radius sans near : 422 sur radius ; sort=distance sans near : 422 sur sort', async () => {
    server = await startServer();
    const radius = await server.api.get('/drops?radius=500');
    expect(radius.status).toBe(422);
    expect(Object.keys(radius.body.error.fields)).toEqual(['radius']);
    const sort = await server.api.get('/drops?sort=distance');
    expect(sort.status).toBe(422);
    expect(Object.keys(sort.body.error.fields)).toEqual(['sort']);
    const bad = await server.api.get('/drops?sort=nope');
    expect(bad.body.error.fields.sort).toBeDefined();
  });

  it('near et bbox ensemble : 422 sur les deux', async () => {
    server = await startServer();
    const res = await server.api.get('/drops?near=47.4,6.8&bbox=6.7,47.4,6.9,47.6');
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['bbox', 'near']);
  });
});

describe('recherche géographique : bbox', () => {
  it('filtre par rectangle, longitude d’abord', async () => {
    server = await startServer();
    const box = { minLng: 6.8, minLat: 47.49, maxLng: 6.81, maxLat: 47.5 };
    const res = await server.api.get(`/drops?bbox=${box.minLng},${box.minLat},${box.maxLng},${box.maxLat}&pageSize=50`);
    expect(res.status).toBe(200);
    const expected = allDrops(server).filter(
      (d) => d.lng >= box.minLng && d.lng <= box.maxLng && d.lat >= box.minLat && d.lat <= box.maxLat,
    );
    expect(expected.length).toBeGreaterThan(3);
    expect(res.body.total).toBe(expected.length);
    expect(res.body.items.every((d: any) => !('distanceM' in d))).toBe(true);
    for (const d of res.body.items) {
      expect(d.location.lng).toBeGreaterThanOrEqual(box.minLng);
      expect(d.location.lat).toBeLessThanOrEqual(box.maxLat);
    }
  });

  it('piège de l’ordre : lat,lng,lat,lng ne renvoie rien en Franche-Comté', async () => {
    server = await startServer();
    const res = await server.api.get('/drops?bbox=47.49,6.8,47.5,6.81');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('refuse un format faux, des bornes dépassées et min > max, sous la clé bbox', async () => {
    server = await startServer();
    for (const bbox of ['1,2,3', 'a,b,c,d', '181,0,182,1', '0,-91,1,0', '6.82,47.48,6.79,47.51', '6.79,47.51,6.82,47.48', '1,2,3,']) {
      const res = await server.api.get(`/drops?bbox=${encodeURIComponent(bbox)}`);
      expect(res.status, bbox).toBe(422);
      expect(res.body.error.fields.bbox).toHaveLength(1);
    }
  });

  it('autorise pageSize jusqu’à 200 avec bbox seulement', async () => {
    server = await startServer();
    const big = await server.api.get('/drops?bbox=6.7,47.4,6.9,47.6&pageSize=200');
    expect(big.status).toBe(200);
    expect(big.body.pageSize).toBe(200);
    expect(big.body.items).toHaveLength(60);
    const tooBig = await server.api.get('/drops?bbox=6.7,47.4,6.9,47.6&pageSize=201');
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.error.fields.pageSize).toBeDefined();
    const noBbox = await server.api.get('/drops?pageSize=51');
    expect(noBbox.status).toBe(422);
    expect(noBbox.body.error.fields.pageSize).toEqual(['Doit être un entier entre 1 et 50.']);
    const nearOnly = await server.api.get('/drops?near=47.4,6.8&pageSize=51');
    expect(nearOnly.status).toBe(422);
  });

  it('respecte BBOX_MAX_PAGE_SIZE', async () => {
    server = await startServer({ bboxMaxPageSize: 100 });
    expect((await server.api.get('/drops?bbox=6.7,47.4,6.9,47.6&pageSize=100')).status).toBe(200);
    expect((await server.api.get('/drops?bbox=6.7,47.4,6.9,47.6&pageSize=101')).status).toBe(422);
  });
});

describe('bloc 2 désactivé : le bloc 1 est inchangé', () => {
  it('near, radius et bbox sont ignorés comme des paramètres inconnus', async () => {
    server = await startServer({ block2Enabled: false });
    const plain = await server.api.get('/drops?pageSize=50');
    for (const query of ['near=47.4,6.8', 'near=abc', 'radius=5', 'bbox=1,2,3', 'near=1,1&bbox=1,1,2,2&radius=0']) {
      const res = await server.api.get(`/drops?pageSize=50&${query}`);
      expect(res.status, query).toBe(200);
      expect(res.body).toEqual(plain.body);
    }
  });

  it('sort=distance et pageSize > 50 restent des erreurs 422', async () => {
    server = await startServer({ block2Enabled: false });
    const sort = await server.api.get('/drops?sort=distance');
    expect(sort.status).toBe(422);
    expect(sort.body.error.fields.sort).toEqual(['Doit valoir recent ou popular.']);
    const size = await server.api.get('/drops?bbox=6.7,47.4,6.9,47.6&pageSize=51');
    expect(size.status).toBe(422);
    expect(size.body.error.fields.pageSize).toEqual(['Doit être un entier entre 1 et 50.']);
  });

  it('open et opens renvoient 404 ; un drop n’est jamais verrouillé', async () => {
    server = await startServer({ block2Enabled: false });
    const { token } = await login(server, 'demo');
    const open = await server.api.post('/drops/1/open').set(bearer(token)).send({ lat: 47.4, lng: 6.8 });
    expect(open.status).toBe(404);
    expect((await server.api.get('/drops/1/opens').set(bearer(token))).status).toBe(404);
    const drop = (await server.api.get('/drops/1')).body;
    expect(drop).toMatchObject({ locked: false, location: { precision: 'exact' } });
    expect(drop.content).toBeTypeOf('string');
  });
});

describe('ouverture', () => {
  const seedTarget = (s: TestServer, notAuthor: string) => {
    const user = s.db.prepare('SELECT id FROM users WHERE username = ?').get(notAuthor) as { id: number };
    return s.db.prepare('SELECT * FROM drops WHERE author_id != ? AND hidden = 0 ORDER BY id LIMIT 1').get(user.id) as Row;
  };

  it('exige un token, un drop existant et visible', async () => {
    server = await startServer();
    expect((await server.api.post('/drops/1/open').send({ lat: 1, lng: 1 })).status).toBe(401);
    const { token } = await login(server, 'demo');
    expect((await server.api.post('/drops/99999/open').set(bearer(token)).send({ lat: 1, lng: 1 })).status).toBe(404);
    expect((await server.api.post('/drops/abc/open').set(bearer(token)).send({ lat: 1, lng: 1 })).status).toBe(404);
    const target = seedTarget(server, 'demo');
    server.db.prepare('UPDATE drops SET hidden = 1 WHERE id = ?').run(target.id);
    const hidden = await server.api.post(`/drops/${target.id}/open`).set(bearer(token)).send({ lat: target.lat, lng: target.lng });
    expect(hidden.status).toBe(404);
  });

  it('valide strictement le corps, erreurs de coordonnées sous location', async () => {
    server = await startServer();
    const { token } = await login(server, 'demo');
    const target = seedTarget(server, 'demo');
    const post = (body: unknown) => server!.api.post(`/drops/${target.id}/open`).set(bearer(token)).send(body as object);
    const asString = await post({ lat: '47.49', lng: 6.8 });
    expect(asString.status).toBe(422);
    expect(asString.body.error.fields.location).toEqual(['Doit être un nombre.']);
    expect((await post({ lat: 95, lng: 6.8 })).body.error.fields.location).toBeDefined();
    expect((await post({ lng: 6.8 })).body.error.fields.location).toEqual(['Champ requis.']);
    expect((await post({ lat: 47.4, lng: 6.8, accuracy: -1 })).body.error.fields.accuracy).toBeDefined();
    expect((await post({ lat: 47.4, lng: 6.8, accuracy: 10001 })).body.error.fields.accuracy).toBeDefined();
    expect((await post({ lat: 47.4, lng: 6.8, accuracy: 'x' })).body.error.fields.accuracy).toBeDefined();
    const unknown = await post({ lat: 47.4, lng: 6.8, speed: 3 });
    expect(unknown.body.error.fields.speed).toEqual(['Champ inconnu.']);
  });

  it('accepte dans le rayon, enregistre une seule ouverture et renvoie le drop', async () => {
    server = await startServer();
    const { token, user } = await login(server, 'demo');
    const target = seedTarget(server, 'demo');
    const opened = vi.fn();
    const off = events.on('drop:opened', (payload, source) => source === server!.db && opened(payload));
    const first = await server.api
      .post(`/drops/${target.id}/open`)
      .set(bearer(token))
      .send({ lat: northOf(target.lat, 30), lng: target.lng });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ id: target.id, openedByMe: true, locked: false, content: target.content });
    expect(first.body.opensCount).toBe(1);
    const again = await server.api.post(`/drops/${target.id}/open`).set(bearer(token)).send({ lat: target.lat, lng: target.lng });
    expect(again.status).toBe(200);
    expect(again.body.opensCount).toBe(1);
    off();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith({ dropId: target.id, userId: user.id, opensCount: 1 });
    const rows = server.db.prepare('SELECT * FROM opens WHERE drop_id = ?').all(target.id);
    expect(rows).toHaveLength(1);
  });

  it('tient compte de accuracy, plafonnée par OPEN_ACCURACY_CAP_M', async () => {
    server = await startServer();
    const { token } = await login(server, 'demo');
    const [a, b, c] = allDrops(server).filter((d) => d.username !== 'demo').slice(0, 3) as [Row, Row, Row];
    const open = (row: Row, meters: number, accuracy?: number) =>
      server!.api
        .post(`/drops/${row.id}/open`)
        .set(bearer(token))
        .send({ lat: northOf(row.lat, meters), lng: row.lng, ...(accuracy === undefined ? {} : { accuracy }) });
    expect((await open(a, 70)).status).toBe(403);
    expect((await open(a, 70, 10)).status).toBe(403);
    expect((await open(a, 70, 25)).status).toBe(200);
    expect((await open(b, 95, 5000)).status).toBe(200);
    const capped = await open(c, 140, 5000);
    expect(capped.status).toBe(403);
    expect(capped.body.error.meta.distanceM).toBe(140);
  });

  it('refuse de trop loin avec code, message et meta arrondie à la dizaine', async () => {
    server = await startServer();
    const { token } = await login(server, 'demo');
    const target = seedTarget(server, 'demo');
    const res = await server.api
      .post(`/drops/${target.id}/open`)
      .set(bearer(token))
      .send({ lat: northOf(target.lat, 234), lng: target.lng });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({
      status: 403,
      code: 'too_far',
      message: 'Vous êtes à 230 m de ce drop. Approchez-vous à moins de 50 m.',
      fields: {},
      simulated: false,
      meta: { distanceM: 230, requiredM: 50 },
    });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    const count = server.db.prepare('SELECT COUNT(*) AS n FROM opens').get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('error.meta n’apparaît que sur too_far', async () => {
    server = await startServer();
    const { token } = await login(server, 'demo');
    const res = await server.api.get('/drops/99999').set(bearer(token));
    expect(res.body.error).not.toHaveProperty('meta');
  });

  it('l’auteur qui ouvre son drop reçoit 200 sans enregistrement ni événement', async () => {
    server = await startServer();
    const { token } = await login(server, 'demo');
    const mine = await createDrop(server, token, 47.4955, 6.8053);
    const opened = vi.fn();
    const off = events.on('drop:opened', opened);
    const res = await server.api.post(`/drops/${mine.id}/open`).set(bearer(token)).send({ lat: 10, lng: 10 });
    off();
    expect(res.status).toBe(200);
    expect(res.body.isMine).toBe(true);
    expect(res.body.opensCount).toBe(0);
    expect(opened).not.toHaveBeenCalled();
    expect(server.db.prepare('SELECT COUNT(*) AS n FROM opens').get()).toEqual({ n: 0 });
  });

  it('la position envoyée n’est ni stockée ni journalisée', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => void logs.push(args.join(' ')));
    server = await startServer({ logRequests: true });
    const { token } = await login(server, 'demo');
    const target = seedTarget(server, 'demo');
    const lat = Number(northOf(target.lat, 20).toFixed(9));
    const lng = Number((target.lng + 0.0000123456).toFixed(9));
    const ok = await server.api.post(`/drops/${target.id}/open`).set(bearer(token)).send({ lat, lng, accuracy: 7.123456 });
    expect(ok.status).toBe(200);
    const far = await server.api.post(`/drops/${target.id + 1}/open`).set(bearer(token)).send({ lat, lng });
    const dump = JSON.stringify([
      ...['users', 'drops', 'likes', 'comments', 'opens', 'reports', 'revoked_tokens', 'settings'].map((t) =>
        server!.db.prepare(`SELECT * FROM ${t}`).all(),
      ),
    ]);
    const secrets = [String(lat), String(lng), '7.123456'];
    for (const secret of secrets) {
      expect(dump).not.toContain(secret);
      expect(logs.join('\n')).not.toContain(secret);
      expect(JSON.stringify(ok.body)).not.toContain(secret);
      expect(JSON.stringify(far.body)).not.toContain(secret);
    }
    expect(logs.some((l) => l.includes('/open'))).toBe(true);
  });

  it('limite les tentatives par minute et par utilisateur', async () => {
    server = await startServer({ rateLimit: { read: 600, write: 60, auth: 60, open: 3 } });
    const { token } = await login(server, 'demo');
    const other = await login(server, 'lea');
    const target = seedTarget(server, 'demo');
    for (let i = 0; i < 3; i++) {
      const res = await server.api.post(`/drops/${target.id}/open`).set(bearer(token)).send({ lat: 1, lng: 1 });
      expect(res.status).toBe(403);
    }
    const limited = await server.api.post(`/drops/${target.id}/open`).set(bearer(token)).send({ lat: 1, lng: 1 });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(limited.headers['retry-after']).toBeDefined();
    const unaffected = await server.api.post(`/drops/${target.id}/open`).set(bearer(other.token)).send({ lat: 1, lng: 1 });
    expect(unaffected.status).toBe(403);
  });

  it('accepte ?delay et ?fail', async () => {
    server = await startServer();
    const { token } = await login(server, 'demo');
    const res = await server.api.post('/drops/1/open?fail=422').set(bearer(token)).send({ lat: 1, lng: 1 });
    expect(res.status).toBe(422);
    expect(res.body.error.fields).toEqual({ lat: ['Erreur simulée sur ce champ.'], lng: ['Erreur simulée sur ce champ.'] });
  });

  it('GET /drops/:id/opens : auteur uniquement, paginé', async () => {
    server = await startServer();
    const a = await login(server, 'demo');
    const mine = await createDrop(server, a.token, 47.4955, 6.8053);
    for (const name of ['lea', 'zoe', 'yanis']) {
      const user = await login(server, name);
      const res = await server.api
        .post(`/drops/${mine.id}/open`)
        .set(bearer(user.token))
        .send({ lat: 47.4955, lng: 6.8053 });
      expect(res.status, name).toBe(200);
    }
    const list = await server.api.get(`/drops/${mine.id}/opens?pageSize=2`).set(bearer(a.token));
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items[0]).toEqual({ user: expect.objectContaining({ username: expect.any(String) }), openedAt: expect.any(String) });
    expect(JSON.stringify(list.body)).not.toContain('email');
    const other = await login(server, 'lea');
    const forbidden = await server.api.get(`/drops/${mine.id}/opens`).set(bearer(other.token));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('forbidden');
    expect((await server.api.get(`/drops/${mine.id}/opens`)).status).toBe(401);
    expect((await server.api.get('/drops/99999/opens').set(bearer(a.token))).status).toBe(404);
  });

  it('première ouverture : drop:opened pour tous et notification pour l’auteur seulement, pas à la réouverture', async () => {
    server = await startServer();
    const a = await connectAs(server, 'demo');
    const b = await connectAs(server, 'lea');
    const c = await connectAs(server, 'zoe');
    const mine = await createDrop(server, a.token, 47.4955, 6.8053);
    const post = () =>
      server!.api.post(`/drops/${mine.id}/open`).set(bearer(b.token)).send({ lat: 47.4955, lng: 6.8053 });
    await post();
    expect((await c.client.next('drop:opened')).data).toEqual({ dropId: mine.id, opensCount: 1 });
    const notification = await a.client.next('notification');
    expect(notification.data).toMatchObject({ kind: 'drop_opened', dropId: mine.id, by: { username: 'lea' } });
    expect(JSON.stringify(a.client.messages)).not.toMatch(/"lat":\s*47\.4955[^}]*"by"/);
    await post();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(a.client.count('notification')).toBe(1);
    expect(c.client.count('drop:opened')).toBe(1);
    expect(b.client.count('notification')).toBe(0);
    expect(c.client.count('notification')).toBe(0);
  });
});

describe('verrouillage (lockMode on)', () => {
  const lockOn = (s: TestServer) => s.api.patch('/admin/settings').set(ADMIN).send({ lockMode: 'on' });

  it('un drop non ouvert est verrouillé : contenu et image masqués, position approchée', async () => {
    server = await startServer();
    const author = await login(server, 'demo');
    const mine = await createDrop(server, author.token, 47.49551, 6.80546, {
      category: 'photo',
      imageUrl: 'https://exemple.test/p.jpg',
      content: 'Contenu secret',
    });
    await lockOn(server);

    const visitor = (await server.api.get(`/drops/${mine.id}`)).body;
    expect(visitor).toMatchObject({
      id: mine.id,
      locked: true,
      content: null,
      imageUrl: null,
      title: 'Drop de test',
      category: 'photo',
      location: { lat: 47.496, lng: 6.805, precision: 'approx' },
      likesCount: 0,
      commentsCount: 0,
      author: { username: 'demo' },
      isMine: false,
    });
    expect(visitor.createdAt).toBeTypeOf('string');
    expect(JSON.stringify(visitor)).not.toContain('Contenu secret');
    expect((await server.api.get(`/drops/${mine.id}`)).body.location).toEqual(visitor.location);

    const other = await login(server, 'lea');
    const asOther = (await server.api.get(`/drops/${mine.id}`).set(bearer(other.token))).body;
    expect(asOther).toMatchObject({ locked: true, content: null, location: { precision: 'approx' } });

    const asAuthor = (await server.api.get(`/drops/${mine.id}`).set(bearer(author.token))).body;
    expect(asAuthor).toMatchObject({ locked: false, content: 'Contenu secret', imageUrl: 'https://exemple.test/p.jpg' });
    expect(asAuthor.location).toEqual({ lat: 47.49551, lng: 6.80546, precision: 'exact' });
  });

  it('la liste verrouille aussi, et l’arrondi est une grille fixe', async () => {
    server = await startServer();
    await lockOn(server);
    const res = await server.api.get('/drops?pageSize=50');
    for (const d of res.body.items) {
      expect(d.locked).toBe(true);
      expect(d.content).toBeNull();
      expect(d.imageUrl).toBeNull();
      expect(d.location.precision).toBe('approx');
      expect(Number((d.location.lat * 1000).toFixed(6)) % 1).toBe(0);
      expect(Number((d.location.lng * 1000).toFixed(6)) % 1).toBe(0);
    }
    const first = await server.api.get('/drops?pageSize=50');
    expect(first.body).toEqual(res.body);
  });

  it('ouvrir déverrouille pour soi seulement', async () => {
    server = await startServer();
    const author = await login(server, 'demo');
    const mine = await createDrop(server, author.token, 47.4955, 6.8053, { content: 'Contenu secret' });
    await lockOn(server);
    const b = await login(server, 'lea');
    const c = await login(server, 'zoe');
    const opened = await server.api
      .post(`/drops/${mine.id}/open`)
      .set(bearer(b.token))
      .send({ lat: 47.4955, lng: 6.8053 });
    expect(opened.body).toMatchObject({ locked: false, content: 'Contenu secret', openedByMe: true });
    expect(opened.body.location).toEqual({ lat: 47.4955, lng: 6.8053, precision: 'exact' });
    const bSees = (await server.api.get(`/drops/${mine.id}`).set(bearer(b.token))).body;
    expect(bSees).toMatchObject({ locked: false, content: 'Contenu secret' });
    const cSees = (await server.api.get(`/drops/${mine.id}`).set(bearer(c.token))).body;
    expect(cSees).toMatchObject({ locked: true, content: null });
    expect(cSees.opensCount).toBe(1);
  });

  it('commentaires, likes : 403 drop_locked tant que le drop n’est pas ouvert', async () => {
    server = await startServer();
    const author = await login(server, 'demo');
    const mine = await createDrop(server, author.token, 47.4955, 6.8053);
    await lockOn(server);
    const b = await login(server, 'lea');
    const expectLocked = (res: any) => {
      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({
        status: 403,
        code: 'drop_locked',
        message: 'Ouvrez ce drop pour voir et réagir.',
        fields: {},
        simulated: false,
      });
    };
    expectLocked(await server.api.get(`/drops/${mine.id}/comments`));
    expectLocked(await server.api.get(`/drops/${mine.id}/comments`).set(bearer(b.token)));
    expectLocked(await server.api.post(`/drops/${mine.id}/comments`).set(bearer(b.token)).send({ content: 'Salut' }));
    expectLocked(await server.api.post(`/drops/${mine.id}/like`).set(bearer(b.token)));
    expectLocked(await server.api.delete(`/drops/${mine.id}/like`).set(bearer(b.token)));

    expect((await server.api.post(`/drops/${mine.id}/like`).set(bearer(author.token))).status).toBe(200);
    expect((await server.api.get(`/drops/${mine.id}/comments`).set(bearer(author.token))).status).toBe(200);

    await server.api.post(`/drops/${mine.id}/open`).set(bearer(b.token)).send({ lat: 47.4955, lng: 6.8053 });
    expect((await server.api.post(`/drops/${mine.id}/like`).set(bearer(b.token))).status).toBe(200);
    expect((await server.api.post(`/drops/${mine.id}/comments`).set(bearer(b.token)).send({ content: 'Salut' })).status).toBe(201);
    expect((await server.api.get(`/drops/${mine.id}/comments`).set(bearer(b.token))).body.total).toBe(1);
  });

  it('lockMode off : rien ne change par rapport au bloc 1', async () => {
    server = await startServer();
    const drop = (await server.api.get('/drops/1')).body;
    expect(drop).toMatchObject({ locked: false, location: { precision: 'exact' } });
    expect((await server.api.get('/drops/1/comments')).status).toBe(200);
    await lockOn(server);
    expect((await server.api.get('/drops/1')).body.locked).toBe(true);
    await server.api.patch('/admin/settings').set(ADMIN).send({ lockMode: 'off' });
    expect((await server.api.get('/drops/1')).body).toEqual(drop);
  });

  it('q ne cherche jamais dans le contenu caché', async () => {
    server = await startServer();
    const author = await login(server, 'demo');
    const mine = await createDrop(server, author.token, 47.4955, 6.8053, {
      title: 'Banc tranquille',
      content: 'Rendez-vous derrière le zéphyrin violet',
    });
    const b = await login(server, 'lea');
    const find = async (token?: string) => {
      const req = server!.api.get('/drops?q=zephyrin&pageSize=50');
      const res = await (token ? req.set(bearer(token)) : req);
      return res.body.items.map((d: any) => d.id);
    };
    expect(await find()).toEqual([mine.id]);
    await lockOn(server);
    expect(await find()).toEqual([]);
    expect(await find(b.token)).toEqual([]);
    expect(await find(author.token)).toEqual([mine.id]);
    const byTitle = await server.api.get('/drops?q=tranquille');
    expect(byTitle.body.items.map((d: any) => d.id)).toEqual([mine.id]);
    const byAuthor = await server.api.get('/drops?q=demo&pageSize=50');
    expect(byAuthor.body.items.map((d: any) => d.id)).toContain(mine.id);
    await server.api.post(`/drops/${mine.id}/open`).set(bearer(b.token)).send({ lat: 47.4955, lng: 6.8053 });
    expect(await find(b.token)).toEqual([mine.id]);
    expect(foldText('Zéphyrin')).toBe('zephyrin');
  });

  it('near, bbox et distanceM utilisent la position approchée d’un drop verrouillé', async () => {
    server = await startServer();
    const author = await login(server, 'demo');
    const mine = await createDrop(server, author.token, 47.49551, 6.80546);
    await lockOn(server);
    const approx = { lat: 47.496, lng: 6.805 };
    const exact = { lat: 47.49551, lng: 6.80546 };
    const idsOf = (res: any) => res.body.items.map((d: any) => d.id);

    const nearApprox = await server.api.get(`/drops?near=${approx.lat},${approx.lng}&radius=1&pageSize=50`);
    expect(idsOf(nearApprox)).toEqual([mine.id]);
    expect(nearApprox.body.items[0].distanceM).toBe(0);
    const nearExact = await server.api.get(`/drops?near=${exact.lat},${exact.lng}&radius=10&pageSize=50`);
    expect(idsOf(nearExact)).not.toContain(mine.id);

    const bboxApprox = await server.api.get(
      `/drops?bbox=${approx.lng - 0.00001},${approx.lat - 0.00001},${approx.lng + 0.00001},${approx.lat + 0.00001}`,
    );
    expect(idsOf(bboxApprox)).toEqual([mine.id]);
    const bboxExact = await server.api.get(
      `/drops?bbox=${exact.lng - 0.00001},${exact.lat - 0.00001},${exact.lng + 0.00001},${exact.lat + 0.00001}`,
    );
    expect(idsOf(bboxExact)).toEqual([]);

    const asAuthor = await server.api
      .get(`/drops?near=${exact.lat},${exact.lng}&radius=10`)
      .set(bearer(author.token));
    expect(idsOf(asAuthor)).toEqual([mine.id]);
    expect(asAuthor.body.items[0].distanceM).toBe(0);
  });

  it('les routes d’écriture du bloc 1 renvoient un drop cohérent pour l’auteur', async () => {
    server = await startServer();
    await lockOn(server);
    const author = await login(server, 'demo');
    const created = await server.api
      .post('/drops')
      .set(bearer(author.token))
      .send({ title: 'Mon drop', content: 'Visible par moi', category: 'note', lat: 47.4955, lng: 6.8053 });
    expect(created.body).toMatchObject({ locked: false, content: 'Visible par moi', isMine: true });
    const patched = await server.api.patch(`/drops/${created.body.id}`).set(bearer(author.token)).send({ title: 'Titre 2' });
    expect(patched.body).toMatchObject({ locked: false, title: 'Titre 2' });
  });
});

describe('documentation du bloc 2 (géolocalisation)', () => {
  it('documente near, radius, bbox, distanceM, too_far et drop_locked quand le bloc 2 est activé', async () => {
    server = await startServer();
    const doc = (await server.api.get('/openapi.json')).body;
    const names = doc.paths['/drops'].get.parameters.map((p: any) => p.name);
    for (const n of ['near', 'radius', 'bbox', 'sort', 'pageSize']) expect(names).toContain(n);
    const sort = doc.paths['/drops'].get.parameters.find((p: any) => p.name === 'sort');
    expect(sort.schema.enum).toEqual(['recent', 'popular', 'distance']);
    expect(doc.components.schemas.Drop.properties.distanceM).toBeDefined();
    expect(doc.components.schemas.Drop.required).not.toContain('distanceM');
    expect(doc.components.schemas.ErrorResponse.properties.error.properties.meta).toBeDefined();
    expect(doc.paths['/drops/{id}/open'].post.responses['403'].content['application/json'].example.error.code).toBe('too_far');
    expect(doc.paths['/drops/{id}/like'].post.responses['403']).toBeDefined();
    expect(doc.paths['/drops/{id}/comments'].get.responses['403']).toBeDefined();
    expect(doc.paths['/drops'].get.description).toContain('longitude d\'abord');
    const contract = (await server.api.get('/contract.md')).text;
    expect(contract).toContain('/drops/{id}/open');
  });

  it('ne montre rien du bloc 2 quand il est désactivé', async () => {
    server = await startServer({ block2Enabled: false });
    const text = JSON.stringify((await server.api.get('/openapi.json')).body) + (await server.api.get('/contract.md')).text;
    for (const word of ['near', 'bbox', 'distanceM', '/drops/{id}/open', 'WebSocket', 'drop_locked', 'too_far', '/ws']) {
      expect(text, word).not.toContain(word);
    }
  });
});
