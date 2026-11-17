import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { ApiError } from './errors.js';

export type LockMode = 'on' | 'off';

export interface SettingsPatch {
  block2Enabled?: boolean;
  lockMode?: LockMode;
}

export interface SettingsChange {
  block2Enabled: boolean;
  lockMode: LockMode;
  previous: { block2Enabled: boolean; lockMode: LockMode };
}

export interface Settings {
  block2Enabled(): boolean;
  lockMode(): LockMode;
  update(patch: SettingsPatch): SettingsChange;
  onChange(listener: (change: SettingsChange) => void): () => void;
}

export function createSettings(db: Db, config: Config): Settings {
  const read = db.prepare('SELECT value FROM settings WHERE key = ?');
  const write = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const listeners = new Set<(change: SettingsChange) => void>();

  const initial = (key: string): string | undefined => (read.get(key) as { value: string } | undefined)?.value;
  let currentBlock2 = initial('block2Enabled') === undefined ? config.block2Enabled : initial('block2Enabled') === 'true';
  const storedLockValue = initial('lockMode');
  let currentLock: LockMode = storedLockValue === 'on' || storedLockValue === 'off' ? storedLockValue : config.lockMode;

  const storedLock = (): LockMode => currentLock;
  const block2Enabled = () => currentBlock2;
  const lockMode = (): LockMode => (currentBlock2 ? currentLock : 'off');

  return {
    block2Enabled,
    lockMode,
    update(patch) {
      const previous = { block2Enabled: block2Enabled(), lockMode: lockMode() };
      const nextBlock2 = patch.block2Enabled ?? previous.block2Enabled;
      let nextLock: LockMode = patch.lockMode ?? storedLock();
      if (patch.lockMode === 'on' && !nextBlock2) {
        throw new ApiError(409, 'block2_disabled', 'Le bloc 2 est désactivé : activez-le avant de verrouiller les drops.');
      }
      if (!nextBlock2) nextLock = 'off';
      db.transaction(() => {
        write.run('block2Enabled', String(nextBlock2));
        write.run('lockMode', nextLock);
      })();
      currentBlock2 = nextBlock2;
      currentLock = nextLock;
      const change: SettingsChange = { block2Enabled: block2Enabled(), lockMode: lockMode(), previous };
      for (const listener of listeners) listener(change);
      return change;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
