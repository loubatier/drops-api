import request from 'supertest';
import { createApp } from '../src/app.js';
import { type Config, loadConfig } from '../src/config.js';
import { type Db, openDb } from '../src/db/index.js';

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
