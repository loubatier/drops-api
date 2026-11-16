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
