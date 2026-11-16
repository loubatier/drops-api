import type { NextFunction, Request, Response } from 'express';
import type { Config } from '../config.js';
import { ApiError, ERROR_DEFS, type Fields, SIMULABLE_STATUSES, validationFailed } from '../errors.js';

const single = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function parseSimulation(query: Request['query']) {
  const fields: Fields = {};
  let delay = 0;
  let fail: number | null = null;
  if (query.delay !== undefined) {
    const raw = single(query.delay);
    const n = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (Number.isNaN(n) || n > 10000) fields.delay = ['Doit être un entier entre 0 et 10000 (millisecondes).'];
    else delay = n;
  }
  if (query.fail !== undefined) {
    const raw = single(query.fail);
    const n = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!(SIMULABLE_STATUSES as readonly number[]).includes(n)) {
      fields.fail = [`Doit être l'un des statuts : ${SIMULABLE_STATUSES.join(', ')}.`];
    } else fail = n;
  }
  return { fields, delay, fail };
}

export function simulation(config: Config) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!config.enableSimulation) return next();
    const { fields, delay, fail } = parseSimulation(req.query);
    if (Object.keys(fields).length > 0) return next(validationFailed(fields));
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    if (fail === null) return next();

    const def = ERROR_DEFS[fail]!;
    const headers: Record<string, string> = { 'X-Simulated': 'true' };
    if (fail === 429) headers['Retry-After'] = '5';
    const errorFields: Fields = {};
    if (fail === 422 && req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      for (const key of Object.keys(req.body)) errorFields[key] = ['Erreur simulée sur ce champ.'];
    }
    next(new ApiError(fail, def.code, def.message, errorFields, headers, true));
  };
}
