import jwt from 'jsonwebtoken';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bearer, buildTestApp, loginAs, registerUser, testConfig } from './helpers.js';

const valid = {
  username: 'lea2',
  email: 'lea2@example.com',
  password: 'motdepasse1',
  displayName: 'Léa Deux',
};

afterEach(() => vi.useRealTimers());

describe('POST /auth/register', () => {
  it('crée un compte et renvoie un token utilisable', async () => {
    const { api, config } = buildTestApp();
    const res = await api.post('/auth/register').send({ ...valid, bio: 'Salut' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      username: 'lea2',
      email: 'lea2@example.com',
      displayName: 'Léa Deux',
      bio: 'Salut',
      avatarUrl: null,
    });
    expect(res.body.user.password).toBeUndefined();
    expect(res.body.user.password_hash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('$2');
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(res.headers['set-cookie']).toBeUndefined();
    const claims = jwt.verify(res.body.token, config.jwtSecret, { algorithms: ['HS256'] }) as any;
    expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'jti', 'sub', 'username']);
    expect(claims.username).toBe('lea2');
    expect(Number(claims.sub)).toBe(res.body.user.id);
    expect(claims.exp - claims.iat).toBe(config.jwtTtlSeconds);
    const me = await api.get('/auth/me').set(bearer(res.body.token));
    expect(me.status).toBe(200);
  });

  it('met le nom d’utilisateur et l’e-mail en minuscules et retire les espaces', async () => {
    const { api } = buildTestApp();
    const res = await api
      .post('/auth/register')
      .send({ ...valid, username: '  LeA2 ', email: ' Lea2@Example.COM ', displayName: '  Léa  ' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ username: 'lea2', email: 'lea2@example.com', displayName: 'Léa' });
  });

  it('renvoie 409 avec fields.username ou fields.email', async () => {
    const { api } = buildTestApp();
    await api.post('/auth/register').send(valid);
    const byName = await api.post('/auth/register').send({ ...valid, email: 'autre@example.com' });
    expect(byName.status).toBe(409);
    expect(byName.body.error).toMatchObject({ code: 'conflict', simulated: false });
    expect(byName.body.error.fields).toEqual({ username: ["Ce nom d'utilisateur est déjà pris."] });
    const byMail = await api.post('/auth/register').send({ ...valid, username: 'autre' });
    expect(byMail.status).toBe(409);
    expect(Object.keys(byMail.body.error.fields)).toEqual(['email']);
    const both = await api.post('/auth/register').send(valid);
    expect(Object.keys(both.body.error.fields).sort()).toEqual(['email', 'username']);
  });

  it('détecte un doublon sans tenir compte de la casse', async () => {
    const { api } = buildTestApp();
    await api.post('/auth/register').send(valid);
    const res = await api.post('/auth/register').send({ ...valid, username: 'LEA2', email: 'x@example.com' });
    expect(res.status).toBe(409);
  });

  it.each([
    ['username trop court', { username: 'ab' }, 'username'],
    ['username trop long', { username: 'a'.repeat(21) }, 'username'],
    ['username avec accent', { username: 'léa' }, 'username'],
    ['username avec espace', { username: 'le a' }, 'username'],
    ['username réservé admin', { username: 'admin' }, 'username'],
    ['username réservé me', { username: 'Me' }, 'username'],
    ['e-mail invalide', { email: 'pas-un-mail' }, 'email'],
    ['e-mail trop long', { email: `${'a'.repeat(250)}@example.com` }, 'email'],
    ['mot de passe court', { password: 'court' }, 'password'],
    ['mot de passe trop long', { password: 'a'.repeat(73) }, 'password'],
    ['displayName vide', { displayName: '   ' }, 'displayName'],
    ['displayName trop long', { displayName: 'a'.repeat(41) }, 'displayName'],
    ['bio trop longue', { bio: 'a'.repeat(281) }, 'bio'],
    ['username non texte', { username: 12 }, 'username'],
    ['champ inconnu', { role: 'admin' }, 'role'],
  ])('renvoie 422 : %s', async (_name, patch, field) => {
    const { api } = buildTestApp();
    const res = await api.post('/auth/register').send({ ...valid, ...patch });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.fields[field]).toBeInstanceOf(Array);
    expect(res.body.error.fields[field].length).toBeGreaterThan(0);
  });

  it('signale « Champ inconnu. » et « Champ requis. »', async () => {
    const { api } = buildTestApp();
    const res = await api.post('/auth/register').send({ foo: 1 });
    expect(res.body.error.fields.foo).toEqual(['Champ inconnu.']);
    expect(res.body.error.fields.username).toEqual(['Champ requis.']);
    expect(res.body.error.fields.password).toEqual(['Champ requis.']);
  });

  it('renvoie 422 sans corps', async () => {
    const { api } = buildTestApp();
    const res = await api.post('/auth/register');
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fields)).toEqual(
      expect.arrayContaining(['username', 'email', 'password', 'displayName']),
    );
  });
});

describe('POST /auth/login', () => {
  it('se connecte par e-mail et par nom d’utilisateur', async () => {
    const { api } = buildTestApp();
    await api.post('/auth/register').send(valid);
    const byMail = await api.post('/auth/login').send({ login: 'lea2@example.com', password: 'motdepasse1' });
    const byName = await api.post('/auth/login').send({ login: 'LEA2', password: 'motdepasse1' });
    expect(byMail.status).toBe(200);
    expect(byName.status).toBe(200);
    expect(byMail.body.user.email).toBe('lea2@example.com');
    expect(byName.body.token).toBeTypeOf('string');
  });

  it('renvoie le même 401 pour un mauvais mot de passe et un compte inconnu', async () => {
    const { api } = buildTestApp();
    await api.post('/auth/register').send(valid);
    const badPassword = await api.post('/auth/login').send({ login: 'lea2', password: 'mauvais-mot-de-passe' });
    const unknown = await api.post('/auth/login').send({ login: 'inconnu', password: 'motdepasse1' });
    for (const res of [badPassword, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_credentials');
      expect(res.body.error.message).toBe('Identifiant ou mot de passe incorrect.');
      expect(res.headers['www-authenticate']).toBe('Bearer');
    }
  });

  it('renvoie 422 quand un champ manque', async () => {
    const { api } = buildTestApp();
    const res = await api.post('/auth/login').send({ login: 'lea2' });
    expect(res.status).toBe(422);
    expect(res.body.error.fields.password).toEqual(['Champ requis.']);
  });

  it.each(['abc', '5', '0', '99999999', '1.5'])('?ttl=%s renvoie 422', async (ttl) => {
    const { api } = buildTestApp();
    const res = await api.post(`/auth/login?ttl=${ttl}`).send({ login: 'a', password: 'b' });
    expect(res.status).toBe(422);
    expect(res.body.error.fields.ttl).toHaveLength(1);
  });

  it('?ttl=10 émet un token qui expire', async () => {
    const { api } = buildTestApp();
    await api.post('/auth/register').send(valid);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T10:00:00.000Z'));
    const login = await api.post('/auth/login?ttl=10').send({ login: 'lea2', password: 'motdepasse1' });
    expect(login.status).toBe(200);
    expect(login.body.expiresAt).toBe('2026-11-16T10:00:10.000Z');
    const token = login.body.token;
    expect((await api.get('/auth/me').set(bearer(token))).status).toBe(200);
    vi.setSystemTime(new Date('2026-11-16T10:00:11.000Z'));
    const expired = await api.get('/auth/me').set(bearer(token));
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('token_expired');
    const publicRoute = await api.get('/categories').set(bearer(token));
    expect(publicRoute.status).toBe(401);
    expect(publicRoute.body.error.code).toBe('token_expired');
  });
});

describe('sessions et erreurs 401', () => {
  it('renvoie 401 unauthorized sans token sur une route protégée', async () => {
    const { api } = buildTestApp();
    const res = await api.get('/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it.each([
    ['garbage', 'Bearer pas.un.jwt'],
    ['schéma inconnu', 'Basic abc'],
    ['sans valeur', 'Bearer'],
  ])('renvoie 401 invalid_token, même sur une route publique (%s)', async (_n, header) => {
    const { api } = buildTestApp();
    for (const path of ['/auth/me', '/categories', '/health', '/drops']) {
      const res = await api.get(path).set('Authorization', header);
      expect(res.status, path).toBe(401);
      expect(res.body.error.code).toBe('invalid_token');
      expect(res.headers['www-authenticate']).toBe('Bearer');
    }
  });

  it('refuse un token signé avec une autre clé', async () => {
    const { api } = buildTestApp();
    const forged = jwt.sign({ username: 'x' }, 'une-autre-cle-une-autre-cle-une-autre-cle', {
      subject: '1',
      jwtid: 'abc',
      expiresIn: 60,
    });
    const res = await api.get('/auth/me').set(bearer(forged));
    expect(res.body.error.code).toBe('invalid_token');
  });

  it('refuse un token dont l’algorithme n’est pas HS256', async () => {
    const { api, config } = buildTestApp();
    const hs512 = jwt.sign({ username: 'x' }, config.jwtSecret, {
      algorithm: 'HS512',
      subject: '1',
      jwtid: 'abc',
      expiresIn: 60,
    });
    const res = await api.get('/auth/me').set(bearer(hs512));
    expect(res.body.error.code).toBe('invalid_token');
  });

  it('logout révoque le token sur toutes les routes', async () => {
    const { api } = buildTestApp();
    const { token } = await registerUser(api, 'lea2');
    const out = await api.post('/auth/logout').set(bearer(token));
    expect(out.status).toBe(204);
    expect(out.text).toBe('');
    for (const path of ['/auth/me', '/categories']) {
      const res = await api.get(path).set(bearer(token));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('token_revoked');
    }
    const again = await api.post('/auth/logout').set(bearer(token));
    expect(again.body.error.code).toBe('token_revoked');
  });

  it('logout sans token renvoie 401 unauthorized', async () => {
    const { api } = buildTestApp();
    expect((await api.post('/auth/logout')).body.error.code).toBe('unauthorized');
  });

  it('un autre token du même utilisateur reste valide après logout', async () => {
    const { api } = buildTestApp();
    const first = await registerUser(api, 'lea2');
    const second = await loginAs(api, 'lea2', 'motdepasse1');
    await api.post('/auth/logout').set(bearer(first.token));
    expect((await api.get('/auth/me').set(bearer(second.token))).status).toBe(200);
  });

  it('refuse un token dont l’utilisateur n’existe plus', async () => {
    const { api, db } = buildTestApp();
    const { token } = await registerUser(api, 'lea2');
    db.prepare('DELETE FROM users').run();
    const res = await api.get('/auth/me').set(bearer(token));
    expect(res.body.error.code).toBe('invalid_token');
  });

  it('purge les tokens révoqués expirés au démarrage', async () => {
    const { openDb } = await import('../src/db/index.js');
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const path = join(mkdtempSync(join(tmpdir(), 'drops-')), 'db.sqlite');
    const first = openDb(path);
    const now = Math.floor(Date.now() / 1000);
    first.prepare('INSERT INTO revoked_tokens VALUES (?, ?)').run('vieux', now - 10);
    first.prepare('INSERT INTO revoked_tokens VALUES (?, ?)').run('recent', now + 1000);
    first.close();
    const second = openDb(path);
    const rows = second.prepare('SELECT jti FROM revoked_tokens').all();
    expect(rows).toEqual([{ jti: 'recent' }]);
    second.close();
  });
});

describe('GET et PATCH /auth/me', () => {
  it('renvoie le compte privé', async () => {
    const { api } = buildTestApp();
    const { token } = await registerUser(api, 'lea2');
    const res = await api.get('/auth/me').set(bearer(token));
    expect(res.body).toMatchObject({ username: 'lea2', email: 'lea2@example.com' });
    expect(Object.keys(res.body).sort()).toEqual(
      ['avatarUrl', 'bio', 'createdAt', 'displayName', 'email', 'id', 'username'].sort(),
    );
  });

  it('modifie les champs fournis et accepte null', async () => {
    const { api } = buildTestApp();
    const { token } = await registerUser(api, 'lea2', { bio: 'Avant' });
    const set = await api
      .patch('/auth/me')
      .set(bearer(token))
      .send({ displayName: 'Nouveau', avatarUrl: 'https://exemple.test/a.png' });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ displayName: 'Nouveau', avatarUrl: 'https://exemple.test/a.png', bio: 'Avant' });
    const clear = await api.patch('/auth/me').set(bearer(token)).send({ bio: null, avatarUrl: null });
    expect(clear.body).toMatchObject({ bio: null, avatarUrl: null, displayName: 'Nouveau' });
  });

  it.each([
    ['corps vide', {}, 'body'],
    ['avatar http', { avatarUrl: 'http://exemple.test/a.png' }, 'avatarUrl'],
    ['avatar non url', { avatarUrl: 'pas une url' }, 'avatarUrl'],
    ['avatar trop long', { avatarUrl: `https://exemple.test/${'a'.repeat(500)}` }, 'avatarUrl'],
    ['displayName vide', { displayName: '' }, 'displayName'],
    ['champ inconnu', { email: 'x@example.com' }, 'email'],
  ])('renvoie 422 : %s', async (_n, body, field) => {
    const { api } = buildTestApp();
    const { token } = await registerUser(api, 'lea2');
    const res = await api.patch('/auth/me').set(bearer(token)).send(body);
    expect(res.status).toBe(422);
    expect(res.body.error.fields[field]).toBeDefined();
  });

  it('renvoie 401 sans token', async () => {
    const { api } = buildTestApp();
    expect((await api.patch('/auth/me').send({ bio: 'x' })).status).toBe(401);
  });
});

describe('limite des inscriptions et connexions', () => {
  it('renvoie 429 avec Retry-After au-delà de la limite par IP', async () => {
    const { api } = buildTestApp({ rateLimit: { ...testConfig().rateLimit, auth: 3 } });
    for (let i = 0; i < 3; i++) {
      const res = await api.post('/auth/login').send({ login: 'x', password: 'y' });
      expect(res.status).toBe(401);
      expect(res.headers['ratelimit-limit']).toBe('3');
    }
    const res = await api.post('/auth/login').send({ login: 'x', password: 'y' });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({ status: 429, code: 'rate_limited', simulated: false, fields: {} });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    const register = await api.post('/auth/register').send(valid);
    expect(register.status).toBe(429);
  });
});
