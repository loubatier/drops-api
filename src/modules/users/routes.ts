import { notFound } from '../../errors.js';
import { defineRoute } from '../../http/route.js';
import { CATEGORIES, CATEGORY_LABELS, CategorySchema, EXAMPLES, ProfileSchema, usernameParams } from '../../schemas.js';
import { z } from '../../openapi/zod.js';
import { findUserByUsername, profileStats } from './repo.js';

export function userRoutes() {
  return [
    defineRoute({
      method: 'get',
      path: '/users/{username}',
      tags: ['Utilisateurs'],
      summary: "Profil d'un utilisateur",
      description:
        "Profil public avec statistiques (drops visibles, likes reçus, commentaires écrits). Les drops d'un utilisateur s'obtiennent avec `GET /drops?author=<username>`.",
      access: 'auth',
      params: usernameParams,
      responses: { 200: { description: 'Profil.', schema: ProfileSchema, example: EXAMPLES.profile } },
      handler: ({ params, db }) => {
        const user = findUserByUsername(db, params.username.toLowerCase());
        if (!user) throw notFound('Utilisateur introuvable.');
        return {
          body: {
            id: user.id,
            username: user.username,
            displayName: user.display_name,
            bio: user.bio,
            avatarUrl: user.avatar_url,
            createdAt: user.created_at,
            stats: profileStats(db, user.id),
          },
        };
      },
    }),
    defineRoute({
      method: 'get',
      path: '/categories',
      tags: ['Drops'],
      summary: 'Catégories de drops',
      description: 'Les quatre catégories disponibles.',
      access: 'auth',
      responses: {
        200: {
          description: 'Liste des catégories.',
          schema: z.array(CategorySchema),
          example: CATEGORIES.map((id) => ({ id, label: CATEGORY_LABELS[id] })),
        },
      },
      handler: () => ({ body: CATEGORIES.map((id) => ({ id, label: CATEGORY_LABELS[id] })) }),
    }),
  ];
}
