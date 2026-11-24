import { type Db, foldText } from '../../db/index.js';
import { haversineMeters } from '../../geo.js';
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
  dislikes_count: number;
  comments_count: number;
  liked_by_me: number;
  disliked_by_me: number;
}

const SELECT_DROP = `
  SELECT d.id, d.author_id, d.title, d.content, d.category, d.image_url, d.lat, d.lng, d.hidden,
    d.created_at, d.updated_at,
    u.username, u.display_name, u.avatar_url,
    (SELECT COUNT(*) FROM likes l WHERE l.drop_id = d.id) AS likes_count,
    (SELECT COUNT(*) FROM dislikes dl WHERE dl.drop_id = d.id) AS dislikes_count,
    (SELECT COUNT(*) FROM comments c WHERE c.drop_id = d.id AND c.deleted = 0) AS comments_count,
    EXISTS (SELECT 1 FROM likes l WHERE l.drop_id = d.id AND l.user_id = @me) AS liked_by_me,
    EXISTS (SELECT 1 FROM dislikes dl WHERE dl.drop_id = d.id AND dl.user_id = @me) AS disliked_by_me
  FROM drops d
  JOIN users u ON u.id = d.author_id`;

export function toDrop(row: DropRow, viewerId: number | null) {
  const isMine = viewerId !== null && row.author_id === viewerId;
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    category: row.category,
    imageUrl: row.image_url,
    location: { lat: row.lat, lng: row.lng },
    hidden: isMine && row.hidden === 1,
    author: toPublicUser({ id: row.author_id, username: row.username, display_name: row.display_name, avatar_url: row.avatar_url }),
    likesCount: row.likes_count,
    dislikesCount: row.dislikes_count,
    commentsCount: row.comments_count,
    likedByMe: row.liked_by_me === 1,
    dislikedByMe: row.disliked_by_me === 1,
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

export interface Near {
  lat: number;
  lng: number;
  radius: number;
}

export interface Bbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface DropFilters {
  q?: string;
  category?: string;
  author?: string;
  sort: 'recent' | 'popular' | 'distance';
  page: number;
  pageSize: number;
  near?: Near;
  bbox?: Bbox;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const APPROX_MARGIN_DEG = 0.0006;

function prefilterRectangle(f: DropFilters): Bbox | null {
  if (f.near) {
    const lat = Math.max(-89, Math.min(89, f.near.lat));
    const dLat = f.near.radius / 111_320 + APPROX_MARGIN_DEG;
    const dLng = f.near.radius / (111_320 * Math.cos((lat * Math.PI) / 180)) + APPROX_MARGIN_DEG;
    return { minLat: f.near.lat - dLat, maxLat: f.near.lat + dLat, minLng: f.near.lng - dLng, maxLng: f.near.lng + dLng };
  }
  if (f.bbox) {
    return {
      minLat: f.bbox.minLat - APPROX_MARGIN_DEG,
      maxLat: f.bbox.maxLat + APPROX_MARGIN_DEG,
      minLng: f.bbox.minLng - APPROX_MARGIN_DEG,
      maxLng: f.bbox.maxLng + APPROX_MARGIN_DEG,
    };
  }
  return null;
}

export function listDrops(db: Db, f: DropFilters, viewerId: number | null) {
  const where: string[] = ['d.hidden = 0'];
  const params: Record<string, unknown> = { me: viewerId ?? 0 };
  if (f.q) {
    const fields = [`fold(d.title) LIKE @q ESCAPE '\\'`, `fold(u.username) LIKE @q ESCAPE '\\'`, `fold(d.content) LIKE @q ESCAPE '\\'`];
    where.push(`(${fields.join(' OR ')})`);
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
  const rect = prefilterRectangle(f);
  if (rect) {
    where.push('d.lat BETWEEN @minLat AND @maxLat AND d.lng BETWEEN @minLng AND @maxLng');
    Object.assign(params, rect);
  }
  const clause = `WHERE ${where.join(' AND ')}`;
  const order =
    f.sort === 'popular' ? 'likes_count DESC, d.created_at DESC, d.id DESC' : 'd.created_at DESC, d.id DESC';

  if (!rect) {
    const total = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM drops d JOIN users u ON u.id = d.author_id ${clause}`)
        .get(params) as { n: number }
    ).n;
    const rows = db
      .prepare(`${SELECT_DROP} ${clause} ORDER BY ${order} LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit: f.pageSize, offset: (f.page - 1) * f.pageSize }) as DropRow[];
    return { rows, total, distances: null as number[] | null };
  }

  const candidates = db.prepare(`${SELECT_DROP} ${clause} ORDER BY ${order}`).all(params) as DropRow[];
  const kept: { row: DropRow; distance: number }[] = [];
  for (const row of candidates) {
    const pos = { lat: row.lat, lng: row.lng };
    if (f.near) {
      const distance = haversineMeters(f.near.lat, f.near.lng, pos.lat, pos.lng);
      if (distance <= f.near.radius) kept.push({ row, distance });
    } else if (f.bbox) {
      const inside =
        pos.lat >= f.bbox.minLat && pos.lat <= f.bbox.maxLat && pos.lng >= f.bbox.minLng && pos.lng <= f.bbox.maxLng;
      if (inside) kept.push({ row, distance: 0 });
    }
  }
  if (f.sort === 'distance') kept.sort((a, b) => a.distance - b.distance);
  const slice = kept.slice((f.page - 1) * f.pageSize, f.page * f.pageSize);
  return {
    rows: slice.map((k) => k.row),
    total: kept.length,
    distances: f.near ? slice.map((k) => Math.round(k.distance)) : null,
  };
}

export const paginate = <T>(items: T[], total: number, page: number, pageSize: number) => ({
  items,
  page,
  pageSize,
  total,
  totalPages: Math.ceil(total / pageSize),
});
