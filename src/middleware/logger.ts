import type { NextFunction, Request, Response } from 'express';
import type { Config } from '../config.js';

export function requestLogger(config: Config) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!config.logRequests) return next();
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const path = req.originalUrl.split('?')[0];
      const user = res.locals.user?.id ?? '-';
      console.log(
        `${req.method} ${path} ${res.statusCode} ${ms.toFixed(1)}ms ${res.locals.requestId} user=${user}`,
      );
    });
    next();
  };
}
