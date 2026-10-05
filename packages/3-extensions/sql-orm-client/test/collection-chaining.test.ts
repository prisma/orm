import { describe, expect, it } from 'vitest';
import { createChainingOrm, PostCollection } from './collection-chaining-fixture';

describe('apply', () => {
  it('returns what the step returns', () => {
    const { db } = createChainingOrm();
    const result = { applied: true };
    expect(db.Post.apply(() => result)).toBe(result);
  });

  it('passes the receiver to the step', () => {
    const { db } = createChainingOrm();
    const posts = db.Post.recent();
    expect(posts.apply((received) => received)).toBe(posts);
  });

  it('an applied where reaches the query plan', async () => {
    const { db, runtime } = createChainingOrm();
    await db.Post.all();
    await db.Post.where((p) => p.views.gte(100)).all();
    await db.Post.apply((posts) => posts.where((p) => p.views.gte(100))).all();
    expect(runtime.executions).toHaveLength(3);
    const [unfiltered, direct, applied] = runtime.executions;
    expect(applied?.plan.ast).toBeDefined();
    expect(applied?.plan.ast).toEqual(direct?.plan.ast);
    expect(applied?.plan.ast).not.toEqual(unfiltered?.plan.ast);
  });
});

describe('chained class methods', () => {
  it('run in order and keep the class', async () => {
    const { db, runtime } = createChainingOrm();
    const chained = db.Post.where({ title: 'x' }).published().recent().limit(5);
    expect(chained).toBeInstanceOf(PostCollection);
    await db.Post.all();
    await chained.all();
    await db.Post.where({ title: 'x' })
      .where((p) => p.views.gte(100))
      .orderBy((p) => p.views.desc())
      .limit(5)
      .all();
    expect(runtime.executions).toHaveLength(3);
    const [unchained, viaClass, viaBuiltIns] = runtime.executions;
    expect(viaClass?.plan.ast).toBeDefined();
    expect(viaClass?.plan.ast).toEqual(viaBuiltIns?.plan.ast);
    expect(viaClass?.plan.ast).not.toEqual(unchained?.plan.ast);
  });

  it('run after include', async () => {
    const { db, runtime } = createChainingOrm();
    const chained = db.Post.include('author').published();
    expect(chained).toBeInstanceOf(PostCollection);
    await db.Post.include('author').all();
    await chained.all();
    await db.Post.include('author')
      .where((p) => p.views.gte(100))
      .all();
    expect(runtime.executions).toHaveLength(3);
    const [unchained, viaClass, viaBuiltIns] = runtime.executions;
    expect(viaClass?.plan.ast).toBeDefined();
    expect(viaClass?.plan.ast).toEqual(viaBuiltIns?.plan.ast);
    expect(viaClass?.plan.ast).not.toEqual(unchained?.plan.ast);
  });
});
