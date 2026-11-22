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
- `GET /users/{username}` exige un token (voir « Accès » ci-dessous) ; `/users/me` et `/users/admin` renvoient 404 puisque ces noms sont réservés.
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

## P5

- Source du jeu de données : le jeu « Les bibliothèques des collectivités territoriales : adresses et données d'activité » du ministère de la Culture, retrouvé par son identifiant data.gouv.fr (`5c3538da9ce2e7459c6d765a`) car l'ancien domaine `data.culture.gouv.fr` redirige maintenant vers une page HTML et plus vers l'API d'export. Le script lit l'export JSON de la ressource principale (repli sur l'URL de l'export du 27/08/2025) : 15 704 établissements.
- Anomalies réelles de la source, relevées par le script et reprises dans la doc de la route : **166 points sans coordonnées** (`lat` et `lng` valent `null`, 1,06 %), **15 538 points dont les coordonnées sont des chaînes** (`"46.769255"`) au lieu de nombres, 1 sans code postal, 14 sans département. Aucune coordonnée inversée, nulle ou hors du monde. Quelques points sont en Nouvelle-Calédonie : valides, mais loin de la métropole.
- Comme la source dépasse déjà 1 % d'anomalies (les nulls seuls font 1,06 %), **aucune anomalie n'a été ajoutée** : `source.synthetic` vaut `false`. Le jeu synthétique de secours (15 000 points déterministes, environ 2 % d'anomalies variées) existe dans le script (`--synthetic`, ou automatiquement si le téléchargement échoue) mais n'est pas celui commité.
- `lat` et `lng` sont gardés tels que la source les donne : chaînes, `null`. Un point est « valide » pour `?format=geojson` s'il a deux coordonnées convertibles en nombres, dans les bornes WGS84 et différentes de (0, 0) ; les chaînes numériques sont converties et acceptées. Les 166 points sans coordonnées sont écartés (`skipped`).
- `?format=geojson` ajoute un membre `source` (attribution de la licence) à côté de `skipped`. `?format` inconnu : 422 sur `format`.
- Compression : le middleware `compression` ne couvre que `/dataset/points` (le reste de l'API reste non compressé, comme au bloc 1). `Cache-Control: public, max-age=86400` remplace `no-store` sur la réponse 200 seulement : les erreurs (`?fail`) gardent `no-store`.
- `data/points.json` est commité (exception dans `.gitignore` et `.dockerignore`) et copié dans l'image par le `Dockerfile`.
- Simulateur : une action tirée au sort parmi like (50 %), commentaire (30 %), ouverture (15 %), création (5 %) ; si l'action tirée ne trouve pas de cible, il se rabat sur un like. Les commentaires ne visent que des drops d'utilisateurs d'exemple. Un like ou un commentaire respecte le verrouillage : l'acteur doit être l'auteur du drop ou l'avoir ouvert. Une ouverture ignore la distance (« directement par le service »). Les créations tombent dans un rayon de 2,5 km autour du centre de la zone, marquées `is_seed = 1`. Les likes, commentaires et ouvertures n'ont pas de colonne `is_seed` : ils disparaissent avec `POST /admin/reset`, qui vide ces tables entières.
- Le simulateur s'arrête tout seul quand le bloc 2 est désactivé à chaud. `SIMULATOR_ENABLED=true` ne le démarre qu'au lancement du serveur, si le bloc 2 est activé. Les services partagés (`src/services.ts` : création de drop, like, commentaire ; `recordOpen` pour l'ouverture) servent à la fois l'API et le simulateur.
- Le simulateur agit aussi au nom des comptes d'exemple (`mathis`, `noah`, etc.) : un élève connecté en `mathis` verra donc des likes arriver sur « ses » drops.
- `POST /admin/simulator` : `intervalSeconds` de 1 à 3600, corps strict. Il renvoie l'état `{ enabled, intervalSeconds }`.
- `smoke:block2` : lit les réglages, active le bloc 2 si besoin, coupe `lockMode` pour la durée du test, puis restaure `block2Enabled` et `lockMode` d'origine et supprime les drops créés. Les deux comptes de fumée restent en base (pas d'endpoint de suppression de compte) : un `POST /admin/reset` avec `keep-users` ou `all` s'en charge. Le script avertit (sans bloquer) si l'URL ne contient pas `staging`. Il utilise `ws://` ou `wss://` selon le schéma de l'URL, sans lire l'URL renvoyée par le ticket.
- Le test du script de fumée passe contre une instance locale : il vérifie 7 ✅ et la restauration des réglages.

## Accès et comptes d'exemple (révision)

- Toutes les lectures exigent désormais un token : `GET /drops`, `/drops/{id}`, `/drops/{id}/comments`, `/users/{username}`, `/categories` et `/dataset/points`. Sans token : 401 `unauthorized`. Restent publics : `/health`, `POST /auth/register`, `POST /auth/login` et la documentation. Le mode d'accès « token facultatif » n'est plus utilisé par aucune route.
- Cette révision modifie le contrat du bloc 1 (`security`, réponse 401 de `/categories`, quelques phrases) : les références `tests/contract/*` ont été régénérées en conséquence.
- Comptes d'exemple : `mathis`, `noah`, `ethan`, `paul`, `paolo`, `nicolas`, `ugo`, `bryan`, `tom` (mot de passe `drops2026`, e-mail `<nom>@example.com`). Un seul drop par compte, aucun like ni commentaire au départ.
- Les tests de lecture et de temps réel utilisent l'ancien jeu riche (13 comptes, 60 drops) comme fixture dans `tests/fixtures/` ; les `GET` de ces clients de test envoient un token par défaut. Le vrai jeu est couvert par `tests/seed.test.ts`.

## J4 : temps réel et présence (branche `j4-realtime`)

Source : `spec-api-drops-temps-reel-J4.md`. T0 (P3 à P5) était déjà livré.

- **Code d'erreur renommé** : `presence:view` sur un drop inexistant ou masqué renvoie désormais `drop_not_found` (« Ce drop n'existe pas. »), plus `not_found` (décision P3). La spec J4 §3.6 le demande ; l'assertion de `tests/realtime.test.ts` a été mise à jour, c'est la seule modification d'un test existant pour ce motif. Le message de `bad_message` devient « dropId doit être un entier positif. ».
- **Modifications de tests existants imposées par la spec** : `simulator.presence` s'ajoute à `GET /admin/settings` et à la réponse de `POST /admin/simulator` (trois assertions `toEqual`), et le test du script de fumée compte 9 ✅ au lieu de 7 (deux étapes ajoutées).
- **Instantané** : envoyé seulement à la connexion qui a émis `presence:view`, hors regroupement. La diffusion d'une seconde atteint toutes les connexions (celle qui vient d'arriver reçoit donc aussi la liste mise à jour) et n'a lieu que si la liste diffère de la dernière diffusée pour ce drop. Un deuxième onglet qui ne change pas la liste ne déclenche donc aucune diffusion.
- **Ordre** : l'ordre d'arrivée est tenu par drop (liste d'identifiants). Un utilisateur garde sa place tant qu'au moins une de ses connexions regarde le drop ; s'il part puis revient, il est en queue. `online` reste trié par identifiant (la spec ne fixe pas d'ordre).
- **Fermeture = départ** : déjà le cas dans le hub (événement `close` du socket, qui couvre fermeture normale, coupure, heartbeat expiré et codes 4001 à 4011) ; des tests couvrent maintenant les trois premiers cas.
- **Présence simulée** : les simulés sont des présences sans socket dans le hub (`realtime.simulated`), comptées comme des connexions pour `online`, `viewers` et l'ordre, et jamais comme de vraies connexions dans `connections`, `byUser` et `viewers` de `/admin/realtime`. Si un compte simulé est aussi connecté pour de vrai, il n'apparaît qu'une fois ; son départ simulé ne le retire pas tant que sa vraie connexion reste.
- Tirage des 3 simulés : au hasard parmi les comptes d'exemple (`is_seed = 1`) autres que `demo`, à chaque démarrage de la présence. Un simulé qui regarde déjà un drop n'est pas retiré pour en regarder un autre : on tire parmi les simulés inactifs, et rien ne se passe si tous regardent. « Drop visible » : non masqué, sans condition de verrouillage (regarder un drop verrouillé est un usage prévu).
- `POST /admin/simulator` sans `presence` remet `presence` à `true` (c'est la valeur par défaut, pas une valeur mémorisée). Désactiver le bloc 2 arrête le simulateur donc fait partir les simulés. `POST /admin/reset` ne les touche pas.
- **Page `/ws-playground`** : routes Express montées directement sur l'application (donc hors du routeur documenté et de `/openapi.json`), derrière `block2Enabled`, avec leur propre en-tête CSP (`helmet` garde sa CSP désactivée pour le reste de l'API). Le HTML et le JS sont des constantes TypeScript (`src/playground/page.ts`) : rien à copier dans l'image Docker. Le script est servi sur `/ws-playground.js` (404 aussi quand le bloc 2 est désactivé). Un navigateur ne donne pas le statut du handshake : après « Réutiliser le dernier ticket », la page affiche le code 1006 et renvoie à l'onglet Réseau pour voir le 401. `style-src 'unsafe-inline'` est nécessaire pour la feuille de style intégrée à la page.
- **Branche** : développé sur `j4-realtime`, rien n'est poussé sur `main`.
- **`/ws-docs`** (ajout hors spec J4, demandé par l'enseignant) : documentation du WebSocket pour les élèves, en Markdown servi en `text/plain` pour s'afficher dans le navigateur (un `text/markdown` serait téléchargé). Même règle que la page de démonstration : routes Express montées directement sur l'application, 404 tant que le bloc 2 est désactivé, absente de `/openapi.json`. Les étapes de la présence et les types viennent des mêmes constantes que `/contract.md` (`PRESENCE_STEPS`, `WS_TYPES`), pour qu'ils ne divergent pas. Exemple Next.js seulement (App Router), indicatif ; un test vérifie que son code est du TypeScript valide et que chaque type de message est documenté.
- **Correction du contrat** : `/contract.md` affichait le texte `${WS_TYPES}` au lieu des types (antislash en trop dans `src/contract.ts`, antérieur à J4). Corrigé, avec un test.
