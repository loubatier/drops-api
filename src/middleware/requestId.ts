import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestId(_req: Request, res: Response, next: NextFunction) {
  const id = `req_${randomBytes(4).toString('hex')}`;
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
