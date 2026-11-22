import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import type { ZodTypeAny, z } from 'zod';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { notFound } from '../errors.js';
import type { Realtime } from '../realtime/hub.js';
import type { Settings } from '../settings.js';
import { validate } from '../validation.js';

export type Access = 'public' | 'optional' | 'auth' | 'admin' | 'author_or_admin';
export type RateClass = 'read' | 'write' | 'auth' | 'open' | 'none';
export type Method = 'get' | 'post' | 'patch' | 'delete';

export interface AuthUser {
  id: number;
  username: string;
  jti: string;
  exp: number;
}

export interface Ctx<P = any, Q = any, B = any> {
  req: Request;
  res: Response;
  params: P;
  query: Q;
  body: B;
  user: AuthUser | null;
  isAdmin: boolean;
  db: Db;
  config: Config;
  settings: Settings;
  realtime: Realtime;
}

export interface Result {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: string;
  contentType?: string;
}

export interface ResponseSpec {
  description: string;
  schema?: ZodTypeAny;
  example?: unknown;
  contentType?: string;
  headers?: Record<string, string>;
}

export interface RouteSpec<P extends ZodTypeAny, Q extends ZodTypeAny, B extends ZodTypeAny> {
  method: Method;
  path: string;
  tags: string[];
  summary: string;
  description: string;
  access: Access;
  rate?: RateClass;
  params?: P;
  query?: Q;
  refineQuery?: (query: z.infer<Q>, ctx: { req: Request; config: Config; settings: Settings }) => z.infer<Q>;
  body?: B;
  responses: Record<number, ResponseSpec>;
  errors?: number[];
  guard?: (ctx: Omit<Ctx<z.infer<P>>, 'query' | 'body'>) => void;
  handler: (ctx: Ctx<z.infer<P>, z.infer<Q>, z.infer<B>>) => Result | Promise<Result>;
}

export type AnyRoute = RouteSpec<any, any, any>;

export function defineRoute<P extends ZodTypeAny, Q extends ZodTypeAny, B extends ZodTypeAny>(
  spec: RouteSpec<P, Q, B>,
): AnyRoute {
  return spec as AnyRoute;
}

export function rateClassOf(spec: AnyRoute): RateClass {
  if (spec.rate) return spec.rate;
  return spec.method === 'get' ? 'read' : 'write';
}

export interface MountDeps {
  config: Config;
  db: Db;
  settings: Settings;
  realtime: Realtime;
  pre: (spec: AnyRoute) => RequestHandler[];
}

const toExpressPath = (path: string) => path.replace(/\{(\w+)\}/g, ':$1');

export function mountRoutes(router: Router, routes: AnyRoute[], deps: MountDeps): void {
  for (const spec of routes) {
    const handler = async (req: Request, res: Response, next: NextFunction) => {
      try {
        let params: unknown = req.params;
        if (spec.params) {
          const parsed = (spec.params as ZodTypeAny).safeParse(req.params);
          if (!parsed.success) throw notFound();
          params = parsed.data;
        }
        const base = {
          req,
          res,
          params,
          user: res.locals.user ?? null,
          isAdmin: res.locals.isAdmin === true,
          db: deps.db,
          config: deps.config,
          settings: deps.settings,
          realtime: deps.realtime,
        };
        spec.guard?.(base);
        const querySchema = spec.query;
        let query = querySchema ? validate(querySchema, req.query) : req.query;
        if (querySchema && spec.refineQuery) {
          query = spec.refineQuery(query, { req, config: deps.config, settings: deps.settings });
        }
        const body = spec.body ? validate(spec.body, req.body ?? {}, true) : undefined;
        const result = await spec.handler({ ...base, query, body });
        res.status(result.status ?? 200);
        for (const [k, v] of Object.entries(result.headers ?? {})) res.setHeader(k, v);
        if (result.raw !== undefined) {
          res.type(result.contentType ?? 'text/plain; charset=utf-8').send(result.raw);
        } else if (result.body === undefined) {
          res.end();
        } else {
          res.json(result.body);
        }
      } catch (err) {
        next(err);
      }
    };
    router[spec.method](toExpressPath(spec.path), ...deps.pre(spec), handler);
  }
}
