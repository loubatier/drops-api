import { randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { ApiError, errorBody } from '../errors.js';
import { events } from '../events.js';
import { TokenExpiredError, verifyToken } from '../modules/auth/tokens.js';
import { findComment } from '../modules/comments/routes.js';
import { type DropRow, findDropRow, toDrop } from '../modules/drops/repo.js';
import { type UserRow, toPublicUser } from '../modules/users/repo.js';

export const CLOSE = {
  sessionExpired: [4001, 'session_expired'],
  rateLimited: [4008, 'rate_limited'],
  tooManyConnections: [4009, 'too_many_connections'],
  serverRestart: [4010, 'server_restart'],
  adminDisconnect: [4011, 'admin_disconnect'],
} as const;

type CloseReason = (typeof CLOSE)[keyof typeof CLOSE];

export interface RealtimeOptions {
  presenceDebounceMs?: number;
  heartbeatMs?: number;
  sessionCheckMs?: number;
}

export interface TicketOwner {
  id: number;
  jti: string;
  exp: number;
}

type PublicUserValue = ReturnType<typeof toPublicUser>;

export interface RealtimeStats {
  connections: number;
  byUser: { user: PublicUserValue; connections: number }[];
  viewers: { dropId: number; count: number }[];
  simulated: { online: PublicUserValue[]; viewing: { user: PublicUserValue; dropId: number }[] };
}

export interface SimulatedPresence {
  setOnline(users: PublicUserValue[]): void;
  view(userId: number, dropId: number | null): void;
  viewingNow(userId: number): number | null;
  realViewedDrops(): number[];
}

export interface Realtime {
  attach(server: Server): void;
  issueTicket(owner: TicketOwner): { ticket: string; expiresAt: string };
  stats(): RealtimeStats;
  simulated: SimulatedPresence;
  disconnectAll(): number;
  checkSessions(): void;
  close(): Promise<void>;
}

interface Presence {
  userId: number;
  user: PublicUserValue;
  viewing: number | null;
}

interface Connection extends Presence {
  ws: WebSocket;
  jti: string;
  jwtExp: number;
  windowStart: number;
  windowCount: number;
  alive: boolean;
  openedAt: number;
}

interface Ticket {
  owner: TicketOwner;
  expiresAt: number;
}

type PublicUserRow = Pick<UserRow, 'id' | 'username' | 'display_name' | 'avatar_url'>;

const MAX_TICKETS = 10_000;

export function createRealtime(
  config: Config,
  db: Db,
  options: RealtimeOptions = {},
): Realtime {
  const presenceDebounceMs = options.presenceDebounceMs ?? 1000;
  const heartbeatMs = options.heartbeatMs ?? 30_000;
  const sessionCheckMs = options.sessionCheckMs ?? 30_000;

  const tickets = new Map<string, Ticket>();
  const connections = new Set<Connection>();
  const virtuals = new Map<number, Presence>();
  const presences = function* (): Generator<Presence> {
    yield* connections;
    yield* virtuals.values();
  };
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
  const cleanups: (() => void)[] = [];
  const timers: NodeJS.Timeout[] = [];
  let server: Server | null = null;

  const findUser = db.prepare('SELECT id, username, display_name, avatar_url FROM users WHERE id = ?');
  const isRevoked = db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?');

  const publicUser = (id: number) => {
    const row = findUser.get(id) as PublicUserRow | undefined;
    return row ? toPublicUser(row) : null;
  };

  const send = (conn: Connection, type: string, data: unknown) => {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify({ type, data }));
  };
  const broadcast = (type: string, data: unknown) => {
    for (const conn of connections) send(conn, type, data);
  };
  const closeConnection = (conn: Connection, [code, reason]: CloseReason) => {
    if (conn.ws.readyState === WebSocket.OPEN || conn.ws.readyState === WebSocket.CONNECTING) {
      conn.ws.close(code, reason);
    }
  };

  const pruneTickets = () => {
    const now = Date.now();
    for (const [key, t] of tickets) if (t.expiresAt <= now) tickets.delete(key);
  };

  let presenceTimer: NodeJS.Timeout | null = null;
  const onlineUsers = () => {
    const seen = new Map<number, PublicUserValue>();
    for (const p of presences()) if (!seen.has(p.userId)) seen.set(p.userId, p.user);
    return [...seen.values()].sort((a, b) => a.id - b.id);
  };
  const scheduleOnline = () => {
    if (presenceTimer) return;
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      broadcast('presence:online', { users: onlineUsers() });
    }, presenceDebounceMs);
    presenceTimer.unref();
  };

  const dropTimers = new Map<number, NodeJS.Timeout>();
  const arrivals = new Map<number, number[]>();
  const lastSent = new Map<number, string>();
  const viewersOf = (dropId: number) => {
    const current = new Map<number, PublicUserValue>();
    for (const p of presences()) if (p.viewing === dropId && !current.has(p.userId)) current.set(p.userId, p.user);
    const order = (arrivals.get(dropId) ?? []).filter((id) => current.has(id));
    for (const id of current.keys()) if (!order.includes(id)) order.push(id);
    if (order.length > 0) arrivals.set(dropId, order);
    else arrivals.delete(dropId);
    return order.map((id) => current.get(id)!);
  };
  const scheduleDrop = (dropId: number) => {
    if (dropTimers.has(dropId)) return;
    const timer = setTimeout(() => {
      dropTimers.delete(dropId);
      const viewers = viewersOf(dropId);
      const key = viewers.map((u) => u.id).join(',');
      if ((lastSent.get(dropId) ?? '') === key) return;
      if (key) lastSent.set(dropId, key);
      else lastSent.delete(dropId);
      broadcast('presence:drop', { dropId, viewers });
    }, presenceDebounceMs);
    timer.unref();
    dropTimers.set(dropId, timer);
  };

  const setViewing = (who: Presence, dropId: number | null) => {
    const previous = who.viewing;
    if (previous === dropId) return;
    who.viewing = dropId;
    if (previous !== null) {
      viewersOf(previous);
      scheduleDrop(previous);
    }
    if (dropId !== null) {
      viewersOf(dropId);
      scheduleDrop(dropId);
    }
  };

  const canSeeDrop = (row: DropRow | undefined, viewerId: number): row is DropRow =>
    row !== undefined && (row.hidden === 0 || row.author_id === viewerId);

  const serializeFor = (dropId: number, viewerId: number) => {
    const row = findDropRow(db, dropId, viewerId);
    return row ? { row, drop: toDrop(row, viewerId) } : null;
  };

  const notify = (
    authorId: number,
    kind: 'drop_liked' | 'drop_commented',
    row: DropRow,
    byId: number,
  ) => {
    if (authorId === byId) return;
    const by = publicUser(byId);
    if (!by) return;
    const data = { kind, dropId: row.id, dropTitle: row.title, by, at: new Date().toISOString() };
    for (const conn of connections) if (conn.userId === authorId) send(conn, 'notification', data);
  };

  const guard =
    <T>(handler: (payload: T) => void) =>
    (payload: unknown, source?: unknown) => {
      if (source !== db) return;
      try {
        handler(payload as T);
      } catch (err) {
        console.error('[realtime]', err);
      }
    };

  const onDropChanged = (type: 'drop:created' | 'drop:updated') => (payload: { id: number }) => {
    for (const conn of connections) {
      const found = serializeFor(payload.id, conn.userId);
      if (!found) continue;
      if (found.row.hidden === 1 && found.row.author_id !== conn.userId) {
        if (type === 'drop:updated') send(conn, 'drop:deleted', { dropId: payload.id });
        continue;
      }
      send(conn, type, { drop: found.drop });
    }
  };

  const subscribe = () => {
    cleanups.push(
      events.on('drop:created', guard(onDropChanged('drop:created'))),
      events.on('drop:updated', guard(onDropChanged('drop:updated'))),
      events.on(
        'drop:deleted',
        guard((payload: { id: number }) => {
          broadcast('drop:deleted', { dropId: payload.id });
          for (const who of [...presences()]) if (who.viewing === payload.id) setViewing(who, null);
        }),
      ),
      events.on(
        'like:updated',
        guard((payload: { dropId: number; userId: number; newLike: boolean; likesCount: number; dislikesCount: number }) => {
          const row = findDropRow(db, payload.dropId, null);
          if (!row) return;
          for (const conn of connections) {
            if (row.hidden === 1 && row.author_id !== conn.userId) continue;
            send(conn, 'like:updated', { dropId: payload.dropId, likesCount: payload.likesCount, dislikesCount: payload.dislikesCount });
          }
          if (payload.newLike) notify(row.author_id, 'drop_liked', row, payload.userId);
        }),
      ),
      events.on(
        'comment:created',
        guard((payload: { id: number; dropId: number; author: { id: number } }) => {
          for (const conn of connections) {
            const row = findDropRow(db, payload.dropId, conn.userId);
            if (!canSeeDrop(row, conn.userId)) continue;
            const comment = findComment(db, payload.id, conn.userId);
            if (comment) send(conn, 'comment:created', { comment });
          }
          const row = findDropRow(db, payload.dropId, null);
          if (row) notify(row.author_id, 'drop_commented', row, payload.author.id);
        }),
      ),
      events.on(
        'comment:updated',
        guard((payload: { id: number; dropId: number }) => {
          for (const conn of connections) {
            const row = findDropRow(db, payload.dropId, conn.userId);
            if (!canSeeDrop(row, conn.userId)) continue;
            const comment = findComment(db, payload.id, conn.userId);
            if (comment) send(conn, 'comment:updated', { comment });
          }
        }),
      ),
      events.on(
        'comment:deleted',
        guard((payload: { dropId: number; commentId: number }) => {
          for (const conn of connections) {
            const row = findDropRow(db, payload.dropId, conn.userId);
            if (!canSeeDrop(row, conn.userId)) continue;
            send(conn, 'comment:deleted', { dropId: payload.dropId, commentId: payload.commentId });
          }
        }),
      ),
    );
  };

  const reject = (socket: Duplex, status: number, statusText: string, error: ApiError) => {
    const requestId = `req_${randomBytes(4).toString('hex')}`;
    const body = JSON.stringify(errorBody(error, requestId));
    const headers = [
      `HTTP/1.1 ${status} ${statusText}`,
      'Content-Type: application/json; charset=utf-8',
      `Content-Length: ${Buffer.byteLength(body)}`,
      `X-Request-Id: ${requestId}`,
      'Cache-Control: no-store',
      'Connection: close',
    ];
    if (status === 401) headers.push('WWW-Authenticate: Bearer');
    socket.write(`${headers.join('\r\n')}\r\n\r\n${body}`);
    socket.destroy();
  };

  const unauthorized = (code: string, message: string) => ApiError.of(401, message, {}, code);

  const handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      return reject(socket, 404, 'Not Found', ApiError.of(404));
    }
    pruneTickets();
    const key = url.searchParams.get('ticket') ?? '';
    const ticket = tickets.get(key);
    if (!ticket) {
      return reject(socket, 401, 'Unauthorized', unauthorized('invalid_token', 'Ticket absent, expiré ou déjà utilisé.'));
    }
    tickets.delete(key);
    const { owner } = ticket;
    if (owner.exp * 1000 <= Date.now()) {
      return reject(socket, 401, 'Unauthorized', unauthorized('token_expired', 'Votre session a expiré.'));
    }
    if (isRevoked.get(owner.jti)) {
      return reject(socket, 401, 'Unauthorized', unauthorized('token_revoked', 'Ce token a été révoqué.'));
    }
    const user = publicUser(owner.id);
    if (!user) return reject(socket, 401, 'Unauthorized', unauthorized('invalid_token', 'Token invalide.'));

    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn: Connection = {
        ws,
        userId: owner.id,
        jti: owner.jti,
        jwtExp: owner.exp,
        user,
        viewing: null,
        windowStart: Date.now(),
        windowCount: 0,
        alive: true,
        openedAt: Date.now(),
      };
      connections.add(conn);
      ws.on('pong', () => {
        conn.alive = true;
      });
      ws.on('message', (raw) => handleMessage(conn, raw.toString()));
      ws.on('close', () => {
        connections.delete(conn);
        setViewing(conn, null);
        scheduleOnline();
      });
      ws.on('error', () => ws.terminate());

      const own = [...connections].filter((c) => c.userId === conn.userId).sort((a, b) => a.openedAt - b.openedAt);
      const excess = own.length - config.wsMaxConnectionsPerUser;
      for (const old of own.slice(0, Math.max(0, excess))) {
        connections.delete(old);
        setViewing(old, null);
        closeConnection(old, CLOSE.tooManyConnections);
      }

      send(conn, 'hello', {
        user,
        serverTime: new Date().toISOString(),
        online: onlineUsers(),
      });
      scheduleOnline();
    });
  };

  const badMessage = (conn: Connection, message: string, code = 'bad_message') =>
    send(conn, 'error', { code, message });

  const handleMessage = (conn: Connection, raw: string) => {
    const now = Date.now();
    if (now - conn.windowStart >= 10_000) {
      conn.windowStart = now;
      conn.windowCount = 0;
    }
    conn.windowCount += 1;
    if (conn.windowCount > config.wsMessagesPer10s) return closeConnection(conn, CLOSE.rateLimited);

    let message: { type?: unknown; data?: unknown };
    try {
      message = JSON.parse(raw);
    } catch {
      return badMessage(conn, 'Message illisible : du JSON est attendu.');
    }
    if (typeof message !== 'object' || message === null || typeof message.type !== 'string') {
      return badMessage(conn, 'Message invalide : { "type": "…", "data": { … } } est attendu.');
    }
    const data = (typeof message.data === 'object' && message.data !== null ? message.data : {}) as Record<string, unknown>;
    switch (message.type) {
      case 'ping':
        return send(conn, 'pong', { serverTime: new Date().toISOString() });
      case 'presence:leave':
        return setViewing(conn, null);
      case 'presence:view': {
        const dropId = data.dropId;
        if (typeof dropId !== 'number' || !Number.isInteger(dropId) || dropId < 1) {
          return badMessage(conn, 'dropId doit être un entier positif.');
        }
        if (!canSeeDrop(findDropRow(db, dropId, conn.userId), conn.userId)) {
          return badMessage(conn, "Ce drop n'existe pas.", 'drop_not_found');
        }
        setViewing(conn, dropId);
        return send(conn, 'presence:drop', { dropId, viewers: viewersOf(dropId) });
      }
      default:
        return badMessage(conn, `Type de message inconnu : ${message.type}.`);
    }
  };

  const checkSessions = () => {
    const nowSeconds = Date.now() / 1000;
    for (const conn of [...connections]) {
      if (conn.jwtExp <= nowSeconds || isRevoked.get(conn.jti)) closeConnection(conn, CLOSE.sessionExpired);
    }
  };

  const heartbeat = () => {
    for (const conn of [...connections]) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      if (conn.ws.readyState === WebSocket.OPEN) conn.ws.ping();
    }
  };

  return {
    attach(httpServer) {
      server = httpServer;
      httpServer.on('upgrade', handleUpgrade);
      subscribe();
      timers.push(setInterval(heartbeat, heartbeatMs), setInterval(checkSessions, sessionCheckMs));
      for (const t of timers) t.unref();
    },
    issueTicket(owner) {
      pruneTickets();
      if (tickets.size >= MAX_TICKETS) tickets.delete(tickets.keys().next().value as string);
      const ticket = `wst_${randomBytes(24).toString('base64url')}`;
      const expiresAt = Date.now() + config.wsTicketTtlSeconds * 1000;
      tickets.set(ticket, { owner, expiresAt });
      return { ticket, expiresAt: new Date(expiresAt).toISOString() };
    },
    simulated: {
      setOnline(users) {
        const wanted = new Map(users.map((u) => [u.id, u]));
        for (const [id, who] of [...virtuals]) {
          if (wanted.has(id)) continue;
          setViewing(who, null);
          virtuals.delete(id);
        }
        for (const [id, user] of wanted) if (!virtuals.has(id)) virtuals.set(id, { userId: id, user, viewing: null });
        scheduleOnline();
      },
      view(userId, dropId) {
        const who = virtuals.get(userId);
        if (who) setViewing(who, dropId);
      },
      viewingNow: (userId) => virtuals.get(userId)?.viewing ?? null,
      realViewedDrops() {
        const ids = new Set<number>();
        for (const c of connections) if (c.viewing !== null) ids.add(c.viewing);
        return [...ids].sort((a, b) => a - b);
      },
    },
    stats() {
      const perUser = new Map<number, { user: PublicUserValue; connections: number }>();
      const perDrop = new Map<number, number>();
      for (const c of connections) {
        const entry = perUser.get(c.userId) ?? { user: c.user, connections: 0 };
        entry.connections += 1;
        perUser.set(c.userId, entry);
        if (c.viewing !== null) perDrop.set(c.viewing, (perDrop.get(c.viewing) ?? 0) + 1);
      }
      return {
        connections: connections.size,
        byUser: [...perUser.values()].sort((a, b) => b.connections - a.connections || a.user.id - b.user.id),
        viewers: [...perDrop.entries()]
          .map(([dropId, count]) => ({ dropId, count }))
          .sort((a, b) => b.count - a.count || a.dropId - b.dropId),
        simulated: {
          online: [...virtuals.values()].map((v) => v.user).sort((a, b) => a.id - b.id),
          viewing: [...virtuals.values()]
            .filter((v) => v.viewing !== null)
            .map((v) => ({ user: v.user, dropId: v.viewing as number }))
            .sort((a, b) => a.user.id - b.user.id),
        },
      };
    },
    disconnectAll() {
      const count = connections.size;
      for (const conn of [...connections]) closeConnection(conn, CLOSE.adminDisconnect);
      return count;
    },
    checkSessions,
    async close() {
      for (const off of cleanups.splice(0)) off();
      for (const t of timers.splice(0)) clearInterval(t);
      if (presenceTimer) clearTimeout(presenceTimer);
      for (const t of dropTimers.values()) clearTimeout(t);
      dropTimers.clear();
      arrivals.clear();
      lastSent.clear();
      virtuals.clear();
      server?.off('upgrade', handleUpgrade);
      for (const conn of [...connections]) closeConnection(conn, CLOSE.serverRestart);
      await new Promise<void>((resolve) => {
        const deadline = setTimeout(resolve, 1000);
        wss.close(() => {
          clearTimeout(deadline);
          resolve();
        });
        for (const client of wss.clients) setTimeout(() => client.terminate(), 500).unref();
      });
    },
  };
}
