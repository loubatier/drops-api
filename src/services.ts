import type { Db } from './db/index.js';
import { events } from './events.js';
import { findComment, toComment } from './modules/comments/routes.js';
import { findDropRow, toDrop } from './modules/drops/repo.js';
import type { LockMode } from './settings.js';

export interface NewDrop {
  title: string;
  content: string;
  category: string;
  imageUrl?: string | null;
  lat: number;
  lng: number;
}

export function createDrop(db: Db, authorId: number, input: NewDrop, lockMode: LockMode, isSeed = false) {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO drops (author_id, title, content, category, image_url, lat, lng, is_seed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(authorId, input.title, input.content, input.category, input.imageUrl ?? null, input.lat, input.lng, isSeed ? 1 : 0, now, now);
  const id = Number(info.lastInsertRowid);
  const drop = toDrop(findDropRow(db, id, authorId)!, authorId, lockMode);
  events.emit('drop:created', drop, db);
  return drop;
}

const countLikes = (db: Db, dropId: number) =>
  (db.prepare('SELECT COUNT(*) AS n FROM likes WHERE drop_id = ?').get(dropId) as { n: number }).n;

export function setLike(db: Db, dropId: number, userId: number, liked: boolean) {
  const changes = liked
    ? db.prepare('INSERT OR IGNORE INTO likes (drop_id, user_id, created_at) VALUES (?, ?, ?)').run(dropId, userId, new Date().toISOString()).changes
    : db.prepare('DELETE FROM likes WHERE drop_id = ? AND user_id = ?').run(dropId, userId).changes;
  const likesCount = countLikes(db, dropId);
  if (changes > 0) events.emit('like:updated', { dropId, userId, liked, likesCount }, db);
  return { liked, likesCount };
}

export function addComment(db: Db, dropId: number, userId: number, content: string) {
  const info = db
    .prepare('INSERT INTO comments (drop_id, author_id, content, created_at) VALUES (?, ?, ?, ?)')
    .run(dropId, userId, content, new Date().toISOString());
  const comment = toComment(findComment(db, Number(info.lastInsertRowid))!, userId);
  events.emit('comment:created', comment, db);
  return comment;
}
