import compression from 'compression';
import cors from 'cors';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import helmet from 'helmet';
import swaggerUiDist from 'swagger-ui-dist';
import type { Config } from './config.js';
import { buildContract } from './contract.js';
import { type RealtimeOptions, createRealtime } from './realtime/hub.js';
import { type SimulatorOptions, createSimulator } from './simulator.js';
import { realtimeRoutes } from './modules/realtime/routes.js';
import type { Db } from './db/index.js';
import { type AnyRoute, mountRoutes, rateClassOf } from './http/route.js';
import { authorOrAdmin, identify, requireAdmin, requireAuth } from './middleware/auth.js';
import { createRateLimiters } from './middleware/rateLimit.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { requestLogger } from './middleware/logger.js';
import { requestId } from './middleware/requestId.js';
import { simulation } from './middleware/simulation.js';
import { authRoutes } from './modules/auth/routes.js';
import { adminRoutes } from './modules/admin/routes.js';
import { commentReadRoutes, commentWriteRoutes } from './modules/comments/routes.js';
import { datasetRoutes } from './modules/dataset/routes.js';
import { dropReadRoutes, dropWriteRoutes } from './modules/drops/routes.js';
import { likeRoutes } from './modules/likes/routes.js';
import { reportRoutes } from './modules/reports/routes.js';
import { systemRoutes } from './modules/health/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { buildDocument } from './openapi/registry.js';
import { buildWsDocs } from './openapi/ws-docs.js';
import { WS_DOCS_CSP, buildWsDocsHtml } from './openapi/ws-docs-html.js';
import { PLAYGROUND_CSP, PLAYGROUND_HTML, PLAYGROUND_JS } from './playground/page.js';

export interface AppDeps {
  config: Config;
  db: Db;
  options?: { realtime?: RealtimeOptions; simulator?: SimulatorOptions };
}

export function createApp({ config, db, options = {} }: AppDeps) {
  const app = express();
  app.set('trust proxy', 1);
  app.set('etag', false);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(requestLogger(config));
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: '*',
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Admin-Key'],
      exposedHeaders: [
        'X-Request-Id',
        'X-Simulated',
        'Retry-After',
        'Location',
        'RateLimit-Limit',
        'RateLimit-Remaining',
        'RateLimit-Reset',
        'RateLimit-Policy',
      ],
      credentials: false,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(simulation(config));
  app.use(identify(config, db));

  const realtime = createRealtime(config, db, options.realtime);
  const simulator = createSimulator(config, db, { presence: realtime.simulated, ...options.simulator });

  const routes: AnyRoute[] = [];
  let documentCache: object | null = null;
  let contractCache: string | null = null;
  let wsDocsHtmlCache: string | null = null;
  let wsDocsMdCache: string | null = null;
  routes.push(
    ...systemRoutes({
      config,
      getDocument: () => (documentCache ??= buildDocument(routes)),
      getContract: () => (contractCache ??= buildContract(routes)),
    }),
  );

  routes.push(
    ...authRoutes(config),
    ...userRoutes(),
    ...dropReadRoutes(config),
    ...dropWriteRoutes(),
    ...likeRoutes(),
    ...commentReadRoutes(),
    ...commentWriteRoutes(),
    ...reportRoutes(),
    ...adminRoutes({ simulator }),
    ...realtimeRoutes(),
    ...datasetRoutes(),
  );

  const limiters = createRateLimiters(config);
  const pre = (spec: AnyRoute): RequestHandler[] => {
    const chain: RequestHandler[] = [];
    if (spec.access === 'admin') chain.push(requireAdmin(config));
    if (spec.access === 'auth') chain.push(requireAuth);
    if (spec.access === 'author_or_admin') chain.push(authorOrAdmin(config));
    const rate = rateClassOf(spec);
    if (rate !== 'none') chain.push(limiters[rate]);
    return chain;
  };

  app.use('/dataset/points', compression());
  const deps = { config, db, realtime, pre };
  const router = express.Router();
  mountRoutes(router, routes, deps);
  app.use('/docs/assets', express.static(swaggerUiDist.getAbsoluteFSPath(), { index: false }));
  app.use(router);
  const playground = (body: string, type: string): RequestHandler => (_req, res) => {
    res.setHeader('Content-Security-Policy', PLAYGROUND_CSP);
    res.type(type).send(body);
  };
  app.get('/ws-playground', playground(PLAYGROUND_HTML, 'text/html; charset=utf-8'));
  app.get('/ws-playground.js', playground(PLAYGROUND_JS, 'application/javascript; charset=utf-8'));
  app.get('/ws-docs', (_req, res) => {
    res.setHeader('Content-Security-Policy', WS_DOCS_CSP);
    res.type('text/html; charset=utf-8').send((wsDocsHtmlCache ??= buildWsDocsHtml()));
  });
  app.get('/ws-docs.md', (_req, res) => {
    res.type('text/plain; charset=utf-8').send((wsDocsMdCache ??= buildWsDocs()));
  });
  app.locals.apiRouter = router;
  app.locals.routes = routes;
  app.locals.realtime = realtime;
  app.locals.simulator = simulator;

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
