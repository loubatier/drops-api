import { type ResetMode, resetDatabase } from '../../db/seed.js';
import { events } from '../../events.js';
import type { SimulatorControl } from '../../simulator.js';
import { notFound } from '../../errors.js';
import { defineRoute } from '../../http/route.js';
import { z } from '../../openapi/zod.js';
import { DropSchema, EXAMPLES, PublicUserSchema, idParams } from '../../schemas.js';
import { ApiError } from '../../errors.js';
import { type DropRow, findDropRow, toDrop } from '../drops/repo.js';
import { toPublicUser } from '../users/repo.js';

const resetBody = z
  .object({
    confirm: z.literal('RESET', { errorMap: () => ({ message: 'Doit valoir "RESET".' }) }),
    mode: z.enum(['all', 'keep-users'], { errorMap: () => ({ message: 'Doit valoir "all" ou "keep-users".' }) }),
  })
  .strict();

const ResetResultSchema = z
  .object({ users: z.number().int(), drops: z.number().int(), comments: z.number().int(), likes: z.number().int() })
  .openapi('ResetResult');

const ReportedDropSchema = z
  .object({
    drop: DropSchema,
    reports: z.array(
      z.object({
        id: z.number().int(),
        reason: z.string(),
        details: z.string().nullable(),
        createdAt: z.string(),
        user: PublicUserSchema,
      }),
    ),
  })
  .openapi('ReportedDrop');

const simulatorBody = z
  .object({
    enabled: z.boolean(),
    intervalSeconds: z.number().int().min(1, 'Entre 1 et 3600.').max(3600, 'Entre 1 et 3600.').optional(),
    presence: z.boolean().optional(),
  })
  .strict();

const adminDrop = (row: DropRow) => ({ ...toDrop(row, null), hidden: row.hidden === 1 });

const SimulatorStateSchema = z.object({
  enabled: z.boolean(),
  intervalSeconds: z.number().int(),
  presence: z.boolean(),
});

const RealtimeStatsSchema = z
  .object({
    connections: z.number().int(),
    byUser: z.array(z.object({ user: PublicUserSchema, connections: z.number().int() })),
    viewers: z.array(z.object({ dropId: z.number().int(), count: z.number().int() })),
    simulated: z.object({
      online: z.array(PublicUserSchema),
      viewing: z.array(z.object({ user: PublicUserSchema, dropId: z.number().int() })),
    }),
  })
  .openapi('AdminRealtime');

export function adminRoutes({ simulator }: { simulator: SimulatorControl }) {
  return [
    defineRoute({
      method: 'post',
      path: '/admin/reset',
      tags: ['Admin (enseignant)'],
      summary: 'Réinitialiser la base',
      description:
        "`all` vide la base (comptes compris) et recharge les données d'exemple. `keep-users` garde les comptes créés par les élèves, supprime leurs drops, likes, commentaires et signalements, puis recharge les données d'exemple. Les tokens des comptes supprimés deviennent invalides.",
      access: 'admin',
      rate: 'none',
      body: resetBody,
      responses: {
        200: {
          description: 'Base réinitialisée, effectifs après rechargement.',
          schema: ResetResultSchema,
          example: { users: 13, drops: 60, comments: 85, likes: 210 },
        },
      },
      handler: ({ body, db }) => ({ body: resetDatabase(db, body.mode as ResetMode) }),
    }),
    defineRoute({
      method: 'get',
      path: '/admin/reports',
      tags: ['Admin (enseignant)'],
      summary: 'Drops signalés',
      description:
        'Liste des drops ayant au moins un signalement, le plus récemment signalé en premier, avec chaque signalement. `hidden` indique si le drop est masqué.',
      access: 'admin',
      rate: 'none',
      responses: {
        200: {
          description: 'Drops signalés.',
          schema: z.array(ReportedDropSchema),
          example: [
            {
              drop: { ...EXAMPLES.drop, hidden: true },
              reports: [
                {
                  id: 1,
                  reason: 'spam',
                  details: null,
                  createdAt: '2026-11-16T11:00:00.000Z',
                  user: EXAMPLES.publicUser,
                },
              ],
            },
          ],
        },
      },
      handler: ({ db }) => {
        const dropIds = db
          .prepare('SELECT drop_id FROM reports GROUP BY drop_id ORDER BY MAX(created_at) DESC, MAX(id) DESC')
          .all() as { drop_id: number }[];
        const reportsOf = db.prepare(
          `SELECT r.id, r.reason, r.details, r.created_at, u.id AS user_id, u.username, u.display_name, u.avatar_url
           FROM reports r JOIN users u ON u.id = r.user_id WHERE r.drop_id = ? ORDER BY r.created_at, r.id`,
        );
        return {
          body: dropIds.map(({ drop_id }) => ({
            drop: adminDrop(findDropRow(db, drop_id, null)!),
            reports: (reportsOf.all(drop_id) as any[]).map((r) => ({
              id: r.id,
              reason: r.reason,
              details: r.details,
              createdAt: r.created_at,
              user: toPublicUser({ id: r.user_id, username: r.username, display_name: r.display_name, avatar_url: r.avatar_url }),
            })),
          })),
        };
      },
    }),
    defineRoute({
      method: 'post',
      path: '/admin/drops/{id}/unhide',
      tags: ['Admin (enseignant)'],
      summary: 'Réactiver un drop masqué',
      description: 'Remet le drop en ligne et remet ses signalements à zéro.',
      access: 'admin',
      rate: 'none',
      params: idParams,
      responses: { 200: { description: 'Drop réactivé.', schema: DropSchema, example: EXAMPLES.drop } },
      guard: ({ params, db }) => {
        if (!findDropRow(db, params.id, null)) throw notFound('Drop introuvable.');
      },
      handler: ({ params, db }) => {
        db.transaction(() => {
          db.prepare('UPDATE drops SET hidden = 0 WHERE id = ?').run(params.id);
          db.prepare('DELETE FROM reports WHERE drop_id = ?').run(params.id);
        })();
        const drop = toDrop(findDropRow(db, params.id, null)!, null);
        events.emit('drop:updated', drop, db);
        return { body: drop };
      },
    }),
    defineRoute({
      method: 'get',
      path: '/admin/realtime',
      tags: ['Admin (enseignant)'],
      summary: 'Connexions temps réel',
      description:
        "Nombre de connexions WebSocket, connexions par utilisateur (trié par nombre décroissant : une application qui ouvre une socket à chaque rendu se repère ici) et lecteurs par drop. Le champ `simulated` liste, sans les mélanger aux vraies connexions, les utilisateurs simulés en ligne et les drops qu'ils regardent.",
      access: 'admin',
      rate: 'none',
      responses: {
        200: {
          description: 'État du temps réel.',
          schema: RealtimeStatsSchema,
          example: {
            connections: 23,
            byUser: [{ user: EXAMPLES.publicUser, connections: 4 }],
            viewers: [{ dropId: 42, count: 2 }],
            simulated: { online: [EXAMPLES.publicUser], viewing: [{ user: EXAMPLES.publicUser, dropId: 42 }] },
          },
        },
      },
      handler: ({ realtime }) => ({ body: realtime.stats() }),
    }),
    defineRoute({
      method: 'post',
      path: '/admin/realtime/disconnect-all',
      tags: ['Admin (enseignant)'],
      summary: 'Déconnecter tout le monde',
      description:
        "Ferme toutes les connexions WebSocket avec le code 4011 (`admin_disconnect`), pour tester la reconnexion des applications.",
      access: 'admin',
      rate: 'none',
      responses: {
        200: {
          description: 'Nombre de connexions fermées.',
          schema: z.object({ disconnected: z.number().int() }),
          example: { disconnected: 23 },
        },
      },
      handler: ({ realtime }) => ({ body: { disconnected: realtime.disconnectAll() } }),
    }),
    defineRoute({
      method: 'post',
      path: '/admin/simulator',
      tags: ['Admin (enseignant)'],
      summary: 'Démarrer ou arrêter le simulateur',
      description:
        "Le simulateur agit au nom d'utilisateurs d'exemple (likes, commentaires, ouvertures, créations de drops) pour qu'un élève qui travaille seul voie des événements en direct. Tout ce qu'il crée disparaît avec `POST /admin/reset`.\n\n`presence` (vrai par défaut) fait aussi apparaître 3 utilisateurs d'exemple en ligne et venir regarder des drops, dont, une fois sur deux, un drop regardé par un vrai utilisateur. Arrêter le simulateur, ou passer `presence` à `false`, les fait tous partir.",
      access: 'admin',
      rate: 'none',
      body: simulatorBody,
      responses: {
        200: {
          description: 'État du simulateur.',
          schema: SimulatorStateSchema,
          example: { enabled: true, intervalSeconds: 20, presence: true },
        },
      },
      handler: ({ body }) => {
        simulator.configure(body.enabled, body.intervalSeconds, body.presence);
        return { body: simulator.state() };
      },
    }),
  ];
}
