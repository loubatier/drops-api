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

export const NEXT_PRESENCE_HOOK = `'use client';

import { useEffect, useState } from 'react';

type Viewer = { id: number; username: string; displayName: string; avatarUrl: string | null };

const NO_RECONNECT = [4001, 4002, 4008, 4009];

export function usePresence(dropId: number) {
  const [viewers, setViewers] = useState<Viewer[]>([]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    async function connect() {
      const res = await fetch('/api/realtime/ticket', { method: 'POST' });
      if (stopped || !res.ok) return;
      const { url } = await res.json();
      if (stopped) return;

      socket = new WebSocket(url);
      socket.onopen = () => {
        attempt = 0;
        socket?.send(JSON.stringify({ type: 'presence:view', data: { dropId } }));
      };
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'presence:drop' && message.data.dropId === dropId) {
          setViewers(message.data.viewers);
        }
      };
      socket.onclose = (event) => {
        if (stopped || NO_RECONNECT.includes(event.code)) return;
        attempt += 1;
        timer = setTimeout(connect, Math.min(1000 * 2 ** attempt, 15000));
      };
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close(1000);
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
| 4002 | \`block2_disabled\` | Le bloc 2 est coupé : ne pas reconnecter. |
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

### 2. Hook client

\`hooks/use-presence.ts\` : une connexion par composant monté, fermée au démontage (ce qui vaut \`presence:leave\`), reconnexion avec un nouveau ticket sauf pour les codes qui demandent de s'arrêter.

\`\`\`tsx
${NEXT_PRESENCE_HOOK}
\`\`\`

### 3. Composant

\`\`\`tsx
${NEXT_PRESENCE_WIDGET}
\`\`\`

### Pièges fréquents

- **Une socket à chaque rendu.** Ouvrez la connexion dans un \`useEffect\`, jamais dans le corps du composant, et fermez-la dans la fonction de nettoyage. Sinon : 4009 en quelques secondes. L'enseignant voit les connexions par utilisateur dans \`/admin/realtime\`.
- **\`presence:view\` en boucle.** Un effet qui dépend d'une valeur qui change à chaque rendu envoie le message sans arrêt : fermeture en 4008.
- **Le mode strict de React** monte les effets deux fois en développement. Le nettoyage ci-dessus ferme la première connexion : c'est normal.
- **Réutiliser un ticket.** Un ticket ne sert qu'une fois. Redemandez-en un à chaque reconnexion.
- **Le JWT dans l'URL du WebSocket.** Jamais : seul le ticket y passe.

## Les types

\`\`\`ts
${WS_TYPES}
\`\`\`
`;
}
