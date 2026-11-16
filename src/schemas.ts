import { z } from './openapi/zod.js';

export const CATEGORIES = ['note', 'photo', 'tip', 'riddle'] as const;
export const CATEGORY_LABELS: Record<(typeof CATEGORIES)[number], string> = {
  note: 'Un mot',
  photo: 'Une photo',
  tip: 'Une recommandation',
  riddle: 'Une énigme',
};
export const REPORT_REASONS = ['spam', 'offensive', 'personal_info', 'other'] as const;

const isHttps = (v: string) => {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

export const httpsUrl = z
  .string()
  .trim()
  .max(500, 'Au plus 500 caractères.')
  .refine(isHttps, 'Doit être une adresse https://.');

export const usernameField = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, '3 à 20 caractères : lettres minuscules, chiffres ou _.')
  .max(20, '3 à 20 caractères : lettres minuscules, chiffres ou _.')
  .regex(/^[a-z0-9_]+$/, '3 à 20 caractères : lettres minuscules, chiffres ou _.')
  .refine((v) => v !== 'admin' && v !== 'me', "Ce nom d'utilisateur est réservé.");

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Adresse e-mail invalide.')
  .email('Adresse e-mail invalide.');

export const passwordField = z
  .string()
  .min(8, 'Au moins 8 caractères.')
  .max(72, 'Au plus 72 caractères.')
  .refine((v) => Buffer.byteLength(v) <= 72, 'Au plus 72 octets (caractères accentués comptés double).');

export const displayNameField = z.string().trim().min(1, 'Entre 1 et 40 caractères.').max(40, 'Entre 1 et 40 caractères.');
export const bioField = z.string().trim().max(280, 'Au plus 280 caractères.');

export const idParams = z.object({
  id: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .openapi({ description: 'Identifiant numérique.', example: '42' }),
});

export const usernameParams = z.object({
  username: z.string().openapi({ description: "Nom d'utilisateur (minuscules).", example: 'lea' }),
});

const intQuery = (def: number, min: number, max?: number) => {
  const message = max
    ? `Doit être un entier entre ${min} et ${max}.`
    : `Doit être un entier supérieur ou égal à ${min}.`;
  let s = z.coerce.number({ invalid_type_error: message }).int(message).min(min, message);
  if (max) s = s.max(max, message);
  return s.default(def);
};

export const paginationQuery = z.object({
  page: intQuery(1, 1).openapi({ description: 'Numéro de page, à partir de 1.' }),
  pageSize: intQuery(20, 1, 50).openapi({ description: 'Éléments par page (1 à 50).' }),
});

export const PublicUserSchema = z
  .object({
    id: z.number().int(),
    username: z.string(),
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  })
  .openapi('PublicUser');

export const PrivateUserSchema = z
  .object({
    id: z.number().int(),
    username: z.string(),
    email: z.string(),
    displayName: z.string(),
    bio: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('PrivateUser');

export const ProfileSchema = z
  .object({
    id: z.number().int(),
    username: z.string(),
    displayName: z.string(),
    bio: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    createdAt: z.string(),
    stats: z.object({
      dropsCount: z.number().int(),
      likesReceived: z.number().int(),
      commentsCount: z.number().int(),
    }),
  })
  .openapi('Profile');

export const DropSchema = z
  .object({
    id: z.number().int(),
    title: z.string(),
    content: z.string().nullable(),
    category: z.enum(CATEGORIES),
    imageUrl: z.string().nullable(),
    location: z.object({ lat: z.number(), lng: z.number(), precision: z.enum(['exact', 'approx']) }),
    locked: z.boolean(),
    hidden: z.boolean(),
    author: PublicUserSchema,
    likesCount: z.number().int(),
    commentsCount: z.number().int(),
    opensCount: z.number().int(),
    likedByMe: z.boolean(),
    openedByMe: z.boolean(),
    isMine: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Drop');

export const CommentSchema = z
  .object({
    id: z.number().int(),
    dropId: z.number().int(),
    content: z.string(),
    author: PublicUserSchema,
    isMine: z.boolean(),
    createdAt: z.string(),
  })
  .openapi('Comment');

export const CategorySchema = z
  .object({ id: z.enum(CATEGORIES), label: z.string() })
  .openapi('Category');

export const AuthResponseSchema = z
  .object({ user: PrivateUserSchema, token: z.string(), expiresAt: z.string() })
  .openapi('AuthResponse');

export function pageSchema<T extends z.ZodTypeAny>(item: T, name: string) {
  return z
    .object({
      items: z.array(item),
      page: z.number().int(),
      pageSize: z.number().int(),
      total: z.number().int(),
      totalPages: z.number().int(),
    })
    .openapi(name);
}

export const EXAMPLES = {
  publicUser: { id: 3, username: 'lea', displayName: 'Léa', avatarUrl: null },
  privateUser: {
    id: 3,
    username: 'lea',
    email: 'lea@example.com',
    displayName: 'Léa',
    bio: null,
    avatarUrl: null,
    createdAt: '2026-11-16T08:00:00.000Z',
  },
  profile: {
    id: 3,
    username: 'lea',
    displayName: 'Léa',
    bio: 'Je cherche les bancs au soleil.',
    avatarUrl: null,
    createdAt: '2026-11-16T08:00:00.000Z',
    stats: { dropsCount: 6, likesReceived: 14, commentsCount: 9 },
  },
  drop: {
    id: 42,
    title: 'Le banc le plus calme du coin',
    content: "Derrière le bâtiment, à l'ombre. Idéal pour réviser.",
    category: 'tip',
    imageUrl: null,
    location: { lat: 47.49561, lng: 6.80544, precision: 'exact' },
    locked: false,
    hidden: false,
    author: { id: 3, username: 'lea', displayName: 'Léa', avatarUrl: null },
    likesCount: 4,
    commentsCount: 2,
    opensCount: 0,
    likedByMe: false,
    openedByMe: false,
    isMine: false,
    createdAt: '2026-11-16T09:12:00.000Z',
    updatedAt: '2026-11-16T09:12:00.000Z',
  },
  comment: {
    id: 7,
    dropId: 42,
    content: 'Validé !',
    author: { id: 5, username: 'yanis', displayName: 'Yanis', avatarUrl: null },
    isMine: false,
    createdAt: '2026-11-16T10:02:00.000Z',
  },
};

export const pageExample = <T>(item: T, total = 57) => ({
  items: [item],
  page: 1,
  pageSize: 20,
  total,
  totalPages: Math.ceil(total / 20),
});
