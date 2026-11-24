import { describe, expect, it } from 'vitest';
import { bearer, buildSeededApp, loginAs } from './helpers.js';

async function setup() {
  const ctx = buildSeededApp();
  const lea = (await loginAs(ctx.api, 'lea')).token;
  const demo = (await loginAs(ctx.api, 'demo')).token;
  const drop = (
    await ctx.api.post('/drops').set(bearer(lea)).send({ title: 'Un coin', content: 'Calme.', category: 'tip', lat: 48.85, lng: 2.35 })
  ).body as { id: number };
  const post = async (token: string, content: string, parentId?: number) =>
    (await ctx.api.post(`/drops/${drop.id}/comments`).set(bearer(token)).send({ content, parentId })).body;
  return { ...ctx, lea, demo, drop, post };
}

describe('réponses aux commentaires', () => {
  it('rattache une réponse à une réponse au commentaire racine', async () => {
    const { api, lea, demo, drop, post } = await setup();
    const root = await post(lea, 'Racine');
    const first = await post(demo, 'Réponse', root.id);
    const nested = await post(lea, 'Réponse à la réponse', first.id);
    expect(root.parentId).toBeNull();
    expect(first.parentId).toBe(root.id);
    expect(nested.parentId).toBe(root.id);

    const list = (await api.get(`/drops/${drop.id}/comments`).set(bearer(lea))).body;
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ id: root.id, repliesCount: 2 });

    const replies = (await api.get(`/comments/${root.id}/replies`).set(bearer(lea))).body;
    expect(replies.items.map((c: any) => c.id)).toEqual([first.id, nested.id]);
    expect((await api.get(`/drops/${drop.id}`).set(bearer(lea))).body.commentsCount).toBe(3);
    expect((await api.get(`/comments/${first.id}/replies`).set(bearer(lea))).status).toBe(404);
  });

  it('refuse un parentId inconnu ou d’un autre drop', async () => {
    const { api, lea, drop, post } = await setup();
    const other = (
      await api.post('/drops').set(bearer(lea)).send({ title: 'Autre', content: 'x', category: 'note', lat: 48.8, lng: 2.3 })
    ).body;
    const foreign = (await api.post(`/drops/${other.id}/comments`).set(bearer(lea)).send({ content: 'ailleurs' })).body;
    for (const parentId of [9999, foreign.id]) {
      const res = await api.post(`/drops/${drop.id}/comments`).set(bearer(lea)).send({ content: 'x', parentId });
      expect(res.status).toBe(422);
      expect(res.body.error.fields.parentId).toBeDefined();
    }
    expect((await api.post(`/drops/${drop.id}/comments`).set(bearer(lea)).send({ content: 'x', parentId: 'a' })).status).toBe(422);
    await post(lea, 'ok');
  });

  it('garde un commentaire supprimé qui a des réponses, puis le retire avec la dernière réponse', async () => {
    const { api, lea, demo, drop, post } = await setup();
    const root = await post(lea, 'Racine');
    const reply = await post(demo, 'Réponse', root.id);

    expect((await api.delete(`/comments/${root.id}`).set(bearer(lea))).status).toBe(204);
    const list = (await api.get(`/drops/${drop.id}/comments`).set(bearer(lea))).body;
    expect(list.items[0]).toMatchObject({ id: root.id, deleted: true, content: '', isMine: false, repliesCount: 1 });
    expect(list.items[0].author.username).toBe('deleted');
    expect((await api.delete(`/comments/${root.id}`).set(bearer(lea))).status).toBe(404);
    expect((await api.get(`/drops/${drop.id}`).set(bearer(lea))).body.commentsCount).toBe(1);
    expect((await api.post(`/comments/${root.id}/like`).set(bearer(demo))).status).toBe(404);

    expect((await api.delete(`/comments/${reply.id}`).set(bearer(demo))).status).toBe(204);
    expect((await api.get(`/drops/${drop.id}/comments`).set(bearer(lea))).body.total).toBe(0);
  });

  it('supprime tout de suite un commentaire sans réponse et refuse un autre auteur', async () => {
    const { api, lea, demo, drop, post } = await setup();
    const root = await post(lea, 'Racine');
    expect((await api.delete(`/comments/${root.id}`).set(bearer(demo))).status).toBe(403);
    expect((await api.delete(`/comments/${root.id}`).set(bearer(lea))).status).toBe(204);
    expect((await api.get(`/drops/${drop.id}/comments`).set(bearer(lea))).body.total).toBe(0);
  });
});

describe('dislikes', () => {
  it('un drop : like et dislike s’excluent, les deux sont idempotents', async () => {
    const { api, lea, demo, drop } = await setup();
    const liked = await api.post(`/drops/${drop.id}/like`).set(bearer(demo));
    expect(liked.body).toEqual({ liked: true, disliked: false, likesCount: 1, dislikesCount: 0 });
    const disliked = await api.post(`/drops/${drop.id}/dislike`).set(bearer(demo));
    expect(disliked.body).toEqual({ liked: false, disliked: true, likesCount: 0, dislikesCount: 1 });
    expect((await api.post(`/drops/${drop.id}/dislike`).set(bearer(demo))).body.dislikesCount).toBe(1);
    expect((await api.post(`/drops/${drop.id}/dislike`).set(bearer(lea))).body.dislikesCount).toBe(2);
    const detail = (await api.get(`/drops/${drop.id}`).set(bearer(demo))).body;
    expect(detail).toMatchObject({ likedByMe: false, dislikedByMe: true, likesCount: 0, dislikesCount: 2 });
    expect((await api.delete(`/drops/${drop.id}/dislike`).set(bearer(demo))).body).toMatchObject({ disliked: false, dislikesCount: 1 });
    expect((await api.delete(`/drops/${drop.id}/dislike`).set(bearer(demo))).body).toMatchObject({ disliked: false, dislikesCount: 1 });
    expect((await api.post('/drops/9999/dislike').set(bearer(demo))).status).toBe(404);
    expect((await api.post(`/drops/${drop.id}/dislike`)).status).toBe(401);
  });

  it('un commentaire : like et dislike s’excluent', async () => {
    const { api, lea, demo, post } = await setup();
    const comment = await post(lea, 'Salut');
    expect((await api.post(`/comments/${comment.id}/like`).set(bearer(demo))).body).toEqual({
      liked: true, disliked: false, likesCount: 1, dislikesCount: 0,
    });
    expect((await api.post(`/comments/${comment.id}/dislike`).set(bearer(demo))).body).toEqual({
      liked: false, disliked: true, likesCount: 0, dislikesCount: 1,
    });
    expect((await api.delete(`/comments/${comment.id}/like`).set(bearer(demo))).body).toMatchObject({ disliked: true, dislikesCount: 1 });
    expect((await api.post(`/comments/${comment.id}/like`).set(bearer(lea))).body.likesCount).toBe(1);
    const reply = await post(demo, 'Réponse', comment.id);
    const replies = (await api.get(`/comments/${comment.id}/replies`).set(bearer(demo))).body;
    expect(replies.items[0]).toMatchObject({ id: reply.id, likedByMe: false });
    expect((await api.delete(`/comments/${comment.id}/dislike`).set(bearer(demo))).body).toMatchObject({ disliked: false, dislikesCount: 0 });
    expect((await api.post('/comments/9999/like').set(bearer(demo))).status).toBe(404);
  });
});
