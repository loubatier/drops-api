export const WS_TYPES = `interface Notification {
  kind: 'drop_liked' | 'drop_commented';
  dropId: number; dropTitle: string; by: PublicUser; at: string;
}
type ClientMessage =
  | { type: 'presence:view'; data: { dropId: number } }
  | { type: 'presence:leave'; data: Record<string, never> }
  | { type: 'ping'; data: Record<string, never> };
type ServerMessage =
  | { type: 'hello'; data: { user: PublicUser; serverTime: string; online: PublicUser[] } }
  | { type: 'pong'; data: { serverTime: string } }
  | { type: 'presence:online'; data: { users: PublicUser[] } }
  | { type: 'presence:drop'; data: { dropId: number; viewers: PublicUser[] } }
  | { type: 'drop:created' | 'drop:updated'; data: { drop: Drop } }
  | { type: 'drop:deleted'; data: { dropId: number } }
  | { type: 'like:updated'; data: { dropId: number; likesCount: number; dislikesCount: number } }
  | { type: 'comment:created' | 'comment:updated'; data: { comment: Comment } }
  | { type: 'comment:deleted'; data: { dropId: number; commentId: number } }
  | { type: 'notification'; data: Notification }
  | { type: 'error'; data: { code: 'bad_message' | 'drop_not_found'; message: string } };`;

export const WS_PROTOCOL = `**WebSocket** (OpenAPI ne décrit pas les WebSocket, le protocole est donc ici).

1. Côté serveur Next, \`POST /realtime/ticket\` avec le JWT : réponse \`{ ticket, expiresAt, url }\`. Le ticket est à usage unique et vaut 30 s. Le JWT ne passe **jamais** dans l'URL du WebSocket : le navigateur ne voit que le ticket.
2. Le navigateur ouvre \`url\` (\`wss://<domaine>/ws?ticket=wst_…\`). Sans ticket, avec un ticket expiré ou déjà utilisé : réponse HTTP 401 au format d'erreur standard pendant le handshake.
3. Le serveur envoie \`hello\`, puis les événements. Tous les messages sont du JSON \`{ "type": "…", "data": { … } }\`. Un message illisible ou de type inconnu reçoit un message \`error\`, sans fermer la connexion.

**Fermetures décidées par le serveur** (code, raison) :
- 4001 \`session_expired\` : le JWT d'origine a expiré ou a été révoqué (vérifié toutes les 30 s).
- 4008 \`rate_limited\` : plus de 20 messages par tranche de 10 s.
- 4009 \`too_many_connections\` : plus de 5 connexions par utilisateur, la plus ancienne est fermée.
- 4010 \`server_restart\` : redémarrage du serveur, reconnectez-vous.
- 4011 \`admin_disconnect\` : déconnexion forcée par l'enseignant.

Le serveur envoie un ping de protocole toutes les 30 s ; le navigateur répond tout seul.

**Présence** (un lecteur, c'est un utilisateur) :
- Après un \`presence:view\` valide, le serveur répond **tout de suite** à cette connexion par un \`presence:drop\` avec la liste actuelle des lecteurs du drop, soi-même inclus, même si la liste n'a pas changé. Les autres connexions reçoivent \`presence:drop\` au plus une fois par seconde, et seulement si la liste a changé.
- \`hello.data.online\` donne les utilisateurs connectés à l'ouverture, soi-même inclus. Reconnaissez-vous avec \`hello.data.user.id\`.
- \`viewers\` et \`online\` sont dédoublonnés par utilisateur : deux onglets sur le même drop font un seul lecteur, qui reste lecteur tant qu'un onglet le regarde.
- \`viewers\` est dans l'ordre d'arrivée sur le drop, du plus ancien au plus récent, stable.
- Une fermeture de connexion, quelle qu'en soit la cause (fermeture normale, coupure réseau, heartbeat sans réponse, codes 4001 à 4011), vaut \`presence:leave\`.
- \`presence:view\` : \`dropId\` absent, non entier ou ≤ 0 → \`error\` \`bad_message\` ; drop inexistant ou masqué → \`error\` \`drop_not_found\`, et le drop regardé avant reste regardé .
- \`presence:view\` compte dans la limite de 20 messages par 10 s : un client qui l'envoie en boucle est fermé en 4008.

Documentation complète avec un exemple Next.js : [/ws-docs](/ws-docs). Pour tester seul, ouvrez [/ws-playground](/ws-playground) (client de démonstration) ; si l'enseignant a activé le simulateur, des utilisateurs simulés viennent regarder vos drops.

**Messages client → serveur** : \`presence:view\` (un seul drop regardé à la fois), \`presence:leave\`, \`ping\` (réponse \`pong\`).

**Chaque \`Drop\` et \`Comment\` diffusé est construit pour son destinataire** (\`isMine\`, \`likedByMe\`, \`dislikedByMe\`). Les drops masqués ne sont diffusés qu'à leur auteur. Quand un drop est masqué, les autres reçoivent \`drop:deleted\`.

**Notifications** : seul l'auteur du drop concerné les reçoit, jamais pour ses propres actions. \`drop_liked\` n'est envoyé que pour un like, pas pour un retrait.

**Éthique** : aucune position d'utilisateur ne transite par le WebSocket.

\`\`\`ts
${WS_TYPES}
\`\`\``;

export const PRESENCE_STEPS = `1. Côté serveur de l'application (jamais dans le navigateur) : \`POST /realtime/ticket\` avec \`Authorization: Bearer <token>\`. Réponse : \`{ ticket, expiresAt, url }\`.
2. Côté navigateur : ouvrir \`url\`. Un nouveau ticket est nécessaire à chaque reconnexion.
3. Recevoir \`hello\` : \`user\` (soi-même) et \`online\` (utilisateurs connectés, soi-même inclus).
4. En arrivant sur la page d'un drop : envoyer \`presence:view { dropId }\`, puis recevoir tout de suite \`presence:drop\` avec la liste actuelle (soi-même inclus). Les changements suivants arrivent par d'autres \`presence:drop\` (au plus un par seconde et par drop).
5. En quittant la page : envoyer \`presence:leave\`. Fermer la connexion vaut un départ.
6. \`viewers\` et \`online\` sont dédoublonnés par utilisateur ; \`viewers\` est dans l'ordre d'arrivée. \`error\` : \`bad_message\` (\`dropId\` invalide) ou \`drop_not_found\` (drop inexistant ou masqué).
7. Codes de fermeture : 4001 \`session_expired\` → se reconnecter à la page de connexion ; 4008 \`rate_limited\` → corriger le code (messages en boucle) ; 4009 \`too_many_connections\` → une seule connexion par onglet ; 4010 \`server_restart\` et 4011 \`admin_disconnect\` → nouveau ticket puis reconnexion avec délai croissant.
8. Pour tester : \`/ws-playground\`, et le simulateur si l'enseignant l'a activé (utilisateurs simulés en ligne qui viennent regarder les drops).`;
