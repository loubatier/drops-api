import bcrypt from 'bcryptjs';
import { pathToFileURL } from 'node:url';
import type { Config } from '../config.js';
import { haversineMeters } from '../geo.js';
import { type Db, openDb } from './index.js';
import { COMMENTS, NOTES, PHOTOS, RIDDLES, SEED_PASSWORD, SEED_USERS, TIPS } from './seed-data.js';

const ZONE_CENTER = { lat: 47.495472, lng: 6.805279 };
const NEAR_RADIUS_M = 800;
const FAR_RADIUS_M = 2900;
const DAY_MS = 86_400_000;
const SEED = 20261116;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let cachedHash: string | null = null;
export function seedPasswordHash(): string {
  return (cachedHash ??= bcrypt.hashSync(SEED_PASSWORD, 10));
}

export interface SeedOptions {
  now?: Date;
  passwordHash?: string;
}

export interface Counts {
  users: number;
  drops: number;
  comments: number;
  likes: number;
}

export function countAll(db: Db): Counts {
  const n = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return { users: n('users'), drops: n('drops'), comments: n('comments'), likes: n('likes') };
}

function shuffle<T>(items: T[], rnd: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function randomPoint(rnd: () => number, near: boolean) {
  const minR = near ? 0 : NEAR_RADIUS_M;
  const maxR = near ? NEAR_RADIUS_M : FAR_RADIUS_M;
  const r = Math.sqrt(minR * minR + rnd() * (maxR * maxR - minR * minR));
  const theta = rnd() * 2 * Math.PI;
  const dLat = (r * Math.cos(theta)) / 111_320;
  const dLng = (r * Math.sin(theta)) / (111_320 * Math.cos((ZONE_CENTER.lat * Math.PI) / 180));
  const lat = Number((ZONE_CENTER.lat + dLat).toFixed(5));
  const lng = Number((ZONE_CENTER.lng + dLng).toFixed(5));
  return { lat, lng, distance: haversineMeters(ZONE_CENTER.lat, ZONE_CENTER.lng, lat, lng) };
}

export function seedDatabase(db: Db, options: SeedOptions = {}): Counts {
  const now = (options.now ?? new Date()).getTime();
  const hash = options.passwordHash ?? seedPasswordHash();
  const rnd = mulberry32(SEED);
  const iso = (ms: number) => new Date(ms).toISOString();

  const run = db.transaction(() => {
    const findUser = db.prepare('SELECT id FROM users WHERE username = ?');
    const insertUser = db.prepare(
      `INSERT INTO users (username, email, password_hash, display_name, bio, is_seed, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    );
    const userIds = new Map<string, number>();
    SEED_USERS.forEach((u, i) => {
      const existing = findUser.get(u.username) as { id: number } | undefined;
      if (existing) {
        userIds.set(u.username, existing.id);
        return;
      }
      const info = insertUser.run(
        u.username,
        `${u.username}@example.com`,
        hash,
        u.displayName,
        u.bio,
        iso(now - 15 * DAY_MS - i * 3_600_000),
      );
      userIds.set(u.username, Number(info.lastInsertRowid));
    });

    const authors = SEED_USERS.filter((u) => u.hasDrops).map((u) => u.username);
    const allUsers = SEED_USERS.map((u) => u.username);
    const texts = shuffle(
      [
        ...NOTES.map((t) => ({ ...t, category: 'note' })),
        ...PHOTOS.map((t) => ({ ...t, category: 'photo' })),
        ...TIPS.map((t) => ({ ...t, category: 'tip' })),
        ...RIDDLES.map((t) => ({ ...t, category: 'riddle' })),
      ],
      rnd,
    );
    const planned = texts.map((t, i) => {
      const point = randomPoint(rnd, i % 10 < 7);
      return {
        ...t,
        author: authors[i % authors.length]!,
        lat: point.lat,
        lng: point.lng,
        createdAt: now - Math.floor(rnd() * 14 * DAY_MS) - 60_000,
      };
    });
    planned.sort((a, b) => a.createdAt - b.createdAt);

    const insertDrop = db.prepare(
      `INSERT INTO drops (author_id, title, content, category, image_url, lat, lng, hidden, is_seed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
    );
    const insertLike = db.prepare('INSERT INTO likes (drop_id, user_id, created_at) VALUES (?, ?, ?)');
    const insertComment = db.prepare(
      'INSERT INTO comments (drop_id, author_id, content, created_at) VALUES (?, ?, ?, ?)',
    );

    planned.forEach((d, index) => {
      const imageUrl = d.category === 'photo' ? `https://picsum.photos/seed/drop-${index + 1}/800/600` : null;
      const created = iso(d.createdAt);
      const dropId = Number(
        insertDrop.run(userIds.get(d.author)!, d.title, d.content, d.category, imageUrl, d.lat, d.lng, created, created)
          .lastInsertRowid,
      );
      const span = now - d.createdAt;
      const likeCount = Math.floor(rnd() * 9);
      for (const username of shuffle(allUsers, rnd).slice(0, likeCount)) {
        insertLike.run(dropId, userIds.get(username)!, iso(d.createdAt + Math.floor(rnd() * span)));
      }
      const commentCount = index === 0 ? 0 : Math.floor(rnd() * 5);
      const commentTimes = Array.from({ length: commentCount }, () => d.createdAt + Math.floor(rnd() * span)).sort(
        (a, b) => a - b,
      );
      for (const time of commentTimes) {
        const author = allUsers[Math.floor(rnd() * allUsers.length)]!;
        const text = COMMENTS[Math.floor(rnd() * COMMENTS.length)]!;
        insertComment.run(dropId, userIds.get(author)!, text, iso(time));
      }
    });
  });
  run();
  return countAll(db);
}

export type ResetMode = 'all' | 'keep-users';

export function resetDatabase(db: Db, mode: ResetMode, options: SeedOptions = {}): Counts {
  db.transaction(() => {
    db.exec('DELETE FROM opens; DELETE FROM reports; DELETE FROM likes; DELETE FROM comments; DELETE FROM drops;');
    if (mode === 'all') {
      db.exec('DELETE FROM revoked_tokens; DELETE FROM users; DELETE FROM sqlite_sequence;');
    } else {
      db.exec("DELETE FROM sqlite_sequence WHERE name IN ('drops', 'comments', 'reports');");
    }
  })();
  return seedDatabase(db, options);
}

export function seedIfEmpty(db: Db, config: Config): boolean {
  if (!config.seedOnEmpty) return false;
  const { users, drops } = countAll(db);
  if (users > 0 || drops > 0) return false;
  seedDatabase(db);
  return true;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const path = process.env.DATABASE_PATH || './data/drops.db';
  const db = openDb(path);
  const reset = process.argv.includes('--reset');
  const { users, drops } = countAll(db);
  if ((users > 0 || drops > 0) && !reset) {
    console.error(`La base ${path} contient déjà des données. Relancez avec « npm run seed -- --reset » pour la vider.`);
    process.exit(1);
  }
  const counts = reset ? resetDatabase(db, 'all') : seedDatabase(db);
  console.log(`Données d'exemple chargées dans ${path} :`, counts);
  db.close();
}
