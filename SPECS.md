# API Drops : spécification pour l'agent de développement (bloc 1)

Ce document est la commande complète. Il se suffit à lui-même : implémente exactement ce qui est décrit, ni plus ni moins.

---

## 0. Contexte et mission

**Le module.** R505, développement front avancé, BUT MMI 3e année, Département MMI de Montbéliard. Une dizaine d'élèves construisent une application Next.js qui **consomme** cette API. L'API est un **support pédagogique** : elle n'est pas un objet de cours, mais sa qualité conditionne toute la semaine.

**Le thème.** Les élèves déposent des **drops**, des messages géolocalisés dans la ville (un mot, une photo, une recommandation, une énigme), qu'on peut liker et commenter.

**Une seule instance partagée** par toute la classe, déployée, plus la possibilité de lancer le dépôt en local avec des données d'exemple.

**Ce que couvre ce document (bloc 1, du 16 au 18 novembre)** : santé, documentation, authentification, drops (lecture et écriture), likes, commentaires, profils, signalement, administration et outils pédagogiques.

**Hors périmètre (bloc 2, à partir du 23 novembre)** : WebSocket, recherche géographique, ouverture des drops à proximité, jeu de données pour Web Worker. Ne les implémente pas, mais respecte la section 14 pour qu'ils s'ajoutent sans casser le contrat.

### Échéances

| Priorité | Contenu | À livrer et déployer avant |
|---|---|---|
| **P0** | Squelette, format d'erreur, `?delay` et `?fail`, `/health`, `/docs`, `/openapi.json`, `/contract.md`, déploiement | **Lundi 16, 13h00** |
| **P1** | Auth, profils, lecture des drops et des commentaires, données d'exemple, limites de requêtes | **Mardi 17, 8h00** |
| **P2** | Écriture des drops, likes, commentaires, signalement, administration | **Mercredi 18, 8h00** |

Tout peut être livré en une fois. Si le temps manque, respecte cet ordre et déploie à la fin de chaque palier.

---

## 1. Règles pour l'agent

1. **Le contrat est figé.** Les chemins, les noms de champs, les codes HTTP et le format des erreurs décrits ici sont exactement ceux à implémenter. Les élèves écrivent leurs types à partir de ce contrat.
2. **Pas de fonctionnalité en plus.** Si quelque chose manque, choisis l'option la plus simple et note-la dans `DECISIONS.md` (une ligne par décision).
3. **Messages en français** pour tout ce que l'utilisateur final peut voir (`message` et `fields` des erreurs). Code, noms de champs et identifiants en anglais.
4. **Tests verts avant chaque déploiement** (section 12).
5. **La documentation OpenAPI est générée depuis le code** ou vérifiée par un test, pour qu'elle ne diverge jamais de l'implémentation.

---

## 2. Stack et exigences techniques

- **Node.js 22 LTS**, **TypeScript** en mode strict, **Express 5**.
- **SQLite** via `better-sqlite3`, requêtes préparées uniquement. Fichier défini par `DATABASE_PATH`.
- **Zod** pour la validation, et une seule source de vérité pour les schémas (génération OpenAPI depuis Zod recommandée, par exemple `@asteasolutions/zod-to-openapi`).
- **Auth** : `bcryptjs` (coût 10) et JWT HS256 (`jose` ou `jsonwebtoken`).
- **Middlewares** : `helmet`, `cors`, `express-rate-limit`, et une limite de corps JSON de 100 ko.
- **Documentation** : Swagger UI ou Scalar sur `/docs`.
- **Tests** : `vitest` et `supertest`, sur une base SQLite en mémoire.
- **Scripts npm** : `dev` (rechargement à chaud), `build`, `start`, `test`, `seed`, `smoke`.
- Un `Dockerfile` pour un déploiement portable.
- **Une seule instance** en production (SQLite, limites en mémoire et, au bloc 2, présence WebSocket). Pas de mise à l'échelle horizontale.
- `app.set('trust proxy', 1)` pour obtenir la bonne IP derrière le proxy de l'hébergeur.

### Structure suggérée

```
src/
  app.ts            # construction de l'app Express (testable sans écouter de port)
  server.ts         # démarrage HTTP (le WebSocket s'y branchera au bloc 2)
  config.ts         # lecture et validation des variables d'environnement
  db/               # connexion, schéma, migrations, seed
  middleware/       # auth, erreurs, simulation, rate limit, request id
  modules/
    auth/ users/ drops/ comments/ reports/ admin/ health/
  events.ts         # bus d'événements interne (voir section 14)
  openapi/          # registre et génération
tests/
scripts/smoke.ts
```

---

## 3. Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `4000` | Port HTTP (pas 3000, pris par Next en local ; en production, l'hébergeur impose sa valeur) |
| `DATABASE_PATH` | `./data/drops.db` | Fichier SQLite (en production : sur le volume persistant, par exemple `/data/drops.db`) |
| `JWT_SECRET` | aucun, **obligatoire** | Au moins 32 caractères, sinon l'app refuse de démarrer |
| `JWT_TTL_SECONDS` | `28800` (8 h) | Durée de vie d'un token |
| `ADMIN_KEY` | aucun, **obligatoire** | Clé de l'enseignant, en-tête `X-Admin-Key` |
| `ZONE_CENTER` | `47.495472,6.805279` | Centre de la zone autorisée : Département MMI de Montbéliard |
| `ZONE_RADIUS_M` | `3000` | Rayon de la zone autorisée, en mètres |
| `LOCK_MODE` | `off` | `off` au bloc 1. Voir la section 14. |
| `ENABLE_SIMULATION` | `true` | Active `?delay=` et `?fail=` |
| `REPORT_HIDE_THRESHOLD` | `3` | Nombre de signalements distincts qui masquent un drop |
| `RATE_LIMIT_READ_PER_MIN` | `600` | Lectures par minute et par clé |
| `RATE_LIMIT_WRITE_PER_MIN` | `60` | Écritures par minute et par utilisateur |
| `RATE_LIMIT_AUTH_PER_MIN` | `60` | Inscriptions et connexions par minute et par IP |
| `SEED_ON_EMPTY` | `true` | Charge les données d'exemple si la base est vide au démarrage |

Fournis un `.env.example` complet. `.env` est dans `.gitignore`.

---

## 4. Conventions

### Général
- JSON uniquement, `Content-Type: application/json; charset=utf-8`.
- Champs en **camelCase**.
- Dates en ISO 8601 UTC (`2026-11-16T09:12:00.000Z`).
- Identifiants : entiers auto-incrémentés. Un identifiant non numérique ou inexistant dans un chemin renvoie **404**.
- Corps de requête **stricts** : un champ inconnu renvoie **422** avec ce champ dans `fields` (« Champ inconnu. »). Cela attrape les champs inventés par l'IA.
- **Pas de conversion de type** : `lat: "47.49"` (une chaîne) renvoie 422 « Doit être un nombre. ». Les élèves qui envoient des `FormData` doivent convertir.
- Chaque réponse porte un en-tête `X-Request-Id`, aussi repris dans les erreurs.
- `Cache-Control: no-store` sur toutes les réponses : la mise en cache est l'affaire du front.
- **CORS** : `Access-Control-Allow-Origin: *`, méthodes `GET, POST, PATCH, DELETE, OPTIONS`, en-têtes `Authorization, Content-Type, X-Admin-Key`, sans credentials.

### Authentification
- En-tête `Authorization: Bearer <token>`. L'API ne pose **aucun cookie** : c'est Next qui stocke le token dans son propre cookie httpOnly.
- Sur une route protégée, l'absence de token renvoie **401**.
- **Un token présent mais invalide, expiré ou révoqué renvoie 401 sur toutes les routes, même publiques.** Les élèves doivent gérer la session expirée partout (grille C4).
- Les réponses 401 portent l'en-tête `WWW-Authenticate: Bearer`.

### Pagination
Paramètres `page` (défaut 1, au moins 1) et `pageSize` (défaut 20, de 1 à 50). Réponse :

```json
{ "items": [], "page": 1, "pageSize": 20, "total": 57, "totalPages": 3 }
```

Une page au-delà de la dernière renvoie 200 avec `items: []`.

### Format d'erreur unique

```json
{
  "error": {
    "status": 422,
    "code": "validation_failed",
    "message": "Le formulaire contient des erreurs.",
    "fields": {
      "title": ["Le titre doit faire au moins 3 caractères."],
      "location": ["Ce point est en dehors de la zone autorisée (3 km autour du département MMI)."]
    },
    "requestId": "req_8f2c1a",
    "simulated": false
  }
}
```

- `fields` est **toujours présent** (objet vide si l'erreur ne concerne pas de champ). Chaque clé est un nom de champ du corps ou un paramètre de requête, et sa valeur est un tableau de messages.
- `simulated` vaut `true` uniquement pour les erreurs provoquées par `?fail=`.
- Aucune trace de pile ni message interne dans les réponses, même en 500. Ils vont dans les logs.

### Codes d'erreur

| Statut | `code` | Quand |
|---|---|---|
| 400 | `bad_request` | JSON illisible |
| 401 | `unauthorized` | Token absent sur une route protégée |
| 401 | `invalid_token` | Token mal formé ou signature invalide |
| 401 | `token_expired` | Token expiré |
| 401 | `token_revoked` | Token révoqué par `/auth/logout` |
| 401 | `invalid_credentials` | Identifiant ou mot de passe incorrect |
| 403 | `forbidden` | Authentifié, mais pas autorisé (pas l'auteur, mauvaise clé admin) |
| 404 | `not_found` | Ressource ou route inexistante, ou drop masqué |
| 409 | `conflict` | Nom d'utilisateur ou e-mail déjà pris, avec `fields` renseigné |
| 422 | `validation_failed` | Corps ou paramètres invalides, avec `fields` renseigné |
| 429 | `rate_limited` | Trop de requêtes, avec l'en-tête `Retry-After` |
| 500 | `internal_error` | Erreur inattendue |
| 503 | `service_unavailable` | Base indisponible |

---

## 5. Outils pédagogiques

Ils servent à provoquer les états que l'IA oublie (chargement, erreur). Ils s'appliquent à **toutes les routes**, y compris `/health`, quand `ENABLE_SIMULATION=true`.

- **`?delay=<ms>`** (de 0 à 10 000) : attend avant de traiter la requête.
- **`?fail=<statut>`**, parmi `400, 401, 403, 404, 409, 422, 429, 500, 503` : la requête **n'est pas exécutée** et l'API renvoie une erreur réaliste, avec le même `code` que la vraie (`401` → `unauthorized`, `422` → `validation_failed`…), `simulated: true` et l'en-tête `X-Simulated: true`.
  - Pour `fail=422`, `fields` contient une entrée « Erreur simulée sur ce champ. » pour **chaque champ présent dans le corps**, ce qui permet de tester l'affichage sous chaque champ d'un formulaire. Sans corps, `fields` est vide.
  - Pour `fail=429`, ajoute `Retry-After: 5`.
- Les deux se combinent : `?delay=2000&fail=500`.
- Une valeur invalide (`?delay=abc`, `?fail=418`) renvoie un vrai 422 sur le paramètre concerné.
- **`POST /auth/login?ttl=<secondes>`** (de 10 à `JWT_TTL_SECONDS`) : émet un token de courte durée pour tester l'expiration de session.

---

## 6. Modèle de données

```
users
  id INTEGER PK
  username TEXT UNIQUE NOT NULL     -- minuscules
  email TEXT UNIQUE NOT NULL        -- minuscules
  password_hash TEXT NOT NULL
  display_name TEXT NOT NULL
  bio TEXT NULL
  avatar_url TEXT NULL
  is_seed INTEGER NOT NULL DEFAULT 0
  created_at TEXT NOT NULL

drops
  id INTEGER PK
  author_id INTEGER NOT NULL → users.id (ON DELETE CASCADE)
  title TEXT NOT NULL
  content TEXT NOT NULL
  category TEXT NOT NULL            -- note | photo | tip | riddle
  image_url TEXT NULL
  lat REAL NOT NULL
  lng REAL NOT NULL
  hidden INTEGER NOT NULL DEFAULT 0
  is_seed INTEGER NOT NULL DEFAULT 0
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL
  INDEX (lat, lng), INDEX (created_at), INDEX (author_id)

likes       (drop_id, user_id) PK, created_at
comments    id PK, drop_id, author_id, content, created_at
opens       (drop_id, user_id) PK, opened_at     -- créée maintenant, utilisée au bloc 2
reports     id PK, drop_id, user_id, reason, details NULL, created_at, UNIQUE (drop_id, user_id)
revoked_tokens  jti PK, expires_at               -- purge des entrées expirées au démarrage
```

Migrations simples et idempotentes au démarrage (`CREATE TABLE IF NOT EXISTS`, ou une table `schema_version`).

---

## 7. Objets renvoyés

### `PublicUser`, intégré dans les drops et les commentaires
```json
{ "id": 3, "username": "lea", "displayName": "Léa", "avatarUrl": null }
```

### `PrivateUser`, renvoyé par `/auth/*` uniquement
```json
{ "id": 3, "username": "lea", "email": "lea@example.com", "displayName": "Léa",
  "bio": null, "avatarUrl": null, "createdAt": "2026-11-16T08:00:00.000Z" }
```

### `Profile`, renvoyé par `GET /users/:username`
```json
{ "id": 3, "username": "lea", "displayName": "Léa", "bio": "…", "avatarUrl": null,
  "createdAt": "…", "stats": { "dropsCount": 6, "likesReceived": 14, "commentsCount": 9 } }
```

### `Drop`
```json
{
  "id": 42,
  "title": "Le banc le plus calme du coin",
  "content": "Derrière le bâtiment, à l'ombre. Idéal pour réviser.",
  "category": "tip",
  "imageUrl": null,
  "location": { "lat": 47.49561, "lng": 6.80544, "precision": "exact" },
  "locked": false,
  "hidden": false,
  "author": { "id": 3, "username": "lea", "displayName": "Léa", "avatarUrl": null },
  "likesCount": 4,
  "commentsCount": 2,
  "opensCount": 0,
  "likedByMe": false,
  "openedByMe": false,
  "isMine": false,
  "createdAt": "2026-11-16T09:12:00.000Z",
  "updatedAt": "2026-11-16T09:12:00.000Z"
}
```
- `likedByMe`, `openedByMe` et `isMine` valent `false` sans token.
- `isMine` sert à l'affichage. **L'autorisation reste vérifiée par l'API** (403).
- Au bloc 1, `locked` vaut toujours `false`, `precision` toujours `"exact"`, et `content` est toujours rempli. Le type doit déjà prévoir `content: string | null` et `imageUrl: string | null` (section 14).
- `hidden` vaut `true` seulement quand l'auteur consulte son propre drop masqué.

### `Comment`
```json
{ "id": 7, "dropId": 42, "content": "Validé !", "author": { "…": "PublicUser" },
  "isMine": false, "createdAt": "…" }
```

### `Category`
```json
{ "id": "tip", "label": "Une recommandation" }
```
Les quatre catégories : `note` (Un mot), `photo` (Une photo), `tip` (Une recommandation), `riddle` (Une énigme).

---

## 8. Endpoints

Légende : 🔓 public · 🔐 token requis · 🛡️ clé admin (`X-Admin-Key`).

### Santé et documentation (P0)

| Méthode | Chemin | Accès | Réponse |
|---|---|---|---|
| GET | `/` | 🔓 | `{ "name": "Drops API", "docs": "/docs", "openapi": "/openapi.json", "contract": "/contract.md", "health": "/health" }` |
| GET | `/health` | 🔓 | 200 : `{ "status": "ok", "service": "drops-api", "version": "1.0.0", "commit": "abc123" \| null, "time": "…", "uptimeSeconds": 1234, "db": "ok" }`. Si la base ne répond pas : 503 avec `status: "degraded"` et `db: "error"`. Pas de limite de requêtes. |
| GET | `/docs` | 🔓 | Interface de documentation interactive |
| GET | `/openapi.json` | 🔓 | Spécification OpenAPI 3.1 |
| GET | `/contract.md` | 🔓 | Résumé Markdown du contrat (section 11) |

### Authentification (P1)

**`POST /auth/register`** 🔓
- Corps : `{ "username", "email", "password", "displayName", "bio"? }`
- 201 : `{ "user": PrivateUser, "token": "…", "expiresAt": "…" }`
- 409 `conflict`, avec `fields.username` ou `fields.email` (« Ce nom d'utilisateur est déjà pris. »).
- 422 si invalide.

**`POST /auth/login`** 🔓, accepte `?ttl=`
- Corps : `{ "login", "password" }`. `login` est un e-mail **ou** un nom d'utilisateur.
- 200 : `{ "user": PrivateUser, "token": "…", "expiresAt": "…" }`
- 401 `invalid_credentials` (« Identifiant ou mot de passe incorrect. »), sans dire lequel des deux est faux.
- 422 si un champ manque.

**`POST /auth/logout`** 🔐 → 204. Révoque le token (son `jti`) : toute requête suivante avec ce token renvoie 401 `token_revoked`.

**`GET /auth/me`** 🔐 → 200 `PrivateUser`.

**`PATCH /auth/me`** 🔐
- Corps : au moins un champ parmi `{ "displayName", "bio", "avatarUrl" }` (`bio` et `avatarUrl` acceptent `null`).
- 200 `PrivateUser`, 422 si invalide.

Contenu du JWT : `sub` (id), `username`, `jti`, `iat`, `exp`.

### Utilisateurs (P1)

**`GET /users/:username`** 🔓 → 200 `Profile`, ou 404. Les drops d'un utilisateur s'obtiennent avec `GET /drops?author=<username>`.

### Catégories (P1)

**`GET /categories`** 🔓 → 200 `Category[]`.

### Drops : lecture (P1)

**`GET /drops`** 🔓 (token facultatif, pour `likedByMe` et `isMine`)

| Paramètre | Type | Règle |
|---|---|---|
| `page`, `pageSize` | entier | Voir la pagination |
| `q` | texte, 100 caractères max | Recherche insensible à la casse et aux accents si possible, dans le titre, le contenu et le nom d'utilisateur de l'auteur |
| `category` | `note\|photo\|tip\|riddle` | Filtre |
| `author` | nom d'utilisateur | Filtre (un nom inexistant donne une liste vide) |
| `sort` | `recent` (défaut) ou `popular` | `popular` = `likesCount` décroissant, puis du plus récent au plus ancien |

- 200 : page de `Drop`. Les drops masqués sont exclus.
- 422 sur un paramètre invalide (clé = nom du paramètre).

**`GET /drops/:id`** 🔓 → 200 `Drop`. 404 si inexistant, ou masqué pour quelqu'un d'autre que l'auteur.

**`GET /drops/:id/comments`** 🔓 → page de `Comment`, du plus ancien au plus récent. 404 si le drop n'existe pas.

### Drops : écriture (P2)

**`POST /drops`** 🔐
- Corps : `{ "title", "content", "category", "imageUrl"?, "lat", "lng" }`
- 201 `Drop`, avec l'en-tête `Location: /drops/:id`.
- 422 si invalide (section 9).

**`PATCH /drops/:id`** 🔐, auteur uniquement
- Corps : au moins un champ parmi ceux de la création. `lat` et `lng` vont ensemble.
- 200 `Drop` (`updatedAt` mis à jour).
- 403 `forbidden` si ce n'est pas l'auteur (« Seul l'auteur peut modifier ce drop. »), 404, 422.

**`DELETE /drops/:id`** 🔐 auteur, ou 🛡️ admin
- 204, supprime aussi les likes, commentaires, ouvertures et signalements associés.
- 403, 404.

**`POST /drops/:id/like`** 🔐 → 200 `{ "liked": true, "likesCount": 5 }`. Idempotent : liker deux fois ne compte qu'une fois. Liker son propre drop est autorisé.

**`DELETE /drops/:id/like`** 🔐 → 200 `{ "liked": false, "likesCount": 4 }`. Idempotent.

**`POST /drops/:id/comments`** 🔐
- Corps : `{ "content" }`
- 201 `Comment`, 404, 422.

**`DELETE /comments/:id`** 🔐, auteur du commentaire uniquement → 204, 403, 404.

**`POST /drops/:id/report`** 🔐
- Corps : `{ "reason": "spam" | "offensive" | "personal_info" | "other", "details"? }`
- 202 `{ "reported": true }`. Idempotent par utilisateur.
- Quand le nombre de signalements distincts atteint `REPORT_HIDE_THRESHOLD`, le drop passe en `hidden`.
- On ne peut pas signaler son propre drop (403).

### Administration (P2) 🛡️

Une clé absente ou fausse renvoie 403 `forbidden`.

**`POST /admin/reset`**
- Corps : `{ "confirm": "RESET", "mode": "all" | "keep-users" }`
  - `all` : vide la base et recharge les données d'exemple.
  - `keep-users` : garde les comptes créés par les élèves, supprime leurs drops, likes, commentaires et signalements, puis recharge les données d'exemple.
- 200 `{ "users": 12, "drops": 60, "comments": 85, "likes": 210 }`.

**`GET /admin/reports`** → la liste des drops signalés, avec leurs signalements.

**`POST /admin/drops/:id/unhide`** → 200 `Drop`, et remet ses signalements à zéro.

Les routes admin apparaissent dans la documentation sous le tag « Admin (enseignant) ».

### Route inconnue
Toute route inconnue renvoie 404 `not_found` au format d'erreur standard, jamais la page HTML par défaut d'Express.

---

## 9. Validation

Les chaînes sont « trimmées » avant validation. Les messages ci-dessous sont des exemples : garde ce ton, court et en français.

| Champ | Règle | Exemple de message |
|---|---|---|
| `username` | 3 à 20 caractères, `^[a-z0-9_]+$`, mis en minuscules ; `admin` et `me` sont réservés | « 3 à 20 caractères : lettres minuscules, chiffres ou _. » |
| `email` | Format valide, 254 caractères max, mis en minuscules | « Adresse e-mail invalide. » |
| `password` | 8 à 72 caractères | « Au moins 8 caractères. » |
| `displayName` | 1 à 40 caractères | « Entre 1 et 40 caractères. » |
| `bio` | 0 à 280 caractères, ou `null` | |
| `avatarUrl`, `imageUrl` | URL `https://`, 500 caractères max, ou `null` | « Doit être une adresse https://. » |
| `title` | 3 à 80 caractères | « Le titre doit faire au moins 3 caractères. » |
| `content` (drop) | 1 à 1000 caractères | |
| `content` (commentaire) | 1 à 500 caractères | |
| `category` | `note`, `photo`, `tip` ou `riddle` | « Catégorie inconnue. » |
| `imageUrl` si `category = photo` | **Obligatoire** (règle croisée) | « Une photo a besoin d'une image. » |
| `lat`, `lng` | Nombres, de −90 à 90 et de −180 à 180 | « Doit être un nombre. » |
| Position | À `ZONE_RADIUS_M` mètres au plus de `ZONE_CENTER` (distance de haversine) | Sous la clé **`location`** : « Ce point est en dehors de la zone autorisée (3 km autour du département MMI). » |
| `reason` | Liste fermée | |
| `details` | 0 à 300 caractères | |

**Toutes les erreurs de coordonnées utilisent la clé `location`** (type, bornes et zone), pour qu'un sélecteur de position sur carte n'ait qu'un seul endroit où afficher l'erreur. Plusieurs erreurs sur un même champ sont toutes renvoyées.

> **Révision** : la restriction de zone a été supprimée (voir `DECISIONS.md`). Le point peut être n'importe où ; seules les bornes de latitude et de longitude sont contrôlées. Le texte ci-dessous est conservé pour l'historique.

La restriction de zone est un **choix éthique** : elle empêche de déposer un drop près de son domicile, ce qui révélerait où l'on habite. Mentionne-le dans la documentation de `POST /drops`.

---

## 10. Sécurité, limites et données d'exemple

### Sécurité
- Ne jamais renvoyer `password_hash`. L'`email` n'apparaît que dans `PrivateUser`.
- Comparaison de la clé admin en temps constant.
- Logs d'une ligne par requête (méthode, chemin, statut, durée, id de requête, id utilisateur), **sans** corps ni token.

### Limites de requêtes
- **Attention** : toute la classe partage la même IP publique (le réseau de l'IUT), et les appels faits par Next sur Vercel partent des IP de Vercel. Une limite stricte par IP bloquerait toute la classe d'un coup.
- **Lectures** : clé = id utilisateur si un token est présent, sinon l'IP. `RATE_LIMIT_READ_PER_MIN`.
- **Écritures** (`POST`, `PATCH`, `DELETE`, hors auth) : par utilisateur. `RATE_LIMIT_WRITE_PER_MIN`.
- **`/auth/register` et `/auth/login`** : par IP. `RATE_LIMIT_AUTH_PER_MIN`.
- `/health` et `/docs` sans limite.
- En-têtes `RateLimit-*` standards, et 429 au format d'erreur avec `Retry-After`.

### Données d'exemple (`npm run seed`, et au démarrage si la base est vide)
- **Déterministes** : générateur pseudo-aléatoire à graine fixe, pour qu'un reset redonne toujours les mêmes données.
- **12 utilisateurs fictifs** aux prénoms variés. Tous ont le mot de passe **`drops2026`**, plus un compte **`demo` / `drops2026`**. Ces identifiants sont documentés : les élèves s'en servent pour tester le 403 avec un deuxième compte.
- **60 drops** : 70 % à moins de 800 m du centre (autour du département MMI), le reste dans la zone.
  - Environ 30 % de `note`, 20 % de `photo`, 30 % de `tip` et 20 % de `riddle`.
  - Les photos utilisent `https://picsum.photos/seed/drop-<n>/800/600`.
- **Contenus écrits à la main** (pas de lorem ipsum) : en français, courts, drôles ou utiles, adaptés à des étudiants. Aucune personne réelle, aucun commerce nommé (« la boulangerie à l'angle » plutôt qu'un nom). Les énigmes sont des devinettes simples.
- 0 à 8 likes et 0 à 4 commentaires par drop, et des dates étalées sur les 14 jours précédant le seed.
- Au moins **un utilisateur sans drop** et **un drop sans commentaire**, pour que les élèves testent les états vides.

### Sauvegarde
Au démarrage puis toutes les heures, copie de la base dans `<dossier de la base>/backups/` (API `db.backup()` de better-sqlite3). On garde les 24 dernières.

---

## 11. Documentation

- **OpenAPI 3.1** complète. Pour chaque route : description en français, schémas de requête et de réponse, **un exemple pour chaque réponse**, et **toutes les réponses d'erreur possibles**.
- Schéma de sécurité `bearerAuth`, et le paramètre `X-Admin-Key` sur les routes admin.
- Tags : Santé, Auth, Utilisateurs, Drops, Likes, Commentaires, Signalement, Admin (enseignant), Outils pédagogiques.
- Une section d'introduction qui explique le format d'erreur, `?delay`, `?fail`, `?ttl` et les comptes de démo.
- **`GET /contract.md`** : un résumé Markdown compact (environ 150 lignes max), généré ou maintenu à côté de l'OpenAPI. Les élèves l'intègrent à leur fichier d'agent, donc il doit être lisible par un humain comme par une IA. Il contient :
  - les objets avec leurs types TypeScript (`interface Drop { … }`) ;
  - la liste des routes avec leur accès et leurs codes de réponse ;
  - le format d'erreur et les codes ;
  - les outils pédagogiques.
- **`README.md`** du dépôt, en français :
  - lancer en local en 3 commandes ;
  - les variables d'environnement ;
  - les comptes de démo ;
  - comment faire un reset ;
  - comment déployer.

---

## 12. Tests et critères d'acceptation

### Tests automatisés (`npm test`), au minimum
- Format d'erreur sur 400, 401 (les quatre codes), 403, 404 (y compris route inconnue), 409, 422 et 429.
- Inscription, connexion par e-mail et par nom d'utilisateur, `me`, logout puis token révoqué, `?ttl=10` puis expiration (avec une horloge simulée).
- Liste des drops : pagination, `q`, `category`, `author`, `sort`, paramètres invalides, page vide.
- Création : cas valide, chaque règle de validation, règle croisée photo, hors zone sous `location`, chaîne au lieu d'un nombre, champ inconnu.
- 403 sur la modification ou la suppression du drop d'un autre, suppression admin.
- Likes idempotents, commentaires, suppression de commentaire.
- Signalement jusqu'au seuil, drop masqué (404 pour les autres, visible pour l'auteur), réactivation admin.
- `?delay` et `?fail`, y compris `fail=422` avec les champs du corps et des valeurs invalides.
- Seed déterministe : deux seeds donnent les mêmes données.
- Chaque route du code figure dans `/openapi.json`.

### Script de fumée (`npm run smoke -- https://url-deployee`)
Contre l'instance déployée :
1. `/health` ;
2. inscription d'un utilisateur aléatoire, connexion ;
3. création d'un drop, like, commentaire ;
4. connexion en `demo` et tentative de modification : 403 attendu ;
5. un 422, un `?fail=500`, un `?delay=500` ;
6. suppression du drop créé.

Le script affiche ✅ ou ❌ par étape, et un code de sortie non nul en cas d'échec.

### Correspondance avec la grille de validation des élèves

| Élément de la grille | Ce que l'API doit permettre |
|---|---|
| A4, page de statut | `/health` |
| B1, types | `/openapi.json` et `/contract.md` exacts |
| B3, liste et filtres | `page`, `pageSize`, `q`, `category`, `author`, `sort` |
| B4, détail et 404 | `GET /drops/:id` et 404 standard |
| B5, états | `?delay` et `?fail` sur toutes les routes |
| C1, D1, erreurs sous les champs | 422 avec `fields` précis, `fail=422` qui reprend les champs du corps |
| C2, C3, session | Token Bearer, pas de cookie côté API |
| C4, 401 | `?ttl=`, `token_expired`, `token_revoked`, 401 aussi sur les routes publiques |
| D2, états d'attente | `?delay` sur les `POST` |
| D3, 403 | Comptes de démo connus, 403 auteur |
| E1, `<distance-badge>` | `location` présent sur chaque drop |

---

## 13. Déploiement

### Exigences pour l'hébergeur
- **Pas de mise en veille** : une offre gratuite qui endort le service après inactivité donnerait 30 à 60 s d'attente au premier appel, en plein cours.
- **Volume persistant** pour SQLite (sinon chaque redéploiement efface les comptes des élèves).
- **Support WebSocket** dès maintenant, pour ne pas migrer au bloc 2.
- **HTTPS** et un nom de domaine stable.
- **Une seule instance.**

Railway (avec un volume) ou Render (offre payante avec disque) conviennent. Fly.io aussi.

### Étapes (exemple avec Railway)
1. Pousser le dépôt sur GitHub.
2. Créer un projet à partir du dépôt.
3. Ajouter un volume monté sur `/data`.
4. Définir les variables : `DATABASE_PATH=/data/drops.db`, `JWT_SECRET` (générer avec `openssl rand -base64 48`), `ADMIN_KEY`, puis les autres si besoin.
5. Déclarer `/health` comme chemin de vérification de santé.
6. Générer un domaine public.
7. Lancer `npm run smoke -- https://<domaine>` : tout doit être ✅.
8. Remettre à l'enseignant : l'URL de l'API, l'URL de `/docs`, l'URL du dépôt et les identifiants de démo. La clé admin passe par un canal privé.

### Ce qui est donné aux élèves
L'URL de l'API, `/docs`, `/contract.md`, les comptes de démo et le lien du dépôt (pour lancer l'API en local). **Jamais la clé admin.**

---

## 14. Bloc 2 : à préparer, pas à implémenter

Ces points font l'objet d'une spécification séparée avant le 23 novembre. D'ici là, l'architecture doit les rendre faciles à ajouter **sans changer le contrat du bloc 1**.

1. **Bus d'événements interne.** Chaque mutation émet un événement sur `src/events.ts` (`drop:created`, `drop:updated`, `drop:deleted`, `like:updated`, `comment:created`), avec l'objet concerné. Au bloc 1, personne n'écoute. Au bloc 2, le WebSocket s'y abonnera.
2. **`server.ts` crée le serveur HTTP explicitement** (`http.createServer(app)`), pour qu'un serveur WebSocket s'y attache sur `/ws`.
3. **`LOCK_MODE=on`** (bloc 2) : pour un utilisateur qui n'est ni l'auteur ni l'ouvreur, un drop renverra `locked: true`, `content: null`, `imageUrl: null`, une `location` arrondie à 3 décimales et `precision: "approx"`. La forme de l'objet est déjà celle du bloc 1, d'où `content: string | null`.
4. **La table `opens`** et les champs `opensCount` et `openedByMe` existent déjà (valeurs 0 et `false`).
5. **Les index sur `lat` et `lng`** existent déjà, pour les futurs `?near=lat,lng&radius=` et `?bbox=minLng,minLat,maxLng,maxLat`.
6. **À venir** : `POST /drops/:id/open` (vérification de distance qui tient compte de la précision GPS), `POST /realtime/ticket`, la présence, et `GET /dataset/points` sur des données ouvertes réelles.
7. **La position des élèves ne sera jamais diffusée** sur le WebSocket. N'ajoute aucun champ de position utilisateur.

---

## 15. Checklist de livraison

- [ ] Dépôt GitHub avec `README.md`, `.env.example`, `DECISIONS.md`, `Dockerfile`.
- [ ] `npm test` vert.
- [ ] Déployé, `npm run smoke` vert sur l'URL publique.
- [ ] `/docs`, `/openapi.json` et `/contract.md` en ligne et à jour.
- [ ] Données d'exemple chargées, comptes de démo fonctionnels.
- [ ] `POST /admin/reset` testé en production.
- [ ] Remis à l'enseignant : URL de l'API, URL de la doc, URL du dépôt, identifiants de démo, clé admin (en privé).
