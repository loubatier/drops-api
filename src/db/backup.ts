import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Db } from './index.js';

const KEEP = 24;

export async function backupDatabase(db: Db, databasePath: string, now = new Date()): Promise<string> {
  const dir = join(dirname(databasePath), 'backups');
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const target = join(dir, `drops-${stamp}.db`);
  await db.backup(target);
  const files = readdirSync(dir)
    .filter((f) => /^drops-.*\.db$/.test(f))
    .sort();
  for (const old of files.slice(0, Math.max(0, files.length - KEEP))) rmSync(join(dir, old));
  return target;
}

export function scheduleBackups(db: Db, databasePath: string): NodeJS.Timeout | null {
  if (databasePath === ':memory:') return null;
  const run = () =>
    backupDatabase(db, databasePath).catch((err) => console.error('Sauvegarde impossible :', err));
  void run();
  const timer = setInterval(run, 3_600_000);
  timer.unref();
  return timer;
}
