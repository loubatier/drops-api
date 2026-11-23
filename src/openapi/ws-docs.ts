import { PRESENCE_STEPS, WS_TYPES } from './block2-text.js';

export const NEXT_TICKET_ROUTE = `import { NextResponse } from 'next/server';
import { getToken } from '@/lib/session';

export async function POST() {
  const token = await getToken();
  if (!token) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const res = await fetch(process.env.DROPS_API_URL + '/realtime/ticket', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) return NextResponse.json(data, { status: res.status });
  return NextResponse.json({ url: data.url });
}`;

export const NEXT_REALTIME_CLIENT = `type Listener = (data: any) => void;

const NO_RECONNECT = [4001, 4008, 4009];
const CLOSE_DELAY_MS = 1000;

const listeners = new Map<string, Set<Listener>>();
const openListeners = new Set<() => void>();

let socket: WebSocket | null = null;
let connecting = false;
let consumers = 0;
let attempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleReconnect() {
  attempt += 1;
  reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** attempt, 15000));
}

async function connect() {
  reconnectTimer = undefined;
  if (socket || connecting || consumers === 0) return;
  connecting = true;
  try {
    const res = await fetch('/api/realtime/ticket', { method: 'POST' });
    if (!res.ok) return;
    const { url } = await res.json();
    if (consumers === 0 || socket) return;
    open(url);
  } catch {
    if (consumers > 0) scheduleReconnect();
  } finally {
    connecting = false;
  }
}

function open(url: string) {
  const ws = new WebSocket(url);
  socket = ws;
  ws.onopen = () => {
    attempt = 0;
    openListeners.forEach((listener) => listener());
  };
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    listeners.get(message.type)?.forEach((listener) => listener(message.data));
  };
  ws.onclose = (event) => {
    if (socket === ws) socket = null;
    if (consumers === 0 || NO_RECONNECT.includes(event.code)) return;
    scheduleReconnect();
  };
}

function disconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  socket?.close(1000);
  socket = null;
}

export function retain() {
  clearTimeout(closeTimer);
  consumers += 1;
  if (!socket && !connecting && !reconnectTimer) connect();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    consumers -= 1;
    if (consumers === 0) closeTimer = setTimeout(disconnect, CLOSE_DELAY_MS);
  };
}

export function subscribe(type: string, listener: Listener) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type)!.add(listener);
  return () => {
    listeners.get(type)?.delete(listener);
  };
}

export function onOpen(listener: () => void) {
  openListeners.add(listener);
  if (socket?.readyState === WebSocket.OPEN) listener();
  return () => {
    openListeners.delete(listener);
  };
}

export function send(type: string, data: object = {}) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type, data }));
}`;

export const NEXT_EVENT_HOOK = `'use client';

import { useEffect, useRef } from 'react';
import { retain, subscribe } from '@/lib/realtime';

export function useRealtimeEvent<T>(type: string, handler: (data: T) => void) {
  const latest = useRef(handler);

  useEffect(() => {
    latest.current = handler;
  });

  useEffect(() => {
    const release = retain();
    const unsubscribe = subscribe(type, (data) => latest.current(data));
    return () => {
      unsubscribe();
      release();
    };
  }, [type]);
}`;

export const NEXT_PRESENCE_HOOK = `'use client';

import { useEffect, useState } from 'react';
import { onOpen, retain, send, subscribe } from '@/lib/realtime';

type Viewer = { id: number; username: string; displayName: string; avatarUrl: string | null };

export function usePresence(dropId: number) {
  const [viewers, setViewers] = useState<Viewer[]>([]);

  useEffect(() => {
    setViewers([]);
    const release = retain();
    const stopOpen = onOpen(() => send('presence:view', { dropId }));
    const stopDrop = subscribe('presence:drop', (data) => {
      if (data.dropId === dropId) setViewers(data.viewers);
    });
    return () => {
      stopDrop();
      stopOpen();
      send('presence:leave');
      release();
    };
  }, [dropId]);

  return viewers;
}`;

export const NEXT_PRESENCE_WIDGET = `'use client';

import { usePresence } from '@/hooks/use-presence';

export function Viewers({ dropId }: { dropId: number }) {
  const viewers = usePresence(dropId);
  return (
    <p>
      {viewers.length === 0
        ? 'Personne ne regarde ce drop.'
        : viewers.map((v) => v.displayName).join(', ') + ' regarde ce drop.'}
    </p>
  );
}`;

export const NEXT_LIKES_WIDGET = `'use client';

import { useState } from 'react';
import { useRealtimeEvent } from '@/hooks/use-realtime-event';

export function LikesCount({ dropId, initial }: { dropId: number; initial: number }) {
  const [likes, setLikes] = useState(initial);

  useRealtimeEvent<{ dropId: number; likesCount: number }>('like:updated', (data) => {
    if (data.dropId === dropId) setLikes(data.likesCount);
  });

  return <span>{likes} likes</span>;
}`;

export function buildWsDocs(): string {
  return `# Drops API : le WebSocket

Tout ce que le WebSocket de l'API sait faire, et comment l'utiliser depuis Next.js. Cette page est servie quand le bloc 2 est activé. Pour essayer les messages sans écrire de code : \`/ws-playground\`. Le résumé de tout le contrat : \`/contract.md\`.

## En bref

- Un WebSocket par onglet, ouvert avec un **ticket** à usage unique (30 s). Le JWT ne passe jamais dans l'URL.
- Tous les messages sont du JSON \`{ "type": "…", "data": { … } }\`, dans les deux sens.
- Le serveur pousse les événements en direct : drops, likes, commentaires, notifications, présence. Le client n'envoie que trois types de messages.
- Aucune position d'utilisateur ne transite par le WebSocket.

## La présence pas à pas

${PRESENCE_STEPS}

## Messages client → serveur

| Type | \`data\` | Réponse |
|---|---|---|
| \`ping\` | \`{}\` | \`pong\` avec \`serverTime\` |
| \`presence:view\` | \`{ dropId: number }\` | \`presence:drop\` tout de suite, pour cette connexion seulement. Un seul drop regardé à la fois : un nouveau \`presence:view\` remplace le précédent. \`error\` \`bad_message\` si \`dropId\` n'est pas un entier positif, \`error\` \`drop_not_found\` si le drop n'existe pas ou est masqué (le drop regardé avant reste regardé). |
| \`presence:leave\` | \`{}\` | Aucune. Les autres reçoivent la liste mise à jour. |

Un message illisible ou de type inconnu reçoit \`error\` \`bad_message\`, sans fermer la connexion.

## Messages serveur → client

| Type | \`data\` | Quand |
|---|---|---|
| \`hello\` | \`{ user, serverTime, lockMode, online }\` | Une fois, à l'ouverture. \`user\` est vous-même, \`online\` les utilisateurs connectés (vous compris). |
| \`pong\` | \`{ serverTime }\` | Réponse à \`ping\`. |
| \`presence:online\` | \`{ users }\` | Quelqu'un arrive ou part. Au plus une fois par seconde. |
| \`presence:drop\` | \`{ dropId, viewers }\` | Réponse à votre \`presence:view\`, puis à chaque changement de lecteurs du drop (au plus une fois par seconde, seulement si la liste change). |
| \`drop:created\`, \`drop:updated\` | \`{ drop }\` | Un drop est créé ou modifié. Le \`drop\` est construit pour vous : \`isMine\`, \`likedByMe\`, \`openedByMe\`, verrouillage. |
| \`drop:deleted\` | \`{ dropId }\` | Un drop est supprimé, ou masqué après signalements. |
| \`drop:opened\` | \`{ dropId, opensCount }\` | Un drop est ouvert à proximité. |
| \`like:updated\` | \`{ dropId, likesCount }\` | Un like est posé ou retiré. |
| \`comment:created\` | \`{ comment }\` | Nouveau commentaire, sauf sur un drop verrouillé que vous n'avez pas ouvert. |
| \`comment:deleted\` | \`{ dropId, commentId }\` | Commentaire supprimé, mêmes règles. |
| \`notification\` | \`{ kind, dropId, dropTitle, by, at }\` | Seul l'auteur du drop la reçoit, jamais pour ses propres actions. \`kind\` : \`drop_opened\`, \`drop_liked\`, \`drop_commented\`. |
| \`settings:updated\` | \`{ lockMode }\` | L'enseignant active ou coupe le verrouillage. |
| \`error\` | \`{ code, message }\` | Message client refusé. \`code\` : \`bad_message\` ou \`drop_not_found\`. La connexion reste ouverte. |

Les drops masqués ne sont diffusés qu'à leur auteur. Un événement ne révèle jamais le contenu d'un drop verrouillé.

## Codes de fermeture

| Code | Raison | Que faire côté client |
|---|---|---|
| 1000 | fermeture normale | Rien : c'est vous qui avez fermé. |
| 1006 | coupure sans code (réseau, refus au handshake) | Redemander un ticket, puis reconnecter avec un délai croissant. |
| 4001 | \`session_expired\` | Le JWT a expiré ou été révoqué : renvoyer vers la connexion. Ne pas reconnecter. |
| 4008 | \`rate_limited\` | Plus de 20 messages par 10 s : c'est un bug de votre code (message envoyé en boucle). Ne pas reconnecter, corriger. |
| 4009 | \`too_many_connections\` | Plus de 5 connexions pour votre compte : une seule connexion par onglet. Ne pas reconnecter en boucle. |
| 4010 | \`server_restart\` | Le serveur redémarre : nouveau ticket, reconnexion avec délai croissant. |
| 4011 | \`admin_disconnect\` | Déconnexion forcée par l'enseignant : nouveau ticket, reconnexion avec délai croissant. |

Le serveur envoie un ping de protocole toutes les 30 s ; le navigateur répond tout seul. Un client qui ne répond pas est déconnecté, et la présence est mise à jour comme s'il avait envoyé \`presence:leave\`.

## Limites

- Ticket : à usage unique, 30 s. Il en faut un nouveau à **chaque** connexion, reconnexions comprises.
- 20 messages par tranche de 10 s et par connexion (\`presence:view\` compris), sinon fermeture en 4008.
- 5 connexions simultanées par utilisateur, la plus ancienne est fermée en 4009.
- 8 ko par message.

## Exemple avec Next.js (App Router)

Exemple **indicatif** : adaptez les chemins et la lecture du token à votre projet. Le ticket se demande côté serveur avec le JWT ; le navigateur ne voit que l'URL du WebSocket.

### 1. Route serveur qui demande le ticket

\`app/api/realtime/ticket/route.ts\` : \`getToken\` est votre fonction qui lit le JWT côté serveur (cookie, session).

\`\`\`ts
${NEXT_TICKET_ROUTE}
\`\`\`

### 2. Un client partagé, une seule connexion par onglet

\`lib/realtime.ts\` : ce module (pas un composant, pas un hook) possède **la** socket de l'onglet. Il l'ouvre quand le premier composant en a besoin, la ferme quand le dernier part, et reconnecte avec un nouveau ticket sauf pour les codes qui demandent de s'arrêter. Les composants ne créent jamais de \`WebSocket\` eux-mêmes : ils s'abonnent à des types de messages et envoient des messages à travers lui.

- \`retain()\` : « j'ai besoin de la connexion ». Retourne la fonction qui la relâche (sans effet si elle est appelée deux fois). La socket se ferme 1 s après le dernier relâchement (ce délai évite de fermer puis rouvrir lors d'un changement de page ou du mode strict).
- \`subscribe(type, listener)\` : reçoit les \`data\` de chaque message de ce type. Retourne la fonction qui se désabonne.
- \`onOpen(listener)\` : appelé à chaque ouverture, reconnexions comprises (tout de suite si la socket est déjà ouverte). C'est là qu'on renvoie ce qui ne survit pas à une reconnexion, comme \`presence:view\`.
- \`send(type, data)\` : envoie si la socket est ouverte, sinon ne fait rien.

\`\`\`ts
${NEXT_REALTIME_CLIENT}
\`\`\`

### 3. Hook de présence

\`hooks/use-presence.ts\` : une fine couche sur le client partagé. La liste est vidée quand \`dropId\` change. Au démontage, \`presence:leave\` puis relâchement de la connexion.

\`\`\`tsx
${NEXT_PRESENCE_HOOK}
\`\`\`

### 4. Composant

\`\`\`tsx
${NEXT_PRESENCE_WIDGET}
\`\`\`

### 5. Les autres événements : le même client

Pour tout autre message du serveur (\`like:updated\`, \`comment:created\`, \`drop:created\`, \`notification\`…), un seul hook générique suffit. Il ne rouvre aucune connexion : il réutilise celle de la présence, ou ouvre la seule de l'onglet si rien d'autre n'est monté.

\`hooks/use-realtime-event.ts\` :

\`\`\`tsx
${NEXT_EVENT_HOOK}
\`\`\`

Exemple, un compteur de likes en direct :

\`\`\`tsx
${NEXT_LIKES_WIDGET}
\`\`\`

Pour envoyer un message du client, importez \`send\` depuis \`@/lib/realtime\`. Pour un nouveau type de message, il n'y a rien à changer dans le client : seuls les hooks au-dessus sont à écrire.

### Pièges fréquents

- **Une socket par composant.** Un hook qui fait \`new WebSocket\` dans son propre \`useEffect\` ouvre une connexion à chaque composant monté : présence, likes et commentaires sur la même page font déjà 3 connexions, et 4009 arrive vite (la limite est de 5 par compte). La socket appartient au module \`lib/realtime.ts\`, jamais à un composant.
- **Une socket à chaque rendu.** Ne touchez au client que dans un \`useEffect\`, jamais dans le corps du composant, et relâchez-le dans la fonction de nettoyage. L'enseignant voit les connexions par utilisateur dans \`/admin/realtime\`.
- **\`presence:view\` en boucle.** Un effet qui dépend d'une valeur qui change à chaque rendu envoie le message sans arrêt : fermeture en 4008.
- **Un seul \`usePresence\` par page.** Le serveur retient un seul drop regardé par connexion, et le \`presence:leave\` d'un composant qui se démonte efface celui des autres. Appelez le hook une fois, au niveau de la page, et passez \`viewers\` aux composants enfants.
- **Le mode strict de React** monte les effets deux fois en développement. Le client partagé absorbe ce double montage sans rouvrir de connexion : c'est normal.
- **Réutiliser un ticket.** Un ticket ne sert qu'une fois. Redemandez-en un à chaque reconnexion.
- **Le JWT dans l'URL du WebSocket.** Jamais : seul le ticket y passe.

## Les types

\`\`\`ts
${WS_TYPES}
\`\`\`
`;
}
