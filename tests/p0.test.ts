import type { Router } from 'express';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { buildTestApp } from './helpers.js';

function expectError(res: any, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toMatch(/application\/json; charset=utf-8/);
  expect(res.body.error).toMatchObject({ status, code, simulated: false });
  expect(res.body.error.fields).toBeTypeOf('object');
  expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  expect(res.body.error.message).toBeTypeOf('string');
}

describe('configuration', () => {
  it('refuse un JWT_SECRET trop court', () => {
    expect(() => loadConfig({ JWT_SECRET: 'court', ADMIN_KEY: 'k' })).toThrow(/JWT_SECRET/);
  });
  it('refuse une ADMIN_KEY absente', () => {
    expect(() => loadConfig({ JWT_SECRET: 'x'.repeat(32) })).toThrow(/ADMIN_KEY/);
  });
  it('applique les valeurs par défaut', () => {
    const c = loadConfig({ JWT_SECRET: 'x'.repeat(32), ADMIN_KEY: 'k' });
    expect(c.port).toBe(4000);
    expect(c.zone).toEqual({ lat: 47.495472, lng: 6.805279, radiusM: 3000 });
    expect(c.jwtTtlSeconds).toBe(28800);
    expect(c.enableSimulation).toBe(true);
  });
});

describe('socle HTTP', () => {
  const { api } = buildTestApp();

  it('GET / renvoie les liens', async () => {
    const res = await api.get('/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      name: 'Drops API',
      docs: '/docs',
      openapi: '/openapi.json',
      contract: '/contract.md',
      health: '/health',
    });
  });

  it('pose X-Request-Id, no-store et CORS', async () => {
    const res = await api.get('/').set('Origin', 'https://exemple.test');
    expect(res.headers['x-request-id']).toMatch(/^req_[0-9a-f]{8}$/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('répond au preflight CORS', async () => {
    const res = await api
      .options('/drops')
      .set('Origin', 'https://exemple.test')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type,x-admin-key');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-methods']).toBe('GET,POST,PATCH,DELETE,OPTIONS');
    expect(res.headers['access-control-allow-headers']).toBe('Authorization,Content-Type,X-Admin-Key');
  });

  it('renvoie 404 au format standard sur une route inconnue', async () => {
    const res = await api.get('/nimportequoi');
    expectError(res, 404, 'not_found');
    expect(res.body.error.fields).toEqual({});
  });

  it('renvoie 404 sur une méthode inconnue pour une route existante', async () => {
    expectError(await api.delete('/health'), 404, 'not_found');
  });

  it('renvoie 400 bad_request sur un JSON illisible', async () => {
    const res = await api.post('/health').set('Content-Type', 'application/json').send('{"a":');
    expectError(res, 400, 'bad_request');
  });

  it('renvoie 400 sur un corps de plus de 100 ko', async () => {
    const res = await api.post('/health').send({ blob: 'x'.repeat(120_000) });
    expectError(res, 400, 'bad_request');
  });
});

describe('/health', () => {
  it('200 quand la base répond', async () => {
    const { api } = buildTestApp({ commit: 'abc1234' });
    const res = await api.get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      service: 'drops-api',
      version: '1.0.0',
      commit: 'abc1234',
      db: 'ok',
    });
    expect(res.body.uptimeSeconds).toBeTypeOf('number');
    expect(new Date(res.body.time).toISOString()).toBe(res.body.time);
  });

  it('commit vaut null sans information', async () => {
    const { api } = buildTestApp({ commit: null });
    expect((await api.get('/health')).body.commit).toBeNull();
  });

  it('503 degraded quand la base ne répond pas', async () => {
    const { api, db } = buildTestApp();
    db.close();
    const res = await api.get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'degraded', db: 'error' });
  });
});

describe('simulation ?delay et ?fail', () => {
  const { api } = buildTestApp();

  it('?delay attend avant de répondre', async () => {
    const start = Date.now();
    const res = await api.get('/health?delay=200');
    expect(res.status).toBe(200);
    expect(Date.now() - start).toBeGreaterThanOrEqual(190);
  });

  it.each([400, 401, 403, 404, 409, 422, 429, 500, 503])('?fail=%i renvoie une erreur simulée', async (status) => {
    const codes: Record<number, string> = {
      400: 'bad_request',
      401: 'unauthorized',
      403: 'forbidden',
      404: 'not_found',
      409: 'conflict',
      422: 'validation_failed',
      429: 'rate_limited',
      500: 'internal_error',
      503: 'service_unavailable',
    };
    const res = await api.get(`/health?fail=${status}`);
    expect(res.status).toBe(status);
    expect(res.body.error).toMatchObject({ status, code: codes[status], simulated: true, fields: {} });
    expect(res.headers['x-simulated']).toBe('true');
    expect(res.headers['x-request-id']).toBe(res.body.error.requestId);
    if (status === 401) expect(res.headers['www-authenticate']).toBe('Bearer');
    if (status === 429) expect(res.headers['retry-after']).toBe('5');
  });

  it('fail=422 reprend chaque champ du corps', async () => {
    const res = await api.post('/nimportequoi?fail=422').send({ title: 'a', lat: 1 });
    expect(res.status).toBe(422);
    expect(res.body.error.fields).toEqual({
      title: ['Erreur simulée sur ce champ.'],
      lat: ['Erreur simulée sur ce champ.'],
    });
  });

  it('fail=422 sans corps donne des fields vides', async () => {
    const res = await api.get('/health?fail=422');
    expect(res.body.error.fields).toEqual({});
  });

  it('la simulation s’applique aussi aux routes inconnues', async () => {
    const res = await api.get('/nimportequoi?fail=500');
    expect(res.status).toBe(500);
    expect(res.body.error.simulated).toBe(true);
  });

  it('combine delay et fail', async () => {
    const start = Date.now();
    const res = await api.get('/health?delay=150&fail=500');
    expect(res.status).toBe(500);
    expect(Date.now() - start).toBeGreaterThanOrEqual(140);
  });

  it.each([
    ['delay=abc', 'delay'],
    ['delay=10001', 'delay'],
    ['delay=-5', 'delay'],
    ['fail=418', 'fail'],
    ['fail=abc', 'fail'],
  ])('?%s renvoie un vrai 422 sur le paramètre', async (qs, field) => {
    const res = await api.get(`/health?${qs}`);
    expectError(res, 422, 'validation_failed');
    expect(res.body.error.fields[field]).toHaveLength(1);
    expect(res.headers['x-simulated']).toBeUndefined();
  });

  it('ignore ?delay et ?fail quand ENABLE_SIMULATION=false', async () => {
    const { api: off } = buildTestApp({ enableSimulation: false });
    const res = await off.get('/health?fail=500&delay=abc');
    expect(res.status).toBe(200);
  });
});

describe('documentation', () => {
  const { api, app } = buildTestApp();

  it('/openapi.json est un document OpenAPI 3.1', async () => {
    const res = await api.get('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.info.description).toContain('?delay');
    expect(res.body.components.securitySchemes.bearerAuth).toBeDefined();
    expect(res.body.paths['/health'].get.responses['200'].content['application/json'].example).toBeDefined();
  });

  it('chaque route Express figure dans /openapi.json, et inversement', async () => {
    const doc = (await api.get('/openapi.json')).body;
    const router = app.locals.apiRouter as Router;
    const registered: string[] = [];
    for (const layer of (router as any).stack) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods)) {
        registered.push(`${method} ${String(layer.route.path).replace(/:(\w+)/g, '{$1}')}`);
      }
    }
    const documented: string[] = [];
    for (const [path, ops] of Object.entries<any>(doc.paths)) {
      for (const method of Object.keys(ops)) documented.push(`${method} ${path}`);
    }
    expect(registered.length).toBeGreaterThan(0);
    expect(documented.sort()).toEqual(registered.sort());
  });

  it('chaque réponse documentée a un exemple', async () => {
    const doc = (await api.get('/openapi.json')).body;
    for (const [path, ops] of Object.entries<any>(doc.paths)) {
      for (const [method, op] of Object.entries<any>(ops)) {
        for (const [status, r] of Object.entries<any>(op.responses)) {
          if (!r.content) continue;
          for (const media of Object.values<any>(r.content)) {
            expect(media.example, `${method} ${path} ${status}`).toBeDefined();
          }
        }
      }
    }
  });

  it('/contract.md est du Markdown de 200 lignes au plus', async () => {
    const res = await api.get('/contract.md');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/markdown; charset=utf-8/);
    expect(res.text.split('\n').length).toBeLessThanOrEqual(200);
    expect(res.text).toContain('interface Drop');
    expect(res.text).toContain('GET    /health');
  });

  it('/docs sert la page Swagger UI et ses ressources', async () => {
    const res = await api.get('/docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('/openapi.json');
    const js = await api.get('/docs/assets/swagger-ui-bundle.js');
    expect(js.status).toBe(200);
  });
});
