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

describe('documentation du bloc 2 (géolocalisation)', () => {
  it('documente near, radius, bbox et distanceM', async () => {
    server = await startServer();
    const doc = (await server.api.get('/openapi.json')).body;
    const names = doc.paths['/drops'].get.parameters.map((p: any) => p.name);
    for (const n of ['near', 'radius', 'bbox', 'sort', 'pageSize']) expect(names).toContain(n);
    const sort = doc.paths['/drops'].get.parameters.find((p: any) => p.name === 'sort');
    expect(sort.schema.enum).toEqual(['recent', 'popular', 'distance']);
    expect(doc.components.schemas.Drop.properties.distanceM).toBeDefined();
    expect(doc.components.schemas.Drop.required).not.toContain('distanceM');
    expect(doc.paths['/drops'].get.description).toContain('longitude d\'abord');
  });
});

describe('verrouillage et ouverture supprimés', () => {
  it('un drop est toujours complet, à sa position exacte, et les routes d’ouverture n’existent plus', async () => {
    server = await startServer();
    const { token } = await login(server, 'demo');
    const drop = (await server.api.get('/drops/1').set(bearer(token))).body;
    expect(drop.content).toEqual(expect.any(String));
    expect(Object.keys(drop.location).sort()).toEqual(['lat', 'lng']);
    for (const key of ['locked', 'openedByMe', 'opensCount']) expect(drop).not.toHaveProperty(key);
    expect((await server.api.post('/drops/1/open').set(bearer(token)).send({ lat: 1, lng: 1 })).status).toBe(404);
    expect((await server.api.get('/drops/1/opens').set(bearer(token))).status).toBe(404);
    expect((await server.api.get('/admin/settings').set(ADMIN)).status).toBe(404);
    const doc = (await server.api.get('/openapi.json')).body;
    expect(JSON.stringify(doc)).not.toMatch(/drop_locked|too_far|lockMode/);
    const contract = (await server.api.get('/contract.md')).text;
    expect(contract).not.toMatch(/drop_locked|too_far|lockMode|\/drops\/:id\/open/);
  });
});
