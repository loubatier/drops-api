# Drops API

API de support pour le module R505 (BUT MMI 3, Montbéliard). Les élèves déposent des **drops** (messages géolocalisés) qu'on peut liker et commenter. Le contrat complet est dans `SPECS.md`, la documentation interactive sur `/docs`.

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
| `LOCK_MODE` | `off` | Réservé au bloc 2 |
| `ENABLE_SIMULATION` | `true` | Active `?delay=` et `?fail=` |
| `REPORT_HIDE_THRESHOLD` | `3` | Signalements qui masquent un drop |
| `RATE_LIMIT_READ_PER_MIN` | `600` | Lectures par minute et par clé |
| `RATE_LIMIT_WRITE_PER_MIN` | `60` | Écritures par minute et par utilisateur |
| `RATE_LIMIT_AUTH_PER_MIN` | `60` | Inscriptions et connexions par minute et par IP |
| `SEED_ON_EMPTY` | `true` | Charge les données d'exemple si la base est vide |

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

`npm run dev` (rechargement à chaud), `npm run build`, `npm start`, `npm test`, `npm run seed`, `npm run smoke -- <url>`.

## Déployer

Exemple avec Railway (voir aussi `SPECS.md`, section 13) :

1. Pousser le dépôt sur GitHub et créer un projet à partir du dépôt (le `Dockerfile` est détecté).
2. Ajouter un volume monté sur `/data`.
3. Définir `DATABASE_PATH=/data/drops.db`, `JWT_SECRET` (`openssl rand -base64 48`), `ADMIN_KEY`, puis les autres variables si besoin.
4. Déclarer `/health` comme chemin de vérification de santé et générer un domaine public.
5. Vérifier : `npm run smoke -- https://<domaine>` doit afficher uniquement des ✅.

Une seule instance (SQLite, limites en mémoire). L'image s'appuie sur `node:22-bookworm-slim` et s'exécute en root pour pouvoir écrire sur le volume monté par Railway.

## Documentation

`/docs` (interface interactive), `/openapi.json` (OpenAPI 3.1, généré depuis le code), `/contract.md` (résumé pour les agents IA).
