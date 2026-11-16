import { notFound } from '../../errors.js';
import { defineRoute } from '../../http/route.js';
import { z } from '../../openapi/zod.js';
import { CATEGORIES, DropSchema, EXAMPLES, idParams, pageExample, pageSchema, paginationQuery } from '../../schemas.js';
import { findDropRow, isVisibleTo, listDrops, paginate, toDrop } from './repo.js';

const listQuery = paginationQuery.extend({
  q: z
    .string()
    .trim()
    .max(100, 'Au plus 100 caractères.')
    .optional()
    .openapi({
      description:
        "Recherche insensible à la casse et aux accents dans le titre, le contenu et le nom d'utilisateur de l'auteur.",
      example: 'banc',
    }),
  category: z.enum(CATEGORIES, { errorMap: () => ({ message: 'Catégorie inconnue.' }) }).optional(),
  author: z.string().trim().optional().openapi({ description: "Nom d'utilisateur de l'auteur.", example: 'lea' }),
  sort: z
    .enum(['recent', 'popular'], { errorMap: () => ({ message: 'Doit valoir recent ou popular.' }) })
    .default('recent')
    .openapi({ description: '`popular` : likes décroissants, puis du plus récent au plus ancien.' }),
});

export const DropPageSchema = pageSchema(DropSchema, 'DropPage');

export function dropReadRoutes() {
  return [
    defineRoute({
      method: 'get',
      path: '/drops',
      tags: ['Drops'],
      summary: 'Lister les drops',
      description:
        "Liste paginée des drops, du plus récent au plus ancien par défaut. Les drops masqués sont exclus. Le token est facultatif : il alimente `likedByMe` et `isMine`.",
      access: 'optional',
      query: listQuery,
      responses: {
        200: { description: 'Page de drops.', schema: DropPageSchema, example: pageExample(EXAMPLES.drop) },
      },
      handler: ({ query, db, user }) => {
        const viewerId = user?.id ?? null;
        const { rows, total } = listDrops(
          db,
          { ...query, q: query.q || undefined, author: query.author || undefined },
          viewerId,
        );
        return { body: paginate(rows.map((r) => toDrop(r, viewerId)), total, query.page, query.pageSize) };
      },
    }),
    defineRoute({
      method: 'get',
      path: '/drops/{id}',
      tags: ['Drops'],
      summary: "Détail d'un drop",
      description:
        "404 si le drop n'existe pas, ou s'il est masqué et que l'appelant n'en est pas l'auteur. L'auteur voit son drop masqué avec `hidden: true`.",
      access: 'optional',
      params: idParams,
      responses: { 200: { description: 'Drop.', schema: DropSchema, example: EXAMPLES.drop } },
      handler: ({ params, db, user }) => {
        const viewerId = user?.id ?? null;
        const row = findDropRow(db, params.id, viewerId);
        if (!row || !isVisibleTo(row, viewerId)) throw notFound('Drop introuvable.');
        return { body: toDrop(row, viewerId) };
      },
    }),
  ];
}
