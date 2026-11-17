import { setLike } from '../../services.js';
import { defineRoute } from '../../http/route.js';
import { z } from '../../openapi/zod.js';
import { idParams } from '../../schemas.js';
import { assertUnlocked, viewableDrop } from '../drops/routes.js';

const LikeSchema = z.object({ liked: z.boolean(), likesCount: z.number().int() }).openapi('LikeState');

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
      handler: ({ params, db, user }) => ({ body: setLike(db, params.id, user!.id, true) }),
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
      handler: ({ params, db, user }) => ({ body: setLike(db, params.id, user!.id, false) }),
    }),
  ];
}
