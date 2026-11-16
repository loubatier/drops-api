import { describe, expect, it } from 'vitest';
import { haversineMeters } from '../src/geo.js';
import { bearer, buildSeededApp, loginAs, testConfig } from './helpers.js';

const DROP_KEYS = [
  'author', 'category', 'commentsCount', 'content', 'createdAt', 'hidden', 'id', 'imageUrl', 'isMine',
  'likedByMe', 'likesCount', 'location', 'locked', 'openedByMe', 'opensCount', 'title', 'updatedAt',
];

describe('GET /drops', () => {
  const { api, db } = buildSeededApp();

  it('renvoie la première page avec la pagination', async () => {
    const res = await api.get('/drops');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 60, totalPages: 3 });
    expect(res.body.items).toHaveLength(20);
    const dates = res.body.items.map((d: any) => d.createdAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('respecte page et pageSize, et ne répète aucun drop', async () => {
    const ids = new Set<number>();
    for (const page of [1, 2, 3]) {
      const res = await api.get(`/drops?page=${page}&pageSize=25`);
      expect(res.body.totalPages).toBe(3);
      for (const d of res.body.items) ids.add(d.id);
    }
    expect(ids.size).toBe(60);
  });

  it('renvoie 200 avec items vides au-delà de la dernière page', async () => {
    const res = await api.get('/drops?page=99');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], page: 99, total: 60, totalPages: 3 });
  });

  it.each([
    ['page=0', 'page'],
    ['page=-1', 'page'],
    ['page=abc', 'page'],
    ['page=1.5', 'page'],
    ['pageSize=0', 'pageSize'],
    ['pageSize=51', 'pageSize'],
    ['pageSize=abc', 'pageSize'],
    ['category=autre', 'category'],
    ['sort=hot', 'sort'],
    [`q=${'a'.repeat(101)}`, 'q'],
  ])('renvoie 422 pour ?%s', async (qs, field) => {
    const res = await api.get(`/drops?${qs}`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('validation_failed');
    expect(res.body.error.fields[field]).toBeInstanceOf(Array);
  });

  it('signale plusieurs paramètres invalides à la fois', async () => {
    const res = await api.get('/drops?page=0&sort=hot');
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['page', 'sort']);
  });

  it('filtre par catégorie', async () => {
    const counts: Record<string, number> = { note: 18, photo: 12, tip: 18, riddle: 12 };
    for (const [category, total] of Object.entries(counts)) {
      const res = await api.get(`/drops?category=${category}&pageSize=50`);
      expect(res.body.total).toBe(total);
      expect(res.body.items.every((d: any) => d.category === category)).toBe(true);
    }
  });

  it('filtre par auteur, et renvoie une liste vide pour un inconnu ou sans drop', async () => {
    const lea = await api.get('/drops?author=lea');
    expect(lea.body.total).toBe(5);
    expect(lea.body.items.every((d: any) => d.author.username === 'lea')).toBe(true);
    expect((await api.get('/drops?author=LEA')).body.total).toBe(5);
    for (const author of ['inconnu', 'zoe']) {
      const res = await api.get(`/drops?author=${author}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ items: [], total: 0, totalPages: 0 });
    }
  });

  it('recherche sans tenir compte de la casse ni des accents', async () => {
    const a = await api.get('/drops?q=enigme&pageSize=50');
    const b = await api.get('/drops?q=ÉNIGME&pageSize=50');
    const c = await api.get('/drops?q=%C3%A9nigme&pageSize=50');
    expect(a.body.total).toBe(11);
    expect(b.body.total).toBe(a.body.total);
    expect(c.body.total).toBe(a.body.total);
  });

  it('recherche dans le contenu et le nom d’utilisateur de l’auteur', async () => {
    const content = await api.get('/drops?q=gourde');
    expect(content.body.total).toBe(1);
    expect(content.body.items[0].title).toBe('Eau gratuite');
    const author = await api.get('/drops?q=camille&pageSize=50');
    expect(author.body.total).toBe(5);
  });

  it('traite % et _ comme du texte', async () => {
    expect((await api.get('/drops?q=%25')).body.total).toBe(0);
    expect((await api.get('/drops?q=_')).body.total).toBe(0);
  });

  it('ignore un q vide', async () => {
    expect((await api.get('/drops?q=%20%20')).body.total).toBe(60);
  });

  it('combine les filtres', async () => {
    const res = await api.get('/drops?category=tip&author=lea');
    expect(res.body.items.every((d: any) => d.category === 'tip' && d.author.username === 'lea')).toBe(true);
  });

  it('trie par popularité puis par date', async () => {
    const res = await api.get('/drops?sort=popular&pageSize=50');
    const items = res.body.items as any[];
    for (let i = 1; i < items.length; i++) {
      const [a, b] = [items[i - 1], items[i]];
      expect(a.likesCount).toBeGreaterThanOrEqual(b.likesCount);
      if (a.likesCount === b.likesCount) expect(a.createdAt >= b.createdAt).toBe(true);
    }
    expect(items[0].likesCount).toBeGreaterThan(items.at(-1).likesCount);
  });

  it('exclut les drops masqués', async () => {
    const { api, db } = buildSeededApp();
    db.prepare('UPDATE drops SET hidden = 1 WHERE id = 5').run();
    const res = await api.get('/drops?pageSize=50');
    expect(res.body.total).toBe(59);
    expect(res.body.items.some((d: any) => d.id === 5)).toBe(false);
  });

  it('renvoie un Drop conforme au contrat', async () => {
    const res = await api.get('/drops');
    const drop = res.body.items[0];
    expect(Object.keys(drop).sort()).toEqual(DROP_KEYS);
    expect(Object.keys(drop.author).sort()).toEqual(['avatarUrl', 'displayName', 'id', 'username']);
    expect(Object.keys(drop.location).sort()).toEqual(['lat', 'lng', 'precision']);
    expect(drop).toMatchObject({ locked: false, hidden: false, opensCount: 0, likedByMe: false, openedByMe: false, isMine: false });
    expect(drop.location.precision).toBe('exact');
    expect(drop.content).toBeTypeOf('string');
    expect(JSON.stringify(res.body)).not.toContain('email');
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('renvoie le bon identifiant d’auteur pour les drops et les commentaires', async () => {
    const res = await api.get('/drops?pageSize=50');
    for (const drop of res.body.items) {
      const user = db.prepare('SELECT id FROM users WHERE username = ?').get(drop.author.username) as { id: number };
      const row = db.prepare('SELECT author_id FROM drops WHERE id = ?').get(drop.id) as { author_id: number };
      expect(drop.author.id).toBe(user.id);
      expect(drop.author.id).toBe(row.author_id);
    }
    const withComments = db.prepare('SELECT DISTINCT drop_id FROM comments LIMIT 10').all() as { drop_id: number }[];
    for (const { drop_id } of withComments) {
      const comments = (await api.get(`/drops/${drop_id}/comments`)).body.items;
      for (const c of comments) {
        const row = db.prepare('SELECT author_id FROM comments WHERE id = ?').get(c.id) as { author_id: number };
        expect(c.author.id).toBe(row.author_id);
      }
    }
  });

  it('compte likes et commentaires', async () => {
    const res = await api.get('/drops?pageSize=50');
    for (const drop of res.body.items) {
      const likes = db.prepare('SELECT COUNT(*) AS n FROM likes WHERE drop_id = ?').get(drop.id) as any;
      const comments = db.prepare('SELECT COUNT(*) AS n FROM comments WHERE drop_id = ?').get(drop.id) as any;
      expect(drop.likesCount).toBe(likes.n);
      expect(drop.commentsCount).toBe(comments.n);
    }
  });

  it('alimente isMine et likedByMe avec un token', async () => {
    const { token } = await loginAs(api, 'lea');
    const mine = await api.get('/drops?author=lea').set(bearer(token));
    expect(mine.body.items.every((d: any) => d.isMine)).toBe(true);
    const others = await api.get('/drops?author=yanis').set(bearer(token));
    expect(others.body.items.every((d: any) => !d.isMine)).toBe(true);
    const liked = db
      .prepare("SELECT drop_id FROM likes WHERE user_id = (SELECT id FROM users WHERE username = 'lea') LIMIT 1")
      .get() as { drop_id: number };
    const detail = await api.get(`/drops/${liked.drop_id}`).set(bearer(token));
    expect(detail.body.likedByMe).toBe(true);
    const anonymous = await api.get(`/drops/${liked.drop_id}`);
    expect(anonymous.body.likedByMe).toBe(false);
  });
});

describe('GET /drops/:id', () => {
  const { api, db } = buildSeededApp();

  it('renvoie le drop', async () => {
    const res = await api.get('/drops/10');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(10);
    expect(Object.keys(res.body).sort()).toEqual(DROP_KEYS);
  });

  it.each(['abc', '1.5', '-1', '99999', '0'])('renvoie 404 pour %s', async (id) => {
    const res = await api.get(`/drops/${id}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('masque un drop signalé aux autres, pas à son auteur', async () => {
    const owner = db
      .prepare('SELECT u.username FROM drops d JOIN users u ON u.id = d.author_id WHERE d.id = 7')
      .get() as { username: string };
    db.prepare('UPDATE drops SET hidden = 1 WHERE id = 7').run();
    expect((await api.get('/drops/7')).status).toBe(404);
    const other = await loginAs(api, owner.username === 'demo' ? 'lea' : 'demo');
    expect((await api.get('/drops/7').set(bearer(other.token))).status).toBe(404);
    const author = await loginAs(api, owner.username);
    const res = await api.get('/drops/7').set(bearer(author.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hidden: true, isMine: true });
    expect((await api.get('/drops/7/comments')).status).toBe(404);
    expect((await api.get('/drops/7/comments').set(bearer(author.token))).status).toBe(200);
  });
});

describe('GET /drops/:id/comments', () => {
  const { api, db } = buildSeededApp();

  it('liste les commentaires du plus ancien au plus récent', async () => {
    const row = db
      .prepare('SELECT drop_id, COUNT(*) AS n FROM comments GROUP BY drop_id ORDER BY n DESC LIMIT 1')
      .get() as { drop_id: number; n: number };
    const res = await api.get(`/drops/${row.drop_id}/comments`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: row.n });
    const dates = res.body.items.map((c: any) => c.createdAt);
    expect(dates).toEqual([...dates].sort());
    const comment = res.body.items[0];
    expect(Object.keys(comment).sort()).toEqual(['author', 'content', 'createdAt', 'dropId', 'id', 'isMine']);
    expect(comment.dropId).toBe(row.drop_id);
    expect(comment.isMine).toBe(false);
    expect(Object.keys(comment.author).sort()).toEqual(['avatarUrl', 'displayName', 'id', 'username']);
  });

  it('pagine', async () => {
    const row = db
      .prepare('SELECT drop_id FROM comments GROUP BY drop_id HAVING COUNT(*) >= 3 LIMIT 1')
      .get() as { drop_id: number };
    const res = await api.get(`/drops/${row.drop_id}/comments?pageSize=2&page=2`);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    expect(res.body.pageSize).toBe(2);
    expect(res.body.totalPages).toBe(Math.ceil(res.body.total / 2));
  });

  it('renvoie une liste vide pour un drop sans commentaire', async () => {
    const res = await api.get('/drops/1/comments');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], total: 0, totalPages: 0 });
  });

  it('renvoie 404 si le drop n’existe pas ou si l’id est invalide', async () => {
    expect((await api.get('/drops/9999/comments')).status).toBe(404);
    expect((await api.get('/drops/abc/comments')).status).toBe(404);
  });

  it('renvoie 422 sur une pagination invalide', async () => {
    const res = await api.get('/drops/1/comments?pageSize=100');
    expect(res.status).toBe(422);
    expect(res.body.error.fields.pageSize).toBeDefined();
  });

  it('marque isMine pour l’auteur du commentaire', async () => {
    const row = db
      .prepare(
        `SELECT c.drop_id, u.username FROM comments c JOIN users u ON u.id = c.author_id LIMIT 1`,
      )
      .get() as { drop_id: number; username: string };
    const { token } = await loginAs(api, row.username);
    const res = await api.get(`/drops/${row.drop_id}/comments`).set(bearer(token));
    expect(res.body.items.some((c: any) => c.isMine && c.author.username === row.username)).toBe(true);
  });
});

describe('GET /users/:username et /categories', () => {
  const { api, db } = buildSeededApp();

  it('renvoie un profil avec ses statistiques', async () => {
    const res = await api.get('/users/lea');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ['avatarUrl', 'bio', 'createdAt', 'displayName', 'id', 'stats', 'username'],
    );
    const drops = db.prepare("SELECT COUNT(*) AS n FROM drops WHERE author_id = ?").get(res.body.id) as any;
    const likes = db
      .prepare('SELECT COUNT(*) AS n FROM likes l JOIN drops d ON d.id = l.drop_id WHERE d.author_id = ?')
      .get(res.body.id) as any;
    const comments = db.prepare('SELECT COUNT(*) AS n FROM comments WHERE author_id = ?').get(res.body.id) as any;
    expect(res.body.stats).toEqual({ dropsCount: drops.n, likesReceived: likes.n, commentsCount: comments.n });
    expect(res.body.email).toBeUndefined();
  });

  it('accepte une casse différente et renvoie des zéros pour un utilisateur sans drop', async () => {
    expect((await api.get('/users/LEA')).status).toBe(200);
    const zoe = await api.get('/users/zoe');
    expect(zoe.body.stats.dropsCount).toBe(0);
    expect(zoe.body.stats.likesReceived).toBe(0);
  });

  it('renvoie 404 pour un utilisateur inconnu', async () => {
    for (const name of ['inconnu', 'me', 'admin']) {
      const res = await api.get(`/users/${name}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('not_found');
    }
  });

  it('liste les quatre catégories', async () => {
    const res = await api.get('/categories');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'note', label: 'Un mot' },
      { id: 'photo', label: 'Une photo' },
      { id: 'tip', label: 'Une recommandation' },
      { id: 'riddle', label: 'Une énigme' },
    ]);
  });
});

describe('limites de lecture', () => {
  it('limite par IP sans token et par utilisateur avec token, hors /health', async () => {
    const { api } = buildSeededApp({ rateLimit: { ...testConfig().rateLimit, read: 3 } });
    const { token } = await loginAs(api, 'lea');
    for (let i = 0; i < 3; i++) {
      const res = await api.get('/categories');
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('3');
      expect(res.headers['ratelimit-remaining']).toBe(String(2 - i));
    }
    const limited = await api.get('/categories');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['www-authenticate']).toBeUndefined();
    expect((await api.get('/categories').set(bearer(token))).status).toBe(200);
    for (let i = 0; i < 8; i++) expect((await api.get('/health')).status).toBe(200);
    for (let i = 0; i < 8; i++) expect((await api.get('/docs')).status).toBe(200);
  });
});

describe('données d’exemple', () => {
  it('respecte la zone et les proportions', () => {
    const { db } = buildSeededApp();
    const rows = db.prepare('SELECT lat, lng, category FROM drops').all() as any[];
    const center = testConfig().zone;
    const distances = rows.map((r) => haversineMeters(center.lat, center.lng, r.lat, r.lng));
    expect(rows).toHaveLength(60);
    expect(Math.max(...distances)).toBeLessThanOrEqual(3000);
    expect(distances.filter((d) => d < 800).length).toBeGreaterThanOrEqual(40);
    expect(distances.filter((d) => d < 800).length).toBeLessThanOrEqual(46);
    const byCategory = (c: string) => rows.filter((r) => r.category === c).length;
    expect([byCategory('note'), byCategory('photo'), byCategory('tip'), byCategory('riddle')]).toEqual([18, 12, 18, 12]);
  });

  it('crée 12 utilisateurs plus demo, avec un utilisateur sans drop et un drop sans commentaire', () => {
    const { db } = buildSeededApp();
    expect((db.prepare('SELECT COUNT(*) AS n FROM users').get() as any).n).toBe(13);
    expect(db.prepare("SELECT 1 FROM users WHERE username = 'demo'").get()).toBeDefined();
    const withoutDrops = db
      .prepare('SELECT COUNT(*) AS n FROM users u WHERE NOT EXISTS (SELECT 1 FROM drops d WHERE d.author_id = u.id)')
      .get() as any;
    expect(withoutDrops.n).toBeGreaterThanOrEqual(1);
    const withoutComments = db
      .prepare('SELECT COUNT(*) AS n FROM drops d WHERE NOT EXISTS (SELECT 1 FROM comments c WHERE c.drop_id = d.id)')
      .get() as any;
    expect(withoutComments.n).toBeGreaterThanOrEqual(1);
  });

  it('borne likes (0 à 8), commentaires (0 à 4) et dates (14 jours)', () => {
    const { db } = buildSeededApp();
    const likes = db.prepare('SELECT COUNT(*) AS n FROM likes GROUP BY drop_id').all() as any[];
    const comments = db.prepare('SELECT COUNT(*) AS n FROM comments GROUP BY drop_id').all() as any[];
    expect(Math.max(...likes.map((l) => l.n))).toBeLessThanOrEqual(8);
    expect(Math.max(...comments.map((c) => c.n))).toBeLessThanOrEqual(4);
    const dates = db.prepare('SELECT MIN(created_at) AS min, MAX(created_at) AS max FROM drops').get() as any;
    const now = new Date('2026-11-16T12:00:00.000Z').getTime();
    expect(now - new Date(dates.min).getTime()).toBeLessThanOrEqual(14 * 86_400_000 + 60_000);
    expect(new Date(dates.max).getTime()).toBeLessThan(now);
  });

  it('utilise des photos picsum pour la catégorie photo uniquement', () => {
    const { db } = buildSeededApp();
    const photos = db.prepare("SELECT image_url FROM drops WHERE category = 'photo'").all() as any[];
    expect(photos.every((p) => /^https:\/\/picsum\.photos\/seed\/drop-\d+\/800\/600$/.test(p.image_url))).toBe(true);
    expect((db.prepare("SELECT COUNT(*) AS n FROM drops WHERE category != 'photo' AND image_url IS NOT NULL").get() as any).n).toBe(0);
  });

  it('est déterministe', () => {
    const dump = () => {
      const { db } = buildSeededApp();
      const select = (sql: string) => db.prepare(sql).all();
      return {
        users: select('SELECT id, username, email, display_name, bio, created_at FROM users ORDER BY id'),
        drops: select('SELECT * FROM drops ORDER BY id'),
        likes: select('SELECT * FROM likes ORDER BY drop_id, user_id'),
        comments: select('SELECT * FROM comments ORDER BY id'),
      };
    };
    expect(dump()).toEqual(dump());
  });

  it('crée des comptes utilisables avec drops2026', async () => {
    const { api } = buildSeededApp();
    for (const login of ['demo', 'lea', 'zoe']) {
      expect((await loginAs(api, login)).res.status).toBe(200);
    }
    expect((await loginAs(api, 'demo@example.com')).res.status).toBe(200);
  });
});
