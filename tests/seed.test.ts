import { describe, expect, it } from 'vitest';
import { bearer, buildProductionSeededApp, loginAs } from './helpers.js';

const USERNAMES = ['mathis', 'noah', 'ethan', 'paul', 'paolo', 'nicolas', 'ugo', 'bryan', 'tom'];

describe('données d’exemple de production', () => {
  it('crée exactement les neuf comptes attendus, sans commentaire ni like', () => {
    const { db } = buildProductionSeededApp();
    const users = db.prepare('SELECT username FROM users ORDER BY id').all() as { username: string }[];
    expect(users.map((u) => u.username)).toEqual(USERNAMES);
    expect(db.prepare('SELECT COUNT(*) AS n FROM comments').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM likes').get()).toEqual({ n: 0 });
  });

  it('donne un seul drop à chaque utilisateur', () => {
    const { db } = buildProductionSeededApp();
    const rows = db
      .prepare('SELECT u.username, COUNT(d.id) AS n FROM users u LEFT JOIN drops d ON d.author_id = u.id GROUP BY u.id')
      .all() as { username: string; n: number }[];
    expect(rows).toHaveLength(9);
    for (const row of rows) expect(row.n, row.username).toBe(1);
  });

  it('crée des comptes utilisables avec drops2026, par nom ou par e-mail', async () => {
    const { api } = buildProductionSeededApp();
    for (const username of USERNAMES) {
      expect((await loginAs(api, username)).res.status, username).toBe(200);
    }
    expect((await loginAs(api, 'mathis@example.com')).res.status).toBe(200);
    for (const gone of ['demo', 'lea', 'zoe']) {
      expect((await loginAs(api, gone)).res.status, gone).toBe(401);
    }
  });

  it('place les drops dans la zone et ne les masque pas', async () => {
    const { api } = buildProductionSeededApp();
    const { token } = await loginAs(api, 'mathis');
    const res = await api.get('/drops?pageSize=50').set(bearer(token));
    expect(res.body.total).toBe(9);
    for (const d of res.body.items) {
      expect(Math.abs(d.location.lat - 47.495472)).toBeLessThan(0.03);
      expect(Math.abs(d.location.lng - 6.805279)).toBeLessThan(0.04);
    }
  });
});
