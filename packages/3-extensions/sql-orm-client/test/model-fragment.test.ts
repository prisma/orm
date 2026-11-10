import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { createChainingOrm } from './collection-chaining-fixture';

const { db: fragments } = createChainingOrm();
const summary = fragments.Post.fragment((posts) => posts.select('id', 'title').include('author'));

describe('collection.fragment', () => {
  it('runs the body on the collection it is applied to', async () => {
    const { db, runtime } = createChainingOrm();
    await db.Post.select('id', 'title').include('author').all();
    await db.Post.with(summary).all();
    await db.Post.all();
    const [inline, applied, unchanged] = runtime.executions;
    expect(applied?.plan.ast).toBeDefined();
    expect(applied?.plan.ast).toEqual(inline?.plan.ast);
    expect(applied?.plan.ast).not.toEqual(unchanged?.plan.ast);
  });

  it('keeps a filter applied before the fragment', async () => {
    const { db, runtime } = createChainingOrm();
    await db.Post.where((p) => p.views.gte(100))
      .select('id', 'title')
      .include('author')
      .all();
    await db.Post.published().with(summary).all();
    const [inline, applied] = runtime.executions;
    expect(applied?.plan.ast).toBeDefined();
    expect(applied?.plan.ast).toEqual(inline?.plan.ast);
  });

  it('keeps an order applied before the fragment', async () => {
    const { db, runtime } = createChainingOrm();
    await db.Post.orderBy((p) => p.views.desc())
      .select('id', 'title')
      .include('author')
      .all();
    await db.Post.recent().with(summary).all();
    await db.Post.with(summary).all();
    const [inline, applied, unordered] = runtime.executions;
    expect(applied?.plan.ast).toBeDefined();
    expect(applied?.plan.ast).toEqual(inline?.plan.ast);
    expect(applied?.plan.ast).not.toEqual(unordered?.plan.ast);
  });

  it('runs inside an include refinement', async () => {
    const { db, runtime } = createChainingOrm();
    await db.User.include('posts', (posts) => posts.select('id', 'title').include('author')).all();
    await db.User.include('posts', (posts) => posts.with(summary)).all();
    const [inline, applied] = runtime.executions;
    expect(applied?.plan.ast).toBeDefined();
    expect(applied?.plan.ast).toEqual(inline?.plan.ast);
  });

  it.each([
    ['undefined', undefined, 'undefined'],
    ['null', null, 'null'],
    ['a number', 3, 'a number'],
    ['an object', {}, 'an object'],
  ])('refuses %s as the body from a JavaScript caller', (_label, body, received) => {
    const { db } = createChainingOrm();
    const fragment = blindCast<(body: unknown) => unknown, 'a JavaScript caller'>(
      db.Post.fragment.bind(db.Post),
    );
    expect(() => fragment(body)).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'Cannot define the fragment: the body is not a function',
        why: `The body of a fragment is a function that receives a collection and returns one; received ${received}.`,
      }),
    );
  });
});
