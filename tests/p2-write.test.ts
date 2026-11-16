import { afterEach, describe, expect, it, vi } from 'vitest';
import { events } from '../src/events.js';
import { bearer, buildSeededApp, buildTestApp, loginAs, registerUser, testConfig } from './helpers.js';

const validDrop = {
  title: 'Un super coin',
  content: 'Calme et ensoleillé.',
  category: 'tip',
  lat: 47.4956,
  lng: 6.8054,
};

afterEach(() => vi.useRealTimers());

async function setup() {
  const ctx = buildSeededApp();
  const lea = await loginAs(ctx.api, 'lea');
  const demo = await loginAs(ctx.api, 'demo');
  return { ...ctx, lea: lea.token, demo: demo.token };
}

async function createDrop(ctx: Awaited<ReturnType<typeof setup>>, token: string, patch: Record<string, unknown> = {}) {
  const res = await ctx.api.post('/drops').set(bearer(token)).send({ ...validDrop, ...patch });
  expect(res.status).toBe(201);
  return res.body as { id: number };
}

describe('POST /drops', () => {
  it('crée un drop et renvoie 201 avec Location', async () => {
    const { api, lea } = await setup();
    const res = await api.post('/drops').set(bearer(lea)).send({ ...validDrop, title: '  Un super coin  ' });
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/drops/${res.body.id}`);
    expect(res.body).toMatchObject({
      title: 'Un super coin',
      content: 'Calme et ensoleillé.',
      category: 'tip',
      imageUrl: null,
      location: { lat: 47.4956, lng: 6.8054, precision: 'exact' },
      locked: false,
      hidden: false,
      likesCount: 0,
      commentsCount: 0,
      opensCount: 0,
      likedByMe: false,
      openedByMe: false,
      isMine: true,
      author: { username: 'lea' },
    });
    expect(res.body.createdAt).toBe(res.body.updatedAt);
    expect((await api.get(`/drops/${res.body.id}`)).status).toBe(200);
  });

  it('accepte une photo avec image', async () => {
    const { api, lea } = await setup();
    const res = await api
      .post('/drops')
      .set(bearer(lea))
      .send({ ...validDrop, category: 'photo', imageUrl: 'https://picsum.photos/seed/x/800/600' });
    expect(res.status).toBe(201);
    expect(res.body.imageUrl).toBe('https://picsum.photos/seed/x/800/600');
  });

  it('renvoie 401 sans token', async () => {
    const { api } = await setup();
    const res = await api.post('/drops').send(validDrop);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it.each([
    ['titre trop court', { title: 'ab' }, 'title', 'Le titre doit faire au moins 3 caractères.'],
    ['titre trop long', { title: 'a'.repeat(81) }, 'title', undefined],
    ['titre vide après trim', { title: '   ' }, 'title', undefined],
    ['contenu vide', { content: '' }, 'content', undefined],
    ['contenu trop long', { content: 'a'.repeat(1001) }, 'content', undefined],
    ['catégorie inconnue', { category: 'video' }, 'category', 'Catégorie inconnue.'],
    ['photo sans image', { category: 'photo' }, 'imageUrl', 'Une photo a besoin d’une image.'],
    ['photo avec image null', { category: 'photo', imageUrl: null }, 'imageUrl', 'Une photo a besoin d’une image.'],
    ['image en http', { imageUrl: 'http://exemple.test/a.png' }, 'imageUrl', 'Doit être une adresse https://.'],
    ['image trop longue', { imageUrl: `https://exemple.test/${'a'.repeat(500)}` }, 'imageUrl', undefined],
    ['latitude texte', { lat: '47.49' }, 'location', 'Doit être un nombre.'],
    ['longitude texte', { lng: '6.8' }, 'location', 'Doit être un nombre.'],
    ['latitude absente', { lat: undefined }, 'location', 'Champ requis.'],
    ['latitude hors bornes', { lat: 100 }, 'location', undefined],
    ['longitude hors bornes', { lng: -181 }, 'location', undefined],
    ['hors zone', { lat: 48.8566, lng: 2.3522 }, 'location', 'Ce point est en dehors de la zone autorisée (3 km autour du département MMI).'],
    ['champ inconnu', { color: 'red' }, 'color', 'Champ inconnu.'],
    ['titre non texte', { title: 12345 }, 'title', 'Doit être une chaîne de caractères.'],
  ])('renvoie 422 : %s', async (_n, patch, field, message) => {
    const { api, lea } = await setup();
    const res = await api.post('/drops').set(bearer(lea)).send({ ...validDrop, ...patch });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'validation_failed', simulated: false });
    expect(res.body.error.fields[field]).toBeInstanceOf(Array);
    if (message) expect(res.body.error.fields[field]).toContain(message);
  });

  it('accepte un point à 2,9 km et refuse un point à 3,1 km', async () => {
    const { api, lea } = await setup();
    const inside = await api.post('/drops').set(bearer(lea)).send({ ...validDrop, lat: 47.495472 + 2900 / 111320, lng: 6.805279 });
    expect(inside.status).toBe(201);
    const outside = await api.post('/drops').set(bearer(lea)).send({ ...validDrop, lat: 47.495472 + 3100 / 111320, lng: 6.805279 });
    expect(outside.status).toBe(422);
    expect(Object.keys(outside.body.error.fields)).toEqual(['location']);
  });

  it('range toutes les erreurs de coordonnées sous location, sans doublon', async () => {
    const { api, lea } = await setup();
    const res = await api.post('/drops').set(bearer(lea)).send({ ...validDrop, lat: 'a', lng: 'b' });
    expect(Object.keys(res.body.error.fields)).toEqual(['location']);
    expect(res.body.error.fields.location).toEqual(['Doit être un nombre.']);
    const both = await api.post('/drops').set(bearer(lea)).send({ ...validDrop, lat: 100, lng: 200 });
    expect(Object.keys(both.body.error.fields)).toEqual(['location']);
    expect(both.body.error.fields.location).toHaveLength(2);
  });

  it('renvoie plusieurs erreurs à la fois', async () => {
    const { api, lea } = await setup();
    const res = await api.post('/drops').set(bearer(lea)).send({ title: 'a', content: '', category: 'x', lat: 'a', lng: 1 });
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['category', 'content', 'location', 'title']);
  });

  it('renvoie 422 sans corps', async () => {
    const { api, lea } = await setup();
    const res = await api.post('/drops').set(bearer(lea));
    expect(res.status).toBe(422);
    expect(res.body.error.fields.title).toEqual(['Champ requis.']);
  });

  it('émet drop:created', async () => {
    const { api, lea } = await setup();
    const seen: any[] = [];
    const off = events.on('drop:created', (d) => seen.push(d));
    const res = await api.post('/drops').set(bearer(lea)).send(validDrop);
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0].id).toBe(res.body.id);
  });
});

describe('PATCH /drops/:id', () => {
  it('modifie les champs fournis et met updatedAt à jour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T10:00:00.000Z'));
    const ctx = await setup();
    const drop = await createDrop(ctx, ctx.lea);
    vi.setSystemTime(new Date('2026-11-16T10:05:00.000Z'));
    const res = await ctx.api.patch(`/drops/${drop.id}`).set(bearer(ctx.lea)).send({ title: 'Nouveau titre', lat: 47.4957, lng: 6.8055 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      title: 'Nouveau titre',
      content: 'Calme et ensoleillé.',
      location: { lat: 47.4957, lng: 6.8055 },
      createdAt: '2026-11-16T10:00:00.000Z',
      updatedAt: '2026-11-16T10:05:00.000Z',
    });
  });

  it('renvoie 403 à un autre utilisateur, avant toute validation', async () => {
    const ctx = await setup();
    const drop = await createDrop(ctx, ctx.lea);
    const res = await ctx.api.patch(`/drops/${drop.id}`).set(bearer(ctx.demo)).send({ title: 'Piraté' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: 'forbidden', message: "Seul l'auteur peut modifier ce drop." });
    const invalid = await ctx.api.patch(`/drops/${drop.id}`).set(bearer(ctx.demo)).send({ title: 'a' });
    expect(invalid.status).toBe(403);
    expect((await ctx.api.get(`/drops/${drop.id}`)).body.title).toBe('Un super coin');
  });

  it('renvoie 404, 401 et 404 pour un id invalide', async () => {
    const { api, lea } = await setup();
    expect((await api.patch('/drops/9999').set(bearer(lea)).send({ title: 'abc' })).status).toBe(404);
    expect((await api.patch('/drops/abc').set(bearer(lea)).send({ title: 'abc' })).status).toBe(404);
    expect((await api.patch('/drops/1').send({ title: 'abc' })).status).toBe(401);
  });

  it.each([
    ['corps vide', {}, 'body'],
    ['titre trop court', { title: 'a' }, 'title'],
    ['latitude seule', { lat: 47.49 }, 'location'],
    ['longitude seule', { lng: 6.8 }, 'location'],
    ['hors zone', { lat: 48.85, lng: 2.35 }, 'location'],
    ['latitude texte', { lat: 'x', lng: 6.8 }, 'location'],
    ['champ inconnu', { likesCount: 99 }, 'likesCount'],
    ['catégorie inconnue', { category: 'x' }, 'category'],
  ])('renvoie 422 : %s', async (_n, body, field) => {
    const ctx = await setup();
    const drop = await createDrop(ctx, ctx.lea);
    const res = await ctx.api.patch(`/drops/${drop.id}`).set(bearer(ctx.lea)).send(body);
    expect(res.status).toBe(422);
    expect(res.body.error.fields[field]).toBeDefined();
  });

  it('applique la règle de la photo sur l’état final', async () => {
    const ctx = await setup();
    const note = await createDrop(ctx, ctx.lea);
    const toPhoto = await ctx.api.patch(`/drops/${note.id}`).set(bearer(ctx.lea)).send({ category: 'photo' });
    expect(toPhoto.status).toBe(422);
    expect(toPhoto.body.error.fields.imageUrl).toBeDefined();
    const withImage = await ctx.api
      .patch(`/drops/${note.id}`)
      .set(bearer(ctx.lea))
      .send({ category: 'photo', imageUrl: 'https://picsum.photos/seed/y/800/600' });
    expect(withImage.status).toBe(200);
    const removeImage = await ctx.api.patch(`/drops/${note.id}`).set(bearer(ctx.lea)).send({ imageUrl: null });
    expect(removeImage.status).toBe(422);
    const toTip = await ctx.api.patch(`/drops/${note.id}`).set(bearer(ctx.lea)).send({ category: 'tip', imageUrl: null });
    expect(toTip.status).toBe(200);
    expect(toTip.body.imageUrl).toBeNull();
  });

  it('émet drop:updated', async () => {
    const ctx = await setup();
    const drop = await createDrop(ctx, ctx.lea);
    const seen: any[] = [];
    const off = events.on('drop:updated', (d) => seen.push(d));
    await ctx.api.patch(`/drops/${drop.id}`).set(bearer(ctx.lea)).send({ title: 'Autre titre' });
    off();
    expect(seen.map((d) => d.title)).toEqual(['Autre titre']);
  });
});

describe('DELETE /drops/:id', () => {
  it('permet à l’auteur de supprimer son drop et ses dépendances', async () => {
    const ctx = await setup();
    const drop = await createDrop(ctx, ctx.lea);
    await ctx.api.post(`/drops/${drop.id}/like`).set(bearer(ctx.demo));
    await ctx.api.post(`/drops/${drop.id}/comments`).set(bearer(ctx.demo)).send({ content: 'Top' });
    await ctx.api.post(`/drops/${drop.id}/report`).set(bearer(ctx.demo)).send({ reason: 'spam' });
    ctx.db.prepare('INSERT INTO opens (drop_id, user_id, opened_at) VALUES (?, 1, ?)').run(drop.id, 'now');
    const seen: any[] = [];
    const off = events.on('drop:deleted', (d) => seen.push(d));
    const res = await ctx.api.delete(`/drops/${drop.id}`).set(bearer(ctx.lea));
    off();
    expect(res.status).toBe(204);
    expect(seen).toHaveLength(1);
    expect((await ctx.api.get(`/drops/${drop.id}`)).status).toBe(404);
    for (const table of ['likes', 'comments', 'reports', 'opens']) {
      const row = ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE drop_id = ?`).get(drop.id) as any;
      expect(row.n, table).toBe(0);
    }
  });

  it('renvoie 403 à un autre utilisateur, 404 pour un drop inconnu, 401 sans token', async () => {
    const ctx = await setup();
    const drop = await createDrop(ctx, ctx.lea);
    const other = await ctx.api.delete(`/drops/${drop.id}`).set(bearer(ctx.demo));
    expect(other.status).toBe(403);
    expect(other.body.error.code).toBe('forbidden');
    expect((await ctx.api.delete('/drops/9999').set(bearer(ctx.lea))).status).toBe(404);
    expect((await ctx.api.delete('/drops/abc').set(bearer(ctx.lea))).status).toBe(404);
    expect((await ctx.api.delete(`/drops/${drop.id}`)).status).toBe(401);
    expect((await ctx.api.get(`/drops/${drop.id}`)).status).toBe(200);
  });

  it('permet à l’enseignant de supprimer avec X-Admin-Key', async () => {
    const ctx = await setup();
    const drop = await createDrop(ctx, ctx.lea);
    const wrong = await ctx.api.delete(`/drops/${drop.id}`).set('X-Admin-Key', 'mauvaise');
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('forbidden');
    const ok = await ctx.api.delete(`/drops/${drop.id}`).set('X-Admin-Key', 'teacher-key');
    expect(ok.status).toBe(204);
    expect((await ctx.api.get(`/drops/${drop.id}`)).status).toBe(404);
    expect((await ctx.api.delete(`/drops/${drop.id}`).set('X-Admin-Key', 'teacher-key')).status).toBe(404);
  });

  it('permet à l’enseignant de supprimer un drop masqué', async () => {
    const ctx = await setup();
    ctx.db.prepare('UPDATE drops SET hidden = 1 WHERE id = 3').run();
    expect((await ctx.api.delete('/drops/3').set('X-Admin-Key', 'teacher-key')).status).toBe(204);
  });
});

describe('likes', () => {
  it('est idempotent dans les deux sens', async () => {
    const ctx = await setup();
    const drop = await createDrop(ctx, ctx.lea);
    const first = await ctx.api.post(`/drops/${drop.id}/like`).set(bearer(ctx.demo));
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ liked: true, likesCount: 1 });
    const second = await ctx.api.post(`/drops/${drop.id}/like`).set(bearer(ctx.demo));
    expect(second.body).toEqual({ liked: true, likesCount: 1 });
    const other = await ctx.api.post(`/drops/${drop.id}/like`).set(bearer(ctx.lea));
    expect(other.body).toEqual({ liked: true, likesCount: 2 });
    const detail = await ctx.api.get(`/drops/${drop.id}`).set(bearer(ctx.demo));
    expect(detail.body).toMatchObject({ likedByMe: true, likesCount: 2 });
    const removed = await ctx.api.delete(`/drops/${drop.id}/like`).set(bearer(ctx.demo));
    expect(removed.body).toEqual({ liked: false, likesCount: 1 });
    const again = await ctx.api.delete(`/drops/${drop.id}/like`).set(bearer(ctx.demo));
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ liked: false, likesCount: 1 });
  });

  it('renvoie 401, 404 et 404 pour un id invalide', async () => {
    const { api, lea } = await setup();
    expect((await api.post('/drops/1/like')).status).toBe(401);
    expect((await api.delete('/drops/1/like')).status).toBe(401);
    expect((await api.post('/drops/9999/like').set(bearer(lea))).status).toBe(404);
    expect((await api.delete('/drops/abc/like').set(bearer(lea))).status).toBe(404);
  });

  it('émet like:updated seulement quand l’état change', async () => {
    const ctx = await setup();
    const drop = await createDrop(ctx, ctx.lea);
    const seen: any[] = [];
    const off = events.on('like:updated', (e) => seen.push(e));
    await ctx.api.post(`/drops/${drop.id}/like`).set(bearer(ctx.demo));
    await ctx.api.post(`/drops/${drop.id}/like`).set(bearer(ctx.demo));
    await ctx.api.delete(`/drops/${drop.id}/like`).set(bearer(ctx.demo));
    off();
    expect(seen.map((e) => e.liked)).toEqual([true, false]);
  });
});

describe('commentaires', () => {
  it('crée, compte et supprime', async () => {
    const ctx = await setup();
    const drop = await createDrop(ctx, ctx.lea);
    const seen: any[] = [];
    const off = events.on('comment:created', (c) => seen.push(c));
    const res = await ctx.api.post(`/drops/${drop.id}/comments`).set(bearer(ctx.demo)).send({ content: '  Validé !  ' });
    off();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ dropId: drop.id, content: 'Validé !', isMine: true, author: { username: 'demo' } });
    expect(Object.keys(res.body).sort()).toEqual(['author', 'content', 'createdAt', 'dropId', 'id', 'isMine']);
    expect(seen).toHaveLength(1);
    expect((await ctx.api.get(`/drops/${drop.id}`)).body.commentsCount).toBe(1);
    const list = await ctx.api.get(`/drops/${drop.id}/comments`).set(bearer(ctx.lea));
    expect(list.body.items[0]).toMatchObject({ content: 'Validé !', isMine: false });
    const del = await ctx.api.delete(`/comments/${res.body.id}`).set(bearer(ctx.demo));
    expect(del.status).toBe(204);
    expect((await ctx.api.get(`/drops/${drop.id}`)).body.commentsCount).toBe(0);
  });

  it.each([
    ['vide', { content: '' }, 'content'],
    ['espaces', { content: '   ' }, 'content'],
    ['trop long', { content: 'a'.repeat(501) }, 'content'],
    ['absent', {}, 'content'],
    ['champ inconnu', { content: 'ok', dropId: 3 }, 'dropId'],
    ['non texte', { content: 12 }, 'content'],
  ])('renvoie 422 : %s', async (_n, body, field) => {
    const ctx = await setup();
    const res = await ctx.api.post('/drops/1/comments').set(bearer(ctx.demo)).send(body);
    expect(res.status).toBe(422);
    expect(res.body.error.fields[field]).toBeDefined();
  });

  it('renvoie 401 et 404 à la création', async () => {
    const { api, demo } = await setup();
    expect((await api.post('/drops/1/comments').send({ content: 'x' })).status).toBe(401);
    expect((await api.post('/drops/9999/comments').set(bearer(demo)).send({ content: 'x' })).status).toBe(404);
    expect((await api.post('/drops/9999/comments').set(bearer(demo)).send({})).status).toBe(404);
  });

  it('refuse de supprimer le commentaire d’un autre (403) et gère 404 et 401', async () => {
    const ctx = await setup();
    const created = await ctx.api.post('/drops/1/comments').set(bearer(ctx.demo)).send({ content: 'Salut' });
    const res = await ctx.api.delete(`/comments/${created.body.id}`).set(bearer(ctx.lea));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
    expect((await ctx.api.delete('/comments/99999').set(bearer(ctx.lea))).status).toBe(404);
    expect((await ctx.api.delete('/comments/abc').set(bearer(ctx.lea))).status).toBe(404);
    expect((await ctx.api.delete(`/comments/${created.body.id}`)).status).toBe(401);
    expect((await ctx.api.delete(`/comments/${created.body.id}`).set('X-Admin-Key', 'teacher-key')).status).toBe(401);
  });

  it('refuse de commenter un drop masqué pour les autres', async () => {
    const ctx = await setup();
    const drop = await createDrop(ctx, ctx.lea);
    ctx.db.prepare('UPDATE drops SET hidden = 1 WHERE id = ?').run(drop.id);
    expect((await ctx.api.post(`/drops/${drop.id}/comments`).set(bearer(ctx.demo)).send({ content: 'x' })).status).toBe(404);
    expect((await ctx.api.post(`/drops/${drop.id}/like`).set(bearer(ctx.demo))).status).toBe(404);
  });
});

describe('signalement et masquage', () => {
  async function reportAs(ctx: Awaited<ReturnType<typeof setup>>, token: string, dropId: number, body: object = { reason: 'spam' }) {
    return ctx.api.post(`/drops/${dropId}/report`).set(bearer(token)).send(body);
  }

  it('masque le drop au seuil de signalements distincts', async () => {
    const ctx = await setup();
    const drop = await createDrop(ctx, ctx.lea);
    const users = [ctx.demo, (await loginAs(ctx.api, 'yanis')).token, (await loginAs(ctx.api, 'hugo')).token];
    const first = await reportAs(ctx, users[0]!, drop.id, { reason: 'offensive', details: 'Pas cool' });
    expect(first.status).toBe(202);
    expect(first.body).toEqual({ reported: true });
    expect((await reportAs(ctx, users[0]!, drop.id)).status).toBe(202);
    expect((await reportAs(ctx, users[0]!, drop.id)).status).toBe(202);
    expect((await ctx.api.get(`/drops/${drop.id}`)).status).toBe(200);
    await reportAs(ctx, users[1]!, drop.id, { reason: 'other' });
    expect((await ctx.api.get(`/drops/${drop.id}`)).status).toBe(200);
    await reportAs(ctx, users[2]!, drop.id, { reason: 'personal_info' });

    expect((await ctx.api.get(`/drops/${drop.id}`)).status).toBe(404);
    expect((await ctx.api.get(`/drops/${drop.id}`).set(bearer(users[0]!))).status).toBe(404);
    const own = await ctx.api.get(`/drops/${drop.id}`).set(bearer(ctx.lea));
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ hidden: true, isMine: true });
    const list = await ctx.api.get('/drops?author=lea&pageSize=50').set(bearer(ctx.lea));
    expect(list.body.items.some((d: any) => d.id === drop.id)).toBe(false);
    expect((await reportAs(ctx, ctx.demo, drop.id)).status).toBe(404);
  });

  it('respecte REPORT_HIDE_THRESHOLD', async () => {
    const ctx = buildSeededApp({ reportHideThreshold: 1 });
    const demo = (await loginAs(ctx.api, 'demo')).token;
    const owner = ctx.db.prepare('SELECT author_id FROM drops WHERE id = 2').get() as { author_id: number };
    expect(owner.author_id).not.toBe(1);
    await ctx.api.post('/drops/2/report').set(bearer(demo)).send({ reason: 'spam' });
    expect((await ctx.api.get('/drops/2')).status).toBe(404);
  });

  it('refuse de signaler son propre drop (403)', async () => {
    const ctx = await setup();
    const drop = await createDrop(ctx, ctx.lea);
    const res = await reportAs(ctx, ctx.lea, drop.id);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('forbidden');
  });

  it.each([
    ['motif inconnu', { reason: 'nul' }, 'reason'],
    ['motif absent', {}, 'reason'],
    ['détails trop longs', { reason: 'spam', details: 'a'.repeat(301) }, 'details'],
    ['champ inconnu', { reason: 'spam', extra: 1 }, 'extra'],
  ])('renvoie 422 : %s', async (_n, body, field) => {
    const ctx = await setup();
    const owner = ctx.db.prepare('SELECT u.username FROM drops d JOIN users u ON u.id = d.author_id WHERE d.id = 4').get() as any;
    const token = (await loginAs(ctx.api, owner.username === 'demo' ? 'lea' : 'demo')).token;
    const res = await reportAs(ctx, token, 4, body);
    expect(res.status).toBe(422);
    expect(res.body.error.fields[field]).toBeDefined();
  });

  it('renvoie 401 et 404', async () => {
    const ctx = await setup();
    expect((await ctx.api.post('/drops/4/report').send({ reason: 'spam' })).status).toBe(401);
    expect((await reportAs(ctx, ctx.demo, 9999)).status).toBe(404);
    expect((await reportAs(ctx, ctx.demo, 9999, {})).status).toBe(404);
  });
});

describe('administration', () => {
  const admin = { 'X-Admin-Key': 'teacher-key' };

  it.each([
    ['POST', '/admin/reset', { confirm: 'RESET', mode: 'all' }],
    ['GET', '/admin/reports', undefined],
    ['POST', '/admin/drops/1/unhide', undefined],
  ])('refuse %s %s sans clé ou avec une mauvaise clé (403)', async (method, path, body) => {
    const ctx = await setup();
    const call = (key?: string, token?: string) => {
      let req = (ctx.api as any)[method.toLowerCase()](path);
      if (key !== undefined) req = req.set('X-Admin-Key', key);
      if (token) req = req.set(bearer(token));
      return req.send(body);
    };
    for (const res of [await call(), await call('mauvaise'), await call(undefined, ctx.lea), await call('')]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    }
  });

  it('liste les drops signalés puis les réactive', async () => {
    const ctx = await setup();
    const drop = await createDrop(ctx, ctx.lea);
    for (const login of ['demo', 'yanis', 'hugo']) {
      const { token } = await loginAs(ctx.api, login);
      await ctx.api.post(`/drops/${drop.id}/report`).set(bearer(token)).send({ reason: 'spam', details: 'Hmm' });
    }
    const list = await ctx.api.get('/admin/reports').set(admin);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].drop).toMatchObject({ id: drop.id, hidden: true, author: { username: 'lea' } });
    expect(list.body[0].reports).toHaveLength(3);
    expect(list.body[0].reports[0]).toMatchObject({ reason: 'spam', details: 'Hmm', user: { username: 'demo' } });
    expect(JSON.stringify(list.body)).not.toContain('email');

    const unhide = await ctx.api.post(`/admin/drops/${drop.id}/unhide`).set(admin);
    expect(unhide.status).toBe(200);
    expect(unhide.body).toMatchObject({ id: drop.id, hidden: false });
    expect((await ctx.api.get(`/drops/${drop.id}`)).status).toBe(200);
    expect((await ctx.api.get('/admin/reports').set(admin)).body).toEqual([]);
    const { token } = await loginAs(ctx.api, 'demo');
    expect((await ctx.api.post(`/drops/${drop.id}/report`).set(bearer(token)).send({ reason: 'spam' })).status).toBe(202);
    expect((await ctx.api.get(`/drops/${drop.id}`)).status).toBe(200);
  });

  it('renvoie 404 pour un drop inconnu et 404 pour un id invalide', async () => {
    const { api } = await setup();
    expect((await api.post('/admin/drops/9999/unhide').set(admin)).status).toBe(404);
    expect((await api.post('/admin/drops/abc/unhide').set(admin)).status).toBe(404);
  });

  it('reset all vide la base et recharge les données d’exemple', async () => {
    const ctx = await setup();
    const initial = (await ctx.api.post('/admin/reset').set(admin).send({ confirm: 'RESET', mode: 'all' })).body;
    expect(initial).toMatchObject({ users: 13, drops: 60 });
    const eleve = await registerUser(ctx.api, 'eleve');
    await createDrop(ctx, eleve.token);
    const res = await ctx.api.post('/admin/reset').set(admin).send({ confirm: 'RESET', mode: 'all' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(initial);
    expect((await ctx.api.get('/users/eleve')).status).toBe(404);
    const stale = await ctx.api.get('/auth/me').set(bearer(eleve.token));
    expect(stale.status).toBe(401);
    expect(stale.body.error.code).toBe('invalid_token');
    expect((await ctx.api.get('/auth/me').set(bearer(ctx.lea))).status).toBe(200);
    expect((await loginAs(ctx.api, 'demo')).res.status).toBe(200);
  });

  it('reset keep-users garde les comptes des élèves et leurs identifiants', async () => {
    const ctx = await setup();
    const before = (await ctx.api.post('/admin/reset').set(admin).send({ confirm: 'RESET', mode: 'all' })).body;
    const eleve = await registerUser(ctx.api, 'eleve');
    const drop = await createDrop(ctx, eleve.token);
    await ctx.api.post(`/drops/${drop.id}/like`).set(bearer(eleve.token));
    await ctx.api.post('/drops/1/comments').set(bearer(eleve.token)).send({ content: 'Coucou' });
    const res = await ctx.api.post('/admin/reset').set(admin).send({ confirm: 'RESET', mode: 'keep-users' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...before, users: before.users + 1 });
    expect((await ctx.api.get('/users/eleve')).body.stats).toEqual({ dropsCount: 0, likesReceived: 0, commentsCount: 0 });
    expect((await ctx.api.get(`/drops/${drop.id}`)).body.author?.username).not.toBe('eleve');
    expect((await ctx.api.get('/auth/me').set(bearer(eleve.token))).status).toBe(200);
    expect((await loginAs(ctx.api, 'eleve', 'motdepasse1')).res.status).toBe(200);
    const ids = (await ctx.api.get('/drops?pageSize=50&sort=recent')).body.items.map((d: any) => d.id);
    expect(Math.max(...ids)).toBe(60);
  });

  it.each([
    [{ confirm: 'reset', mode: 'all' }, 'confirm'],
    [{ mode: 'all' }, 'confirm'],
    [{ confirm: 'RESET', mode: 'tout' }, 'mode'],
    [{ confirm: 'RESET' }, 'mode'],
    [{ confirm: 'RESET', mode: 'all', extra: 1 }, 'extra'],
  ])('reset renvoie 422 pour %j', async (body, field) => {
    const { api, db } = await setup();
    const before = db.prepare('SELECT COUNT(*) AS n FROM drops').get();
    const res = await api.post('/admin/reset').set(admin).send(body);
    expect(res.status).toBe(422);
    expect(res.body.error.fields[field]).toBeDefined();
    expect(db.prepare('SELECT COUNT(*) AS n FROM drops').get()).toEqual(before);
  });
});

describe('limites d’écriture et simulation sur les écritures', () => {
  it('limite par utilisateur, et ne compte pas les appels non authentifiés', async () => {
    const ctx = buildSeededApp({ rateLimit: { ...testConfig().rateLimit, write: 3 } });
    const lea = (await loginAs(ctx.api, 'lea')).token;
    const demo = (await loginAs(ctx.api, 'demo')).token;
    for (let i = 0; i < 5; i++) expect((await ctx.api.post('/drops/1/like')).status).toBe(401);
    for (let i = 0; i < 3; i++) {
      const res = await ctx.api.post('/drops/1/like').set(bearer(lea));
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('3');
    }
    const limited = await ctx.api.post('/drops/1/like').set(bearer(lea));
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await ctx.api.post('/drops/1/like').set(bearer(demo))).status).toBe(200);
    expect((await ctx.api.get('/drops/1').set(bearer(lea))).status).toBe(200);
  });

  it('?fail=422 reprend les champs du corps sans exécuter l’écriture', async () => {
    const ctx = await setup();
    const res = await ctx.api.post('/drops?fail=422').set(bearer(ctx.lea)).send(validDrop);
    expect(res.status).toBe(422);
    expect(res.body.error.simulated).toBe(true);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['category', 'content', 'lat', 'lng', 'title']);
    expect((await ctx.api.get('/drops')).body.total).toBe(60);
  });

  it('?fail=500 n’exécute pas l’écriture, ?delay retarde l’écriture', async () => {
    const ctx = await setup();
    const failed = await ctx.api.post('/drops?fail=500').set(bearer(ctx.lea)).send(validDrop);
    expect(failed.status).toBe(500);
    const start = Date.now();
    const slow = await ctx.api.post('/drops?delay=200').set(bearer(ctx.lea)).send(validDrop);
    expect(slow.status).toBe(201);
    expect(Date.now() - start).toBeGreaterThanOrEqual(190);
    expect((await ctx.api.get('/drops')).body.total).toBe(61);
  });
});

describe('documentation des routes d’écriture', () => {
  it('décrit la zone, l’authentification et les erreurs', async () => {
    const { api } = buildTestApp();
    const doc = (await api.get('/openapi.json')).body;
    const post = doc.paths['/drops'].post;
    expect(post.description).toContain('domicile');
    expect(post.security).toEqual([{ bearerAuth: [] }]);
    expect(Object.keys(post.responses).sort()).toEqual(['201', '400', '401', '422', '429', '500']);
    const del = doc.paths['/drops/{id}'].delete;
    expect(del.security).toEqual([{ bearerAuth: [] }, { adminKey: [] }]);
    expect(del.responses['403']).toBeDefined();
    const reset = doc.paths['/admin/reset'].post;
    expect(reset.tags).toEqual(['Admin (enseignant)']);
    expect(reset.parameters.some((p: any) => p.in === 'header' && p.name === 'X-Admin-Key')).toBe(true);
    expect(doc.paths['/drops'].get.parameters.map((p: any) => p.name)).toEqual(
      expect.arrayContaining(['page', 'pageSize', 'q', 'category', 'author', 'sort', 'delay', 'fail']),
    );
  });
});
