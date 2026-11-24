import { addComment, removeComment, setCommentReaction } from '../../services.js';
import { forbidden, notFound, validationFailed } from '../../errors.js';
import { z } from '../../openapi/zod.js';
import { defineRoute } from '../../http/route.js';
import { CommentSchema, EXAMPLES, idParams, pageExample, pageSchema, paginationQuery } from '../../schemas.js';
import type { Db } from '../../db/index.js';
import { findDropRow, isVisibleTo, pageWindow, paginate } from '../drops/repo.js';
import { viewableDrop } from '../drops/routes.js';
import { toPublicUser } from '../users/repo.js';

export const CommentPageSchema = pageSchema(CommentSchema, 'CommentPage');

interface CommentRow {
  id: number;
  drop_id: number;
  author_id: number;
  parent_id: number | null;
  content: string;
  deleted: number;
  created_at: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  replies_count: number;
  likes_count: number;
  dislikes_count: number;
  my_reaction: 'like' | 'dislike' | null;
}

const SELECT_COMMENT = `
  SELECT c.id, c.drop_id, c.author_id, c.parent_id, c.content, c.deleted, c.created_at,
    u.username, u.display_name, u.avatar_url,
    (SELECT COUNT(*) FROM comments r WHERE r.parent_id = c.id) AS replies_count,
    (SELECT COUNT(*) FROM comment_reactions x WHERE x.comment_id = c.id AND x.kind = 'like') AS likes_count,
    (SELECT COUNT(*) FROM comment_reactions x WHERE x.comment_id = c.id AND x.kind = 'dislike') AS dislikes_count,
    (SELECT x.kind FROM comment_reactions x WHERE x.comment_id = c.id AND x.user_id = @me) AS my_reaction
  FROM comments c JOIN users u ON u.id = c.author_id`;

const DELETED_AUTHOR = { id: 0, username: 'deleted', displayName: 'Commentaire supprimé', avatarUrl: null };

const toComment = (row: CommentRow, viewerId: number | null) => {
  const deleted = row.deleted === 1;
  return {
    id: row.id,
    dropId: row.drop_id,
    parentId: row.parent_id,
    content: deleted ? '' : row.content,
    author: deleted
      ? DELETED_AUTHOR
      : toPublicUser({ id: row.author_id, username: row.username, display_name: row.display_name, avatar_url: row.avatar_url }),
    isMine: !deleted && viewerId !== null && row.author_id === viewerId,
    deleted,
    repliesCount: row.replies_count,
    likesCount: row.likes_count,
    dislikesCount: row.dislikes_count,
    likedByMe: row.my_reaction === 'like',
    dislikedByMe: row.my_reaction === 'dislike',
    createdAt: row.created_at,
  };
};

export type CommentView = ReturnType<typeof toComment>;

export const findComment = (db: Db, id: number, viewerId: number | null): CommentView | undefined => {
  const row = db.prepare(`${SELECT_COMMENT} WHERE c.id = @id`).get({ id, me: viewerId ?? 0 }) as CommentRow | undefined;
  return row && toComment(row, viewerId);
};

function listComments(db: Db, where: string, params: Record<string, number>, query: { page?: number | undefined; pageSize?: number | undefined }, viewerId: number | null) {
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM comments c WHERE ${where}`).get(params) as { n: number }).n;
  const window = pageWindow(query.page, query.pageSize);
  const rows = db
    .prepare(`${SELECT_COMMENT} WHERE ${where} ORDER BY c.created_at ASC, c.id ASC${window ? ' LIMIT @limit OFFSET @offset' : ''}`)
    .all(
      window
        ? { ...params, me: viewerId ?? 0, limit: window.pageSize, offset: (window.page - 1) * window.pageSize }
        : { ...params, me: viewerId ?? 0 },
    ) as CommentRow[];
  return paginate(rows.map((r) => toComment(r, viewerId)), total, window);
}

const commentOf = (db: Db, id: number, viewerId: number | null) => {
  const comment = findComment(db, id, viewerId);
  if (!comment) throw notFound('Commentaire introuvable.');
  const drop = findDropRow(db, comment.dropId, viewerId);
  if (!drop || !isVisibleTo(drop, viewerId)) throw notFound('Commentaire introuvable.');
  return { comment, drop };
};

const reactableComment = (db: Db, id: number, userId: number) => {
  const { comment } = commentOf(db, id, userId);
  if (comment.deleted) throw notFound('Commentaire introuvable.');
  return comment;
};

const ReactionStateSchema = z
  .object({ liked: z.boolean(), disliked: z.boolean(), likesCount: z.number().int(), dislikesCount: z.number().int() })
  .openapi('CommentReactionState');

export function commentReadRoutes() {
  return [
    defineRoute({
      method: 'get',
      path: '/drops/{id}/comments',
      tags: ['Commentaires'],
      summary: "Commentaires d'un drop",
      description:
        "Page de commentaires de premier niveau, du plus ancien au plus récent, chacun avec `repliesCount`. Les réponses se lisent avec `GET /comments/{id}/replies`. Un commentaire supprimé qui a des réponses reste dans la liste avec `deleted: true`. 404 si le drop n'existe pas ou est masqué pour l'appelant.",
      access: 'auth',
      params: idParams,
      query: paginationQuery,
      responses: {
        200: { description: 'Page de commentaires.', schema: CommentPageSchema, example: pageExample(EXAMPLES.comment, 2) },
      },
      handler: ({ params, query, db, user }) => {
        const viewerId = user?.id ?? null;
        const drop = findDropRow(db, params.id, viewerId);
        if (!drop || !isVisibleTo(drop, viewerId)) throw notFound('Drop introuvable.');
        return { body: listComments(db, 'c.drop_id = @dropId AND c.parent_id IS NULL', { dropId: params.id }, query, viewerId) };
      },
    }),
    defineRoute({
      method: 'get',
      path: '/comments/{id}/replies',
      tags: ['Commentaires'],
      summary: "Réponses à un commentaire",
      description:
        "Page de réponses à un commentaire de premier niveau, de la plus ancienne à la plus récente. Répondre à une réponse la rattache au même commentaire racine : il n'y a qu'un niveau de réponses. 404 si le commentaire n'existe pas, s'il est lui-même une réponse ou si son drop est masqué.",
      access: 'auth',
      params: idParams,
      query: paginationQuery,
      responses: {
        200: {
          description: 'Page de réponses.',
          schema: CommentPageSchema,
          example: pageExample({ ...EXAMPLES.comment, id: 8, parentId: 7, repliesCount: 0, likesCount: 0 }, 1),
        },
      },
      handler: ({ params, query, db, user }) => {
        const viewerId = user?.id ?? null;
        const { comment } = commentOf(db, params.id, viewerId);
        if (comment.parentId !== null) throw notFound('Commentaire introuvable.');
        return { body: listComments(db, 'c.parent_id = @parentId', { parentId: params.id }, query, viewerId) };
      },
    }),
  ];
}

const commentBody = z
  .object({
    content: z.string().trim().min(1, 'Entre 1 et 500 caractères.').max(500, 'Entre 1 et 500 caractères.'),
    parentId: z
      .number({ invalid_type_error: 'Doit être un entier positif.' })
      .int('Doit être un entier positif.')
      .positive('Doit être un entier positif.')
      .optional()
      .openapi({ description: "Commentaire auquel répondre. Si c'est une réponse, la nouvelle réponse est rattachée au commentaire racine." }),
  })
  .strict();

const reactionRoute = (kind: 'like' | 'dislike', on: boolean) => {
  const label = kind === 'like' ? 'like' : 'dislike';
  return defineRoute({
    method: on ? 'post' : 'delete',
    path: `/comments/{id}/${label}`,
    tags: ['Commentaires'],
    summary: on ? (kind === 'like' ? 'Liker un commentaire' : 'Disliker un commentaire') : `Retirer son ${label} d'un commentaire`,
    description: on
      ? `Idempotent. ${kind === 'like' ? 'Retire un éventuel dislike' : 'Retire un éventuel like'} : un utilisateur a au plus une réaction par commentaire. 404 sur un commentaire supprimé.`
      : `Idempotent : retirer un ${label} absent renvoie le même résultat.`,
    access: 'auth',
    params: idParams,
    responses: {
      200: {
        description: 'État des réactions du commentaire.',
        schema: ReactionStateSchema,
        example: { liked: kind === 'like' && on, disliked: kind === 'dislike' && on, likesCount: 3, dislikesCount: 1 },
      },
    },
    handler: ({ params, db, user }) => {
      reactableComment(db, params.id, user!.id);
      return { body: setCommentReaction(db, params.id, user!.id, kind, on) };
    },
  });
};

export function commentWriteRoutes() {
  return [
    defineRoute({
      method: 'post',
      path: '/drops/{id}/comments',
      tags: ['Commentaires'],
      summary: 'Commenter un drop',
      description:
        'Ajoute un commentaire de 1 à 500 caractères. Avec `parentId`, ajoute une réponse : si `parentId` désigne déjà une réponse, la nouvelle est rattachée au commentaire racine (`parentId` de la réponse = racine). 422 sous la clé `parentId` si ce commentaire n\'existe pas sur ce drop.',
      access: 'auth',
      params: idParams,
      body: commentBody,
      responses: {
        201: { description: 'Commentaire créé.', schema: CommentSchema, example: { ...EXAMPLES.comment, isMine: true } },
      },
      guard: ({ params, db, user }) => {
        viewableDrop(db, params.id, user!.id);
      },
      handler: ({ params, body, db, user }) => {
        let rootId: number | null = null;
        if (body.parentId !== undefined) {
          const parent = findComment(db, body.parentId, user!.id);
          if (!parent || parent.dropId !== params.id) {
            throw validationFailed({ parentId: ['Commentaire introuvable sur ce drop.'] });
          }
          rootId = parent.parentId ?? parent.id;
        }
        return { status: 201, body: addComment(db, params.id, user!.id, body.content, rootId) };
      },
    }),
    defineRoute({
      method: 'delete',
      path: '/comments/{id}',
      tags: ['Commentaires'],
      summary: 'Supprimer un commentaire',
      description:
        "Réservé à l'auteur du commentaire. Un commentaire de premier niveau qui a des réponses est conservé comme « supprimé » (`deleted: true`, contenu vide, auteur anonymisé) ; sinon il disparaît. Une réponse disparaît toujours.",
      access: 'auth',
      params: idParams,
      errors: [403],
      responses: { 204: { description: 'Commentaire supprimé.' } },
      guard: ({ params, db, user }) => {
        const comment = findComment(db, params.id, user!.id);
        if (!comment || comment.deleted) throw notFound('Commentaire introuvable.');
        if (!comment.isMine) throw forbidden("Seul l'auteur peut supprimer ce commentaire.");
      },
      handler: ({ params, db, user }) => {
        removeComment(db, findComment(db, params.id, user!.id)!);
        return { status: 204 };
      },
    }),
    reactionRoute('like', true),
    reactionRoute('like', false),
    reactionRoute('dislike', true),
    reactionRoute('dislike', false),
  ];
}
