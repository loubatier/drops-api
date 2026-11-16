import bcrypt from 'bcryptjs';
import type { Config } from '../../config.js';
import { ApiError } from '../../errors.js';
import { defineRoute } from '../../http/route.js';
import { z } from '../../openapi/zod.js';
import {
  AuthResponseSchema,
  EXAMPLES,
  PrivateUserSchema,
  bioField,
  displayNameField,
  emailField,
  httpsUrl,
  passwordField,
  usernameField,
} from '../../schemas.js';
import { findUserById, findUserByLogin, toPrivateUser } from '../users/repo.js';
import { signToken } from './tokens.js';

const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

const registerBody = z
  .object({
    username: usernameField,
    email: emailField,
    password: passwordField,
    displayName: displayNameField,
    bio: bioField.nullable().optional(),
  })
  .strict();

const loginBody = z
  .object({
    login: z.string().trim().min(1, "Renseignez votre e-mail ou nom d'utilisateur."),
    password: z.string().min(1, 'Renseignez votre mot de passe.'),
  })
  .strict();

const patchMeBody = z
  .object({
    displayName: displayNameField.optional(),
    bio: bioField.nullable().optional(),
    avatarUrl: httpsUrl.nullable().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Renseignez au moins un champ à modifier.');

const authExample = {
  user: EXAMPLES.privateUser,
  token: 'eyJhbGciOiJIUzI1NiIsInR9.eyJzdWIiOiIzIn0.signature',
  expiresAt: '2026-11-16T16:00:00.000Z',
};

export function authRoutes(config: Config) {
  const ttlMessage = `Doit être un entier entre 10 et ${config.jwtTtlSeconds}.`;
  const loginQuery = z.object({
    ttl: z.coerce
      .number({ invalid_type_error: ttlMessage })
      .int(ttlMessage)
      .min(10, ttlMessage)
      .max(config.jwtTtlSeconds, ttlMessage)
      .optional()
      .openapi({
        description: `Durée de vie du token en secondes (10 à ${config.jwtTtlSeconds}), pour tester l'expiration de session.`,
        example: 10,
      }),
  });

  return [
    defineRoute({
      method: 'post',
      path: '/auth/register',
      tags: ['Auth'],
      summary: 'Créer un compte',
      description:
        "Crée un compte et renvoie directement un token. Le nom d'utilisateur et l'e-mail sont mis en minuscules. `admin` et `me` sont réservés.",
      access: 'public',
      rate: 'auth',
      body: registerBody,
      errors: [409],
      responses: {
        201: { description: 'Compte créé.', schema: AuthResponseSchema, example: authExample },
      },
      handler: ({ body, db, config }) => {
        const fields: Record<string, string[]> = {};
        if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(body.username)) {
          fields.username = ["Ce nom d'utilisateur est déjà pris."];
        }
        if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(body.email)) {
          fields.email = ['Cette adresse e-mail est déjà utilisée.'];
        }
        if (Object.keys(fields).length > 0) {
          throw ApiError.of(409, 'Ces informations sont déjà utilisées.', fields);
        }
        const hash = bcrypt.hashSync(body.password, 10);
        const info = db
          .prepare(
            `INSERT INTO users (username, email, password_hash, display_name, bio, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(body.username, body.email, hash, body.displayName, body.bio ?? null, new Date().toISOString());
        const user = findUserById(db, Number(info.lastInsertRowid))!;
        const { token, expiresAt } = signToken(config, user, config.jwtTtlSeconds);
        return { status: 201, body: { user: toPrivateUser(user), token, expiresAt } };
      },
    }),
    defineRoute({
      method: 'post',
      path: '/auth/login',
      tags: ['Auth', 'Outils pédagogiques'],
      summary: 'Se connecter',
      description:
        "Connexion par e-mail **ou** nom d'utilisateur. Le paramètre `?ttl=<secondes>` émet un token de courte durée pour tester l'expiration de session.",
      access: 'public',
      rate: 'auth',
      query: loginQuery,
      body: loginBody,
      errors: [401],
      responses: {
        200: { description: 'Connexion réussie.', schema: AuthResponseSchema, example: authExample },
      },
      handler: ({ body, query, db, config }) => {
        const user = findUserByLogin(db, body.login.toLowerCase());
        const ok = bcrypt.compareSync(body.password, user?.password_hash ?? DUMMY_HASH);
        if (!user || !ok) {
          throw ApiError.of(401, 'Identifiant ou mot de passe incorrect.', {}, 'invalid_credentials');
        }
        const { token, expiresAt } = signToken(config, user, query.ttl ?? config.jwtTtlSeconds);
        return { body: { user: toPrivateUser(user), token, expiresAt } };
      },
    }),
    defineRoute({
      method: 'post',
      path: '/auth/logout',
      tags: ['Auth'],
      summary: 'Se déconnecter',
      description: 'Révoque le token courant : toute requête suivante avec ce token renvoie 401 `token_revoked`.',
      access: 'auth',
      responses: { 204: { description: 'Token révoqué.' } },
      handler: ({ user, db }) => {
        db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)').run(user!.jti, user!.exp);
        return { status: 204 };
      },
    }),
    defineRoute({
      method: 'get',
      path: '/auth/me',
      tags: ['Auth'],
      summary: 'Mon compte',
      description: "Renvoie le compte de l'utilisateur connecté, avec son e-mail.",
      access: 'auth',
      responses: { 200: { description: 'Mon compte.', schema: PrivateUserSchema, example: EXAMPLES.privateUser } },
      handler: ({ user, db }) => ({ body: toPrivateUser(findUserById(db, user!.id)!) }),
    }),
    defineRoute({
      method: 'patch',
      path: '/auth/me',
      tags: ['Auth'],
      summary: 'Modifier mon profil',
      description: 'Au moins un champ parmi `displayName`, `bio` et `avatarUrl`. `bio` et `avatarUrl` acceptent `null`.',
      access: 'auth',
      body: patchMeBody,
      responses: { 200: { description: 'Compte mis à jour.', schema: PrivateUserSchema, example: EXAMPLES.privateUser } },
      handler: ({ user, body, db }) => {
        const current = findUserById(db, user!.id)!;
        db.prepare('UPDATE users SET display_name = ?, bio = ?, avatar_url = ? WHERE id = ?').run(
          body.displayName ?? current.display_name,
          body.bio === undefined ? current.bio : body.bio,
          body.avatarUrl === undefined ? current.avatar_url : body.avatarUrl,
          user!.id,
        );
        return { body: toPrivateUser(findUserById(db, user!.id)!) };
      },
    }),
  ];
}
