import { describe, expect, it } from 'vitest';
import { bearer, buildSeededApp, loginAs } from './helpers.js';

const PROTECTED_READS = ['/drops', '/drops/1', '/drops/1/comments', '/users/demo', '/categories', '/dataset/points'];

describe('lectures protégées par un token', () => {
  it.each(PROTECTED_READS)('GET %s renvoie 401 unauthorized sans token', async (path) => {
    const { api } = buildSeededApp();
    const res = await api.get(path).unset('Authorization');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it.each(PROTECTED_READS)('GET %s répond 200 avec un token', async (path) => {
    const { api } = buildSeededApp();
    const { token } = await loginAs(api, 'demo');
    const res = await api.get(path).set(bearer(token));
    expect(res.status).toBe(200);
  });

  it('un token révoqué est refusé sur ces lectures', async () => {
    const { api } = buildSeededApp();
    const { token } = await loginAs(api, 'demo');
    await api.post('/auth/logout').set(bearer(token));
    const res = await api.get('/drops').set(bearer(token));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('token_revoked');
  });

  it('/health, /auth/register et /auth/login restent publics', async () => {
    const { api } = buildSeededApp();
    expect((await api.get('/health').unset('Authorization')).status).toBe(200);
    const register = await api.post('/auth/register').send({
      username: 'nouveau',
      email: 'nouveau@example.com',
      password: 'motdepasse1',
      displayName: 'Nouveau',
    });
    expect(register.status).toBe(201);
    const login = await api.post('/auth/login').send({ login: 'nouveau', password: 'motdepasse1' });
    expect(login.status).toBe(200);
  });
});
