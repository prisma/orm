import { describe, expect, it } from 'vitest';
import { createChainingOrm } from './collection-chaining-fixture';

const { db: scopes } = createChainingOrm();
const summary = scopes.Post.scope((posts) => posts.select('id', 'title').include('author'));

describe('collection.scope', () => {
  it('runs the body on the collection it is applied to', async () => {
    const { db, runtime } = createChainingOrm();
    await db.Post.select('id', 'title').include('author').all();
    await db.Post.apply(summary).all();
    await db.Post.all();
    const [inline, applied, unchanged] = runtime.executions;
    expect(applied?.plan.ast).toBeDefined();
    expect(applied?.plan.ast).toEqual(inline?.plan.ast);
    expect(applied?.plan.ast).not.toEqual(unchanged?.plan.ast);
  });

  it('keeps a filter applied before the scope', async () => {
    const { db, runtime } = createChainingOrm();
    await db.Post.where((p) => p.views.gte(100))
      .select('id', 'title')
      .include('author')
      .all();
    await db.Post.published().apply(summary).all();
    const [inline, applied] = runtime.executions;
    expect(applied?.plan.ast).toBeDefined();
    expect(applied?.plan.ast).toEqual(inline?.plan.ast);
  });

  it('keeps an order applied before the scope', async () => {
    const { db, runtime } = createChainingOrm();
    await db.Post.orderBy((p) => p.views.desc())
      .select('id', 'title')
      .include('author')
      .all();
    await db.Post.recent().apply(summary).all();
    await db.Post.apply(summary).all();
    const [inline, applied, unordered] = runtime.executions;
    expect(applied?.plan.ast).toBeDefined();
    expect(applied?.plan.ast).toEqual(inline?.plan.ast);
    expect(applied?.plan.ast).not.toEqual(unordered?.plan.ast);
  });

  it('runs inside an include refinement', async () => {
    const { db, runtime } = createChainingOrm();
    await db.User.include('posts', (posts) => posts.select('id', 'title').include('author')).all();
    await db.User.include('posts', (posts) => posts.apply(summary)).all();
    const [inline, applied] = runtime.executions;
    expect(applied?.plan.ast).toBeDefined();
    expect(applied?.plan.ast).toEqual(inline?.plan.ast);
  });
});
