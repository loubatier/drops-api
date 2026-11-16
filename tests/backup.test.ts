import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { backupDatabase } from '../src/db/backup.js';
import { openDb } from '../src/db/index.js';

it('sauvegarde la base et conserve les 24 dernières copies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'drops-backup-'));
  const path = join(dir, 'drops.db');
  const db = openDb(path);
  db.prepare("INSERT INTO users (username, email, password_hash, display_name, created_at) VALUES ('a','a@a.fr','x','A','now')").run();
  for (let hour = 0; hour < 26; hour++) {
    await backupDatabase(db, path, new Date(Date.UTC(2026, 10, 16, hour % 24, 0, hour < 24 ? 0 : 1) + Math.floor(hour / 24) * 86_400_000));
  }
  const files = readdirSync(join(dir, 'backups'));
  expect(files).toHaveLength(24);
  const copy = openDb(join(dir, 'backups', files.at(-1)!));
  expect((copy.prepare('SELECT COUNT(*) AS n FROM users').get() as any).n).toBe(1);
  copy.close();
  db.close();
});
