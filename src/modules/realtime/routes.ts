import { defineRoute } from '../../http/route.js';
import { z } from '../../openapi/zod.js';

const TicketSchema = z
  .object({ ticket: z.string(), expiresAt: z.string(), url: z.string() })
  .openapi('RealtimeTicket');

export function realtimeRoutes() {
  return [
    defineRoute({
      method: 'post',
      path: '/realtime/ticket',
      tags: ['Temps réel'],
      block2: true,
      summary: 'Obtenir un ticket WebSocket',
      description:
        "Émet un ticket aléatoire, **à usage unique**, valable `WS_TICKET_TTL_SECONDS` (30 s par défaut), à passer dans l'URL du WebSocket : `wss://<domaine>/ws?ticket=wst_…`.\n\n" +
        "**Pourquoi un ticket ?** Le JWT ne doit jamais apparaître dans l'URL d'un WebSocket, qui finit souvent dans des journaux. Seule la route Next côté serveur demande le ticket avec le JWT ; le navigateur ne voit que le ticket.\n\n" +
        'Voir la description du tag « Temps réel » pour le protocole.',
      access: 'auth',
      rate: 'read',
      responses: {
        201: {
          description: 'Ticket émis.',
          schema: TicketSchema,
          example: {
            ticket: 'wst_Zk3m9v0Qe1m2n3o4p5q6r7s8t9u0v1w2',
            expiresAt: '2026-11-23T08:00:30.000Z',
            url: 'wss://drops-api.example.com/ws?ticket=wst_Zk3m9v0Qe1m2n3o4p5q6r7s8t9u0v1w2',
          },
        },
      },
      handler: ({ req, user, realtime }) => {
        const { ticket, expiresAt } = realtime.issueTicket({ id: user!.id, jti: user!.jti, exp: user!.exp });
        const scheme = req.protocol === 'https' ? 'wss' : 'ws';
        return { status: 201, body: { ticket, expiresAt, url: `${scheme}://${req.get('host')}/ws?ticket=${ticket}` } };
      },
    }),
  ];
}
