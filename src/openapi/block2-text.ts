export const WS_TYPES = `interface Notification {
  kind: 'drop_opened' | 'drop_liked' | 'drop_commented';
  dropId: number; dropTitle: string; by: PublicUser; at: string;
}
type ClientMessage =
  | { type: 'presence:view'; data: { dropId: number } }
  | { type: 'presence:leave'; data: Record<string, never> }
  | { type: 'ping'; data: Record<string, never> };
type ServerMessage =
  | { type: 'hello'; data: { user: PublicUser; serverTime: string; lockMode: 'on' | 'off' } }
  | { type: 'pong'; data: { serverTime: string } }
  | { type: 'presence:online'; data: { users: PublicUser[] } }
  | { type: 'presence:drop'; data: { dropId: number; viewers: PublicUser[] } }
  | { type: 'drop:created' | 'drop:updated'; data: { drop: Drop } }
  | { type: 'drop:deleted'; data: { dropId: number } }
  | { type: 'drop:opened'; data: { dropId: number; opensCount: number } }
  | { type: 'like:updated'; data: { dropId: number; likesCount: number } }
  | { type: 'comment:created'; data: { comment: Comment } }
  | { type: 'comment:deleted'; data: { dropId: number; commentId: number } }
  | { type: 'notification'; data: Notification }
  | { type: 'settings:updated'; data: { lockMode: 'on' | 'off' } }
  | { type: 'error'; data: { code: string; message: string } };`;

export const WS_PROTOCOL = `**WebSocket** (OpenAPI ne décrit pas les WebSocket, le protocole est donc ici).

1. Côté serveur Next, \`POST /realtime/ticket\` avec le JWT : réponse \`{ ticket, expiresAt, url }\`. Le ticket est à usage unique et vaut 30 s. Le JWT ne passe **jamais** dans l'URL du WebSocket : le navigateur ne voit que le ticket.
2. Le navigateur ouvre \`url\` (\`wss://<domaine>/ws?ticket=wst_…\`). Sans ticket, avec un ticket expiré ou déjà utilisé : réponse HTTP 401 au format d'erreur standard pendant le handshake.
3. Le serveur envoie \`hello\`, puis les événements. Tous les messages sont du JSON \`{ "type": "…", "data": { … } }\`. Un message illisible ou de type inconnu reçoit un message \`error\`, sans fermer la connexion.

**Fermetures décidées par le serveur** (code, raison) :
- 4001 \`session_expired\` : le JWT d'origine a expiré ou a été révoqué (vérifié toutes les 30 s).
- 4002 \`block2_disabled\` : le bloc 2 a été désactivé.
- 4008 \`rate_limited\` : plus de 20 messages par tranche de 10 s.
- 4009 \`too_many_connections\` : plus de 5 connexions par utilisateur, la plus ancienne est fermée.
- 4010 \`server_restart\` : redémarrage du serveur, reconnectez-vous.
- 4011 \`admin_disconnect\` : déconnexion forcée par l'enseignant.

Le serveur envoie un ping de protocole toutes les 30 s ; le navigateur répond tout seul.

**Messages client → serveur** : \`presence:view\` (un seul drop regardé à la fois), \`presence:leave\`, \`ping\` (réponse \`pong\`).

**Chaque \`Drop\` et \`Comment\` diffusé est construit pour son destinataire** (\`isMine\`, \`likedByMe\`, \`openedByMe\`, verrouillage) : un événement ne fait jamais fuiter le contenu d'un drop verrouillé. Les drops masqués ne sont diffusés qu'à leur auteur. Quand un drop est masqué, les autres reçoivent \`drop:deleted\`.

**Notifications** : seul l'auteur du drop concerné les reçoit, jamais pour ses propres actions. \`drop_liked\` n'est envoyé que pour un like, pas pour un retrait.

**Éthique** : aucune position d'utilisateur ne transite par le WebSocket. La notification \`drop_opened\` révèle à l'auteur que quelqu'un se trouvait près de son drop à cet instant : c'est voulu, mais c'est un sujet de discussion pour le J5.

\`\`\`ts
${WS_TYPES}
\`\`\``;
