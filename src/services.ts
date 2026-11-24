import type { Db } from './db/index.js';
import { events } from './events.js';
import { findComment } from './modules/comments/routes.js';
import { findDropRow, toDrop } from './modules/drops/repo.js';

export interface NewDrop {
  title: string;
  content: string;
  category: string;
  imageUrl?: string | null;
  lat: number;
  lng: number;
}

export function createDrop(db: Db, authorId: number, input: NewDrop, isSeed = false) {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO drops (author_id, title, content, category, image_url, lat, lng, is_seed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(authorId, input.title, input.content, input.category, input.imageUrl ?? null, input.lat, input.lng, isSeed ? 1 : 0, now, now);
  const id = Number(info.lastInsertRowid);
  const drop = toDrop(findDropRow(db, id, authorId)!, authorId);
  events.emit('drop:created', drop, db);
  return drop;
}

export type ReactionKind = 'like' | 'dislike';

const DROP_TABLE = { like: 'likes', dislike: 'dislikes' } as const;
const OPPOSITE = { like: 'dislike', dislike: 'like' } as const;

const countRows = (db: Db, table: string, column: string, id: number) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(id) as { n: number }).n;

export function setDropReaction(db: Db, dropId: number, userId: number, kind: ReactionKind, on: boolean) {
  const now = new Date().toISOString();
  let changed = 0;
  let newLike = false;
  db.transaction(() => {
    if (on) {
      changed += db.prepare(`DELETE FROM ${DROP_TABLE[OPPOSITE[kind]]} WHERE drop_id = ? AND user_id = ?`).run(dropId, userId).changes;
      const inserted = db.prepare(`INSERT OR IGNORE INTO ${DROP_TABLE[kind]} (drop_id, user_id, created_at) VALUES (?, ?, ?)`).run(dropId, userId, now).changes;
      changed += inserted;
      newLike = kind === 'like' && inserted > 0;
    } else {
      changed += db.prepare(`DELETE FROM ${DROP_TABLE[kind]} WHERE drop_id = ? AND user_id = ?`).run(dropId, userId).changes;
    }
  })();
  const state = {
    liked: db.prepare('SELECT 1 FROM likes WHERE drop_id = ? AND user_id = ?').get(dropId, userId) !== undefined,
    disliked: db.prepare('SELECT 1 FROM dislikes WHERE drop_id = ? AND user_id = ?').get(dropId, userId) !== undefined,
    likesCount: countRows(db, 'likes', 'drop_id', dropId),
    dislikesCount: countRows(db, 'dislikes', 'drop_id', dropId),
  };
  if (changed > 0) events.emit('like:updated', { dropId, userId, newLike, ...state }, db);
  return state;
}

export const setLike = (db: Db, dropId: number, userId: number, liked: boolean) => setDropReaction(db, dropId, userId, 'like', liked);
export const setDislike = (db: Db, dropId: number, userId: number, disliked: boolean) =>
  setDropReaction(db, dropId, userId, 'dislike', disliked);

export function setCommentReaction(db: Db, commentId: number, userId: number, kind: ReactionKind, on: boolean) {
  const current = db.prepare('SELECT kind FROM comment_reactions WHERE comment_id = ? AND user_id = ?').get(commentId, userId) as
    | { kind: ReactionKind }
    | undefined;
  let changed = false;
  if (on && current?.kind !== kind) {
    db.prepare('INSERT OR REPLACE INTO comment_reactions (comment_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)').run(
      commentId,
      userId,
      kind,
      new Date().toISOString(),
    );
    changed = true;
  } else if (!on && current?.kind === kind) {
    db.prepare('DELETE FROM comment_reactions WHERE comment_id = ? AND user_id = ?').run(commentId, userId);
    changed = true;
  }
  const comment = findComment(db, commentId, userId)!;
  if (changed) events.emit('comment:updated', comment, db);
  return {
    liked: comment.likedByMe,
    disliked: comment.dislikedByMe,
    likesCount: comment.likesCount,
    dislikesCount: comment.dislikesCount,
  };
}

export function addComment(db: Db, dropId: number, userId: number, content: string, parentId: number | null = null) {
  const info = db
    .prepare('INSERT INTO comments (drop_id, author_id, parent_id, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(dropId, userId, parentId, content, new Date().toISOString());
  const comment = findComment(db, Number(info.lastInsertRowid), userId)!;
  events.emit('comment:created', comment, db);
  return comment;
}

export function removeComment(db: Db, comment: { id: number; dropId: number; parentId: number | null; repliesCount: number }) {
  const hardDelete = (id: number) => {
    db.prepare('DELETE FROM comments WHERE id = ?').run(id);
    events.emit('comment:deleted', { dropId: comment.dropId, commentId: id }, db);
  };
  if (comment.parentId === null && comment.repliesCount > 0) {
    db.prepare("UPDATE comments SET deleted = 1, content = '' WHERE id = ?").run(comment.id);
    db.prepare('DELETE FROM comment_reactions WHERE comment_id = ?').run(comment.id);
    events.emit('comment:updated', { id: comment.id, dropId: comment.dropId }, db);
    return;
  }
  hardDelete(comment.id);
  if (comment.parentId === null) return;
  const parent = db.prepare('SELECT deleted FROM comments WHERE id = ?').get(comment.parentId) as { deleted: number } | undefined;
  if (parent?.deleted === 1 && countRows(db, 'comments', 'parent_id', comment.parentId) === 0) hardDelete(comment.parentId);
}
