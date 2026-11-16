import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Config } from '../../config.js';

export interface TokenClaims {
  sub: string;
  username: string;
  jti: string;
  iat: number;
  exp: number;
}

export function signToken(config: Config, user: { id: number; username: string }, ttlSeconds: number) {
  const token = jwt.sign({ username: user.username }, config.jwtSecret, {
    algorithm: 'HS256',
    subject: String(user.id),
    jwtid: randomUUID(),
    expiresIn: ttlSeconds,
  });
  const { exp } = jwt.decode(token) as TokenClaims;
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyToken(config: Config, token: string): TokenClaims {
  return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as unknown as TokenClaims;
}

export const TokenExpiredError = jwt.TokenExpiredError;
