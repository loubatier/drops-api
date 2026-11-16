# Drops API : contrat v1.0.0

JSON, camelCase, dates ISO 8601 UTC, ids entiers. Auth : `Authorization: Bearer <token>` (aucun cookie).
Un token présent mais invalide, expiré ou révoqué donne 401 sur toutes les routes, même publiques.
Corps stricts : champ inconnu = 422, pas de conversion de type (`"47.4"` n'est pas un nombre).
Doc interactive : /docs. Spécification : /openapi.json.

## Types

```ts
type Category = 'note' | 'photo' | 'tip' | 'riddle';
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
}
```

`likedByMe`, `openedByMe`, `isMine` valent `false` sans token. `hidden` n'est `true` que pour l'auteur.
Pagination : `?page=1` (≥1), `?pageSize=20` (1 à 50). Page au-delà de la fin : 200 avec `items: []`.

## Routes

Accès : public, token? (token facultatif), token, admin (`X-Admin-Key`). Format : succès | erreurs possibles.

```
GET    /                            public      200 | 429,500
GET    /health                      public      200,503 | 500
GET    /docs                        public      200 | 500
GET    /openapi.json                public      200 | 500
GET    /contract.md                 public      200 | 500
POST   /auth/register               public      201 | 400,409,422,429,500
POST   /auth/login                  public      200 | 400,401,422,429,500
POST   /auth/logout                 token       204 | 401,429,500
GET    /auth/me                     token       200 | 401,429,500
PATCH  /auth/me                     token       200 | 400,401,422,429,500
GET    /users/{username}            token?      200 | 401,404,429,500
GET    /categories                  public      200 | 429,500
GET    /drops                       token?      200 | 401,422,429,500
GET    /drops/{id}                  token?      200 | 401,404,429,500
POST   /drops                       token       201 | 400,401,422,429,500
PATCH  /drops/{id}                  token       200 | 400,401,403,404,422,429,500
DELETE /drops/{id}                  token|admin 204 | 401,403,404,429,500
POST   /drops/{id}/like             token       200 | 401,404,429,500
DELETE /drops/{id}/like             token       200 | 401,404,429,500
GET    /drops/{id}/comments         token?      200 | 401,404,422,429,500
POST   /drops/{id}/comments         token       201 | 400,401,404,422,429,500
DELETE /comments/{id}               token       204 | 401,403,404,429,500
POST   /drops/{id}/report           token       202 | 400,401,403,404,422,429,500
POST   /admin/reset                 admin       200 | 400,403,422,500
GET    /admin/reports               admin       200 | 403,500
POST   /admin/drops/{id}/unhide     admin       200 | 403,404,500
```

## Erreurs

Format unique, `fields` toujours présent (clé = champ du corps ou paramètre, valeur = messages) :
`{ "error": { "status": 422, "code": "validation_failed", "message": "…", "fields": { "title": ["…"] }, "requestId": "req_…", "simulated": false } }`

400 bad_request · 401 unauthorized, invalid_token, token_expired, token_revoked, invalid_credentials · 403 forbidden
404 not_found · 409 conflict · 422 validation_failed · 429 rate_limited (Retry-After) · 500 internal_error · 503 service_unavailable
Erreurs de coordonnées (type, bornes, zone de 3 km autour du département MMI) : toujours sous la clé `location`.

## Outils pédagogiques

- `?delay=<ms>` (0 à 10000) sur toute route.
- `?fail=<statut>` (400, 401, 403, 404, 409, 422, 429, 500, 503) : requête non exécutée, erreur avec `simulated: true` et `X-Simulated: true`.
  `fail=422` met « Erreur simulée sur ce champ. » sous chaque champ du corps. `fail=429` ajoute `Retry-After: 5`.
- `POST /auth/login?ttl=<secondes>` (10 à 28800) : token de courte durée.
- Comptes de démo : `demo` / `drops2026` (autres prénoms : même mot de passe).
