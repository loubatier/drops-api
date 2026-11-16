import compression from 'compression';
import cors from 'cors';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import helmet from 'helmet';
import swaggerUiDist from 'swagger-ui-dist';
import type { Config } from './config.js';
import { buildContract } from './contract.js';
import { type RealtimeOptions, createRealtime } from './realtime/hub.js';
import { createSettings } from './settings.js';
import { createSimulator } from './simulator.js';
import { realtimeRoutes } from './modules/realtime/routes.js';
import { ApiError } from './errors.js';
import type { Db } from './db/index.js';
import { type AnyRoute, type DocFlags, mountRoutes, rateClassOf } from './http/route.js';
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
import { dropGeoRoutes } from './modules/drops/open.js';
import { dropReadRoutes, dropWriteRoutes } from './modules/drops/routes.js';
import { likeRoutes } from './modules/likes/routes.js';
import { reportRoutes } from './modules/reports/routes.js';
import { systemRoutes } from './modules/health/routes.js';
import { userRoutes } from './modules/users/routes.js';
import { buildDocument } from './openapi/registry.js';

export interface AppDeps {
  config: Config;
  db: Db;
  options?: { realtime?: RealtimeOptions };
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

  const settings = createSettings(db, config);
  const realtime = createRealtime(config, db, settings, options.realtime);
  const simulator = createSimulator(config, db, settings);
  const flags = (): DocFlags => ({ block2: settings.block2Enabled() });

  const routes: AnyRoute[] = [];
  let documentCache: object | null = null;
  let contractCache: string | null = null;
  settings.onChange(() => {
    documentCache = null;
    contractCache = null;
  });
  routes.push(
    ...systemRoutes({
      config,
      getDocument: () => (documentCache ??= buildDocument(routes, flags())),
      getContract: () => (contractCache ??= buildContract(routes, flags())),
    }),
  );

  routes.push(
    ...authRoutes(config),
    ...userRoutes(),
    ...dropReadRoutes(config),
    ...dropWriteRoutes(config),
    ...likeRoutes(),
    ...commentReadRoutes(),
    ...commentWriteRoutes(),
    ...reportRoutes(),
    ...adminRoutes({ simulator }),
    ...realtimeRoutes(),
    ...dropGeoRoutes(),
    ...datasetRoutes(),
  );

  const limiters = createRateLimiters(config);
  const pre = (spec: AnyRoute): RequestHandler[] => {
    const chain: RequestHandler[] = [];
    if (spec.block2) {
      chain.push((_req, _res, next) => (settings.block2Enabled() ? next() : next(ApiError.of(404))));
    }
    if (spec.access === 'admin') chain.push(requireAdmin(config));
    if (spec.access === 'auth') chain.push(requireAuth);
    if (spec.access === 'author_or_admin') chain.push(authorOrAdmin(config));
    const rate = rateClassOf(spec);
    if (rate !== 'none') chain.push(limiters[rate]);
    return chain;
  };

  app.use('/dataset/points', compression());
  const deps = { config, db, settings, realtime, pre };
  const router = express.Router();
  mountRoutes(router, routes.filter((r) => !r.block2 && !r.documentedOnlyWithBlock2), deps);
  const alwaysRouter = express.Router();
  mountRoutes(alwaysRouter, routes.filter((r) => r.documentedOnlyWithBlock2), deps);
  const block2Router = express.Router();
  mountRoutes(block2Router, routes.filter((r) => r.block2), deps);
  app.use('/docs/assets', express.static(swaggerUiDist.getAbsoluteFSPath(), { index: false }));
  app.use(router);
  app.use(alwaysRouter);
  app.use((req, res, next) => (settings.block2Enabled() ? block2Router(req, res, next) : next()));
  app.locals.apiRouter = router;
  app.locals.block2Routers = [alwaysRouter, block2Router];
  app.locals.routes = routes;
  app.locals.realtime = realtime;
  app.locals.settings = settings;
  app.locals.simulator = simulator;

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
