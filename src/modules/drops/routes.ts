import type { Config } from '../../config.js';
import { resolveGeo } from './geo-query.js';
import type { Db } from '../../db/index.js';
import { events } from '../../events.js';
import { createDrop } from '../../services.js';
import { forbidden, notFound, validationFailed } from '../../errors.js';
import { haversineMeters } from '../../geo.js';
import { defineRoute } from '../../http/route.js';
import { z } from '../../openapi/zod.js';
import { CATEGORIES, DropSchema, EXAMPLES, idParams, intQuery, pageExample, pageSchema, paginationQuery } from '../../schemas.js';
import { latField, lngField } from './schemas.js';
import { PublicUserSchema } from '../../schemas.js';
import { toPublicUser } from '../users/repo.js';
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
  author: z.string().trim().optional().openapi({ description: "Nom d'utilisateur de l'auteur.", example: 'mathis' }),
  sort: z
    .enum(['recent', 'popular'], { errorMap: () => ({ message: 'Doit valoir recent ou popular.' }) })
    .default('recent')
    .openapi({ description: '`popular` : likes décroissants, puis du plus récent au plus ancien.' }),
});

export const DropPageSchema = pageSchema(DropSchema, 'DropPage');

const radiusMessage = 'Doit être un entier entre 1 et 5000.';

const extendedListQuery = (bboxMaxPageSize: number) =>
  paginationQuery.extend({
    ...listQuery.shape,
    pageSize: intQuery(20, 1, Math.max(50, bboxMaxPageSize)).openapi({
      description: `Éléments par page (1 à 50, jusqu'à ${Math.max(50, bboxMaxPageSize)} avec \`bbox\`).`,
    }),
    sort: z
      .enum(['recent', 'popular', 'distance'], {
        errorMap: () => ({ message: 'Doit valoir recent, popular ou distance.' }),
      })
      .default('recent')
      .openapi({
        description:
          '`popular` : likes décroissants, puis du plus récent au plus ancien. `distance` : du plus proche au plus loin, **uniquement avec `near`** (c\'est alors le tri par défaut).',
      }),
    near: z
      .string()
      .optional()
      .openapi({
        description:
          '`lat,lng` : ne renvoie que les drops à `radius` mètres au plus, et ajoute `distanceM` à chacun. Exclusif avec `bbox`.',
        example: '47.4955,6.8053',
      }),
    radius: z.coerce
      .number({ invalid_type_error: radiusMessage })
      .int(radiusMessage)
      .min(1, radiusMessage)
      .max(5000, radiusMessage)
      .optional()
      .openapi({ description: 'Rayon en mètres, de 1 à 5000 (1000 par défaut). Exige `near`.', example: 500 }),
    bbox: z
      .string()
      .optional()
      .openapi({
        description:
          '`minLng,minLat,maxLng,maxLat`. **Ordre GeoJSON : la longitude d\'abord**, piège classique avec Leaflet qui utilise `[lat, lng]`. Exclusif avec `near`.',
        example: '6.79,47.48,6.82,47.51',
      }),
  });

export function dropReadRoutes(config: Config) {
  return [
    defineRoute({
      method: 'get',
      path: '/drops',
      tags: ['Drops'],
      summary: 'Lister les drops',
      description:
        "Liste paginée des drops, du plus récent au plus ancien par défaut. Les drops masqués sont exclus. Token requis : il alimente `likedByMe` et `isMine`.",
      access: 'auth',
      query: extendedListQuery(config.bboxMaxPageSize) as z.ZodTypeAny,
      refineQuery: (query, { req, config: cfg }) => {
        const resolved = resolveGeo(
          {
            near: query.near,
            radius: query.radius,
            bbox: query.bbox,
            sortGiven: req.query.sort !== undefined,
            sort: query.sort,
            pageSize: query.pageSize,
          },
          cfg.bboxMaxPageSize,
        );
        return { ...query, sort: resolved.sort, geoNear: resolved.near, geoBbox: resolved.bbox };
      },
      responses: {
        200: { description: 'Page de drops.', schema: DropPageSchema, example: pageExample(EXAMPLES.drop) },
      },
      handler: ({ query, db, user }) => {
        const viewerId = user?.id ?? null;
        const { rows, total, distances } = listDrops(
          db,
          {
            ...query,
            q: query.q || undefined,
            author: query.author || undefined,
            near: query.geoNear,
            bbox: query.geoBbox,
          },
          viewerId,
        );
        const items = rows.map((r, i) => ({
          ...toDrop(r, viewerId),
          ...(distances ? { distanceM: distances[i] } : {}),
        }));
        return { body: paginate(items, total, query.page, query.pageSize) };
      },
    }),
    defineRoute({
      method: 'get',
      path: '/drops/{id}',
      tags: ['Drops'],
      summary: "Détail d'un drop",
      description:
        "404 si le drop n'existe pas, ou s'il est masqué et que l'appelant n'en est pas l'auteur. L'auteur voit son drop masqué avec `hidden: true`.",
      access: 'auth',
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

export function dropWriteRoutes() {
  const { createBody, patchBody } = dropSchemas();
  return [
    defineRoute({
      method: 'post',
      path: '/drops',
      tags: ['Drops'],
      summary: 'Créer un drop',
      description:
        `Dépose un drop à la position \`lat\`/\`lng\`. Les coordonnées doivent être des nombres (pas des chaînes). Une \`photo\` exige \`imageUrl\`.\n\n` +
        'Aucune restriction de zone : le point peut se trouver n\'importe où. Toutes les erreurs de coordonnées (type, bornes) sont rangées sous la clé `location`.',
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
        const drop = createDrop(db, user!.id, body);
        return { status: 201, headers: { Location: `/drops/${drop.id}` }, body: drop };
      },
    }),
    defineRoute({
      method: 'patch',
      path: '/drops/{id}',
      tags: ['Drops'],
      summary: 'Modifier un drop',
      description:
        "Réservé à l'auteur. Au moins un champ parmi ceux de la création ; `lat` et `lng` vont ensemble. Les mêmes règles s'appliquent (photo avec image).",
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
        events.emit('drop:updated', drop, db);
        return { body: drop };
      },
    }),
    defineRoute({
      method: 'delete',
      path: '/drops/{id}',
      tags: ['Drops'],
      summary: 'Supprimer un drop',
      description:
        "Réservé à l'auteur (token) ou à l'enseignant (`X-Admin-Key`). Supprime aussi les likes, dislikes, commentaires et signalements du drop.",
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
        events.emit('drop:deleted', drop, db);
        return { status: 204 };
      },
    }),
  ];
}

export { viewableDrop };
