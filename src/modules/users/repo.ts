import type { Db } from '../../db/index.js';

export interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  is_seed: number;
  created_at: string;
}

export const toPublicUser = (u: Pick<UserRow, 'id' | 'username' | 'display_name' | 'avatar_url'>) => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  avatarUrl: u.avatar_url,
});

export const toPrivateUser = (u: UserRow) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  displayName: u.display_name,
  bio: u.bio,
  avatarUrl: u.avatar_url,
  createdAt: u.created_at,
});

export const findUserById = (db: Db, id: number) =>
  db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;

export const findUserByUsername = (db: Db, username: string) =>
  db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;

export const findUserByLogin = (db: Db, login: string) =>
  db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(login, login) as UserRow | undefined;

export function profileStats(db: Db, userId: number) {
  const row = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM drops WHERE author_id = @id AND hidden = 0) AS dropsCount,
        (SELECT COUNT(*) FROM likes l JOIN drops d ON d.id = l.drop_id WHERE d.author_id = @id AND d.hidden = 0) AS likesReceived,
        (SELECT COUNT(*) FROM comments WHERE author_id = @id) AS commentsCount`,
    )
    .get({ id: userId }) as { dropsCount: number; likesReceived: number; commentsCount: number };
  return row;
}
