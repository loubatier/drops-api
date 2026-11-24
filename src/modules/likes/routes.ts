import { setDislike, setLike } from '../../services.js';
import { defineRoute } from '../../http/route.js';
import { z } from '../../openapi/zod.js';
import { idParams } from '../../schemas.js';
import { viewableDrop } from '../drops/routes.js';

const LikeSchema = z
  .object({ liked: z.boolean(), disliked: z.boolean(), likesCount: z.number().int(), dislikesCount: z.number().int() })
  .openapi('LikeState');

export function likeRoutes() {
  return [
    defineRoute({
      method: 'post',
      path: '/drops/{id}/like',
      tags: ['Likes'],
      summary: 'Liker un drop',
      description: 'Idempotent : liker deux fois ne compte qu’une fois. Liker son propre drop est autorisé. Retire un éventuel dislike : un utilisateur a au plus une réaction par drop.',
      access: 'auth',
      params: idParams,
      responses: { 200: { description: 'État du like.', schema: LikeSchema, example: { liked: true, disliked: false, likesCount: 5, dislikesCount: 1 } } },
      guard: ({ params, db, user }) => {
        viewableDrop(db, params.id, user!.id);
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
      responses: { 200: { description: 'État du like.', schema: LikeSchema, example: { liked: false, disliked: false, likesCount: 4, dislikesCount: 1 } } },
      guard: ({ params, db, user }) => {
        viewableDrop(db, params.id, user!.id);
      },
      handler: ({ params, db, user }) => ({ body: setLike(db, params.id, user!.id, false) }),
    }),
    defineRoute({
      method: 'post',
      path: '/drops/{id}/dislike',
      tags: ['Likes'],
      summary: 'Disliker un drop',
      description: 'Idempotent. Retire un éventuel like : un utilisateur a au plus une réaction par drop.',
      access: 'auth',
      params: idParams,
      responses: { 200: { description: 'État des réactions.', schema: LikeSchema, example: { liked: false, disliked: true, likesCount: 4, dislikesCount: 2 } } },
      guard: ({ params, db, user }) => {
        viewableDrop(db, params.id, user!.id);
      },
      handler: ({ params, db, user }) => ({ body: setDislike(db, params.id, user!.id, true) }),
    }),
    defineRoute({
      method: 'delete',
      path: '/drops/{id}/dislike',
      tags: ['Likes'],
      summary: 'Retirer son dislike',
      description: 'Idempotent : retirer un dislike absent renvoie le même résultat.',
      access: 'auth',
      params: idParams,
      responses: { 200: { description: 'État des réactions.', schema: LikeSchema, example: { liked: false, disliked: false, likesCount: 4, dislikesCount: 1 } } },
      guard: ({ params, db, user }) => {
        viewableDrop(db, params.id, user!.id);
      },
      handler: ({ params, db, user }) => ({ body: setDislike(db, params.id, user!.id, false) }),
    }),
  ];
}
