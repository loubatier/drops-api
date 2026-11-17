import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from './zod.js';
import { ERROR_DEFS, SIMULABLE_STATUSES } from '../errors.js';
import { type AnyRoute, type DocFlags, isDocumented, queryOf, rateClassOf } from '../http/route.js';
import { VERSION } from '../version.js';
import { applyBlock2Additions } from './block2.js';
import { BLOCK2_INTRO, BLOCK2_TAGS, INTRO, TAGS } from './intro.js';

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      status: z.number().int(),
      code: z.string(),
      message: z.string(),
      fields: z.record(z.array(z.string())),
      requestId: z.string(),
      simulated: z.boolean(),
    }),
  })
  .openapi('ErrorResponse');

const ERROR_EXAMPLE_FIELDS: Record<number, Record<string, string[]>> = {
  409: { username: ['Ce nom d\'utilisateur est déjà pris.'] },
  422: { title: ['Le titre doit faire au moins 3 caractères.'] },
};

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'JSON illisible (`bad_request`).',
  401: 'Token absent, invalide, expiré ou révoqué (`unauthorized`, `invalid_token`, `token_expired`, `token_revoked`, `invalid_credentials`).',
  403: 'Authentifié mais non autorisé (`forbidden`).',
  404: 'Ressource ou route inexistante (`not_found`).',
  409: 'Conflit : valeur déjà prise (`conflict`).',
  422: 'Corps ou paramètres invalides (`validation_failed`), détail dans `fields`.',
  429: 'Trop de requêtes (`rate_limited`), voir `Retry-After`.',
  500: 'Erreur inattendue (`internal_error`).',
  503: 'Base indisponible (`service_unavailable`).',
};

export function errorExample(status: number, codeOverride?: string) {
  const def = ERROR_DEFS[status]!;
  return {
    error: {
      status,
      code: codeOverride ?? def.code,
      message: def.message,
      fields: ERROR_EXAMPLE_FIELDS[status] ?? {},
      requestId: 'req_8f2c1a3b',
      simulated: false,
    },
  };
}

export function errorStatusesOf(spec: AnyRoute): number[] {
  const s = new Set<number>(spec.errors ?? []);
  if (spec.body) {
    s.add(400);
    s.add(422);
  }
  if (spec.query) s.add(422);
  if (spec.params) s.add(404);
  if (spec.access === 'auth' || spec.access === 'optional' || spec.access === 'author_or_admin') s.add(401);
  if (spec.access === 'admin' || spec.access === 'author_or_admin') s.add(403);
  if (rateClassOf(spec) !== 'none') s.add(429);
  s.add(500);
  return [...s].filter((c) => !(c in spec.responses)).sort((a, b) => a - b);
}

const simulationQuery = z.object({
  delay: z
    .string()
    .optional()
    .openapi({ description: 'Attend ce nombre de millisecondes (0 à 10000) avant de traiter la requête.', example: '1500' }),
  fail: z
    .enum(SIMULABLE_STATUSES.map(String) as [string, ...string[]])
    .optional()
    .openapi({ description: 'Ne traite pas la requête et renvoie cette erreur simulée.', example: '500' }),
});

export function buildDocument(allRoutes: AnyRoute[], flags: DocFlags = { block2: false }) {
  const routes = allRoutes.filter((r) => isDocumented(r, flags));
  const registry = new OpenAPIRegistry();
  registry.register('ErrorResponse', ErrorResponseSchema);
  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'Token obtenu via `/auth/login` ou `/auth/register`.',
  });
  registry.registerComponent('securitySchemes', 'adminKey', {
    type: 'apiKey',
    in: 'header',
    name: 'X-Admin-Key',
    description: "Clé de l'enseignant.",
  });

  for (const spec of routes) {
    const responses: Record<string, any> = {};
    for (const [status, r] of Object.entries(spec.responses)) {
      const entry: Record<string, any> = { description: r.description };
      if (r.schema) {
        entry.content = {
          [r.contentType ?? 'application/json']: { schema: r.schema, example: r.example },
        };
      } else if (r.example !== undefined) {
        entry.content = { [r.contentType ?? 'text/plain']: { schema: z.string(), example: r.example } };
      }
      if (r.headers) {
        entry.headers = Object.fromEntries(
          Object.entries(r.headers).map(([name, description]) => [name, { description, schema: { type: 'string' } }]),
        );
      }
      responses[status] = entry;
    }
    for (const status of errorStatusesOf(spec)) {
      const headers: Record<string, any> = {};
      if (status === 401) headers['WWW-Authenticate'] = { description: 'Toujours `Bearer`.', schema: { type: 'string' } };
      if (status === 429) headers['Retry-After'] = { description: 'Secondes à attendre.', schema: { type: 'string' } };
      responses[String(status)] = {
        description: ERROR_DESCRIPTIONS[status],
        content: { 'application/json': { schema: ErrorResponseSchema, example: errorExample(status) } },
        ...(Object.keys(headers).length ? { headers } : {}),
      };
    }

    const specQuery = queryOf(spec, flags);
    const query = specQuery ? (specQuery as any).merge(simulationQuery) : simulationQuery;
    const security: Record<string, string[]>[] =
      spec.access === 'auth'
        ? [{ bearerAuth: [] }]
        : spec.access === 'optional'
          ? [{}, { bearerAuth: [] }]
          : spec.access === 'admin'
            ? [{ adminKey: [] }]
            : spec.access === 'author_or_admin'
              ? [{ bearerAuth: [] }, { adminKey: [] }]
              : [];

    registry.registerPath({
      method: spec.method,
      path: spec.path,
      tags: spec.tags,
      summary: spec.summary,
      description: spec.description,
      security,
      request: {
        ...(spec.params ? { params: spec.params } : {}),
        query,
        ...(spec.access === 'admin'
          ? {
              headers: z.object({
                'X-Admin-Key': z.string().openapi({ description: "Clé de l'enseignant.", example: 'cle-enseignant' }),
              }),
            }
          : spec.access === 'author_or_admin'
            ? {
                headers: z.object({
                  'X-Admin-Key': z
                    .string()
                    .optional()
                    .openapi({ description: "Clé de l'enseignant, à la place du token.", example: 'cle-enseignant' }),
                }),
              }
            : {}),
        ...(spec.body
          ? { body: { required: true, content: { 'application/json': { schema: spec.body } } } }
          : {}),
      },
      responses,
    });
  }

  const document = new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'Drops API', version: VERSION, description: flags.block2 ? INTRO + BLOCK2_INTRO : INTRO },
    tags: flags.block2 ? [...TAGS, ...BLOCK2_TAGS] : TAGS,
  });
  return flags.block2 ? applyBlock2Additions(document) : document;
}
