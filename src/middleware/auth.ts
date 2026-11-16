import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { ApiError, forbidden } from '../errors.js';
import { TokenExpiredError, verifyToken } from '../modules/auth/tokens.js';

const invalid = (code: string, message: string) => ApiError.of(401, message, {}, code);

export function identify(config: Config, db: Db): RequestHandler {
  const isRevoked = db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?');
  const userExists = db.prepare('SELECT username FROM users WHERE id = ?');
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (header === undefined) return next();
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) return next(invalid('invalid_token', 'Token invalide.'));
    let claims;
    try {
      claims = verifyToken(config, match[1]!);
    } catch (err) {
      if (err instanceof TokenExpiredError) return next(invalid('token_expired', 'Votre session a expiré.'));
      return next(invalid('invalid_token', 'Token invalide.'));
    }
    if (isRevoked.get(claims.jti)) return next(invalid('token_revoked', 'Ce token a été révoqué.'));
    const id = Number(claims.sub);
    if (!Number.isInteger(id) || !userExists.get(id)) return next(invalid('invalid_token', 'Token invalide.'));
    res.locals.user = { id, username: claims.username, jti: claims.jti, exp: claims.exp };
    next();
  };
}

export const requireAuth: RequestHandler = (_req, res, next) => {
  if (!res.locals.user) return next(ApiError.of(401, 'Authentification requise.'));
  next();
};

const digest = (v: string) => createHash('sha256').update(v).digest();

export function requireAdmin(config: Config): RequestHandler {
  const expected = digest(config.adminKey);
  return (req, _res, next) => {
    const provided = req.headers['x-admin-key'];
    const key = typeof provided === 'string' ? provided : '';
    if (!timingSafeEqual(digest(key), expected)) return next(forbidden('Clé administrateur absente ou incorrecte.'));
    next();
  };
}
