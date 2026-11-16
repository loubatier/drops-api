import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { runSmoke } from '../scripts/smoke.js';
import { buildSeededApp } from './helpers.js';

it('le script de fumée passe contre une instance locale', async () => {
  const { app } = buildSeededApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  const lines: string[] = [];
  const ok = await runSmoke(`http://127.0.0.1:${port}`, (l) => lines.push(l));
  await new Promise((resolve) => server.close(resolve));
  expect(lines.join('\n')).not.toContain('❌');
  expect(lines).toHaveLength(6);
  expect(ok).toBe(true);
}, 30000);
