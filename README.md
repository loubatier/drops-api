# Drops API

API de support pour le module R505 (BUT MMI 3, Montbéliard). Les élèves déposent des **drops** (messages géolocalisés) qu'on peut liker et commenter. Le contrat complet est dans `SPECS.md` (bloc 1) et `SPECS_V2.md` (bloc 2), la documentation interactive sur `/docs`.

## Lancer en local en 3 commandes

```bash
npm install
cp .env.example .env
npm run dev
```

L'API écoute sur http://localhost:4000 (`/docs`, `/health`, `/contract.md`).

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `4000` | Port HTTP |
| `DATABASE_PATH` | `./data/drops.db` | Fichier SQLite (production : `/data/drops.db`) |
| `JWT_SECRET` | obligatoire | 32 caractères minimum |
| `JWT_TTL_SECONDS` | `28800` | Durée de vie d'un token |
| `ADMIN_KEY` | obligatoire | Clé de l'enseignant (`X-Admin-Key`) |
| `ZONE_CENTER` | `47.495472,6.805279` | Centre de la zone autorisée |
| `ZONE_RADIUS_M` | `3000` | Rayon de la zone (mètres) |
| `LOCK_MODE` | `off` | Bloc 2 : `on` verrouille les drops (refusé si le bloc 2 est désactivé). Modifiable à chaud |
| `ENABLE_SIMULATION` | `true` | Active `?delay=` et `?fail=` |
| `REPORT_HIDE_THRESHOLD` | `3` | Signalements qui masquent un drop |
| `RATE_LIMIT_READ_PER_MIN` | `600` | Lectures par minute et par clé |
| `RATE_LIMIT_WRITE_PER_MIN` | `60` | Écritures par minute et par utilisateur |
| `RATE_LIMIT_AUTH_PER_MIN` | `60` | Inscriptions et connexions par minute et par IP |
| `SEED_ON_EMPTY` | `true` | Charge les données d'exemple si la base est vide |
| `BLOCK2_ENABLED` | `false` | Bloc 2 : active routes, paramètres et documentation. Modifiable à chaud |
| `OPEN_RADIUS_M` | `50` | Bloc 2 : rayon d'ouverture d'un drop |
| `OPEN_ACCURACY_CAP_M` | `50` | Bloc 2 : tolérance maximale accordée pour l'imprécision GPS |
| `RATE_LIMIT_OPEN_PER_MIN` | `30` | Bloc 2 : tentatives d'ouverture par minute et par utilisateur |
| `BBOX_MAX_PAGE_SIZE` | `200` | Bloc 2 : `pageSize` maximal avec `bbox` |
| `WS_TICKET_TTL_SECONDS` | `30` | Bloc 2 : durée de validité d'un ticket WebSocket |
| `WS_MAX_CONNECTIONS_PER_USER` | `5` | Bloc 2 : connexions WebSocket simultanées par utilisateur |
| `WS_MESSAGES_PER_10S` | `20` | Bloc 2 : messages client par connexion et par tranche de 10 s |
| `SIMULATOR_ENABLED` | `false` | Bloc 2 : démarre le simulateur au lancement (si le bloc 2 est activé) |
| `SIMULATOR_INTERVAL_SECONDS` | `20` | Bloc 2 : intervalle moyen entre deux actions simulées |

## Comptes de démo

Au premier démarrage sur une base vide, l'API charge 12 utilisateurs fictifs (`lea`, `yanis`, `camille`, `hugo`, `ines`, `noe`, `manon`, `lucas`, `sarah`, `tom`, `jade`, `zoe`) et un compte `demo`. Tous ont le mot de passe `drops2026`. Les e-mails sont de la forme `<nom>@example.com`. `zoe` n'a aucun drop, et un drop n'a aucun commentaire, pour tester les états vides. Connecte-toi avec `demo` et un autre compte pour tester le 403.

## Outils pour tester le front

- `?delay=<ms>` et `?fail=<statut>` sur toutes les routes, `POST /auth/login?ttl=<secondes>` pour une session courte.
- Le contrat résumé est servi sur `/contract.md`, à coller dans le fichier d'agent.

## Faire un reset

Avec la clé de l'enseignant (`ADMIN_KEY`) :

```bash
curl -X POST https://<domaine>/admin/reset \
  -H "X-Admin-Key: $ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"confirm":"RESET","mode":"keep-users"}'
```

`mode: "all"` vide tout (comptes compris) et recharge les données d'exemple ; `"keep-users"` garde les comptes des élèves et remet les drops, likes, commentaires et signalements à l'état d'exemple. Les drops signalés se consultent avec `GET /admin/reports` et se réactivent avec `POST /admin/drops/{id}/unhide`.

## Scripts

`npm run dev` (rechargement à chaud), `npm run build`, `npm start`, `npm test`, `npm run seed`, `npm run smoke -- <url>`, `ADMIN_KEY=… npm run smoke:block2 -- <url-de-staging>`, `npm run build-dataset` (voir le bloc 2).

## Déployer

Exemple avec Railway (voir aussi `SPECS.md`, section 13) :

1. Pousser le dépôt sur GitHub et créer un projet à partir du dépôt (le `Dockerfile` est détecté).
2. Ajouter un volume monté sur `/data`.
3. Définir `DATABASE_PATH=/data/drops.db`, `JWT_SECRET` (`openssl rand -base64 48`), `ADMIN_KEY`, puis les autres variables si besoin.
4. Déclarer `/health` comme chemin de vérification de santé et générer un domaine public.
5. Vérifier : `npm run smoke -- https://<domaine>` doit afficher uniquement des ✅.

Une seule instance (SQLite, limites en mémoire). L'image s'appuie sur `node:22-bookworm-slim` et s'exécute en root pour pouvoir écrire sur le volume monté par Railway.

## Bloc 2 : temps réel, géolocalisation, jeu de données

Le bloc 2 (`SPECS_V2.md`) est **additif et caché derrière un interrupteur** : tant que `block2Enabled` vaut `false`, ses routes répondent 404, ses paramètres sont ignorés et rien n'apparaît dans `/docs`, `/openapi.json` ni `/contract.md` (les agents IA des élèves ne le voient pas). Un test de contrat (`tests/contract/`) compare l'OpenAPI à celui du bloc 1.

### Workflow de staging

1. Développer sur une branche (`v2`, ou `block2` dans la spec) : **ne jamais pousser sur `main`**, chaque push sur `main` redéploie l'API utilisée en cours.
2. L'environnement `staging` de Railway (volume et domaine propres, `BLOCK2_ENABLED=true`) déploie cette branche. Pousser à la fin de chaque palier.
3. Avant de fusionner : `npm test` vert, puis `ADMIN_KEY=… npm run smoke:block2 -- https://<staging>` vert. Ce script crée deux comptes et des drops, puis restaure les réglages et supprime les drops. **Ne jamais le lancer contre la production pendant un cours** (il avertit si l'URL ne contient pas `staging`).
4. Fusionner dans `main` **le soir**, jamais pendant un cours (un redéploiement coupe l'API environ une minute). Vérifier que la production a toujours `block2Enabled=false` (`GET /admin/settings`) puis relancer `npm run smoke`.

### Activation à chaud

Les deux réglages sont stockés en base et priment sur les variables d'environnement. Aucun redéploiement :

```bash
# lire les réglages
curl https://<domaine>/admin/settings -H "X-Admin-Key: $ADMIN_KEY"
# lundi 8 h : activer le bloc 2
curl -X PATCH https://<domaine>/admin/settings -H "X-Admin-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" -d '{"block2Enabled":true}'
# mardi 8 h : verrouiller les drops (409 block2_disabled si le bloc 2 est désactivé)
curl -X PATCH https://<domaine>/admin/settings -H "X-Admin-Key: $ADMIN_KEY" \
  -H "Content-Type: application/json" -d '{"lockMode":"on"}'
```

`/admin/settings` fonctionne même bloc 2 désactivé, mais n'est documentée dans `/openapi.json` qu'une fois le bloc 2 activé. Désactiver le bloc 2 ferme les WebSocket (code 4002) et remet `lockMode` à `off`. Changer `lockMode` prévient tous les clients connectés (`settings:updated`).

### Outils de l'enseignant

- `GET /admin/realtime` : connexions par utilisateur (trié par nombre décroissant, pour repérer une application qui ouvre une socket à chaque rendu) et lecteurs par drop.
- `POST /admin/realtime/disconnect-all` : ferme tout avec le code 4011, pour tester la reconnexion.
- `POST /admin/simulator` avec `{"enabled":true,"intervalSeconds":20}` : lance le **simulateur**. Il agit au nom d'utilisateurs d'exemple (50 % likes, 30 % commentaires, 15 % ouvertures, 5 % créations de drops), passe par les mêmes services que l'API donc émet les mêmes événements WebSocket, n'écrit jamais sur les drops d'un élève (sauf likes et ouvertures) et disparaît avec `POST /admin/reset`. `{"enabled":false}` l'arrête. Il se lance aussi au démarrage avec `SIMULATOR_ENABLED=true`.

### Jeu de données

`GET /dataset/points` sert `data/points.json`, **commité** : le serveur ne télécharge rien au démarrage. Pour le reconstruire depuis data.gouv.fr (Licence Ouverte, ministère de la Culture) : `npm run build-dataset` (`-- --synthetic` pour le jeu de secours de 15 000 points). Les valeurs ne sont pas corrigées : les anomalies de la source sont celles que les élèves traitent dans le Worker (voir `DECISIONS.md`).

## Documentation

`/docs` (interface interactive), `/openapi.json` (OpenAPI 3.1, généré depuis le code), `/contract.md` (résumé pour les agents IA).
