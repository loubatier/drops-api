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

## Scripts

`npm run dev` (rechargement à chaud), `npm run build`, `npm start`, `npm test`, `npm run seed`, `npm run smoke -- <url>`.

## Déployer

Voir `SPECS.md`, section 13 (Railway, volume monté sur `/data`, `/health` comme chemin de santé). L'image Docker s'appuie sur `node:22-bookworm-slim`.
