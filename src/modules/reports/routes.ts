import { events } from '../../events.js';
import { forbidden } from '../../errors.js';
import { defineRoute } from '../../http/route.js';
import { z } from '../../openapi/zod.js';
import { REPORT_REASONS, idParams } from '../../schemas.js';
import { findDropRow, toDrop } from '../drops/repo.js';
import { viewableDrop } from '../drops/routes.js';

const reportBody = z
  .object({
    reason: z.enum(REPORT_REASONS, { errorMap: () => ({ message: `Motif inconnu (${REPORT_REASONS.join(', ')}).` }) }),
    details: z.string().trim().max(300, 'Au plus 300 caractères.').optional(),
  })
  .strict();

export function reportRoutes() {
  return [
    defineRoute({
      method: 'post',
      path: '/drops/{id}/report',
      tags: ['Signalement'],
      summary: 'Signaler un drop',
      description:
        "Idempotent par utilisateur. Quand le nombre de signalements distincts atteint `REPORT_HIDE_THRESHOLD`, le drop est masqué (404 pour tous sauf son auteur). On ne peut pas signaler son propre drop.",
      access: 'auth',
      params: idParams,
      body: reportBody,
      errors: [403],
      responses: {
        202: { description: 'Signalement enregistré.', schema: z.object({ reported: z.literal(true) }), example: { reported: true } },
      },
      guard: ({ params, db, user }) => {
        const row = viewableDrop(db, params.id, user!.id);
        if (row.author_id === user!.id) throw forbidden('Vous ne pouvez pas signaler votre propre drop.');
      },
      handler: ({ params, body, db, user, config }) => {
        const report = db.transaction(() => {
          db.prepare(
            'INSERT OR IGNORE INTO reports (drop_id, user_id, reason, details, created_at) VALUES (?, ?, ?, ?, ?)',
          ).run(params.id, user!.id, body.reason, body.details ?? null, new Date().toISOString());
          const { n } = db.prepare('SELECT COUNT(*) AS n FROM reports WHERE drop_id = ?').get(params.id) as { n: number };
          if (n >= config.reportHideThreshold) {
            return db.prepare('UPDATE drops SET hidden = 1 WHERE id = ? AND hidden = 0').run(params.id).changes > 0;
          }
          return false;
        })();
        if (report) events.emit('drop:updated', toDrop(findDropRow(db, params.id, null)!, null), db);
        return { status: 202, body: { reported: true } };
      },
    }),
  ];
}
