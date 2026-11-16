import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebSocket } from 'ws';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { seedDatabase, seedPasswordHash } from '../src/db/seed.js';
import { type Db, openDb } from '../src/db/index.js';
import type { Realtime, RealtimeOptions } from '../src/realtime/hub.js';
import { SEED_NOW, testConfig } from './helpers.js';

export interface TestServer {
  app: ReturnType<typeof createApp>;
  api: ReturnType<typeof request>;
  db: Db;
  config: Config;
  realtime: Realtime;
  port: number;
  stop: () => Promise<void>;
}

export async function startServer(
  overrides: Partial<Config> = {},
  realtimeOptions: RealtimeOptions = { presenceDebounceMs: 30 },
): Promise<TestServer> {
  const config = testConfig({ block2Enabled: true, ...overrides });
  const db = openDb(':memory:');
  seedDatabase(db, { now: SEED_NOW, passwordHash: seedPasswordHash() });
  const app = createApp({ config, db, options: { realtime: realtimeOptions } });
  const server = http.createServer(app);
  const realtime = app.locals.realtime as Realtime;
  realtime.attach(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    app,
    api: request(app),
    db,
    config,
    realtime,
    port,
    stop: async () => {
      await realtime.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

type Message = { type: string; data: any };

export class Client {
  messages: Message[] = [];
  closed: { code: number; reason: string } | null = null;
  private waiters: (() => void)[] = [];

  constructor(public ws: WebSocket) {
    ws.on('message', (raw) => {
      this.messages.push(JSON.parse(raw.toString()));
      this.wake();
    });
    ws.on('close', (code, reason) => {
      this.closed = { code, reason: reason.toString() };
      this.wake();
    });
  }

  private wake() {
    for (const w of this.waiters.splice(0)) w();
  }

  private async until<T>(check: () => T | undefined, ms: number, failure: () => string): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = check();
      if (found !== undefined) return found;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(failure());
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  waitFor(predicate: (m: Message) => boolean, ms = 3000): Promise<Message> {
    return this.until(
      () => this.messages.find(predicate),
      ms,
      () => `Message attendu non reçu. Reçus : ${JSON.stringify(this.messages.map((m) => m.type))}`,
    );
  }

  next(type: string, ms?: number) {
    return this.waitFor((m) => m.type === type, ms);
  }

  waitClosed(ms = 3000) {
    return this.until(
      () => this.closed ?? undefined,
      ms,
      () => 'Fermeture attendue.',
    );
  }

  count(type: string) {
    return this.messages.filter((m) => m.type === type).length;
  }

  send(type: string, data: unknown = {}) {
    this.ws.send(JSON.stringify({ type, data }));
  }

  sendRaw(raw: string) {
    this.ws.send(raw);
  }
}

export async function login(server: TestServer, name: string, ttl?: number) {
  const res = await server.api
    .post(`/auth/login${ttl ? `?ttl=${ttl}` : ''}`)
    .send({ login: name, password: 'drops2026' });
  return { token: res.body.token as string, user: res.body.user };
}

export async function ticketFor(server: TestServer, token: string) {
  const res = await server.api.post('/realtime/ticket').set('Authorization', `Bearer ${token}`);
  return res.body as { ticket: string; expiresAt: string; url: string };
}

export async function openSocket(server: TestServer, ticket: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws?ticket=${ticket}`);
  const client = new Client(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`handshake ${res.statusCode}`)));
  });
  await client.next('hello');
  return client;
}

export async function connectAs(server: TestServer, name: string, ttl?: number) {
  const { token, user } = await login(server, name, ttl);
  const { ticket } = await ticketFor(server, token);
  const client = await openSocket(server, ticket);
  return { client, token, user };
}

export function handshake(
  server: TestServer,
  query: string,
): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws${query}`);
    ws.once('open', () => {
      ws.close();
      reject(new Error('connexion ouverte alors qu’un refus était attendu'));
    });
    ws.once('unexpected-response', (_req, res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null, headers: res.headers }),
      );
    });
    ws.once('error', () => undefined);
  });
}
