# Décisions

Une ligne par choix non couvert par la spécification.

## P0

- Documentation interactive : Swagger UI servi depuis le paquet `swagger-ui-dist` (sous `/docs/assets`), pas de CDN, pour fonctionner même si le réseau de la salle est lent.
- Les routes sont déclarées une seule fois (`defineRoute`) : le même objet monte la route Express, valide la requête avec Zod et alimente l'OpenAPI et `/contract.md`. Un test compare les routes Express aux chemins de `/openapi.json`.
- `/`, `/health`, `/docs`, `/openapi.json` et `/contract.md` figurent dans l'OpenAPI sous le tag « Santé ».
- Un corps JSON de plus de 100 ko renvoie 400 `bad_request` (la spec ne liste pas de 413).
- Un corps qui n'est pas un objet JSON (ou une valeur racine invalide) renvoie 422 avec la clé `body` dans `fields`.
- Les erreurs de validation de requête sont vérifiées après l'authentification et avant le handler : un non-auteur qui envoie un PATCH invalide reçoit 422 plutôt que 403.
- Les paramètres de chemin qui échouent à la validation (identifiant non numérique) renvoient 404 `not_found`.
- Les paramètres de requête inconnus sont ignorés ; seuls les corps sont stricts.
- `?delay` et `?fail` sont traités avant l'authentification et la limite de requêtes : une requête simulée ne consomme pas de quota.
- CORS : en plus des en-têtes demandés, `Access-Control-Expose-Headers` expose `X-Request-Id`, `X-Simulated`, `Retry-After`, `Location` et `RateLimit-*`, pour que le front puisse les lire.
- Helmet : CSP désactivée (API JSON, page Swagger avec script inline), `Cross-Origin-Resource-Policy: cross-origin`.
- Identifiant de requête : `req_` suivi de 8 caractères hexadécimaux.
- `commit` de `/health` : lu dans `COMMIT_SHA`, `RAILWAY_GIT_COMMIT_SHA` ou `SOURCE_VERSION` (7 premiers caractères), sinon `null`. `version` est la constante de `src/version.ts`.
- Les logs de requête sont coupés quand `NODE_ENV=test`.
- `npm start` et `npm run dev` chargent `.env` s'il existe (`--env-file-if-exists`) ; le conteneur utilise les variables de l'hébergeur.
- Les routes inexistantes avec `?fail` ou `?delay` sont aussi simulées, car la simulation s'applique à toutes les routes.
- Dockerfile : `node:22-bookworm-slim` en deux étapes (compilation avec les outils de build, image finale sans eux), conteneur exécuté en root pour le volume Railway.

## P1

- Un token présent est vérifié sur **toutes** les routes, y compris `/health`, `/docs` et les routes inconnues (la spec dit « toutes les routes »). L'hébergeur n'envoie pas de token, donc la vérification de santé n'est pas touchée.
- `sub` du JWT est l'identifiant en chaîne de caractères (la norme JWT l'impose). Le token est refusé (`invalid_token`) si l'utilisateur n'existe plus, par exemple après un reset `all`.
- Un en-tête `Authorization` qui n'est pas de la forme `Bearer <token>` renvoie 401 `invalid_token`.
- Le mot de passe n'est pas « trimmé » (les espaces peuvent faire partie d'un mot de passe) ; la limite de 72 s'applique aussi en octets, car bcrypt ignore le reste.
- `login` accepte l'e-mail ou le nom d'utilisateur sans tenir compte de la casse. Un compte inconnu coûte le même temps de calcul bcrypt qu'un mauvais mot de passe.
- Inscription : l'identifiant et l'e-mail sont aussi comparés en minuscules ; un e-mail déjà pris renvoie 409 avec `fields.email`, les deux champs sont signalés ensemble si besoin.
- `PATCH /auth/me` avec un corps vide renvoie 422 avec la clé `body`.
- Profil : `dropsCount` et `likesReceived` ne comptent que les drops visibles ; `commentsCount` est le nombre de commentaires **écrits** par l'utilisateur.
- `GET /users/{username}` est accessible avec ou sans token (token facultatif) ; `/users/me` et `/users/admin` renvoient 404 puisque ces noms sont réservés.
- `GET /categories` figure sous le tag « Drops » ; `POST /auth/login` porte aussi le tag « Outils pédagogiques » à cause de `?ttl`.
- Pagination : `totalPages` vaut 0 quand il n'y a aucun résultat.
- `q` : un `q` vide ou fait d'espaces est ignoré ; `%` et `_` sont traités comme du texte ; la comparaison ignore casse et accents grâce à une fonction SQL `fold` (normalisation Unicode NFD).
- `author` : un nom inconnu, ou un utilisateur sans drop, donne une liste vide (200).
- Un drop masqué rend aussi 404 sur `GET /drops/:id/comments` pour tout autre que l'auteur.
- Les routes ne signalent que les paramètres de requête connus ; `delay` et `fail` sont documentés sur chaque route dans l'OpenAPI.
- Limites de requêtes : compteurs en mémoire, fenêtre de 60 s, un compteur partagé par classe (lecture, écriture, auth). Écriture : l'authentification est vérifiée avant le compteur, donc un appel non authentifié (401) ne consomme rien. En-têtes `RateLimit-*` au format draft-6 (`RateLimit-Limit`, `-Remaining`, `-Reset`, `-Policy`).
- Seed : 12 utilisateurs fictifs **plus** `demo` (13 comptes), tous avec `drops2026` (un seul hash bcrypt calculé par exécution). `zoe` n'a aucun drop et le plus ancien drop n'a aucun commentaire.
- Seed : 60 drops répartis à parts égales entre 12 auteurs (5 chacun, `zoe` exclue), 42 à moins de 800 m du centre et 18 plus loin (jusqu'à 2,9 km), catégories 18/12/18/12. Les dates se calculent depuis l'instant du seed (14 jours en arrière) ; seule la date change d'un seed à l'autre, le reste est identique.
- Seed : les énigmes ne contiennent pas leur réponse ; les commentaires sont tirés d'une liste écrite à la main.
- `npm run seed` refuse de toucher une base non vide ; `npm run seed -- --reset` la vide d'abord.
- Reset `keep-users` (P2) conserve tous les comptes, y compris les comptes d'exemple, et remet à zéro les compteurs d'identifiants des drops et commentaires.
- Sauvegarde : au démarrage puis toutes les heures, fichier `backups/drops-<horodatage>.db` à côté de la base, 24 copies conservées. Désactivée pour une base en mémoire.
- `src/events.ts` expose un bus d'événements typé (aucun abonné au bloc 1).
