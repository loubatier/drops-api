import { notFound } from '../../errors.js';
import { defineRoute } from '../../http/route.js';
import { CommentSchema, EXAMPLES, idParams, pageExample, pageSchema, paginationQuery } from '../../schemas.js';
import type { Db } from '../../db/index.js';
import { findDropRow, isVisibleTo, paginate } from '../drops/repo.js';
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
