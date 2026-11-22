import type { Config } from '../../config.js';
import type { Db } from '../../db/index.js';
import { ApiError, forbidden, tooFar } from '../../errors.js';
import { events } from '../../events.js';
import { haversineMeters } from '../../geo.js';
import { defineRoute } from '../../http/route.js';
import { z } from '../../openapi/zod.js';
import { ErrorResponseSchema, errorExample } from '../../openapi/registry.js';
import { DropSchema, EXAMPLES, PublicUserSchema, idParams, pageSchema, paginationQuery } from '../../schemas.js';
import { toPublicUser } from '../users/repo.js';
import { findDropRow, paginate, toDrop } from './repo.js';
import { latField, lngField } from './schemas.js';
import { viewableDrop } from './routes.js';

const openBody = z
  .object({
    lat: latField,
    lng: lngField,
    accuracy: z
      .number()
      .min(0, 'Doit être compris entre 0 et 10000.')
      .max(10_000, 'Doit être compris entre 0 et 10000.')
      .optional()
      .openapi({ description: '`coords.accuracy` de l’API Geolocation, en mètres (0 par défaut).', example: 12 }),
  })
  .strict();

const OpenPageSchema = pageSchema(
  z.object({ user: PublicUserSchema, openedAt: z.string() }),
  'OpenPage',
);

export interface OpenResult {
  drop: ReturnType<typeof toDrop>;
  firstOpen: boolean;
}

export function checkOpenDistance(config: Config, row: { lat: number; lng: number }, lat: number, lng: number, accuracy: number) {
  const distance = haversineMeters(lat, lng, row.lat, row.lng);
  const allowed = config.openRadiusM + Math.min(accuracy, config.openAccuracyCapM);
  return { distance, allowed, ok: distance <= allowed };
}

export function recordOpen(db: Db, dropId: number, userId: number): { firstOpen: boolean; opensCount: number } {
  const info = db
    .prepare('INSERT OR IGNORE INTO opens (drop_id, user_id, opened_at) VALUES (?, ?, ?)')
    .run(dropId, userId, new Date().toISOString());
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM opens WHERE drop_id = ?').get(dropId) as { n: number };
  const firstOpen = info.changes > 0;
  if (firstOpen) events.emit('drop:opened', { dropId, userId, opensCount: n }, db);
  return { firstOpen, opensCount: n };
}

const tooFarExample = {
  error: {
    ...errorExample(403, 'too_far').error,
    message: 'Vous êtes à 230 m de ce drop. Approchez-vous à moins de 50 m.',
    meta: { distanceM: 230, requiredM: 50 },
  },
};

export function dropGeoRoutes() {
  return [
    defineRoute({
      method: 'post',
      path: '/drops/{id}/open',
      tags: ['Géolocalisation'],
      summary: 'Ouvrir un drop',
      description:
        "Déverrouille un drop pour l'appelant s'il se trouve assez près. **Règle** : la distance entre la position envoyée et la position **exacte** du drop doit être au plus de `OPEN_RADIUS_M` (50 m) + `min(accuracy, OPEN_ACCURACY_CAP_M)` (50 m au plus de tolérance).\n\n" +
        "Première ouverture : enregistrée, et le WebSocket émet `drop:opened` et la notification `drop_opened` à l'auteur. Rouvrir renvoie 200 sans nouvel événement. L'auteur qui ouvre son propre drop reçoit 200 sans enregistrement.\n\n" +
        "**La position envoyée n'est ni stockée, ni journalisée, ni diffusée** : on ne garde que le fait d'avoir ouvert. Les erreurs de coordonnées sont rangées sous la clé `location`.\n\n" +
        "Fonctionne aussi quand `lockMode` vaut `off`, pour construire le parcours d'ouverture avant l'activation du verrouillage.\n\n" +
        '**Rappel pédagogique** : la position est déclarée par le client et se simule en un clic dans les DevTools. La vérification serveur garantit que la règle est appliquée, pas que la position est vraie.',
      access: 'auth',
      rate: 'open',
      params: idParams,
      body: openBody,
      errors: [404],
      responses: {
        200: { description: 'Drop déverrouillé pour cet utilisateur.', schema: DropSchema, example: { ...EXAMPLES.drop, openedByMe: true, opensCount: 1 } },
        403: { description: 'Trop loin du drop (`too_far`, avec `meta.distanceM` arrondi à la dizaine et `meta.requiredM`).', schema: ErrorResponseSchema, example: tooFarExample },
      },
      guard: ({ params, db, user }) => {
        viewableDrop(db, params.id, user!.id);
      },
      handler: ({ params, body, db, user, config, settings }) => {
        const row = findDropRow(db, params.id, user!.id)!;
        if (row.author_id !== user!.id) {
          const { distance, ok } = checkOpenDistance(config, row, body.lat, body.lng, body.accuracy ?? 0);
          if (!ok) {
            const rounded = Math.round(distance / 10) * 10;
            throw tooFar(`Vous êtes à ${rounded} m de ce drop. Approchez-vous à moins de ${config.openRadiusM} m.`, {
              distanceM: rounded,
              requiredM: config.openRadiusM,
            });
          }
          recordOpen(db, params.id, user!.id);
        }
        return { body: toDrop(findDropRow(db, params.id, user!.id)!, user!.id, settings.lockMode()) };
      },
    }),
    defineRoute({
      method: 'get',
      path: '/drops/{id}/opens',
      tags: ['Géolocalisation'],
      summary: 'Qui a ouvert ce drop ?',
      description: "Réservé à l'auteur du drop : liste paginée de ceux qui l'ont ouvert, du plus récent au plus ancien. C'est le statut « ouvert par… ».",
      access: 'auth',
      params: idParams,
      query: paginationQuery,
      errors: [403, 404],
      responses: {
        200: {
          description: 'Page d’ouvertures.',
          schema: OpenPageSchema,
          example: { items: [{ user: EXAMPLES.publicUser, openedAt: '2026-11-24T09:30:00.000Z' }], page: 1, pageSize: 20, total: 1, totalPages: 1 },
        },
      },
      guard: ({ params, db, user }) => {
        const row = viewableDrop(db, params.id, user!.id);
        if (row.author_id !== user!.id) throw forbidden("Seul l'auteur peut voir qui a ouvert ce drop.");
      },
      handler: ({ params, query, db }) => {
        const { n } = db.prepare('SELECT COUNT(*) AS n FROM opens WHERE drop_id = ?').get(params.id) as { n: number };
        const rows = db
          .prepare(
            `SELECT o.opened_at, u.id, u.username, u.display_name, u.avatar_url
             FROM opens o JOIN users u ON u.id = o.user_id
             WHERE o.drop_id = ? ORDER BY o.opened_at DESC, u.id DESC LIMIT ? OFFSET ?`,
          )
          .all(params.id, query.pageSize, (query.page - 1) * query.pageSize) as any[];
        return {
          body: paginate(
            rows.map((r) => ({ user: toPublicUser(r), openedAt: r.opened_at as string })),
            n,
            query.page,
            query.pageSize,
          ),
        };
      },
    }),
  ];
}

