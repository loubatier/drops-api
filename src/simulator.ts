import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { findDropRow, isLockedFor, isVisibleTo } from './modules/drops/repo.js';
import { recordOpen } from './modules/drops/open.js';
import { SIM_COMMENTS, SIM_DROPS } from './simulator-data.js';
import { addComment, createDrop, setLike } from './services.js';
import type { Settings } from './settings.js';

export type SimulatorAction = 'like' | 'comment' | 'open' | 'create';

export interface SimulatorControl {
  state(): { enabled: boolean; intervalSeconds: number };
  configure(enabled: boolean, intervalSeconds?: number): void;
  runOnce(action?: SimulatorAction): string | null;
  stop(): void;
}

interface SimUser {
  id: number;
}

interface DropIds {
  id: number;
  author_id: number;
  author_is_seed: number;
}

const WEIGHTS: [SimulatorAction, number][] = [
  ['like', 50],
  ['comment', 30],
  ['open', 15],
  ['create', 5],
];

const ZONE_RADIUS_USED_M = 2500;

export function createSimulator(
  config: Config,
  db: Db,
  settings: Settings,
  rng: () => number = Math.random,
): SimulatorControl {
  let enabled = false;
  let intervalSeconds = config.simulatorIntervalSeconds;
  let timer: NodeJS.Timeout | null = null;

  const pick = <T>(items: T[]): T | undefined => items[Math.floor(rng() * items.length)];

  const actors = () => db.prepare('SELECT id FROM users WHERE is_seed = 1').all() as SimUser[];
  const candidates = (actorId: number, seedAuthorsOnly: boolean) =>
    (
      db
        .prepare(
          `SELECT d.id, d.author_id, u.is_seed AS author_is_seed FROM drops d JOIN users u ON u.id = d.author_id
           WHERE d.hidden = 0 ${seedAuthorsOnly ? 'AND u.is_seed = 1' : ''}`,
        )
        .all() as DropIds[]
    ).filter((d) => d.author_id !== actorId || !seedAuthorsOnly);

  const unlockedFor = (dropId: number, actorId: number) => {
    const row = findDropRow(db, dropId, actorId);
    return row !== undefined && isVisibleTo(row, actorId) && !isLockedFor(row, actorId, settings.lockMode());
  };

  const like = (actorId: number): string | null => {
    const options = candidates(actorId, false).filter((d) => unlockedFor(d.id, actorId));
    const target = pick(options);
    if (!target) return null;
    const already = db.prepare('SELECT 1 FROM likes WHERE drop_id = ? AND user_id = ?').get(target.id, actorId) !== undefined;
    setLike(db, target.id, actorId, !already);
    return already ? `unlike:${target.id}` : `like:${target.id}`;
  };

  const comment = (actorId: number): string | null => {
    const options = candidates(actorId, true).filter((d) => unlockedFor(d.id, actorId));
    const target = pick(options);
    const text = pick(SIM_COMMENTS);
    if (!target || !text) return null;
    addComment(db, target.id, actorId, text);
    return `comment:${target.id}`;
  };

  const open = (actorId: number): string | null => {
    const options = candidates(actorId, false).filter(
      (d) =>
        d.author_id !== actorId &&
        db.prepare('SELECT 1 FROM opens WHERE drop_id = ? AND user_id = ?').get(d.id, actorId) === undefined,
    );
    const target = pick(options);
    if (!target) return null;
    recordOpen(db, target.id, actorId);
    return `open:${target.id}`;
  };

  const create = (actorId: number): string | null => {
    const template = pick(SIM_DROPS);
    if (!template) return null;
    const radius = Math.sqrt(rng()) * ZONE_RADIUS_USED_M;
    const theta = rng() * 2 * Math.PI;
    const lat = Number((config.zone.lat + (radius * Math.cos(theta)) / 111_320).toFixed(5));
    const lng = Number(
      (config.zone.lng + (radius * Math.sin(theta)) / (111_320 * Math.cos((config.zone.lat * Math.PI) / 180))).toFixed(5),
    );
    const drop = createDrop(db, actorId, { ...template, lat, lng }, settings.lockMode(), true);
    return `create:${drop.id}`;
  };

  const actions: Record<SimulatorAction, (actorId: number) => string | null> = { like, comment, open, create };

  const chooseAction = (): SimulatorAction => {
    const total = WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
    let roll = rng() * total;
    for (const [action, weight] of WEIGHTS) {
      roll -= weight;
      if (roll < 0) return action;
    }
    return 'like';
  };

  const runOnce = (action?: SimulatorAction): string | null => {
    const actor = pick(actors());
    if (!actor) return null;
    const chosen = action ?? chooseAction();
    return actions[chosen](actor.id) ?? (action ? null : like(actor.id));
  };

  const schedule = () => {
    if (!enabled) return;
    const delayMs = intervalSeconds * 1000 * (0.5 + rng());
    timer = setTimeout(() => {
      try {
        runOnce();
      } catch (err) {
        console.error('[simulateur]', err);
      }
      schedule();
    }, delayMs);
    timer.unref();
  };

  const stop = () => {
    enabled = false;
    if (timer) clearTimeout(timer);
    timer = null;
  };

  settings.onChange((change) => {
    if (!change.block2Enabled) stop();
  });

  return {
    state: () => ({ enabled, intervalSeconds }),
    configure(nextEnabled, nextInterval) {
      if (nextInterval !== undefined) intervalSeconds = nextInterval;
      if (timer) clearTimeout(timer);
      timer = null;
      enabled = nextEnabled;
      schedule();
    },
    runOnce,
    stop,
  };
}
