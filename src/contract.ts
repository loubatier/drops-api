import { type AnyRoute } from './http/route.js';
import { errorStatusesOf } from './openapi/registry.js';
import { VERSION } from './version.js';

const TYPES = `type Category = 'note' | 'photo' | 'tip' | 'riddle';
type ReportReason = 'spam' | 'offensive' | 'personal_info' | 'other';
interface PublicUser { id: number; username: string; displayName: string; avatarUrl: string | null }
interface PrivateUser extends PublicUser { email: string; bio: string | null; createdAt: string }
interface Profile extends PublicUser {
  bio: string | null; createdAt: string;
  stats: { dropsCount: number; likesReceived: number; commentsCount: number };
}
interface Drop {
  id: number; title: string; content: string | null; category: Category; imageUrl: string | null;
  location: { lat: number; lng: number; precision: 'exact' | 'approx' };
  locked: boolean; hidden: boolean; author: PublicUser;
  likesCount: number; commentsCount: number; opensCount: number;
  likedByMe: boolean; openedByMe: boolean; isMine: boolean;
  createdAt: string; updatedAt: string;
}
interface Comment { id: number; dropId: number; content: string; author: PublicUser; isMine: boolean; createdAt: string }
interface CategoryItem { id: Category; label: string }
interface Page<T> { items: T[]; page: number; pageSize: number; total: number; totalPages: number }
interface AuthResponse { user: PrivateUser; token: string; expiresAt: string }
interface ApiError {
  error: {
    status: number; code: string; message: string;
    fields: Record<string, string[]>; requestId: string; simulated: boolean;
  };
}`;

const ACCESS_LABEL = { public: 'public', optional: 'token?', auth: 'token', admin: 'admin' } as const;

export function buildContract(routes: AnyRoute[]): string {
  const lines = routes.map((r) => {
    const ok = Object.keys(r.responses).join(',');
    const err = errorStatusesOf(r).join(',');
    return `${r.method.toUpperCase().padEnd(6)} ${r.path.padEnd(28)} ${ACCESS_LABEL[r.access].padEnd(7)} ${ok} | ${err}`;
  });
  return `# Drops API : contrat v${VERSION}

JSON, camelCase, dates ISO 8601 UTC, ids entiers. Auth : \`Authorization: Bearer <token>\` (aucun cookie).
Un token présent mais invalide, expiré ou révoqué donne 401 sur toutes les routes, même publiques.
Corps stricts : champ inconnu = 422, pas de conversion de type (\`"47.4"\` n'est pas un nombre).
Doc interactive : /docs. Spécification : /openapi.json.

## Types

\`\`\`ts
${TYPES}
\`\`\`

\`likedByMe\`, \`openedByMe\`, \`isMine\` valent \`false\` sans token. \`hidden\` n'est \`true\` que pour l'auteur.
Pagination : \`?page=1\` (≥1), \`?pageSize=20\` (1 à 50). Page au-delà de la fin : 200 avec \`items: []\`.

## Routes

Accès : public, token? (token facultatif), token, admin (\`X-Admin-Key\`). Format : succès | erreurs possibles.

\`\`\`
${lines.join('\n')}
\`\`\`

## Erreurs

Format unique, \`fields\` toujours présent (clé = champ du corps ou paramètre, valeur = messages) :
\`{ "error": { "status": 422, "code": "validation_failed", "message": "…", "fields": { "title": ["…"] }, "requestId": "req_…", "simulated": false } }\`

400 bad_request · 401 unauthorized, invalid_token, token_expired, token_revoked, invalid_credentials · 403 forbidden
404 not_found · 409 conflict · 422 validation_failed · 429 rate_limited (Retry-After) · 500 internal_error · 503 service_unavailable
Erreurs de coordonnées (type, bornes, zone de 3 km autour du département MMI) : toujours sous la clé \`location\`.

## Outils pédagogiques

- \`?delay=<ms>\` (0 à 10000) sur toute route.
- \`?fail=<statut>\` (400, 401, 403, 404, 409, 422, 429, 500, 503) : requête non exécutée, erreur avec \`simulated: true\` et \`X-Simulated: true\`.
  \`fail=422\` met « Erreur simulée sur ce champ. » sous chaque champ du corps. \`fail=429\` ajoute \`Retry-After: 5\`.
- \`POST /auth/login?ttl=<secondes>\` (10 à 28800) : token de courte durée.
- Comptes de démo : \`demo\` / \`drops2026\` (autres prénoms : même mot de passe).
`;
}
