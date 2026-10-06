import {
  jsonbColumn,
  textColumn,
  timestamptzTemporalColumn,
} from '@internal/adapter-postgres/column-types';
import { field } from '@internal/sql-contract-ts/contract-builder';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it, vi } from 'vitest';
import { createScopesOrm } from './scopes-fixture';

function scopes() {
  const fixture = createScopesOrm();
  const notDeleted = fixture.client.scope(
    { deletedAt: field.column(timestamptzTemporalColumn).optional() },
    (rows) => rows.where((r) => r.deletedAt.isNull()),
  );
  const deletedLast = fixture.client.scope(
    { deletedAt: { codecId: 'pg/timestamptz-temporal@1', nullable: true } },
    (rows) => rows.orderBy((r) => r.deletedAt.desc()).limit(5),
  );
  return { ...fixture, notDeleted, deletedLast };
}

function untyped(scope: unknown): (collection: unknown) => unknown {
  return blindCast<
    (collection: unknown) => unknown,
    'a JavaScript caller applies the scope to any collection'
  >(scope);
}

describe('client.scope', () => {
  it('puts the filter of the body in the plan, through the field to column mapping', async () => {
    const { plain, runtime, notDeleted } = scopes();
    await plain.Post.where((p) => p.deletedAt.isNull()).all();
    await plain.Post.apply(notDeleted).all();
    await plain.Post.all();
    const [inline, applied, unfiltered] = runtime.executions;
    expect(applied?.plan.ast).toBeDefined();
    expect(applied?.plan.ast).toEqual(inline?.plan.ast);
    expect(applied?.plan.ast).not.toEqual(unfiltered?.plan.ast);
  });

  it('puts the order and limit of the body in the plan', async () => {
    const { plain, runtime, deletedLast } = scopes();
    await plain.Comment.orderBy((c) => c.deletedAt.desc())
      .limit(5)
      .all();
    await plain.Comment.apply(deletedLast).all();
    const [inline, applied] = runtime.executions;
    expect(applied?.plan.ast).toBeDefined();
    expect(applied?.plan.ast).toEqual(inline?.plan.ast);
  });

  it('runs on a custom class, after where and in an include refinement', async () => {
    const { db, plain, runtime, notDeleted } = scopes();
    await db.Post.where({ title: 'x' })
      .where((p) => p.deletedAt.isNull())
      .all();
    await db.Post.where({ title: 'x' }).apply(notDeleted).all();
    await plain.User.include('posts', (posts) => posts.where((p) => p.deletedAt.isNull())).all();
    await plain.User.include('posts', (posts) => posts.apply(notDeleted)).all();
    const [inline, applied, inlineInclude, appliedInclude] = runtime.executions;
    expect(applied?.plan.ast).toEqual(inline?.plan.ast);
    expect(appliedInclude?.plan.ast).toBeDefined();
    expect(appliedInclude?.plan.ast).toEqual(inlineInclude?.plan.ast);
  });

  it('refuses a model without the field before running the body', () => {
    const { client, plain } = scopes();
    const body = vi.fn((rows: { limit(n: number): unknown }) => rows.limit(1));
    const limited = blindCast<
      (fields: unknown, body: unknown) => unknown,
      'the body is a spy that records its calls'
    >(client.scope)({ deletedAt: field.column(timestamptzTemporalColumn).optional() }, body);
    expect(() => untyped(limited)(plain.Tag)).toThrow(
      expect.objectContaining({ code: 'ORM.FIELD_UNKNOWN' }),
    );
    expect(body).not.toHaveBeenCalled();
    untyped(limited)(plain.Post);
    expect(body).toHaveBeenCalledTimes(1);
  });

  it('refuses a model without the field with why, fix and meta', () => {
    const { plain, runtime, notDeleted } = scopes();
    expect(() => untyped(notDeleted)(plain.Tag)).toThrow(
      expect.objectContaining({
        code: 'ORM.FIELD_UNKNOWN',
        message: 'Cannot apply a scope to Tag: it has no field deletedAt',
        why: 'The scope was declared for models that have a field deletedAt with codec pg/timestamptz-temporal@1 that may be null.',
        meta: {
          model: 'Tag',
          namespace: 'public',
          field: 'deletedAt',
          codecId: 'pg/timestamptz-temporal@1',
          nullable: true,
          many: false,
        },
      }),
    );
    expect(runtime.executions).toEqual([]);
  });

  it('refuses a field of another column type or nullability', () => {
    const { client, plain } = scopes();
    const titleAsTimestamp = client.scope(
      { title: field.column(timestamptzTemporalColumn) },
      (rows) => rows.limit(1),
    );
    expect(() => untyped(titleAsTimestamp)(plain.Post)).toThrow(
      expect.objectContaining({
        code: 'ORM.FIELD_UNKNOWN',
        why: 'The scope was declared for models that have a field title with codec pg/timestamptz-temporal@1 that is never null. Post.title has codec pg/text@1 and is never null.',
        fix: 'Apply the scope to a model whose title field has that codec and nullability, or change the declaration in the scope.',
      }),
    );
    const titleNullable = client.scope({ title: field.column(textColumn).optional() }, (rows) =>
      rows.limit(1),
    );
    expect(() => untyped(titleNullable)(plain.Post)).toThrow(
      expect.objectContaining({
        code: 'ORM.FIELD_UNKNOWN',
        message: 'Cannot apply a scope to Post: its field title does not match the declaration',
      }),
    );
  });

  it('refuses a relation declared as a field', () => {
    const { client, plain } = scopes();
    const byUser = client.scope({ user: field.column(textColumn) }, (rows) => rows.limit(1));
    expect(() => untyped(byUser)(plain.Post)).toThrow(
      expect.objectContaining({
        code: 'ORM.FIELD_UNKNOWN',
        message: 'Cannot apply a scope to Post: it has no field user',
      }),
    );
  });

  it('refuses a field builder that names no column type', () => {
    const { client } = scopes();
    expect(() =>
      client.scope(
        blindCast<
          { readonly kind: ReturnType<typeof field.column<typeof textColumn>> },
          'a JavaScript caller passes a named type builder'
        >({ kind: field.namedType('user_type') }),
        (rows) => rows.limit(1),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'Cannot define the scope: the field builder for kind names no column type',
      }),
    );
  });

  describe('list fields', () => {
    it('refuses a declaration of one value for a list field', () => {
      const { client, plain, runtime } = scopes();
      const labelled = client.scope({ labels: field.column(textColumn) }, (rows) => rows.limit(1));
      expect(() => untyped(labelled)(plain.Tag)).toThrow(
        expect.objectContaining({
          code: 'ORM.FIELD_UNKNOWN',
          message: 'Cannot apply a scope to Tag: its field labels does not match the declaration',
          why: 'The scope was declared for models that have a field labels with codec pg/text@1 that is never null. Tag.labels is a list with codec pg/text@1 that is never null and whose elements are never null.',
          fix: 'Apply the scope to a model whose labels field holds one value, or declare labels as a list whose elements are never null, with .many() or many: { elementNullable: false }.',
          meta: {
            model: 'Tag',
            namespace: 'public',
            field: 'labels',
            codecId: 'pg/text@1',
            nullable: false,
            many: false,
          },
        }),
      );
      expect(runtime.executions).toEqual([]);
    });

    it('refuses a list declaration for a field that holds one value', () => {
      const { client, plain } = scopes();
      const titles = client.scope({ title: field.column(textColumn).many() }, (rows) =>
        rows.limit(1),
      );
      expect(() => untyped(titles)(plain.Post)).toThrow(
        expect.objectContaining({
          code: 'ORM.FIELD_UNKNOWN',
          why: 'The scope was declared for models that have a list field title with codec pg/text@1 that is never null and whose elements are never null. Post.title has codec pg/text@1 and is never null.',
          fix: 'Apply the scope to a model whose title field is a list whose elements are never null, or declare title as one value, without .many() or many.',
        }),
      );
    });

    it('matches a list whose elements are never null with .many() or many: { elementNullable: false }', async () => {
      const { client, plain, runtime } = scopes();
      const built = client.scope({ labels: field.column(textColumn).many() }, (rows) =>
        rows.where((r) => r.labels.eq(['a'])),
      );
      const literal = client.scope(
        { labels: { codecId: 'pg/text@1', nullable: false, many: { elementNullable: false } } },
        (rows) => rows.where((r) => r.labels.eq(['a'])),
      );
      await plain.Tag.where((t) => t.labels.eq(['a'])).all();
      await plain.Tag.apply(built).all();
      await plain.Tag.apply(literal).all();
      const [inline, fromBuilder, fromLiteral] = runtime.executions;
      expect(fromBuilder?.plan.ast).toBeDefined();
      expect(fromBuilder?.plan.ast).toEqual(inline?.plan.ast);
      expect(fromLiteral?.plan.ast).toEqual(inline?.plan.ast);
    });

    it('refuses a list of elements that are never null for a list whose elements may be null', () => {
      const { client, plain } = scopes();
      const built = client.scope({ notes: field.column(textColumn).many() }, (rows) =>
        rows.limit(1),
      );
      const literal = client.scope(
        { notes: { codecId: 'pg/text@1', nullable: false, many: { elementNullable: false } } },
        (rows) => rows.limit(1),
      );
      for (const scope of [built, literal]) {
        expect(() => untyped(scope)(plain.Tag)).toThrow(
          expect.objectContaining({
            code: 'ORM.FIELD_UNKNOWN',
            message: 'Cannot apply a scope to Tag: its field notes does not match the declaration',
            why: 'The scope was declared for models that have a list field notes with codec pg/text@1 that is never null and whose elements are never null. Tag.notes is a list with codec pg/text@1 that is never null and whose elements may be null.',
            fix: 'Apply the scope to a model whose notes field is a list whose elements are never null, or declare notes as a list whose elements may be null, with .many({ elementsNullable: true }) or many: { elementNullable: true }.',
            meta: {
              model: 'Tag',
              namespace: 'public',
              field: 'notes',
              codecId: 'pg/text@1',
              nullable: false,
              many: { elementNullable: false },
            },
          }),
        );
      }
    });

    it('matches a list whose elements may be null with .many({ elementsNullable: true }) or many: { elementNullable: true }', async () => {
      const { client, plain, runtime } = scopes();
      const built = client.scope(
        { notes: field.column(textColumn).many({ elementsNullable: true }) },
        (rows) => rows.where((r) => r.notes.eq(['a', null])),
      );
      const literal = client.scope(
        { notes: { codecId: 'pg/text@1', nullable: false, many: { elementNullable: true } } },
        (rows) => rows.where((r) => r.notes.eq(['a', null])),
      );
      await plain.Tag.where((t) => t.notes.eq(['a', null])).all();
      await plain.Tag.apply(built).all();
      await plain.Tag.apply(literal).all();
      const [inline, fromBuilder, fromLiteral] = runtime.executions;
      expect(fromBuilder?.plan.ast).toBeDefined();
      expect(fromBuilder?.plan.ast).toEqual(inline?.plan.ast);
      expect(fromLiteral?.plan.ast).toEqual(inline?.plan.ast);
    });

    it('refuses a list of elements that may be null for a list whose elements are never null', () => {
      const { client, plain } = scopes();
      const built = client.scope(
        { labels: field.column(textColumn).many({ elementsNullable: true }) },
        (rows) => rows.limit(1),
      );
      const literal = client.scope(
        { labels: { codecId: 'pg/text@1', nullable: false, many: { elementNullable: true } } },
        (rows) => rows.limit(1),
      );
      for (const scope of [built, literal]) {
        expect(() => untyped(scope)(plain.Tag)).toThrow(
          expect.objectContaining({
            code: 'ORM.FIELD_UNKNOWN',
            why: 'The scope was declared for models that have a list field labels with codec pg/text@1 that is never null and whose elements may be null. Tag.labels is a list with codec pg/text@1 that is never null and whose elements are never null.',
            fix: 'Apply the scope to a model whose labels field is a list whose elements may be null, or declare labels as a list whose elements are never null, with .many() or many: { elementNullable: false }.',
            meta: expect.objectContaining({ many: { elementNullable: true } }),
          }),
        );
      }
    });

    it('matches a list of value objects, stored as one jsonb value, with a list declaration', async () => {
      const { client, plain, runtime } = scopes();
      const built = client.scope({ addresses: field.column(jsonbColumn).many() }, (rows) =>
        rows.limit(1),
      );
      const literal = client.scope(
        { addresses: { codecId: 'pg/jsonb@1', nullable: false, many: { elementNullable: false } } },
        (rows) => rows.limit(1),
      );
      await plain.Tag.limit(1).all();
      await plain.Tag.apply(built).all();
      await plain.Tag.apply(literal).all();
      const [inline, fromBuilder, fromLiteral] = runtime.executions;
      expect(fromBuilder?.plan.ast).toBeDefined();
      expect(fromBuilder?.plan.ast).toEqual(inline?.plan.ast);
      expect(fromLiteral?.plan.ast).toEqual(inline?.plan.ast);
    });

    it('refuses a declaration of one value for a list of value objects', () => {
      const { client, plain } = scopes();
      const oneValue = client.scope({ addresses: field.column(jsonbColumn) }, (rows) =>
        rows.limit(1),
      );
      expect(() => untyped(oneValue)(plain.Tag)).toThrow(
        expect.objectContaining({
          code: 'ORM.FIELD_UNKNOWN',
          why: 'The scope was declared for models that have a field addresses with codec pg/jsonb@1 that is never null. Tag.addresses is a list with codec pg/jsonb@1 that is never null and whose elements are never null.',
          fix: 'Apply the scope to a model whose addresses field holds one value, or declare addresses as a list whose elements are never null, with .many() or many: { elementNullable: false }.',
        }),
      );
    });
  });

  describe('input from a JavaScript caller', () => {
    const scopeOf = (fields: unknown, body: unknown) => () => {
      const { client } = scopes();
      return blindCast<(fields: unknown, body: unknown) => unknown, 'a JavaScript caller'>(
        client.scope,
      )(fields, body);
    };
    const validBody = (rows: { limit(n: number): unknown }) => rows.limit(1);
    const validFields = { deletedAt: { codecId: 'pg/timestamptz-temporal@1', nullable: true } };

    it.each([
      ['undefined', undefined, 'undefined'],
      ['null', null, 'null'],
      ['a number', 3, 'a number'],
    ])('refuses %s as the field map', (_label, fields, received) => {
      expect(scopeOf(fields, validBody)).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message: 'Cannot define the scope: the fields are not an object',
          why: `The first argument of scope maps the name of each field the scope needs to its declaration; received ${received}.`,
        }),
      );
    });

    it.each([
      ['null', null, 'null'],
      ['a number', 3, 'a number'],
      ['an object without nullable', { codecId: 'pg/text@1' }, 'an object'],
      [
        'an object whose many is a string',
        { codecId: 'pg/text@1', nullable: false, many: 'yes' },
        'an object',
      ],
      [
        'an object whose many is true',
        { codecId: 'pg/text@1', nullable: false, many: true },
        'an object',
      ],
      [
        'an object whose many has no boolean elementNullable',
        { codecId: 'pg/text@1', nullable: false, many: { elementNullable: 'yes' } },
        'an object',
      ],
    ])('refuses %s as a field declaration', (_label, declaration, received) => {
      expect(scopeOf({ title: declaration }, validBody)).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message:
            'Cannot define the scope: the declaration of field title is not a field builder or { codecId, nullable }',
          why: `Each field of a scope is declared with a field builder or with an object that has a string codecId, a boolean nullable and, for a list, many: { elementNullable } with a boolean elementNullable; received ${received} for title.`,
          fix: 'Declare each field with a field builder, such as field.temporal.timestamptz().optional(), or with { codecId, nullable }. Declare a list with .many() or many: { elementNullable: false }, or, when its elements may be null, with .many({ elementsNullable: true }) or many: { elementNullable: true }.',
        }),
      );
    });

    it.each([
      ['true', true, 'a boolean'],
      ['a string', 'yes', 'a string'],
      ['an object without a boolean elementNullable', { elementNullable: 'yes' }, 'an object'],
    ])('refuses a field builder whose build() returns %s as many', (_label, many, received) => {
      const builder = {
        build: () => ({ descriptor: { codecId: 'pg/text@1' }, nullable: false, many }),
      };
      expect(scopeOf({ labels: builder }, validBody)).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message:
            'Cannot define the scope: the field builder for labels builds a many that is not false or { elementNullable }',
          why: `A field builder's build() returns many as false or undefined for one value, or as { elementNullable } with a boolean elementNullable for a list; received ${received} for labels.`,
          fix: 'Declare each field with a field builder, such as field.temporal.timestamptz().optional(), or with { codecId, nullable }. Declare a list with .many() or many: { elementNullable: false }, or, when its elements may be null, with .many({ elementsNullable: true }) or many: { elementNullable: true }.',
          meta: { field: 'labels' },
        }),
      );
    });

    it('reads a field builder whose build() returns many as undefined as one value', () => {
      const { client, plain } = scopes();
      const builder = {
        build: () => ({ descriptor: { codecId: 'pg/text@1' }, nullable: false, many: undefined }),
      };
      const declared = blindCast<
        (fields: unknown, body: unknown) => unknown,
        'a JavaScript caller'
      >(client.scope)({ title: builder }, validBody);
      expect(() => untyped(declared)(plain.Post)).not.toThrow();
    });

    it('accepts many: false as a declaration of one value', () => {
      const { client, plain } = scopes();
      const declared = blindCast<
        (fields: unknown, body: unknown) => unknown,
        'a JavaScript caller'
      >(client.scope)({ title: { codecId: 'pg/text@1', nullable: false, many: false } }, validBody);
      expect(() => untyped(declared)(plain.Post)).not.toThrow();
      expect(() => untyped(declared)(plain.Tag)).toThrow(
        expect.objectContaining({ meta: expect.objectContaining({ many: false }) }),
      );
    });

    it.each([
      ['undefined', undefined, 'undefined'],
      ['null', null, 'null'],
      ['a number', 3, 'a number'],
      ['an object', {}, 'an object'],
    ])('refuses %s as the body', (_label, body, received) => {
      expect(scopeOf(validFields, body)).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message: 'Cannot define the scope: the body is not a function',
          why: `The body of a scope is a function that receives a collection and returns one; received ${received}.`,
        }),
      );
    });
  });
});
