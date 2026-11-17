import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeAnomalies, mapRecord, syntheticPoints } from '../scripts/build-dataset.js';
import { runSmokeBlock2 } from '../scripts/smoke-block2.js';
import { events } from '../src/events.js';
import { validCoordinates } from '../src/modules/dataset/routes.js';
import type { SimulatorControl } from '../src/simulator.js';
import { bearer, buildTestApp, registerUser } from './helpers.js';
import { type TestServer, connectAs, login, startServer } from './ws-helpers.js';

const ADMIN = { 'X-Admin-Key': 'teacher-key' };

let server: TestServer | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await server?.stop();
  server = null;
});

const simulatorOf = (s: TestServer) => s.app.locals.simulator as SimulatorControl;

describe('jeu de données', () => {
  it('renvoie la forme annoncée, brute et sans pagination', async () => {
    const { api } = buildTestApp({ block2Enabled: true });
    const auth = bearer((await registerUser(api, 'lecteur')).token);
    const res = await api.get('/dataset/points').set(auth);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json; charset=utf-8/);
    expect(res.body.source).toMatchObject({
      license: 'Licence Ouverte / Open Licence',
      synthetic: false,
      name: expect.stringContaining('bibliothèques'),
      url: expect.stringMatching(/^https:\/\//),
    });
    expect(new Date(res.body.source.retrievedAt).getTime()).not.toBeNaN();
    expect(res.body.count).toBeGreaterThan(10_000);
    expect(res.body.points).toHaveLength(res.body.count);
    expect(Object.keys(res.body.points[0]).sort()).toEqual(['city', 'department', 'id', 'lat', 'lng', 'name', 'postcode']);
    const kinds = new Set(res.body.points.map((p: any) => typeof p.lat));
    expect(kinds.has('string') || kinds.has('object')).toBe(true);
    expect(res.body.points.some((p: any) => p.lat === null)).toBe(true);
  });

  it('?format=geojson ne contient que des points valides, [lng, lat], avec skipped', async () => {
    const { api } = buildTestApp({ block2Enabled: true });
    const auth = bearer((await registerUser(api, 'lecteur')).token);
    const json = (await api.get('/dataset/points').set(auth)).body;
    const geo = (await api.get('/dataset/points?format=geojson').set(auth)).body;
    expect(geo.type).toBe('FeatureCollection');
    expect(geo.skipped).toBeGreaterThan(0);
    expect(geo.features.length + geo.skipped).toBe(json.count);
    for (const f of geo.features) {
      expect(f.type).toBe('Feature');
      expect(f.geometry.type).toBe('Point');
      const [lng, lat] = f.geometry.coordinates;
      expect(Number.isFinite(lng) && Number.isFinite(lat)).toBe(true);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(lng)).toBeLessThanOrEqual(180);
    }
    const first = json.points.find((p: any) => validCoordinates(p));
    const feature = geo.features.find((f: any) => f.properties.id === first.id);
    expect(feature.geometry.coordinates).toEqual([Number(first.lng), Number(first.lat)]);
  });

  it('format inconnu : 422 sur format', async () => {
    const { api } = buildTestApp({ block2Enabled: true });
    const auth = bearer((await registerUser(api, 'lecteur')).token);
    const res = await api.get('/dataset/points?format=csv').set(auth);
    expect(res.status).toBe(422);
    expect(res.body.error.fields.format).toBeDefined();
  });

  it('Cache-Control public 24 h (exception à no-store) et gzip', async () => {
    const { api } = buildTestApp({ block2Enabled: true });
    const auth = bearer((await registerUser(api, 'lecteur')).token);
    const res = await api.get('/dataset/points').set(auth).set('Accept-Encoding', 'gzip');
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers.vary).toMatch(/Accept-Encoding/i);
    expect(res.body.count).toBeGreaterThan(10_000);
    const other = await api.get('/drops').set(auth);
    expect(other.headers['cache-control']).toBe('no-store');
    expect(other.headers['content-encoding']).toBeUndefined();
  });

  it('accepte ?delay et ?fail, et reste en 404 avec le bloc 2 désactivé', async () => {
    const { api } = buildTestApp({ block2Enabled: true });
    const failed = await api.get('/dataset/points?fail=503');
    expect(failed.status).toBe(503);
    expect(failed.headers['cache-control']).toBe('no-store');
    const started = Date.now();
    await api.get('/dataset/points?delay=300&format=geojson');
    expect(Date.now() - started).toBeGreaterThanOrEqual(280);
    const off = buildTestApp({ block2Enabled: false });
    const res = await off.api.get('/dataset/points');
    expect(res.status).toBe(404);
  });

  it('est documenté avec ses anomalies réelles quand le bloc 2 est activé', async () => {
    const { api } = buildTestApp({ block2Enabled: true });
    const doc = (await api.get('/openapi.json')).body;
    const op = doc.paths['/dataset/points'].get;
    expect(op.tags).toEqual(['Jeu de données']);
    expect(op.description).toContain('Anomalies réelles');
    expect(op.description).toContain('Aucune anomalie n\'a été ajoutée');
    expect(op.description).toMatch(/\d+ points sans coordonnées/);
    expect(doc.tags.map((t: any) => t.name)).toContain('Jeu de données');
  });

  it('le fichier commité est la vraie source, non corrigée', () => {
    const file = JSON.parse(readFileSync(new URL('../data/points.json', import.meta.url), 'utf8'));
    expect(file.source.synthetic).toBe(false);
    const report = describeAnomalies(file.points);
    expect(report.nullCoordinates).toBeGreaterThan(0);
    expect(report.total).toBe(file.points.length);
  });

  it('le jeu synthétique de secours est déterministe, de 15 000 points et d’environ 2 % d’anomalies', () => {
    const a = syntheticPoints();
    expect(a).toHaveLength(15_000);
    expect(JSON.stringify(syntheticPoints())).toBe(JSON.stringify(a));
    const invalid = a.filter((p) => validCoordinates(p as any) === null).length;
    expect(invalid / a.length).toBeGreaterThan(0.005);
    expect(invalid / a.length).toBeLessThan(0.03);
    expect(Object.keys(a[0]!).sort()).toEqual(['city', 'department', 'id', 'lat', 'lng', 'name', 'postcode']);
  });

  it('mapRecord garde les valeurs telles que la source les donne', () => {
    expect(mapRecord({ code_bib: 'X1', nom_de_l_etablissement: 'N', ville: 'V', cp: '25200', departement: 'Doubs', latitude: '47.5', longitude: null })).toEqual({
      id: 'X1',
      name: 'N',
      city: 'V',
      postcode: '25200',
      department: 'Doubs',
      lat: '47.5',
      lng: null,
    });
  });
});

describe('simulateur', () => {
  const counts = (s: TestServer) =>
    ['drops', 'likes', 'comments', 'opens'].map((t) => (s.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n);

  it('un like produit like:updated, un commentaire comment:created, une ouverture drop:opened, une création drop:created', async () => {
    server = await startServer();
    const seen: string[] = [];
    const offs = (['like:updated', 'comment:created', 'drop:opened', 'drop:created'] as const).map((name) =>
      events.on(name, (_payload, source) => source === server!.db && seen.push(name)),
    );
    const sim = simulatorOf(server);
    expect(sim.runOnce('like')).toMatch(/^(un)?like:\d+$/);
    expect(sim.runOnce('comment')).toMatch(/^comment:\d+$/);
    expect(sim.runOnce('open')).toMatch(/^open:\d+$/);
    expect(sim.runOnce('create')).toMatch(/^create:\d+$/);
    offs.forEach((off) => off());
    expect(seen).toEqual(['like:updated', 'comment:created', 'drop:opened', 'drop:created']);
  });

  it('les événements arrivent sur le WebSocket', async () => {
    server = await startServer();
    const { client } = await connectAs(server, 'zoe');
    const sim = simulatorOf(server);
    sim.runOnce('create');
    const created = await client.next('drop:created');
    expect(created.data.drop.isMine).toBe(false);
    sim.runOnce('comment');
    await client.next('comment:created');
  });

  it('crée dans la zone autour du département MMI, au nom d’un utilisateur d’exemple, marqué is_seed', async () => {
    server = await startServer();
    const sim = simulatorOf(server);
    const before = counts(server)[0]!;
    for (let i = 0; i < 25; i++) sim.runOnce('create');
    const rows = server.db
      .prepare('SELECT d.lat, d.lng, d.is_seed, u.is_seed AS user_seed FROM drops d JOIN users u ON u.id = d.author_id WHERE d.id > 60')
      .all() as any[];
    expect(rows).toHaveLength(25);
    expect(counts(server)[0]! - before).toBe(25);
    for (const r of rows) {
      expect(r.is_seed).toBe(1);
      expect(r.user_seed).toBe(1);
      const dLat = (r.lat - 47.495472) * 111_320;
      const dLng = (r.lng - 6.805279) * 111_320 * Math.cos((47.495472 * Math.PI) / 180);
      expect(Math.hypot(dLat, dLng)).toBeLessThan(3000);
    }
  });

  it('n’agit jamais sur les drops d’un élève, sauf pour les likes et les ouvertures', async () => {
    server = await startServer();
    const student = await server.api
      .post('/auth/register')
      .send({ username: 'eleve1', email: 'eleve1@example.com', password: 'motdepasse1', displayName: 'Élève' });
    const mine = (
      await server.api
        .post('/drops')
        .set(bearer(student.body.token))
        .send({ title: 'Drop élève', content: 'Mon drop', category: 'note', lat: 47.4955, lng: 6.8053 })
    ).body;
    server.db.prepare('DELETE FROM drops WHERE author_id != ?').run(student.body.user.id);
    expect(server.db.prepare('SELECT COUNT(*) AS n FROM drops').get()).toEqual({ n: 1 });
    const sim = simulatorOf(server);
    for (let i = 0; i < 40; i++) sim.runOnce('comment');
    expect(server.db.prepare('SELECT COUNT(*) AS n FROM comments WHERE drop_id = ?').get(mine.id)).toEqual({ n: 0 });
    for (let i = 0; i < 40; i++) sim.runOnce();
    const created = server.db.prepare('SELECT COUNT(*) AS n FROM drops WHERE author_id = ?').get(student.body.user.id);
    expect(created).toEqual({ n: 1 });
    expect(server.db.prepare('SELECT COUNT(*) AS n FROM comments WHERE drop_id = ?').get(mine.id)).toEqual({ n: 0 });
    const likes = server.db.prepare('SELECT COUNT(*) AS n FROM likes WHERE drop_id = ?').get(mine.id) as { n: number };
    const opens = server.db.prepare('SELECT COUNT(*) AS n FROM opens WHERE drop_id = ?').get(mine.id) as { n: number };
    expect(likes.n + opens.n).toBeGreaterThan(0);
  });

  it('respecte le verrouillage : seulement sur ses propres drops ou ceux qu’il a ouverts', async () => {
    server = await startServer();
    await server.api.patch('/admin/settings').set(ADMIN).send({ lockMode: 'on' });
    const sim = simulatorOf(server);
    const known = (table: string, columns: string) =>
      new Set((server!.db.prepare(`SELECT ${columns} AS k FROM ${table}`).all() as { k: string }[]).map((r) => r.k));
    const likesBefore = known('likes', "drop_id || ':' || user_id");
    const commentsBefore = known('comments', 'CAST(id AS TEXT)');
    for (let i = 0; i < 60; i++) sim.runOnce(i % 2 ? 'comment' : 'like');
    const unlockedFor = (dropId: number, userId: number) => {
      const drop = server!.db.prepare('SELECT author_id FROM drops WHERE id = ?').get(dropId) as { author_id: number };
      const opened = server!.db.prepare('SELECT 1 FROM opens WHERE drop_id = ? AND user_id = ?').get(dropId, userId);
      return drop.author_id === userId || opened !== undefined;
    };
    const newLikes = server.db.prepare('SELECT drop_id, user_id FROM likes').all() as { drop_id: number; user_id: number }[];
    for (const l of newLikes) {
      if (likesBefore.has(`${l.drop_id}:${l.user_id}`)) continue;
      expect(unlockedFor(l.drop_id, l.user_id)).toBe(true);
    }
    const newComments = server.db.prepare('SELECT id, drop_id, author_id FROM comments').all() as { id: number; drop_id: number; author_id: number }[];
    for (const c of newComments) {
      if (commentsBefore.has(String(c.id))) continue;
      expect(unlockedFor(c.drop_id, c.author_id)).toBe(true);
    }
    expect(sim.runOnce('open')).toMatch(/^open:/);
  });

  it('le reset efface ce qu’il a créé', async () => {
    server = await startServer();
    const sim = simulatorOf(server);
    const baseline = counts(server);
    for (let i = 0; i < 30; i++) sim.runOnce();
    sim.runOnce('create');
    expect(counts(server)).not.toEqual(baseline);
    for (const mode of ['keep-users', 'all']) {
      for (let i = 0; i < 10; i++) sim.runOnce();
      const reset = await server.api.post('/admin/reset').set(ADMIN).send({ confirm: 'RESET', mode });
      expect(reset.status).toBe(200);
      expect(counts(server)[3]).toBe(0);
      expect(counts(server)[0]).toBe(9);
      expect(server.db.prepare('SELECT COUNT(*) AS n FROM drops WHERE is_seed = 0').get()).toEqual({ n: 0 });
      expect(server.db.prepare('SELECT COUNT(*) AS n FROM opens').get()).toEqual({ n: 0 });
    }
  });

  it('se déclenche seul à intervalle aléatoire, s’arrête, et s’arrête à la désactivation du bloc 2', async () => {
    server = await startServer();
    const sim = simulatorOf(server);
    const seen = vi.fn();
    const off = events.on('like:updated', (_p, source) => source === server!.db && seen());
    const start = await server.api.post('/admin/simulator').set(ADMIN).send({ enabled: true, intervalSeconds: 1 });
    expect(start.body).toEqual({ enabled: true, intervalSeconds: 1 });
    expect((await server.api.get('/admin/settings').set(ADMIN)).body.simulator).toEqual({ enabled: true, intervalSeconds: 1 });
    const baseline = counts(server).join();
    await vi.waitFor(() => expect(counts(server!).join()).not.toBe(baseline), { timeout: 4000 });
    const stop = await server.api.post('/admin/simulator').set(ADMIN).send({ enabled: false });
    expect(stop.body.enabled).toBe(false);
    const frozen = counts(server).join();
    await new Promise((resolve) => setTimeout(resolve, 1700));
    expect(counts(server).join()).toBe(frozen);
    off();

    await server.api.post('/admin/simulator').set(ADMIN).send({ enabled: true, intervalSeconds: 1 });
    expect(sim.state().enabled).toBe(true);
    await server.api.patch('/admin/settings').set(ADMIN).send({ block2Enabled: false });
    expect(sim.state().enabled).toBe(false);
  });

  it('POST /admin/simulator : clé admin, corps strict', async () => {
    server = await startServer();
    expect((await server.api.post('/admin/simulator').send({ enabled: true })).status).toBe(403);
    const bad = await server.api.post('/admin/simulator').set(ADMIN).send({ enabled: 'oui', extra: 1 });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fields.enabled).toBeDefined();
    expect(bad.body.error.fields.extra).toEqual(['Champ inconnu.']);
    expect((await server.api.post('/admin/simulator').set(ADMIN).send({ enabled: true, intervalSeconds: 0 })).status).toBe(422);
  });
});

describe('smoke:block2', () => {
  it('passe contre une instance locale et restaure les réglages', async () => {
    server = await startServer({ block2Enabled: false });
    const lines: string[] = [];
    const before = (await server.api.get('/admin/settings').set(ADMIN)).body;
    const ok = await runSmokeBlock2(`http://127.0.0.1:${server.port}`, 'teacher-key', (l) => lines.push(l));
    expect(lines.join('\n')).not.toContain('❌');
    expect(lines.some((l) => l.startsWith('⚠️'))).toBe(true);
    expect(lines.filter((l) => l.startsWith('✅'))).toHaveLength(7);
    expect(ok).toBe(true);
    expect((await server.api.get('/admin/settings').set(ADMIN)).body).toEqual(before);
    expect(server.db.prepare('SELECT COUNT(*) AS n FROM drops').get()).toEqual({ n: 60 });
  }, 30000);

  it('ne dit rien de grave avec une URL de staging et restaure aussi un lockMode initial à on', async () => {
    server = await startServer();
    await server.api.patch('/admin/settings').set(ADMIN).send({ lockMode: 'on' });
    const lines: string[] = [];
    const ok = await runSmokeBlock2(`http://127.0.0.1:${server.port}/`, 'teacher-key', (l) => lines.push(l));
    expect(ok).toBe(true);
    expect((await server.api.get('/admin/settings').set(ADMIN)).body).toMatchObject({ block2Enabled: true, lockMode: 'on' });
    await login(server, 'demo');
  }, 30000);
});
