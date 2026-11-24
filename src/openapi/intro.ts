import { WS_PROTOCOL } from './block2-text.js';

export const TAGS = [
  { name: 'Santé', description: "État du service et accès à la documentation." },
  { name: 'Auth', description: 'Inscription, connexion, session.' },
  { name: 'Utilisateurs', description: 'Profils publics.' },
  { name: 'Drops', description: 'Lecture, création, modification et suppression des drops.' },
  { name: 'Likes', description: 'Liker, disliker et retirer sa réaction sur un drop. Like et dislike s\'excluent.' },
  { name: 'Commentaires', description: 'Commentaires des drops, réponses (un seul niveau), likes et dislikes de commentaires.' },
  { name: 'Signalement', description: 'Signalement des drops problématiques.' },
  { name: 'Admin (enseignant)', description: 'Routes réservées à la clé `X-Admin-Key`.' },
  {
    name: 'Outils pédagogiques',
    description:
      'Paramètres `?delay=`, `?fail=` (toutes les routes) et `?ttl=` (`POST /auth/login`). Voir l\'introduction.',
  },
];

export const INTRO = `
API de support pour le module R505 (BUT MMI, Montbéliard). Les élèves déposent des **drops** : des messages géolocalisés qu'on peut liker, disliker et commenter (avec des réponses).

## Conventions
- JSON uniquement, champs en camelCase, dates ISO 8601 UTC.
- Authentification : \`Authorization: Bearer <token>\`. L'API ne pose aucun cookie.
- Un token présent mais invalide, expiré ou révoqué renvoie **401 sur toutes les routes**, même publiques.
- Corps stricts : un champ inconnu renvoie 422, et les types ne sont pas convertis (\`"47.49"\` n'est pas un nombre).
- Chaque réponse porte \`X-Request-Id\` et \`Cache-Control: no-store\`.

## Format d'erreur
Toutes les erreurs ont la même forme. \`fields\` est toujours présent (objet vide hors erreur de champ), \`simulated\` vaut \`true\` pour les erreurs provoquées par \`?fail=\`.

\`\`\`json
{
  "error": {
    "status": 422,
    "code": "validation_failed",
    "message": "Le formulaire contient des erreurs.",
    "fields": { "title": ["Le titre doit faire au moins 3 caractères."] },
    "requestId": "req_8f2c1a3b",
    "simulated": false
  }
}
\`\`\`

Codes : \`bad_request\` (400), \`unauthorized\`, \`invalid_token\`, \`token_expired\`, \`token_revoked\`, \`invalid_credentials\` (401), \`forbidden\` (403), \`not_found\` (404), \`conflict\` (409), \`validation_failed\` (422), \`rate_limited\` (429), \`internal_error\` (500), \`service_unavailable\` (503).

## Outils pédagogiques
- \`?delay=<ms>\` (0 à 10000) : attend avant de traiter la requête.
- \`?fail=<statut>\` (400, 401, 403, 404, 409, 422, 429, 500, 503) : la requête n'est pas exécutée, l'API renvoie l'erreur correspondante avec \`simulated: true\` et l'en-tête \`X-Simulated: true\`. Avec \`fail=422\`, chaque champ du corps reçoit « Erreur simulée sur ce champ. ». Avec \`fail=429\`, \`Retry-After: 5\`.
- Les deux se combinent : \`?delay=2000&fail=500\`. Une valeur invalide renvoie un vrai 422.
- \`POST /auth/login?ttl=<secondes>\` (10 à la durée maximale) : token de courte durée pour tester l'expiration de session.

## Comptes de démo
Tous les comptes d'exemple ont le mot de passe \`drops2026\`. Utilisez \`mathis\` / \`drops2026\`, ou un autre prénom (par exemple \`noah\`), pour tester le 403 avec un deuxième compte.
`;

export const BLOCK2_TAGS = [
  { name: 'Temps réel', description: WS_PROTOCOL },
  { name: 'Géolocalisation', description: 'Recherche géographique et ouverture des drops à proximité.' },
  { name: 'Jeu de données', description: 'Jeu de données ouvert pour le travail dans un Web Worker.' },
];

export const BLOCK2_INTRO = `

## Bloc 2
Temps réel (WebSocket), recherche géographique, jeu de données. Tout est additif : rien du bloc 1 ne change.

Une page de démonstration du WebSocket, sans code à écrire, est servie sur [\`/ws-playground\`](/ws-playground). La documentation complète du WebSocket, avec un exemple Next.js, est sur [\`/ws-docs\`](/ws-docs).
`;
