import { type Db, foldText } from '../../db/index.js';
import { toPublicUser } from '../users/repo.js';

export interface DropRow {
  id: number;
  author_id: number;
  title: string;
  content: string;
  category: string;
  image_url: string | null;
  lat: number;
  lng: number;
  hidden: number;
  created_at: string;
  updated_at: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  likes_count: number;
  comments_count: number;
  opens_count: number;
  liked_by_me: number;
  opened_by_me: number;
}

const SELECT_DROP = `
  SELECT d.id, d.author_id, d.title, d.content, d.category, d.image_url, d.lat, d.lng, d.hidden,
    d.created_at, d.updated_at,
    u.username, u.display_name, u.avatar_url,
    (SELECT COUNT(*) FROM likes l WHERE l.drop_id = d.id) AS likes_count,
    (SELECT COUNT(*) FROM comments c WHERE c.drop_id = d.id) AS comments_count,
    (SELECT COUNT(*) FROM opens o WHERE o.drop_id = d.id) AS opens_count,
    EXISTS (SELECT 1 FROM likes l WHERE l.drop_id = d.id AND l.user_id = @me) AS liked_by_me,
    EXISTS (SELECT 1 FROM opens o WHERE o.drop_id = d.id AND o.user_id = @me) AS opened_by_me
  FROM drops d
  JOIN users u ON u.id = d.author_id`;

export const approximate = (value: number): number => Math.round(value * 1000) / 1000;

export function isLockedFor(row: DropRow, viewerId: number | null, lockMode: 'on' | 'off'): boolean {
  if (lockMode !== 'on') return false;
  if (viewerId === null) return true;
  return row.author_id !== viewerId && row.opened_by_me !== 1;
}

export function toDrop(row: DropRow, viewerId: number | null, lockMode: 'on' | 'off' = 'off') {
  const isMine = viewerId !== null && row.author_id === viewerId;
  const locked = isLockedFor(row, viewerId, lockMode);
  return {
    id: row.id,
    title: row.title,
    content: (locked ? null : row.content) as string | null,
    category: row.category,
    imageUrl: locked ? null : row.image_url,
    location: locked
      ? { lat: approximate(row.lat), lng: approximate(row.lng), precision: 'approx' as 'exact' | 'approx' }
      : { lat: row.lat, lng: row.lng, precision: 'exact' as 'exact' | 'approx' },
    locked,
    hidden: isMine && row.hidden === 1,
    author: toPublicUser({ id: row.author_id, username: row.username, display_name: row.display_name, avatar_url: row.avatar_url }),
    likesCount: row.likes_count,
    commentsCount: row.comments_count,
    opensCount: row.opens_count,
    likedByMe: row.liked_by_me === 1,
    openedByMe: row.opened_by_me === 1,
    isMine,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function findDropRow(db: Db, id: number, viewerId: number | null): DropRow | undefined {
  return db.prepare(`${SELECT_DROP} WHERE d.id = @id`).get({ id, me: viewerId ?? 0 }) as DropRow | undefined;
}

export function isVisibleTo(row: DropRow, viewerId: number | null): boolean {
  return row.hidden === 0 || row.author_id === viewerId;
}

export interface DropFilters {
  q?: string;
  category?: string;
  author?: string;
  sort: 'recent' | 'popular';
  page: number;
  pageSize: number;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function listDrops(db: Db, f: DropFilters, viewerId: number | null) {
  const where: string[] = ['d.hidden = 0'];
  const params: Record<string, unknown> = { me: viewerId ?? 0 };
  if (f.q) {
    where.push(
      `(fold(d.title) LIKE @q ESCAPE '\\' OR fold(d.content) LIKE @q ESCAPE '\\' OR fold(u.username) LIKE @q ESCAPE '\\')`,
    );
    params.q = `%${escapeLike(foldText(f.q))}%`;
  }
  if (f.category) {
    where.push('d.category = @category');
    params.category = f.category;
  }
  if (f.author) {
    where.push('u.username = @author');
    params.author = f.author.toLowerCase();
  }
  const clause = `WHERE ${where.join(' AND ')}`;
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM drops d JOIN users u ON u.id = d.author_id ${clause}`)
      .get(params) as { n: number }
  ).n;
  const order =
    f.sort === 'popular' ? 'likes_count DESC, d.created_at DESC, d.id DESC' : 'd.created_at DESC, d.id DESC';
  const rows = db
    .prepare(`${SELECT_DROP} ${clause} ORDER BY ${order} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: f.pageSize, offset: (f.page - 1) * f.pageSize }) as DropRow[];
  return { rows, total };
}

export const paginate = <T>(items: T[], total: number, page: number, pageSize: number) => ({
  items,
  page,
  pageSize,
  total,
  totalPages: Math.ceil(total / pageSize),
});
