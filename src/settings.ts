import type { Config } from './config.js';
import type { Db } from './db/index.js';

export type LockMode = 'on' | 'off';

export interface SettingsPatch {
  lockMode?: LockMode;
}

export interface SettingsChange {
  lockMode: LockMode;
  previous: { lockMode: LockMode };
}

export interface Settings {
  lockMode(): LockMode;
  update(patch: SettingsPatch): SettingsChange;
  onChange(listener: (change: SettingsChange) => void): () => void;
}

export function createSettings(db: Db, config: Config): Settings {
  const read = db.prepare('SELECT value FROM settings WHERE key = ?');
  const write = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const listeners = new Set<(change: SettingsChange) => void>();

  const initial = (key: string): string | undefined => (read.get(key) as { value: string } | undefined)?.value;
  const storedLockValue = initial('lockMode');
  let currentLock: LockMode = storedLockValue === 'on' || storedLockValue === 'off' ? storedLockValue : config.lockMode;

  const lockMode = (): LockMode => currentLock;

  return {
    lockMode,
    update(patch) {
      const previous = { lockMode: lockMode() };
      const nextLock: LockMode = patch.lockMode ?? previous.lockMode;
      write.run('lockMode', nextLock);
      currentLock = nextLock;
      const change: SettingsChange = { lockMode: nextLock, previous };
      for (const listener of listeners) listener(change);
      return change;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
