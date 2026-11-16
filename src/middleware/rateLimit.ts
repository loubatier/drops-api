import type { Request, RequestHandler, Response } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { Config } from '../config.js';
import { ApiError } from '../errors.js';
import type { RateClass } from '../http/route.js';

function limiter(limit: number, keyOf: (req: Request, res: Response) => string): RequestHandler {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-6',
    legacyHeaders: false,
    keyGenerator: keyOf,
    handler: (_req, res, next) => {
      const retryAfter = String(res.getHeader('Retry-After') ?? 60);
      next(new ApiError(429, 'rate_limited', 'Trop de requêtes, réessayez dans quelques instants.', {}, { 'Retry-After': retryAfter }));
    },
  });
}

const ipKey = (req: Request) => `ip:${ipKeyGenerator(req.ip ?? '0.0.0.0')}`;
const userOrIpKey = (req: Request, res: Response) =>
  res.locals.user ? `user:${res.locals.user.id}` : ipKey(req);

export function createRateLimiters(config: Config): Record<Exclude<RateClass, 'none'>, RequestHandler> {
  return {
    read: limiter(config.rateLimit.read, userOrIpKey),
    write: limiter(config.rateLimit.write, userOrIpKey),
    auth: limiter(config.rateLimit.auth, (req) => ipKey(req)),
  };
}
