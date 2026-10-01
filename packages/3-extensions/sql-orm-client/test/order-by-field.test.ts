import type { Direction } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { orderByField } from '../src/query-fragments';
import { createChainingOrm } from './collection-chaining-fixture';

describe('orderByField', () => {
  it('orders like the same field written in orderBy', async () => {
    const { db, runtime } = createChainingOrm();
    await db.Post.orderBy((p) => p.title.desc()).all();
    await db.Post.orderBy(orderByField(db.Post, 'title', 'desc')).all();
    await db.Post.orderBy((p) => p.title.asc()).all();
    const [direct, ordered, ascending] = runtime.executions;
    expect(ordered?.plan.ast).toBeDefined();
    expect(ordered?.plan.ast).toEqual(direct?.plan.ast);
    expect(ordered?.plan.ast).not.toEqual(ascending?.plan.ast);
  });

  it('orders ascending by default and through the field to column mapping', async () => {
    const { db, runtime } = createChainingOrm();
    await db.Post.orderBy((p) => p.userId.asc()).all();
    await db.Post.orderBy(orderByField(db.Post, 'userId')).all();
    const [direct, ordered] = runtime.executions;
    expect(ordered?.plan.ast).toBeDefined();
    expect(ordered?.plan.ast).toEqual(direct?.plan.ast);
  });

  it('accepts a name in the allowed list', async () => {
    const { db, runtime } = createChainingOrm();
    await db.Post.orderBy((p) => p.views.desc()).all();
    await db.Post.orderBy(orderByField(db.Post, 'views', 'desc', ['title', 'views'])).all();
    const [direct, ordered] = runtime.executions;
    expect(ordered?.plan.ast).toBeDefined();
    expect(ordered?.plan.ast).toEqual(direct?.plan.ast);
  });

  it('works inside an include refinement', async () => {
    const { db, runtime } = createChainingOrm();
    await db.User.include('posts', (posts) => posts.orderBy((p) => p.title.asc())).all();
    await db.User.include('posts', (posts) => posts.orderBy(orderByField(posts, 'title'))).all();
    const [direct, ordered] = runtime.executions;
    expect(ordered?.plan.ast).toBeDefined();
    expect(ordered?.plan.ast).toEqual(direct?.plan.ast);
  });

  describe('throws ORM.ARGUMENT_INVALID before the query runs', () => {
    it('for a name that is not a field', () => {
      const { db, runtime } = createChainingOrm();
      expect(() => orderByField(db.Post, 'nope')).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message: 'Cannot order Post by "nope"',
          why: 'Post has no field "nope".',
          fix: 'Order by one of: id, title, userId, views.',
          meta: { model: 'Post', field: 'nope' },
        }),
      );
      expect(runtime.executions).toEqual([]);
    });

    it('for a name that only the object prototype has', () => {
      const { db } = createChainingOrm();
      expect(() => orderByField(db.Post, 'constructor')).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          why: 'Post has no field "constructor".',
        }),
      );
    });

    it('for a relation', () => {
      const { db } = createChainingOrm();
      expect(() => orderByField(db.Post, 'author')).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          why: '"author" is a relation of Post, not a field.',
        }),
      );
    });

    it('for a field whose codec has no order trait', () => {
      const { db } = createChainingOrm();
      expect(() => orderByField(db.Post, 'embedding')).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          why: 'The codec pg/vector@1 of Post.embedding cannot be ordered.',
        }),
      );
    });

    it('for a field outside the allowed list', () => {
      const { db } = createChainingOrm();
      expect(() => orderByField(db.Post, 'views', 'asc', ['title', 'id'])).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message: 'Cannot order Post by "views"',
          why: '"views" is not one of the fields allowed for ordering.',
          fix: 'Order by one of: title, id.',
        }),
      );
    });

    it('for a direction other than asc and desc', () => {
      const { db } = createChainingOrm();
      const direction = 'up' as Direction;
      expect(() => orderByField(db.Post, 'title', direction)).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message: 'Cannot order Post in direction "up"',
          why: 'An order direction is "asc" or "desc".',
          fix: 'Pass "asc" or "desc".',
          meta: { model: 'Post', direction: 'up' },
        }),
      );
    });
  });

  describe('quotes the request text in the error', () => {
    it('escapes quotes and line breaks', () => {
      const { db } = createChainingOrm();
      const name = 'x"\nInjected line';
      expect(() => orderByField(db.Post, name)).toThrow(
        expect.objectContaining({
          message: 'Cannot order Post by "x\\"\\nInjected line"',
          why: 'Post has no field "x\\"\\nInjected line".',
          meta: { model: 'Post', field: name },
        }),
      );
    });

    it('cuts a long name to 64 characters and keeps it whole in meta', () => {
      const { db } = createChainingOrm();
      const name = 'a'.repeat(100);
      const shown = `"${'a'.repeat(64)}…"`;
      expect(() => orderByField(db.Post, name)).toThrow(
        expect.objectContaining({
          message: `Cannot order Post by ${shown}`,
          why: `Post has no field ${shown}.`,
          fix: 'Order by one of: id, title, userId, views. The name above is cut to its first 64 characters.',
          meta: { model: 'Post', field: name },
        }),
      );
    });

    it('cuts a long direction the same way', () => {
      const { db } = createChainingOrm();
      const direction = 'd'.repeat(70) as Direction;
      expect(() => orderByField(db.Post, 'title', direction)).toThrow(
        expect.objectContaining({
          message: `Cannot order Post in direction "${'d'.repeat(64)}…"`,
          fix: 'Pass "asc" or "desc". The direction above is cut to its first 64 characters.',
          meta: { model: 'Post', direction },
        }),
      );
    });

    it('cuts by characters, so a character at the limit stays whole', () => {
      const { db } = createChainingOrm();
      const name = `${'a'.repeat(63)}😀${'b'.repeat(5)}`;
      expect(() => orderByField(db.Post, name)).toThrow(
        expect.objectContaining({
          message: `Cannot order Post by "${'a'.repeat(63)}😀…"`,
          meta: { model: 'Post', field: name },
        }),
      );
    });

    it('does not cut a name of exactly 64 characters', () => {
      const { db } = createChainingOrm();
      const name = `${'a'.repeat(63)}😀`;
      expect(() => orderByField(db.Post, name)).toThrow(
        expect.objectContaining({
          message: `Cannot order Post by "${name}"`,
          fix: 'Order by one of: id, title, userId, views.',
        }),
      );
    });
  });

  describe('refuses a request value that is not a string', () => {
    const received = [
      ['undefined', undefined],
      ['null', null],
      ['a number', 5],
      ['an array', ['title']],
      ['an object', { field: 'title' }],
    ] as const;

    it.each(received)('for a name that is %s', (description, value) => {
      const { db } = createChainingOrm();
      expect(() => orderByField(db.Post, value as unknown as string)).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message: 'Cannot order Post: the field name is not a string',
          why: `An order field name is a string; received ${description}.`,
          fix: 'Order by one of: id, title, userId, views.',
          meta: { model: 'Post', field: value },
        }),
      );
    });

    it.each(received.slice(1))('for a direction that is %s', (description, value) => {
      const { db } = createChainingOrm();
      expect(() => orderByField(db.Post, 'title', value as unknown as Direction)).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message: 'Cannot order Post: the direction is not a string',
          why: `An order direction is "asc" or "desc"; received ${description}.`,
          fix: 'Pass "asc" or "desc".',
          meta: { model: 'Post', direction: value },
        }),
      );
    });

    it('orders ascending for an undefined direction, the default', async () => {
      const { db, runtime } = createChainingOrm();
      await db.Post.orderBy((p) => p.title.asc()).all();
      await db.Post.orderBy(orderByField(db.Post, 'title', undefined)).all();
      const [direct, ordered] = runtime.executions;
      expect(ordered?.plan.ast).toBeDefined();
      expect(ordered?.plan.ast).toEqual(direct?.plan.ast);
    });
  });

  describe('with an empty allowed list', () => {
    it('refuses every name and says the list names no field', () => {
      const { db } = createChainingOrm();
      expect(() => orderByField(db.Post, 'title', 'asc', [])).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message: 'Cannot order Post by "title"',
          why: '"title" is not one of the fields allowed for ordering.',
          fix: 'Pass an allowed list that names at least one field of Post that can be ordered.',
        }),
      );
    });
  });
});
