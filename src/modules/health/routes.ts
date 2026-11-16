import { z } from '../../openapi/zod.js';
import { defineRoute } from '../../http/route.js';
import { VERSION } from '../../version.js';
import type { Config } from '../../config.js';
import type { Db } from '../../db/index.js';
import { DOCS_HTML } from '../../openapi/docs.js';

const HealthSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    service: z.string(),
    version: z.string(),
    commit: z.string().nullable(),
    time: z.string(),
    uptimeSeconds: z.number().int(),
    db: z.enum(['ok', 'error']),
  })
  .openapi('Health');

const RootSchema = z
  .object({ name: z.string(), docs: z.string(), openapi: z.string(), contract: z.string(), health: z.string() })
  .openapi('Root');

const startedAt = Date.now();

function dbIsUp(db: Db): boolean {
  try {
    db.prepare('SELECT 1').get();
    return true;
  } catch {
    return false;
  }
}

export interface SystemDeps {
  config: Config;
  getDocument: () => object;
  getContract: () => string;
}

export function systemRoutes(deps: SystemDeps) {
  const healthExample = {
    status: 'ok',
    service: 'drops-api',
    version: VERSION,
    commit: 'abc1234',
    time: '2026-11-16T09:12:00.000Z',
    uptimeSeconds: 1234,
    db: 'ok',
  };
  return [
    defineRoute({
      method: 'get',
      path: '/',
      tags: ['Santé'],
      summary: "Point d'entrée",
      description: "Liens vers la documentation, la spécification, le contrat et la santé de l'API.",
      access: 'public',
      responses: {
        200: {
          description: "Liens de l'API.",
          schema: RootSchema,
          example: {
            name: 'Drops API',
            docs: '/docs',
            openapi: '/openapi.json',
            contract: '/contract.md',
            health: '/health',
          },
        },
      },
      handler: () => ({
        body: { name: 'Drops API', docs: '/docs', openapi: '/openapi.json', contract: '/contract.md', health: '/health' },
      }),
    }),
    defineRoute({
      method: 'get',
      path: '/health',
      tags: ['Santé'],
      summary: 'État du service',
      description:
        "Renvoie 200 si l'API et la base répondent, 503 avec `status: \"degraded\"` sinon. Sans limite de requêtes. Utilisable pour une page de statut.",
      access: 'public',
      rate: 'none',
      responses: {
        200: { description: 'Service en bonne santé.', schema: HealthSchema, example: healthExample },
        503: {
          description: 'Base indisponible.',
          schema: HealthSchema,
          example: { ...healthExample, status: 'degraded', db: 'error' },
        },
      },
      handler: ({ db, config }) => {
        const up = dbIsUp(db);
        return {
          status: up ? 200 : 503,
          body: {
            status: up ? 'ok' : 'degraded',
            service: 'drops-api',
            version: VERSION,
            commit: config.commit,
            time: new Date().toISOString(),
            uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
            db: up ? 'ok' : 'error',
          },
        };
      },
    }),
    defineRoute({
      method: 'get',
      path: '/docs',
      tags: ['Santé'],
      summary: 'Documentation interactive',
      description: 'Interface Swagger UI générée depuis `/openapi.json`.',
      access: 'public',
      rate: 'none',
      responses: {
        200: { description: 'Page HTML.', schema: z.string(), example: '<!doctype html>…', contentType: 'text/html' },
      },
      handler: () => ({ raw: DOCS_HTML, contentType: 'text/html; charset=utf-8' }),
    }),
    defineRoute({
      method: 'get',
      path: '/openapi.json',
      tags: ['Santé'],
      summary: 'Spécification OpenAPI 3.1',
      description: "Spécification OpenAPI complète, générée depuis le code de l'API.",
      access: 'public',
      rate: 'none',
      responses: {
        200: {
          description: 'Document OpenAPI.',
          schema: z.object({ openapi: z.string() }).passthrough(),
          example: { openapi: '3.1.0', info: { title: 'Drops API', version: VERSION } },
        },
      },
      handler: () => ({ body: deps.getDocument() }),
    }),
    defineRoute({
      method: 'get',
      path: '/contract.md',
      tags: ['Santé'],
      summary: 'Contrat en Markdown',
      description:
        'Résumé compact du contrat (types TypeScript, routes, erreurs, outils pédagogiques), à glisser dans un fichier d\'agent.',
      access: 'public',
      rate: 'none',
      responses: {
        200: {
          description: 'Texte Markdown.',
          schema: z.string(),
          example: '# Drops API : contrat v1.0.0',
          contentType: 'text/markdown',
        },
      },
      handler: () => ({ raw: deps.getContract(), contentType: 'text/markdown; charset=utf-8' }),
    }),
  ];
}
