import type { AnyRoute } from './http/route.js';
import { PRESENCE_STEPS, WS_TYPES } from './openapi/block2-text.js';
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
  location: { lat: number; lng: number };
  hidden: boolean; author: PublicUser;
  likesCount: number; dislikesCount: number; commentsCount: number;
  likedByMe: boolean; dislikedByMe: boolean; isMine: boolean;
  createdAt: string; updatedAt: string;
}
interface Comment {
  id: number; dropId: number; parentId: number | null; content: string; author: PublicUser; isMine: boolean;
  deleted: boolean; repliesCount: number; likesCount: number; dislikesCount: number;
  likedByMe: boolean; dislikedByMe: boolean; createdAt: string;
}
interface ReactionState { liked: boolean; disliked: boolean; likesCount: number; dislikesCount: number }
interface CategoryItem { id: Category; label: string }
interface Page<T> { items: T[]; page: number; pageSize: number; total: number; totalPages: number }
interface AuthResponse { user: PrivateUser; token: string; expiresAt: string }
interface ApiError {
  error: {
    status: number; code: string; message: string;
    fields: Record<string, string[]>; requestId: string; simulated: boolean;
  };
}`;

const ACCESS_LABEL = {
  public: 'public',
  optional: 'token?',
  auth: 'token',
  admin: 'admin',
  author_or_admin: 'token|admin',
} as const;

const BLOCK2_SECTION = `
## Bloc 2

Tout est additif : rien du bloc 1 ne change. \`Drop.distanceM?: number\` n'existe que si la requête utilise \`near\`.

### Géolocalisation (GET /drops)

- \`near=lat,lng\` + \`radius\` (1 à 5000 m, défaut 1000) : drops dans le rayon, \`distanceM\` ajouté. \`sort=distance\` (défaut avec near) n'existe qu'avec near.
- \`bbox=minLng,minLat,maxLng,maxLat\` : **longitude d'abord** (ordre GeoJSON, pas celui de Leaflet). \`pageSize\` jusqu'à 200 avec bbox.
- near et bbox s'excluent (422 sur les deux) ; radius sans near : 422 sur radius. Se combinent avec q, category, author, page.

### Jeu de données

\`GET /dataset/points\` (token, gzip, cache 24 h, sans pagination) : \`{ source, count, points[] }\`, valeurs brutes (coordonnées parfois en chaîne ou \`null\`).
\`?format=geojson\` : FeatureCollection \`[lng, lat]\` des seuls points valides, plus \`skipped\`.

### Temps réel

Page de démonstration sans code : \`GET /ws-playground\`. Documentation complète du WebSocket, avec un exemple Next.js : \`GET /ws-docs\`.

#### La présence pas à pas

${PRESENCE_STEPS}

#### Protocole

1. Côté serveur Next : \`POST /realtime/ticket\` (JWT) → \`{ ticket, expiresAt, url }\`. Ticket à usage unique, 30 s. Le JWT ne passe jamais dans l'URL du WebSocket.
2. Navigateur : ouvrir \`url\` (\`/ws?ticket=wst_…\`). Ticket absent, expiré ou déjà utilisé : HTTP 401 au format d'erreur, pendant le handshake.
3. Messages JSON \`{ type, data }\`. Message illisible ou inconnu : message \`error\`, sans fermeture.
4. Fermetures serveur : 4001 session_expired · 4008 rate_limited (20 messages / 10 s) · 4009 too_many_connections (5 max, la plus ancienne est fermée) · 4010 server_restart · 4011 admin_disconnect.
5. Chaque Drop et Comment diffusé est construit pour son destinataire (isMine, likedByMe, dislikedByMe). Drops masqués : diffusés à leur auteur seulement, les autres reçoivent drop:deleted.
6. Notifications : à l'auteur du drop uniquement, jamais pour ses propres actions. Aucune position d'utilisateur ne transite par le WebSocket.

\`\`\`ts
${WS_TYPES}
\`\`\`
`;

export function buildContract(routes: AnyRoute[]): string {
  const lines = routes.map((r) => {
    const ok = Object.keys(r.responses).join(',');
    const err = errorStatusesOf(r).join(',');
    return `${r.method.toUpperCase().padEnd(6)} ${r.path.padEnd(28)} ${ACCESS_LABEL[r.access].padEnd(11)} ${ok} | ${err}`;
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

\`likedByMe\`, \`dislikedByMe\`, \`isMine\` sont calculés pour l'utilisateur du token. \`hidden\` n'est \`true\` que pour l'auteur.
Like et dislike s'excluent (drops et commentaires) : poser l'un retire l'autre. Les routes like/dislike renvoient \`ReactionState\` (\`LikeState\` pour les drops).
Réponses : un seul niveau. \`GET /drops/:id/comments\` ne liste que les commentaires de premier niveau (\`parentId: null\`, avec \`repliesCount\`) ; \`GET /comments/:id/replies\` liste les réponses. \`POST /drops/:id/comments\` accepte \`parentId\` ; répondre à une réponse la rattache à la racine. Un commentaire supprimé qui a des réponses reste avec \`deleted: true\`, \`content: ""\` et un auteur anonymisé.
Pagination : \`?page=1\` (≥1), \`?pageSize=20\` (1 à 50). Page au-delà de la fin : 200 avec \`items: []\`.

## Routes

Accès : public, token, admin (\`X-Admin-Key\`). Format : succès | erreurs possibles.

\`\`\`
${lines.join('\n')}
\`\`\`

## Erreurs

Format unique, \`fields\` toujours présent (clé = champ du corps ou paramètre, valeur = messages) :
\`{ "error": { "status": 422, "code": "validation_failed", "message": "…", "fields": { "title": ["…"] }, "requestId": "req_…", "simulated": false } }\`

400 bad_request · 401 unauthorized, invalid_token, token_expired, token_revoked, invalid_credentials · 403 forbidden
404 not_found · 409 conflict · 422 validation_failed · 429 rate_limited (Retry-After) · 500 internal_error · 503 service_unavailable
Erreurs de coordonnées (type, bornes ; aucune restriction de zone) : toujours sous la clé \`location\`.

## Outils pédagogiques

- \`?delay=<ms>\` (0 à 10000) sur toute route.
- \`?fail=<statut>\` (400, 401, 403, 404, 409, 422, 429, 500, 503) : requête non exécutée, erreur avec \`simulated: true\` et \`X-Simulated: true\`.
  \`fail=422\` met « Erreur simulée sur ce champ. » sous chaque champ du corps. \`fail=429\` ajoute \`Retry-After: 5\`.
- \`POST /auth/login?ttl=<secondes>\` (10 à 28800) : token de courte durée.
- Comptes de démo : \`mathis\` / \`drops2026\` (autres prénoms : même mot de passe).
${BLOCK2_SECTION}`;
}
