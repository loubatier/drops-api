import request from 'supertest';
import { createApp } from '../src/app.js';
import { type Config, loadConfig } from '../src/config.js';
import { type Db, openDb } from '../src/db/index.js';
import { seedDatabase, seedPasswordHash } from '../src/db/seed.js';

export function testConfig(overrides: Partial<Config> = {}): Config {
  const base = loadConfig({
    JWT_SECRET: 'test-secret-test-secret-test-secret-123',
    ADMIN_KEY: 'teacher-key',
    DATABASE_PATH: ':memory:',
    SEED_ON_EMPTY: 'false',
    NODE_ENV: 'test',
  });
  return { ...base, ...overrides };
}

export function buildTestApp(overrides: Partial<Config> = {}) {
  const config = testConfig(overrides);
  const db: Db = openDb(':memory:');
  const app = createApp({ config, db });
  return { app, db, config, api: request(app) };
}


export const SEED_NOW = new Date('2026-11-16T12:00:00.000Z');

export function buildSeededApp(overrides: Partial<Config> = {}) {
  const ctx = buildTestApp(overrides);
  seedDatabase(ctx.db, { now: SEED_NOW, passwordHash: seedPasswordHash() });
  return ctx;
}

export async function registerUser(
  api: ReturnType<typeof request>,
  name: string,
  extra: Record<string, unknown> = {},
) {
  const res = await api.post('/auth/register').send({
    username: name,
    email: `${name}@example.com`,
    password: 'motdepasse1',
    displayName: name.toUpperCase(),
    ...extra,
  });
  return { token: res.body.token as string, user: res.body.user, res };
}

export async function loginAs(api: ReturnType<typeof request>, login: string, password = 'drops2026') {
  const res = await api.post('/auth/login').send({ login, password });
  return { token: res.body.token as string, user: res.body.user, res };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
