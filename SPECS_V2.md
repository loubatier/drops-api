# API Drops : spécification pour l'agent de développement (bloc 2)

Suite de `SPEC.md` (bloc 1), déjà livré et en production. Ce document est la commande complète du bloc 2. Les règles du bloc 1 (section 1 de `SPEC.md`) restent valables : contrat exact, pas de fonctionnalité en plus, messages en français, `DECISIONS.md`, tests verts avant chaque déploiement.

---

## 0. Contexte, mission et échéances

**Le bloc 2 du module** (23 au 25 novembre) ajoute aux applications des élèves :
- le temps réel (J4, lundi 23) ;
- la géolocalisation, la carte et le Web Worker (J5, mardi 24).

L'API doit fournir tout cela **sans casser le bloc 1** : les élèves l'utilisent en production cette semaine, et leurs types TypeScript reposent sur le contrat du bloc 1.

### Principe : tout est additif et caché derrière un interrupteur

- Aucun chemin, champ, code ou comportement du bloc 1 ne change. On ne fait qu'**ajouter** : des routes, des paramètres facultatifs, des champs facultatifs, des codes d'erreur.
- Tant que `block2Enabled` vaut `false`, le bloc 2 est **invisible** : routes en 404, paramètres ignorés, **rien dans `/docs`, `/openapi.json` ni `/contract.md`**. C'est essentiel : les agents IA des élèves lisent le contrat, et ne doivent pas leur proposer le WebSocket avant le cours.

### Paliers

| Palier | Contenu | Échéance (en **staging**) |
|---|---|---|
| **P3** | Interrupteurs et réglages, test de contrat, temps réel (ticket, WebSocket, événements, présence, notifications) | Mercredi 18 au soir |
| **P4** | Recherche géographique, ouverture des drops, `lockMode` | Jeudi 19 au soir |
| **P5** | Jeu de données, simulateur, outils admin du temps réel, smoke test du bloc 2 | Vendredi 20 au soir |

Mise en production (merge dans `main`) : **au plus tard dimanche 22 au soir**, avec `block2Enabled=false`. L'enseignant active le bloc 2 lundi 23 à 8h, puis `lockMode` mardi 24 à 8h.

---

## 1. Méthode de travail (obligatoire)

1. **Branche `block2`.** Ne pousse **jamais** sur `main` pendant le développement : chaque push sur `main` redéploie l'API utilisée en cours.
2. **Environnement de staging.** L'enseignant crée sur Railway un environnement `staging` (copie de production avec son propre volume et son propre domaine), qui déploie la branche `block2` avec `BLOCK2_ENABLED=true`. Pousse sur `block2` à la fin de chaque palier.
3. **Test de contrat, à écrire en tout premier**, avant toute autre modification :
   - Sauvegarde l'OpenAPI actuel de `main` dans `tests/contract/openapi-block1.json`.
   - Avec `block2Enabled=false`, l'OpenAPI généré doit être **strictement identique** à cette référence.
   - Avec `block2Enabled=true`, chaque chemin, paramètre, schéma et code de réponse du bloc 1 doit être présent et inchangé. Seuls des ajouts facultatifs sont tolérés.
4. **Les tests du bloc 1 restent tous verts**, sans modification. Si un test du bloc 1 doit changer, c'est que le contrat casse : arrête-toi et note-le dans `DECISIONS.md`.
5. **Le merge dans `main`** se fait le soir, jamais pendant un cours (un redéploiement coupe l'API environ une minute).

---

## 2. Configuration et réglages modifiables à chaud

Les variables d'environnement donnent les **valeurs par défaut**. Deux réglages sont **modifiables sans redéploiement** par l'enseignant (section 9) et stockés dans une table `settings` :
- `block2Enabled`, initialisé par `BLOCK2_ENABLED` ;
- `lockMode`, initialisé par `LOCK_MODE`.

Une valeur stockée dans `settings` prime sur la variable d'environnement.

| Variable | Défaut | Rôle |
|---|---|---|
| `BLOCK2_ENABLED` | `false` | Active les routes, paramètres et la doc du bloc 2 |
| `LOCK_MODE` | `off` | `on` : drops verrouillés (section 6). Refusé si le bloc 2 est désactivé. |
| `OPEN_RADIUS_M` | `50` | Rayon d'ouverture d'un drop |
| `OPEN_ACCURACY_CAP_M` | `50` | Tolérance maximale accordée pour l'imprécision GPS |
| `RATE_LIMIT_OPEN_PER_MIN` | `30` | Tentatives d'ouverture par minute et par utilisateur |
| `BBOX_MAX_PAGE_SIZE` | `200` | `pageSize` maximal quand `bbox` est utilisé |
| `WS_TICKET_TTL_SECONDS` | `30` | Durée de validité d'un ticket WebSocket |
| `WS_MAX_CONNECTIONS_PER_USER` | `5` | Connexions simultanées autorisées par utilisateur |
| `WS_MESSAGES_PER_10S` | `20` | Messages client autorisés par connexion et par tranche de 10 s |
| `SIMULATOR_ENABLED` | `false` | Démarre le simulateur au lancement |
| `SIMULATOR_INTERVAL_SECONDS` | `20` | Intervalle moyen entre deux actions simulées |

Ajoute-les à `.env.example`.

**L'OpenAPI et `/contract.md` sont générés à la demande** (avec un cache invalidé à chaque changement de réglage), pour refléter immédiatement `block2Enabled`.

---

## 3. Ajouts au contrat

### Nouveaux champs (facultatifs, donc additifs)

- **`Drop.distanceM?: number`** : présent **uniquement** quand la requête utilise `near` (section 5). Entier en mètres.
- **`error.meta?: object`** : informations complémentaires sur certaines erreurs (`too_far`). Absent dans tous les cas du bloc 1.

### Nouveaux codes d'erreur

| Statut | `code` | Quand |
|---|---|---|
| 403 | `too_far` | Ouverture refusée : trop loin du drop |
| 403 | `drop_locked` | Action sur un drop verrouillé : liker, commenter, lire les commentaires |
| 409 | `block2_disabled` | Action admin qui exige le bloc 2 alors qu'il est désactivé |

### `contract.md`

Quand le bloc 2 est activé, `/contract.md` gagne une section « Bloc 2 » :
- les nouveaux paramètres et routes ;
- le protocole WebSocket, avec les types TypeScript des messages (section 4) ;
- les règles de verrouillage.

---

## 4. Temps réel (P3)

### Ticket

**`POST /realtime/ticket`** 🔐
- 201 : `{ "ticket": "wst_…", "expiresAt": "…", "url": "wss://<domaine>/ws?ticket=wst_…" }`
- Le ticket est aléatoire (au moins 128 bits), **à usage unique**, et valable `WS_TICKET_TTL_SECONDS`.
- Il retient l'id de l'utilisateur, le `jti` et l'expiration du JWT qui l'a demandé.
- `?delay` et `?fail` s'appliquent, comme sur toute route HTTP.

**Pourquoi un ticket** : le JWT ne passe jamais dans l'URL du WebSocket, qui finit souvent dans des logs. Seule la route Next côté serveur demande le ticket, le navigateur ne voit que lui. Explique-le dans la doc.

### Connexion

- **WebSocket sur le même serveur HTTP**, chemin `/ws`, avec la bibliothèque `ws`.
- La connexion **sans ticket**, avec un ticket expiré ou avec un ticket déjà utilisé est refusée **pendant le handshake** : réponse HTTP 401 au format d'erreur standard, pas de connexion ouverte.
- **Fermetures côté serveur**, avec un code et une raison en français :

| Code | Raison | Quand |
|---|---|---|
| 4001 | `session_expired` | Le JWT d'origine expire, ou il est révoqué par un logout. Vérification au moins toutes les 30 s. |
| 4002 | `block2_disabled` | Le bloc 2 est désactivé à chaud |
| 4008 | `rate_limited` | Plus de `WS_MESSAGES_PER_10S` messages |
| 4009 | `too_many_connections` | Plus de `WS_MAX_CONNECTIONS_PER_USER` connexions : on ferme **la plus ancienne** |
| 4010 | `server_restart` | Arrêt propre du serveur (SIGTERM) |
| 4011 | `admin_disconnect` | Déconnexion forcée par l'enseignant (section 9) |

- **Heartbeat** : le serveur envoie un ping de protocole toutes les 30 s et termine les connexions qui n'ont pas répondu au précédent.
- **Arrêt propre** : sur SIGTERM, fermer toutes les connexions avec 4010, puis arrêter le serveur HTTP.

La limite de 5 connexions est volontairement pédagogique : une application qui ouvre une socket à chaque re-rendu se fait couper, et l'enseignant le voit dans `/admin/realtime`.

### Format des messages

JSON uniquement, toujours de la forme `{ "type": "…", "data": { … } }`. Un message illisible ou de type inconnu reçoit un message `error`, sans fermer la connexion.

**Du client vers le serveur**

| `type` | `data` | Effet |
|---|---|---|
| `presence:view` | `{ "dropId": 42 }` | « Je regarde ce drop ». Un seul drop à la fois par connexion : remplace le précédent. |
| `presence:leave` | `{}` | Je ne regarde plus aucun drop |
| `ping` | `{}` | Le serveur répond `pong` |

**Du serveur vers le client**

| `type` | `data` | Destinataires |
|---|---|---|
| `hello` | `{ "user": PublicUser, "serverTime": "…", "lockMode": "off" }` | La connexion, juste après l'ouverture |
| `pong` | `{ "serverTime": "…" }` | La connexion qui a envoyé `ping` |
| `presence:online` | `{ "users": PublicUser[] }` | Tous, à chaque changement (regroupé sur 1 s au plus) |
| `presence:drop` | `{ "dropId": 42, "viewers": PublicUser[] }` | Tous, quand les lecteurs d'un drop changent (regroupé sur 1 s) |
| `drop:created` | `{ "drop": Drop }` | Tous |
| `drop:updated` | `{ "drop": Drop }` | Tous |
| `drop:deleted` | `{ "dropId": 42 }` | Tous |
| `drop:opened` | `{ "dropId": 42, "opensCount": 5 }` | Tous (sans dire qui) |
| `like:updated` | `{ "dropId": 42, "likesCount": 7 }` | Tous |
| `comment:created` | `{ "comment": Comment }` | Tous ceux qui ont le droit de voir les commentaires de ce drop |
| `comment:deleted` | `{ "dropId": 42, "commentId": 7 }` | Idem |
| `notification` | Voir ci-dessous | L'auteur du drop concerné uniquement |
| `settings:updated` | `{ "lockMode": "on" }` | Tous, quand l'enseignant change `lockMode` |
| `error` | `{ "code": "bad_message", "message": "…" }` | La connexion fautive |

**Notifications** (`data`) :
```json
{ "kind": "drop_opened" | "drop_liked" | "drop_commented",
  "dropId": 42, "dropTitle": "…", "by": PublicUser, "at": "…" }
```
Pas de notification pour ses propres actions. `drop_liked` n'est envoyé que pour un like, pas pour un retrait.

### Règle essentielle : sérialisation par destinataire

Un `Drop` ou un `Comment` diffusé est **construit pour chaque destinataire** avec les mêmes règles que `GET /drops/:id` : `isMine`, `likedByMe`, `openedByMe` et surtout le **verrouillage** (section 6). Un événement ne doit **jamais** faire fuiter le contenu d'un drop verrouillé. Pour une dizaine de connexions, le coût est négligeable.

Les drops masqués par la modération ne sont diffusés qu'à leur auteur.

### Types TypeScript à publier dans `contract.md`

```ts
type ClientMessage =
  | { type: "presence:view"; data: { dropId: number } }
  | { type: "presence:leave"; data: Record<string, never> }
  | { type: "ping"; data: Record<string, never> };

type ServerMessage =
  | { type: "hello"; data: { user: PublicUser; serverTime: string; lockMode: "on" | "off" } }
  | { type: "pong"; data: { serverTime: string } }
  | { type: "presence:online"; data: { users: PublicUser[] } }
  | { type: "presence:drop"; data: { dropId: number; viewers: PublicUser[] } }
  | { type: "drop:created" | "drop:updated"; data: { drop: Drop } }
  | { type: "drop:deleted"; data: { dropId: number } }
  | { type: "drop:opened"; data: { dropId: number; opensCount: number } }
  | { type: "like:updated"; data: { dropId: number; likesCount: number } }
  | { type: "comment:created"; data: { comment: Comment } }
  | { type: "comment:deleted"; data: { dropId: number; commentId: number } }
  | { type: "notification"; data: Notification }
  | { type: "settings:updated"; data: { lockMode: "on" | "off" } }
  | { type: "error"; data: { code: string; message: string } };
```

### Éthique

- **Aucune position d'utilisateur ne transite jamais** par le WebSocket : ni latitude, ni longitude, ni distance à un utilisateur.
- La notification `drop_opened` révèle à l'auteur que quelqu'un se trouvait près de son drop à cet instant. C'est voulu (fonctionnalité du plan), mais c'est un **sujet de discussion pour le J5**. Signale-le dans la doc de la notification.

---

## 5. Recherche géographique (P4)

Deux nouveaux paramètres de `GET /drops`, **mutuellement exclusifs** (les deux ensemble : 422 sur `near` et `bbox`).

### `near` et `radius`
- `near=lat,lng` (deux nombres séparés par une virgule) et `radius` en mètres (entier de 1 à 5000, défaut 1000).
- Ne renvoie que les drops situés à `radius` mètres au plus, et ajoute `distanceM` à chacun.
- Nouvelle valeur `sort=distance`, valide **uniquement** avec `near` (sinon 422 sur `sort`). Quand `near` est présent et `sort` absent, le tri par défaut devient `distance`.
- `radius` sans `near` : 422 sur `radius`.

### `bbox`
- `bbox=minLng,minLat,maxLng,maxLat`, **ordre GeoJSON : longitude d'abord**. Écris-le en gras dans la doc : c'est un piège classique avec Leaflet, qui utilise `[lat, lng]`.
- 422 sur `bbox` si le format est faux, si les valeurs sont hors bornes, ou si min > max.
- Avec `bbox`, `pageSize` peut monter jusqu'à `BBOX_MAX_PAGE_SIZE` (200).

### Règles communes
- Tous les autres paramètres (`q`, `category`, `author`, pagination) se combinent avec ces filtres.
- Calcul : un pré-filtre par rectangle en SQL (grâce à l'index sur `lat` et `lng`), puis une distance de haversine exacte dans le code.
- **Pour un drop verrouillé, tous les calculs** (filtre `near`, filtre `bbox`, `distanceM`) **utilisent sa position approchée** (section 6). Sinon, on retrouverait sa position exacte avec des requêtes sur de minuscules zones.
- Bloc 2 désactivé : `near`, `radius` et `bbox` sont **ignorés**, comme des paramètres inconnus, exactement comme au bloc 1.

---

## 6. Ouverture et verrouillage (P4)

### `POST /drops/:id/open` 🔐

- Corps : `{ "lat": number, "lng": number, "accuracy"?: number }`
  - `accuracy` en mètres, de 0 à 10 000, défaut 0 : c'est `coords.accuracy` de l'API Geolocation.
  - Validation stricte, comme au bloc 1 : les erreurs de coordonnées vont sous la clé `location`.
- **Règle** : on accepte si la distance entre la position envoyée et la position **exacte** du drop est au plus de `OPEN_RADIUS_M + min(accuracy, OPEN_ACCURACY_CAP_M)`.
- **Succès** : 200 `Drop`, déverrouillé pour cet utilisateur.
  - Enregistre `(drop_id, user_id, opened_at)` si ce n'est pas déjà fait.
  - Émet `drop:opened` et la notification `drop_opened` **seulement à la première ouverture**.
  - Rouvrir un drop déjà ouvert renvoie 200 sans nouvel événement.
  - L'auteur qui ouvre son propre drop reçoit 200, sans enregistrement ni événement.
- **Trop loin** : 403 `too_far`, avec le message « Vous êtes à 230 m de ce drop. Approchez-vous à moins de 50 m. » et `meta: { "distanceM": 230, "requiredM": 50 }`. `distanceM` est arrondi à la dizaine.
- 404 si le drop n'existe pas ou est masqué.
- Limite : `RATE_LIMIT_OPEN_PER_MIN` tentatives par minute et par utilisateur.
- **La position envoyée n'est ni stockée, ni journalisée, ni diffusée.** On ne garde que le fait d'avoir ouvert. Dis-le dans la doc.
- **Fonctionne aussi quand `lockMode` vaut `off`** : les élèves peuvent construire le parcours d'ouverture avant l'activation du verrouillage.

Rappel pédagogique à mettre dans la doc : la position est **déclarée par le client** et se simule en un clic dans les DevTools. La vérification serveur garantit que la règle est appliquée, pas que la position est vraie.

### `GET /drops/:id/opens` 🔐, auteur du drop uniquement
- 200 : `{ "items": [{ "user": PublicUser, "openedAt": "…" }], "page": 1, "pageSize": 20, "total": 3, "totalPages": 1 }`
- 403 pour toute autre personne.
- C'est le statut « ouvert par… » du plan.

### Comportement quand `lockMode` vaut `on`

Un drop est **verrouillé** pour un utilisateur qui n'en est pas l'auteur et ne l'a pas ouvert (et toujours pour un visiteur sans token). Pour un drop verrouillé :

| Élément | Valeur |
|---|---|
| `locked` | `true` |
| `content`, `imageUrl` | `null` |
| `location` | Arrondie à 3 décimales (environ 110 m × 75 m à Montbéliard), avec `precision: "approx"` |
| `title`, `category`, `author`, compteurs, dates | Visibles |
| `GET /drops/:id/comments`, commentaires, likes | 403 `drop_locked` (« Ouvrez ce drop pour voir et réagir. ») |
| Recherche `q` | Ne cherche que dans le titre et l'auteur, jamais dans le contenu caché |

- L'arrondi est **déterministe** (une grille fixe), et non un bruit aléatoire qu'on pourrait moyenner sur plusieurs requêtes.
- Quand `lockMode` vaut `off`, rien ne change par rapport au bloc 1.
- Basculer `lockMode` émet `settings:updated` à tous les clients connectés.

---

## 7. Jeu de données pour le Web Worker (P5)

### Source

Le jeu de données du ministère de la Culture « Les bibliothèques des collectivités territoriales : adresses et données d'activité », sur data.culture.gouv.fr (identifiant `adresses-des-bibliotheques-publiques`, sous Licence Ouverte). Environ 15 000 bibliothèques en France.

### Préparation, faite une seule fois et versionnée

- Un script `scripts/build-dataset.ts` télécharge l'export complet (API d'export JSON ou CSV de la plateforme), puis produit `data/points.json`, **commité** dans le dépôt. Le serveur ne télécharge rien au démarrage.
- **Champs gardés et renommés** : `id`, `name`, `city`, `postcode`, `department`, `lat`, `lng`.
- **Ne corrige rien.** Garde les valeurs telles que la source les donne : coordonnées manquantes, nulles, en chaîne, inversées, hors de France. Ce désordre est le sujet du travail des élèves dans le Worker.
  - Recense les anomalies réelles dans `DECISIONS.md` et dans la doc de la route.
  - Si la source est trop propre (moins de 1 % d'anomalies), ajoute environ 1 % d'anomalies variées, **marquées dans la doc comme ajoutées**.
- **Si le téléchargement échoue**, génère un jeu synthétique déterministe de 15 000 points répartis en France, avec les mêmes champs et environ 2 % d'anomalies, et indique-le clairement dans la doc et dans `source`.

### `GET /dataset/points` 🔓

```json
{
  "source": { "name": "…", "url": "…", "license": "Licence Ouverte / Open Licence", "retrievedAt": "…", "synthetic": false },
  "count": 15234,
  "points": [ { "id": "…", "name": "…", "city": "…", "postcode": "…", "department": "…", "lat": 47.51, "lng": 6.79 } ]
}
```

- **Pas de pagination** : recevoir le jeu complet fait partie de l'exercice.
- `?format=geojson` renvoie une `FeatureCollection` (ordre `[lng, lat]`) qui ne contient **que les points valides**, avec un membre `skipped` donnant le nombre de points écartés.
- Compression gzip (middleware `compression`).
- **Exception** à la règle `no-store` : `Cache-Control: public, max-age=86400`, puisque les données ne changent pas.
- `?delay` et `?fail` s'appliquent.

---

## 8. Simulateur (P5)

Il permet à un élève qui travaille seul de voir des événements en direct.

- Quand il est actif, il exécute une action à intervalle aléatoire autour de `SIMULATOR_INTERVAL_SECONDS` (± 50 %), **au nom d'un utilisateur d'exemple tiré au hasard** :
  - 50 % : like ou retrait de like ;
  - 30 % : commentaire, tiré d'une liste d'au moins 30 phrases courtes, en français et variées ;
  - 15 % : ouverture d'un drop (sans position, directement par le service) ;
  - 5 % : création d'un drop dans la zone autour du département MMI.
- **Il passe par les mêmes services que l'API**, donc les mêmes événements partent sur le WebSocket.
- Tout ce qu'il crée est marqué `is_seed`, et disparaît donc avec `POST /admin/reset`.
- Il n'agit **jamais sur les drops d'un élève**, sauf pour les likes et les ouvertures, afin que les notifications arrivent aussi chez les élèves.

---

## 9. Administration (P3 à P5) 🛡️

| Méthode | Chemin | Corps | Effet |
|---|---|---|---|
| GET | `/admin/settings` | | `{ "block2Enabled", "lockMode", "simulator": { "enabled", "intervalSeconds" } }` |
| PATCH | `/admin/settings` | `{ "block2Enabled"?, "lockMode"? }` | Change les réglages à chaud. `lockMode: "on"` avec le bloc 2 désactivé : 409 `block2_disabled`. |
| GET | `/admin/realtime` | | `{ "connections": 23, "byUser": [{ "user": PublicUser, "connections": 4 }], "viewers": [{ "dropId": 42, "count": 2 }] }`, trié par nombre de connexions décroissant |
| POST | `/admin/realtime/disconnect-all` | | Ferme toutes les connexions avec le code 4011. L'enseignant s'en sert en cours pour tester la reconnexion des applications. |
| POST | `/admin/simulator` | `{ "enabled": true, "intervalSeconds"?: 20 }` | Démarre ou arrête le simulateur |

Ces routes n'apparaissent dans la doc que si le bloc 2 est activé, sauf `/admin/settings`, toujours documentée.

---

## 10. Tests et critères d'acceptation

### Tests automatisés, en plus de ceux du bloc 1 (qui restent inchangés)

- **Contrat** : snapshot strictement identique avec le bloc 2 désactivé, et sur-ensemble avec le bloc 2 activé (section 1).
- **Bloc 2 désactivé** : nouvelles routes en 404, `near` et `bbox` ignorés, `/ws` refuse le handshake.
- **Ticket** : usage unique, expiration, refus au handshake.
- **WebSocket**, avec deux clients :
  - `hello` ;
  - un drop créé par A arrive chez B ;
  - la présence en ligne et par drop ;
  - les notifications reçues uniquement par l'auteur ;
  - fermeture 4001 après expiration du JWT (horloge simulée) et après logout ;
  - fermeture 4009 de la plus ancienne connexion au-delà de 5 ;
  - fermeture 4008 en cas de rafale de messages ;
  - message invalide : `error` sans fermeture.
- **Sérialisation par destinataire** : avec `lockMode` à `on`, un drop créé par A arrive verrouillé chez B (`content: null`) et complet chez A.
- **Géo** : `near` (filtre, `distanceM`, tri par défaut), `radius` seul, `sort=distance` sans `near`, `bbox` (ordre, bornes, min > max), `near` et `bbox` ensemble, `pageSize` jusqu'à 200 avec `bbox`.
- **Ouverture** : dans le rayon, dans le rayon grâce à `accuracy`, `accuracy` plafonnée, trop loin avec `meta`, première ouverture contre réouverture (événements), auteur, et position absente de la base et des logs.
- **Verrouillage** : chaque ligne du tableau de la section 6, y compris `q` qui n'interroge plus le contenu et les filtres géographiques sur la position approchée.
- **Jeu de données** : forme, `format=geojson` sans point invalide, en-têtes de cache.
- **Simulateur** : une action produit l'événement attendu, et le reset efface ce qu'il a créé.

### Smoke test du bloc 2 (`npm run smoke:block2 -- <url>`, avec `ADMIN_KEY` en variable d'environnement)

1. Lire les réglages, activer le bloc 2 si besoin (et noter l'état initial pour le restaurer).
2. Deux comptes, deux connexions WebSocket. A crée un drop, B le reçoit.
3. `near` et `bbox` renvoient ce drop.
4. B ouvre de près (200), puis tente de loin sur un autre drop (403 `too_far`).
5. Passer `lockMode` à `on` : B reçoit `settings:updated`, et un drop non ouvert apparaît verrouillé.
6. `/dataset/points` contient plus de 1 000 points.
7. Restaurer les réglages initiaux et supprimer ce qui a été créé.

Le script ne doit **jamais** être lancé contre la production pendant un cours. Il affiche un avertissement si l'URL ne contient pas `staging`.

---

## 11. Documentation

Quand le bloc 2 est activé :
- **OpenAPI** : nouveaux tags « Temps réel », « Géolocalisation » et « Jeu de données ». Le protocole WebSocket est décrit dans la description du tag « Temps réel », puisque OpenAPI ne décrit pas les WebSockets.
- **`contract.md`** : section « Bloc 2 » (section 3).
- **`README.md`** : le workflow de staging, l'activation à chaud (exemples `curl` de `PATCH /admin/settings`) et le simulateur.

---

## 12. Déploiement

### Préparé par l'enseignant
- Environnement `staging` sur Railway, avec son volume, son domaine, et `BLOCK2_ENABLED=true`, branché sur la branche `block2`.
- Si ce n'est pas encore fait, déplacer la production en région **EU West** avant le 23 : la latence compte pour le temps réel.

### Mise en production
1. Tous les tests sont verts, et le smoke test du bloc 2 est vert sur staging.
2. Merge de `block2` dans `main`, **le soir**.
3. Vérifier que la production a toujours `block2Enabled=false` (`GET /admin/settings`), puis relancer `npm run smoke` (bloc 1) sur la production.
4. **Lundi 23, 8h** : `PATCH /admin/settings { "block2Enabled": true }`.
5. **Mardi 24, 8h** : `PATCH /admin/settings { "lockMode": "on" }`.

---

## 13. Checklist de livraison

- [ ] Test de contrat écrit avant toute modification, et vert.
- [ ] Tests du bloc 1 inchangés et verts, tests du bloc 2 verts.
- [ ] Staging à jour, `smoke:block2` vert.
- [ ] `data/points.json` commité, anomalies documentées.
- [ ] Doc, `contract.md` et `README.md` à jour.
- [ ] `DECISIONS.md` à jour.
- [ ] Merge dans `main` fait un soir, production vérifiée avec le bloc 2 désactivé.
