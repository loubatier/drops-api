import { events } from '../../events.js';
import { defineRoute } from '../../http/route.js';
import { z } from '../../openapi/zod.js';
import { idParams } from '../../schemas.js';
import { assertUnlocked, viewableDrop } from '../drops/routes.js';
import type { Db } from '../../db/index.js';

const LikeSchema = z.object({ liked: z.boolean(), likesCount: z.number().int() }).openapi('LikeState');

const countLikes = (db: Db, dropId: number) =>
  (db.prepare('SELECT COUNT(*) AS n FROM likes WHERE drop_id = ?').get(dropId) as { n: number }).n;

export function likeRoutes() {
  return [
    defineRoute({
      method: 'post',
      path: '/drops/{id}/like',
      tags: ['Likes'],
      summary: 'Liker un drop',
      description: 'Idempotent : liker deux fois ne compte qu’une fois. Liker son propre drop est autorisé.',
      access: 'auth',
      params: idParams,
      responses: { 200: { description: 'État du like.', schema: LikeSchema, example: { liked: true, likesCount: 5 } } },
      guard: ({ params, db, user, settings }) => {
        assertUnlocked(viewableDrop(db, params.id, user!.id), user!.id, settings.lockMode());
      },
      handler: ({ params, db, user }) => {
        const info = db
          .prepare('INSERT OR IGNORE INTO likes (drop_id, user_id, created_at) VALUES (?, ?, ?)')
          .run(params.id, user!.id, new Date().toISOString());
        const likesCount = countLikes(db, params.id);
        if (info.changes > 0) {
          events.emit('like:updated', { dropId: params.id, userId: user!.id, liked: true, likesCount }, db);
        }
        return { body: { liked: true, likesCount } };
      },
    }),
    defineRoute({
      method: 'delete',
      path: '/drops/{id}/like',
      tags: ['Likes'],
      summary: 'Retirer son like',
      description: 'Idempotent : retirer un like absent renvoie le même résultat.',
      access: 'auth',
      params: idParams,
      responses: { 200: { description: 'État du like.', schema: LikeSchema, example: { liked: false, likesCount: 4 } } },
      guard: ({ params, db, user, settings }) => {
        assertUnlocked(viewableDrop(db, params.id, user!.id), user!.id, settings.lockMode());
      },
      handler: ({ params, db, user }) => {
        const info = db.prepare('DELETE FROM likes WHERE drop_id = ? AND user_id = ?').run(params.id, user!.id);
        const likesCount = countLikes(db, params.id);
        if (info.changes > 0) {
          events.emit('like:updated', { dropId: params.id, userId: user!.id, liked: false, likesCount }, db);
        }
        return { body: { liked: false, likesCount } };
      },
    }),
  ];
}
