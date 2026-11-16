import type { NextFunction, Request, Response } from 'express';
import { ApiError, errorBody } from '../errors.js';

export function sendError(res: Response, err: ApiError) {
  for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v);
  if (err.status === 401) res.setHeader('WWW-Authenticate', 'Bearer');
  res.status(err.status).json(errorBody(err, res.locals.requestId));
}

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(ApiError.of(404));
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) return sendError(res, err);
  const type = (err as { type?: string })?.type;
  if (type === 'entity.parse.failed') return sendError(res, ApiError.of(400, 'JSON illisible.'));
  if (type === 'entity.too.large') {
    return sendError(res, ApiError.of(400, 'Corps de requête trop volumineux (100 ko maximum).'));
  }
  if (res.headersSent) return;
  console.error(`[${res.locals.requestId}] ${req.method} ${req.originalUrl.split('?')[0]}`, err);
  sendError(res, ApiError.of(500));
}
