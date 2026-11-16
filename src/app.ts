import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import swaggerUiDist from 'swagger-ui-dist';
import type { Config } from './config.js';
import { buildContract } from './contract.js';
import type { Db } from './db/index.js';
import { type AnyRoute, mountRoutes } from './http/route.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { requestLogger } from './middleware/logger.js';
import { requestId } from './middleware/requestId.js';
import { simulation } from './middleware/simulation.js';
import { systemRoutes } from './modules/health/routes.js';
import { buildDocument } from './openapi/registry.js';

export interface AppDeps {
  config: Config;
  db: Db;
}

export function createApp({ config, db }: AppDeps) {
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

  const routes: AnyRoute[] = [];
  let documentCache: object | null = null;
  let contractCache: string | null = null;
  routes.push(
    ...systemRoutes({
      config,
      getDocument: () => (documentCache ??= buildDocument(routes)),
      getContract: () => (contractCache ??= buildContract(routes)),
    }),
  );

  const router = express.Router();
  mountRoutes(router, routes, { config, db, pre: () => [] });
  app.use('/docs/assets', express.static(swaggerUiDist.getAbsoluteFSPath(), { index: false }));
  app.use(router);
  app.locals.apiRouter = router;
  app.locals.routes = routes;

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
