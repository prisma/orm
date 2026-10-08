import { describe, expect, it } from 'vitest';
import { createChainingOrm, PostCollection } from './collection-chaining-fixture';

describe('whereUnique', () => {
  it('records the same filter as where with the same object', () => {
    const { db } = createChainingOrm();
    const unique = db.Post.whereUnique({ id: 1 });
    expect(unique.state.filters).toHaveLength(1);
    expect(unique.state).toEqual(db.Post.where({ id: 1 }).state);
  });

  it('records the same filter as where for a compound key', () => {
    const { plain } = createChainingOrm();
    const unique = plain.Project.whereUnique({ tenantId: 1, id: 2 });
    expect(unique.state.filters).toHaveLength(1);
    expect(unique.state).toEqual(plain.Project.where({ tenantId: 1, id: 2 }).state);
  });

  it('adds its filter to the filters already applied', () => {
    const { db } = createChainingOrm();
    const unique = db.Post.where({ title: 'x' }).whereUnique({ id: 1 });
    expect(unique.state.filters).toHaveLength(2);
    expect(unique.state).toEqual(db.Post.where({ title: 'x' }).where({ id: 1 }).state);
  });

  it('keeps the class and leaves the receiver unchanged', () => {
    const { db } = createChainingOrm();
    const unique = db.Post.whereUnique({ id: 1 });
    expect(unique).toBeInstanceOf(PostCollection);
    expect(unique).not.toBe(db.Post);
    expect(db.Post.state.filters).toHaveLength(0);
  });

  it('first reads with the same plan as where with the same object', async () => {
    const { db, runtime } = createChainingOrm();
    await db.Post.whereUnique({ id: 1 }).first();
    await db.Post.where({ id: 1 }).first();
    await db.Post.first();
    expect(runtime.executions).toHaveLength(3);
    const [unique, filtered, unfiltered] = runtime.executions;
    expect(unique?.plan.ast).toBeDefined();
    expect(unique?.plan.ast).toEqual(filtered?.plan.ast);
    expect(unique?.plan.ast).not.toEqual(unfiltered?.plan.ast);
  });

  it('delete writes with the same plan as where with the same object', async () => {
    const { db, runtime } = createChainingOrm();
    await db.Post.whereUnique({ id: 1 }).delete();
    await db.Post.where({ id: 1 }).delete();
    expect(runtime.executions).toHaveLength(2);
    const [unique, filtered] = runtime.executions;
    expect(unique?.plan.ast).toBeDefined();
    expect(unique?.plan.ast).toEqual(filtered?.plan.ast);
  });

  it('throws inside an include refinement reached through a model fragment', () => {
    const { plain } = createChainingOrm();
    const summary = plain.Post.fragment((posts) => posts.select('id', 'title'));
    const onePost = plain.Post.fragment((posts) => posts.whereUnique({ id: 1 }).with(summary));
    expect(() => plain.User.include('posts', (posts) => posts.with(onePost))).toThrow(
      expect.objectContaining({
        code: 'ORM.INCLUDE_INVALID',
        message: 'whereUnique() is not available inside include() refinement callbacks',
        meta: { action: 'whereUnique()' },
      }),
    );
  });

  it('the same model fragment works on a top-level collection', () => {
    const { plain } = createChainingOrm();
    const summary = plain.Post.fragment((posts) => posts.select('id', 'title'));
    const onePost = plain.Post.fragment((posts) => posts.whereUnique({ id: 1 }).with(summary));
    expect(plain.Post.with(onePost).state).toEqual(
      plain.Post.where({ id: 1 }).select('id', 'title').state,
    );
  });
});
