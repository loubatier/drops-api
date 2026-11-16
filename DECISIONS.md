# Décisions

Une ligne par choix non couvert par la spécification.

## P0

- Documentation interactive : Swagger UI servi depuis le paquet `swagger-ui-dist` (sous `/docs/assets`), pas de CDN, pour fonctionner même si le réseau de la salle est lent.
- Les routes sont déclarées une seule fois (`defineRoute`) : le même objet monte la route Express, valide la requête avec Zod et alimente l'OpenAPI et `/contract.md`. Un test compare les routes Express aux chemins de `/openapi.json`.
- `/`, `/health`, `/docs`, `/openapi.json` et `/contract.md` figurent dans l'OpenAPI sous le tag « Santé ».
- Un corps JSON de plus de 100 ko renvoie 400 `bad_request` (la spec ne liste pas de 413).
- Un corps qui n'est pas un objet JSON (ou une valeur racine invalide) renvoie 422 avec la clé `body` dans `fields`.
- Ordre des contrôles : authentification, identifiant (404), existence et droits (404 puis 403), puis validation (422). Un non-auteur qui envoie un PATCH invalide reçoit donc 403, pas 422.
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

## P2

- `DELETE /drops/{id}` accepte le token de l'auteur **ou** `X-Admin-Key`. Si `X-Admin-Key` est présent, il doit être correct (sinon 403), même si un token valide accompagne la requête. L'enseignant peut aussi supprimer un drop masqué.
- `DELETE /comments/{id}` reste réservé à l'auteur du commentaire : la clé admin seule donne 401.
- Liker, commenter ou signaler un drop masqué par d'autres renvoie 404 (le drop n'est pas visible pour eux) ; son auteur peut encore le liker, le commenter et le modifier.
- Un seul signalement par utilisateur et par drop : un second signalement renvoie 202 sans rien changer (le motif initial est conservé).
- Au seuil de signalements, le drop passe en `hidden` et l'événement `drop:updated` est émis.
- `POST /admin/drops/{id}/unhide` remet `hidden` à 0 et supprime tous les signalements du drop.
- `GET /admin/reports` renvoie un tableau (pas une page) de `{ drop, reports }`, le drop signalé le plus récemment en premier ; `hidden` y reflète l'état réel. Format libre dans la spec, choisi pour rester simple.
- Reset `all` : les comptes d'exemple retrouvent les mêmes identifiants, donc leurs anciens tokens restent valides (même id et même nom) ; les comptes d'élèves disparaissent et leurs tokens renvoient 401 `invalid_token`. Le token doit correspondre à l'id **et** au nom d'utilisateur.
- Reset : le JSON de réponse donne les effectifs après rechargement ; la confirmation exige exactement `"RESET"` et le mode est obligatoire.
- Les routes admin ne sont pas limitées en débit (une seule clé, usage enseignant).
- Création et modification : `imageUrl` accepte `null` ou l'absence pour les catégories autres que `photo` ; sur un PATCH, la règle « une photo a besoin d'une image » s'applique à l'état final (catégorie et image fusionnées avec l'existant).
- Bornes de latitude et de longitude : messages dédiés, rangés sous `location` avec les erreurs de type et de zone. Si seule `lat` ou `lng` est envoyée dans un PATCH, l'erreur `location` demande de les envoyer ensemble.
- Le message de zone calcule le rayon depuis `ZONE_RADIUS_M` (3000 m donne « 3 km »).
- Un commentaire ou un titre est « trimmé » avant le contrôle de longueur ; un texte fait uniquement d'espaces est refusé.
- Les événements du bus (`drop:created`, `drop:updated`, `drop:deleted`, `like:updated`, `comment:created`) sont émis après chaque mutation réussie ; `like:updated` seulement quand l'état change. Aucun événement pour la suppression d'un commentaire (non prévu par la spec).
- Script de fumée : l'utilisateur créé reste en base (pas d'endpoint de suppression de compte) ; un `POST /admin/reset` avec `keep-users` ou `all` s'en charge. Le script est aussi testé contre l'app dans `npm test`.
- Docker n'était pas disponible sur la machine de développement : l'image n'a pas été construite localement, seul le build TypeScript et le démarrage de `dist/server.js` ont été vérifiés.

## P3 (bloc 2, branche `v2`)

- La spec nomme la branche `block2` ; le travail est fait sur `v2`, sur demande explicite de l'enseignant. Rien n'est poussé sur `main`.
- Contradiction de la spec : `/admin/settings` devrait être « toujours documentée » (section 9) alors que l'OpenAPI doit rester strictement identique à la référence quand le bloc 2 est désactivé (section 1). Le test de contrat gagne : la route fonctionne toujours, mais elle n'apparaît dans `/openapi.json` qu'une fois le bloc 2 activé. Son usage est documenté dans le README.
- Le test de bloc 1 « chaque route Express figure dans /openapi.json » parcourt `app.locals.apiRouter`. Les routes du bloc 2 vivent donc dans deux autres routeurs (`app.locals.block2Routers`) : l'un toujours actif (`/admin/settings`), l'autre derrière un interrupteur qui laisse tomber dans le 404 standard quand le bloc 2 est désactivé. Aucun test du bloc 1 n'a été modifié.
- Les réglages (`block2Enabled`, `lockMode`) sont lus en base au démarrage puis tenus en mémoire (une seule instance). Une valeur stockée prime sur la variable d'environnement. Écrire un réglage fige les deux valeurs en base.
- `lockMode` effectif : toujours `off` tant que le bloc 2 est désactivé. Désactiver le bloc 2 remet `lockMode` à `off` en base. `LOCK_MODE=on` avec `BLOCK2_ENABLED=false` empêche le démarrage (« refusé si le bloc 2 est désactivé »).
- Le bus d'événements transmet la base d'origine en second argument (`events.emit(nom, payload, db)`), pour qu'un hub ne traite que les événements de sa propre base. Les payloads du bloc 1 sont inchangés. Deux événements ajoutés : `comment:deleted` et `drop:opened`. Le déverrouillage d'un drop (`/admin/drops/:id/unhide`) émet désormais `drop:updated`.
- Le hub WebSocket relit le drop en base pour **chaque destinataire** à chaque événement (même sérialisation que `GET /drops/:id`), sans jamais réutiliser l'objet de l'émetteur.
- Un drop qui passe en `hidden` est diffusé comme `drop:updated` à son auteur, et comme `drop:deleted` aux autres (pour qu'ils le retirent de leur liste). Quand il est réactivé, tout le monde reçoit `drop:updated`.
- Raison de fermeture WebSocket : l'identifiant de la colonne « Raison » de la spec (`session_expired`, `block2_disabled`…), pour que le client puisse l'aiguiller sans parser du texte.
- `presence:view` sur un drop inexistant ou masqué : message `error` avec `code: "not_found"` (la spec ne prévoit que `bad_message`).
- Handshake refusé : 401 `invalid_token` pour un ticket absent, expiré ou déjà utilisé ; 401 `token_expired` / `token_revoked` si le JWT d'origine ne vaut plus ; 404 `not_found` si le bloc 2 est désactivé ou si le chemin n'est pas `/ws`.
- `POST /realtime/ticket` compte dans la limite de **lecture** (et non d'écriture) : une application qui se reconnecte souvent ne doit pas épuiser son quota d'écritures. L'URL du ticket commence par `wss://` derrière HTTPS (proxy compris), `ws://` en local.
- Messages WebSocket limités à 8 ko ; au-delà, `ws` ferme la connexion.
- Présence : un utilisateur connecté plusieurs fois n'apparaît qu'une fois dans `presence:online` et `viewers`.
- Le simulateur n'a qu'un contrôleur d'état à ce stade (`POST /admin/simulator` et `GET /admin/settings` répondent) ; les actions simulées arrivent en P5.
- Le contrat `contract.md` du bloc 1 est aussi gardé en référence (`tests/contract/contract-block1.md`) : désactivé, il doit être identique à l'octet près.

## P4

- `GET /drops` : quand le bloc 2 est activé, le schéma des paramètres est élargi (`near`, `radius`, `bbox`, `sort=distance`, `pageSize` jusqu'à 200). Les règles croisées (exclusivité, `radius` sans `near`, `sort=distance` sans `near`, `pageSize` > 50 sans `bbox`) sont vérifiées après le schéma, dans `refineQuery`. Désactivé, le schéma du bloc 1 est utilisé tel quel : les paramètres du bloc 2 sont ignorés, `sort=distance` et `pageSize=51` renvoient les 422 du bloc 1.
- Seul un `sort` **explicite** à `recent` ou `popular` empêche le tri par distance par défaut avec `near`. `radius` n'a pas de défaut dans le schéma (sinon on ne pourrait pas détecter un `radius` sans `near`) ; le défaut de 1000 m est appliqué dans le code.
- Les erreurs de `near` et `bbox` (format, bornes, min > max) portent la clé du paramètre, un seul message par paramètre. Les nombres doivent s'écrire sans exposant (`47.4955`, pas `4.7e1`). `pageSize` trop grand renvoie 422 sur `pageSize` avec « Doit être un entier entre 1 et 50 » (ou la limite de `bbox`).
- Calcul : pré-filtre SQL par rectangle (marge de 0,0006° pour couvrir l'arrondi des drops verrouillés), puis haversine exacte dans le code sur la position **effective** (approchée pour un drop verrouillé, exacte sinon). Avec `near` ou `bbox`, filtrage, tri et pagination se font en mémoire sur les candidats du rectangle (au plus quelques milliers de lignes).
- Arrondi des drops verrouillés : `Math.round(valeur × 1000) / 1000`, une grille fixe de 0,001° (ni bruit, ni dépendance au temps). Le point de la grille est le plus proche, pas le coin.
- Verrouillage : un drop est verrouillé quand `lockMode` vaut `on` pour tout visiteur sans token, et pour tout utilisateur qui n'en est pas l'auteur et ne l'a pas ouvert. L'auteur et les ouvreurs voient la position exacte.
- `403 drop_locked` : likes (poser et retirer), lecture et écriture de commentaires. Signaler un drop verrouillé reste possible (la spec ne le liste pas). `DELETE /comments/:id` n'est pas concerné.
- `POST /drops/:id/open` : l'ordre des contrôles reste celui du bloc 1 (authentification, identifiant, existence puis 404 si masqué, puis validation 422, puis la règle de distance). `requiredM` vaut `OPEN_RADIUS_M` (sans la tolérance d'`accuracy`) et `distanceM` est arrondi à la dizaine la plus proche. Compteur de limite dédié `RATE_LIMIT_OPEN_PER_MIN`, par utilisateur.
- L'ouverture d'un drop ne dépend pas de `lockMode`. Un drop masqué renvoie 404 sauf à son auteur. La position envoyée n'est lue que pour calculer la distance : elle n'est ni copiée en base, ni dans les logs (le logger n'écrit que méthode, chemin, statut, durée), ni dans la réponse d'erreur.
- Limite connue de la spec : `too_far` donne la distance (à 10 m près) au point exact d'un drop, ce qui permet à qui sonde depuis plusieurs positions de retrouver un drop verrouillé. Elle est bornée par la limite de 30 tentatives par minute ; c'est le prix du message demandé.
- `GET /drops/:id/opens` : du plus récent au plus ancien (la spec ne fixe pas l'ordre), 404 si le drop est inconnu ou masqué, 403 pour tout autre que l'auteur.
- La doc ajoute, quand le bloc 2 est activé, une réponse 403 `drop_locked` aux likes et aux commentaires, `distanceM` (facultatif) dans `Drop`, `meta` (facultatif) dans `ErrorResponse`, et complète la description de `GET /drops`.
