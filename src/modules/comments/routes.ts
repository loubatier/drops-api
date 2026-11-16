import { events } from '../../events.js';
import { forbidden, notFound } from '../../errors.js';
import { z } from '../../openapi/zod.js';
import { defineRoute } from '../../http/route.js';
import { CommentSchema, EXAMPLES, idParams, pageExample, pageSchema, paginationQuery } from '../../schemas.js';
import type { Db } from '../../db/index.js';
import { findDropRow, isVisibleTo, paginate } from '../drops/repo.js';
import { viewableDrop } from '../drops/routes.js';
import { toPublicUser } from '../users/repo.js';

export const CommentPageSchema = pageSchema(CommentSchema, 'CommentPage');

export interface CommentRow {
  id: number;
  drop_id: number;
  author_id: number;
  content: string;
  created_at: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export const SELECT_COMMENT = `
  SELECT c.id, c.drop_id, c.author_id, c.content, c.created_at, u.username, u.display_name, u.avatar_url
  FROM comments c JOIN users u ON u.id = c.author_id`;

export const toComment = (row: CommentRow, viewerId: number | null) => ({
  id: row.id,
  dropId: row.drop_id,
  content: row.content,
  author: toPublicUser({ id: row.author_id, username: row.username, display_name: row.display_name, avatar_url: row.avatar_url }),
  isMine: viewerId !== null && row.author_id === viewerId,
  createdAt: row.created_at,
});

export const findComment = (db: Db, id: number) =>
  db.prepare(`${SELECT_COMMENT} WHERE c.id = ?`).get(id) as CommentRow | undefined;

export function commentReadRoutes() {
  return [
    defineRoute({
      method: 'get',
      path: '/drops/{id}/comments',
      tags: ['Commentaires'],
      summary: "Commentaires d'un drop",
      description: 'Page de commentaires, du plus ancien au plus récent. 404 si le drop n\'existe pas ou est masqué pour l\'appelant.',
      access: 'optional',
      params: idParams,
      query: paginationQuery,
      responses: {
        200: { description: 'Page de commentaires.', schema: CommentPageSchema, example: pageExample(EXAMPLES.comment, 2) },
      },
      handler: ({ params, query, db, user }) => {
        const viewerId = user?.id ?? null;
        const drop = findDropRow(db, params.id, viewerId);
        if (!drop || !isVisibleTo(drop, viewerId)) throw notFound('Drop introuvable.');
        const total = (db.prepare('SELECT COUNT(*) AS n FROM comments WHERE drop_id = ?').get(params.id) as { n: number }).n;
        const rows = db
          .prepare(`${SELECT_COMMENT} WHERE c.drop_id = ? ORDER BY c.created_at ASC, c.id ASC LIMIT ? OFFSET ?`)
          .all(params.id, query.pageSize, (query.page - 1) * query.pageSize) as CommentRow[];
        return { body: paginate(rows.map((r) => toComment(r, viewerId)), total, query.page, query.pageSize) };
      },
    }),
  ];
}

const commentBody = z
  .object({ content: z.string().trim().min(1, 'Entre 1 et 500 caractères.').max(500, 'Entre 1 et 500 caractères.') })
  .strict();

export function commentWriteRoutes() {
  return [
    defineRoute({
      method: 'post',
      path: '/drops/{id}/comments',
      tags: ['Commentaires'],
      summary: 'Commenter un drop',
      description: 'Ajoute un commentaire de 1 à 500 caractères.',
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
        const info = db
          .prepare('INSERT INTO comments (drop_id, author_id, content, created_at) VALUES (?, ?, ?, ?)')
          .run(params.id, user!.id, body.content, new Date().toISOString());
        const comment = toComment(findComment(db, Number(info.lastInsertRowid))!, user!.id);
        events.emit('comment:created', comment, db);
        return { status: 201, body: comment };
      },
    }),
    defineRoute({
      method: 'delete',
      path: '/comments/{id}',
      tags: ['Commentaires'],
      summary: 'Supprimer un commentaire',
      description: "Réservé à l'auteur du commentaire.",
      access: 'auth',
      params: idParams,
      errors: [403],
      responses: { 204: { description: 'Commentaire supprimé.' } },
      guard: ({ params, db, user }) => {
        const comment = findComment(db, params.id);
        if (!comment) throw notFound('Commentaire introuvable.');
        if (comment.author_id !== user!.id) throw forbidden("Seul l'auteur peut supprimer ce commentaire.");
      },
      handler: ({ params, db }) => {
        const comment = findComment(db, params.id)!;
        db.prepare('DELETE FROM comments WHERE id = ?').run(params.id);
        events.emit('comment:deleted', { dropId: comment.drop_id, commentId: comment.id }, db);
        return { status: 204 };
      },
    }),
  ];
}
