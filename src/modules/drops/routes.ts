import type { Config } from '../../config.js';
import type { Db } from '../../db/index.js';
import { events } from '../../events.js';
import { forbidden, notFound, validationFailed } from '../../errors.js';
import { defineRoute } from '../../http/route.js';
import { z } from '../../openapi/zod.js';
import { CATEGORIES, DropSchema, EXAMPLES, idParams, pageExample, pageSchema, paginationQuery } from '../../schemas.js';
import { findDropRow, isVisibleTo, listDrops, paginate, toDrop } from './repo.js';
import { dropSchemas } from './schemas.js';

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

const nowIso = () => new Date().toISOString();

function viewableDrop(db: Db, id: number, viewerId: number | null) {
  const row = findDropRow(db, id, viewerId);
  if (!row || !isVisibleTo(row, viewerId)) throw notFound('Drop introuvable.');
  return row;
}

export function dropWriteRoutes(config: Config) {
  const { createBody, patchBody } = dropSchemas(config);
  const radiusKm = String(config.zone.radiusM / 1000).replace('.', ',');
  return [
    defineRoute({
      method: 'post',
      path: '/drops',
      tags: ['Drops'],
      summary: 'Créer un drop',
      description:
        `Dépose un drop à la position \`lat\`/\`lng\`. Les coordonnées doivent être des nombres (pas des chaînes). Une \`photo\` exige \`imageUrl\`.\n\n` +
        `**Pourquoi une zone ?** Le point doit se trouver à ${radiusKm} km au plus du département MMI. C'est un choix éthique : cela empêche de déposer un drop près de son domicile, ce qui révélerait où l'on habite. Toutes les erreurs de coordonnées (type, bornes, zone) sont rangées sous la clé \`location\`.`,
      access: 'auth',
      body: createBody,
      responses: {
        201: {
          description: 'Drop créé.',
          schema: DropSchema,
          example: { ...EXAMPLES.drop, isMine: true },
          headers: { Location: 'Chemin du drop créé, par exemple `/drops/42`.' },
        },
      },
      handler: ({ body, db, user }) => {
        const now = nowIso();
        const info = db
          .prepare(
            `INSERT INTO drops (author_id, title, content, category, image_url, lat, lng, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(user!.id, body.title, body.content, body.category, body.imageUrl ?? null, body.lat, body.lng, now, now);
        const id = Number(info.lastInsertRowid);
        const drop = toDrop(findDropRow(db, id, user!.id)!, user!.id);
        events.emit('drop:created', drop);
        return { status: 201, headers: { Location: `/drops/${id}` }, body: drop };
      },
    }),
    defineRoute({
      method: 'patch',
      path: '/drops/{id}',
      tags: ['Drops'],
      summary: 'Modifier un drop',
      description:
        "Réservé à l'auteur. Au moins un champ parmi ceux de la création ; `lat` et `lng` vont ensemble. Les mêmes règles s'appliquent (zone, photo avec image).",
      access: 'auth',
      params: idParams,
      body: patchBody,
      errors: [403, 404],
      responses: { 200: { description: 'Drop modifié.', schema: DropSchema, example: { ...EXAMPLES.drop, isMine: true } } },
      guard: ({ params, db, user }) => {
        const row = viewableDrop(db, params.id, user!.id);
        if (row.author_id !== user!.id) throw forbidden("Seul l'auteur peut modifier ce drop.");
      },
      handler: ({ params, body, db, user }) => {
        const row = findDropRow(db, params.id, user!.id)!;
        const next = {
          title: body.title ?? row.title,
          content: body.content ?? row.content,
          category: body.category ?? row.category,
          imageUrl: body.imageUrl === undefined ? row.image_url : body.imageUrl,
          lat: body.lat ?? row.lat,
          lng: body.lng ?? row.lng,
        };
        if (next.category === 'photo' && !next.imageUrl) {
          throw validationFailed({ imageUrl: ['Une photo a besoin d’une image.'] });
        }
        db.prepare(
          `UPDATE drops SET title = ?, content = ?, category = ?, image_url = ?, lat = ?, lng = ?, updated_at = ?
           WHERE id = ?`,
        ).run(next.title, next.content, next.category, next.imageUrl, next.lat, next.lng, nowIso(), params.id);
        const drop = toDrop(findDropRow(db, params.id, user!.id)!, user!.id);
        events.emit('drop:updated', drop);
        return { body: drop };
      },
    }),
    defineRoute({
      method: 'delete',
      path: '/drops/{id}',
      tags: ['Drops'],
      summary: 'Supprimer un drop',
      description:
        "Réservé à l'auteur (token) ou à l'enseignant (`X-Admin-Key`). Supprime aussi les likes, commentaires, ouvertures et signalements du drop.",
      access: 'author_or_admin',
      params: idParams,
      errors: [403],
      responses: { 204: { description: 'Drop supprimé.' } },
      guard: ({ params, db, user, isAdmin }) => {
        const row = findDropRow(db, params.id, user?.id ?? null);
        if (!row) throw notFound('Drop introuvable.');
        if (isAdmin) return;
        if (!isVisibleTo(row, user!.id)) throw notFound('Drop introuvable.');
        if (row.author_id !== user!.id) throw forbidden("Seul l'auteur peut supprimer ce drop.");
      },
      handler: ({ params, db, user }) => {
        const drop = toDrop(findDropRow(db, params.id, user?.id ?? null)!, user?.id ?? null);
        db.prepare('DELETE FROM drops WHERE id = ?').run(params.id);
        events.emit('drop:deleted', drop);
        return { status: 204 };
      },
    }),
  ];
}

export { viewableDrop };
