import {
  jsonbColumn,
  textColumn,
  timestamptzTemporalColumn,
} from '@internal/adapter-postgres/column-types';
import { field } from '@internal/sql-contract-ts/contract-builder';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it, vi } from 'vitest';
import { createFragmentsOrm } from './fragments-fixture';

function fragments() {
  const fixture = createFragmentsOrm();
  const notDeleted = fixture.client.fragment(
    { deletedAt: field.column(timestamptzTemporalColumn).optional() },
    (rows) => rows.where((r) => r.deletedAt.isNull()),
  );
  const deletedLast = fixture.client.fragment(
    { deletedAt: { codecId: 'pg/timestamptz-temporal@1', nullable: true } },
    (rows) => rows.orderBy((r) => r.deletedAt.desc()).limit(5),
  );
  return { ...fixture, notDeleted, deletedLast };
}

function untyped(fragment: unknown): (collection: unknown) => unknown {
  return blindCast<
    (collection: unknown) => unknown,
    'a JavaScript caller applies the fragment to any collection'
  >(fragment);
}

describe('client.fragment', () => {
  it('puts the filter of the body in the plan, through the field to column mapping', async () => {
    const { plain, runtime, notDeleted } = fragments();
    await plain.Post.where((p) => p.deletedAt.isNull()).all();
    await plain.Post.with(notDeleted).all();
    await plain.Post.all();
    const [inline, applied, unfiltered] = runtime.executions;
    expect(applied?.plan.ast).toBeDefined();
    expect(applied?.plan.ast).toEqual(inline?.plan.ast);
    expect(applied?.plan.ast).not.toEqual(unfiltered?.plan.ast);
  });

  it('puts the order and limit of the body in the plan', async () => {
    const { plain, runtime, deletedLast } = fragments();
    await plain.Comment.orderBy((c) => c.deletedAt.desc())
      .limit(5)
      .all();
    await plain.Comment.with(deletedLast).all();
    const [inline, applied] = runtime.executions;
    expect(applied?.plan.ast).toBeDefined();
    expect(applied?.plan.ast).toEqual(inline?.plan.ast);
  });

  it('runs on a custom class, after where and in an include refinement', async () => {
    const { db, plain, runtime, notDeleted } = fragments();
    await db.Post.where({ title: 'x' })
      .where((p) => p.deletedAt.isNull())
      .all();
    await db.Post.where({ title: 'x' }).with(notDeleted).all();
    await plain.User.include('posts', (posts) => posts.where((p) => p.deletedAt.isNull())).all();
    await plain.User.include('posts', (posts) => posts.with(notDeleted)).all();
    const [inline, applied, inlineInclude, appliedInclude] = runtime.executions;
    expect(applied?.plan.ast).toEqual(inline?.plan.ast);
    expect(appliedInclude?.plan.ast).toBeDefined();
    expect(appliedInclude?.plan.ast).toEqual(inlineInclude?.plan.ast);
  });

  it('refuses a model without the field before running the body', () => {
    const { client, plain } = fragments();
    const body = vi.fn((rows: { limit(n: number): unknown }) => rows.limit(1));
    const limited = blindCast<
      (fields: unknown, body: unknown) => unknown,
      'the body is a spy that records its calls'
    >(client.fragment)({ deletedAt: field.column(timestamptzTemporalColumn).optional() }, body);
    expect(() => untyped(limited)(plain.Tag)).toThrow(
      expect.objectContaining({ code: 'ORM.FIELD_UNKNOWN' }),
    );
    expect(body).not.toHaveBeenCalled();
    untyped(limited)(plain.Post);
    expect(body).toHaveBeenCalledTimes(1);
  });

  it('refuses a model without the field with why, fix and meta', () => {
    const { plain, runtime, notDeleted } = fragments();
    expect(() => untyped(notDeleted)(plain.Tag)).toThrow(
      expect.objectContaining({
        code: 'ORM.FIELD_UNKNOWN',
        message: 'Cannot apply a fragment to Tag: it has no field deletedAt',
        why: 'The fragment was declared for models that have a field deletedAt with codec pg/timestamptz-temporal@1 that may be null.',
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
    const { client, plain } = fragments();
    const titleAsTimestamp = client.fragment(
      { title: field.column(timestamptzTemporalColumn) },
      (rows) => rows.limit(1),
    );
    expect(() => untyped(titleAsTimestamp)(plain.Post)).toThrow(
      expect.objectContaining({
        code: 'ORM.FIELD_UNKNOWN',
        why: 'The fragment was declared for models that have a field title with codec pg/timestamptz-temporal@1 that is never null. Post.title has codec pg/text@1 and is never null.',
        fix: 'Apply the fragment to a model whose title field has that codec and nullability, or change the declaration in the fragment.',
      }),
    );
    const titleNullable = client.fragment({ title: field.column(textColumn).optional() }, (rows) =>
      rows.limit(1),
    );
    expect(() => untyped(titleNullable)(plain.Post)).toThrow(
      expect.objectContaining({
        code: 'ORM.FIELD_UNKNOWN',
        message: 'Cannot apply a fragment to Post: its field title does not match the declaration',
      }),
    );
  });

  it('refuses a relation declared as a field', () => {
    const { client, plain } = fragments();
    const byUser = client.fragment({ user: field.column(textColumn) }, (rows) => rows.limit(1));
    expect(() => untyped(byUser)(plain.Post)).toThrow(
      expect.objectContaining({
        code: 'ORM.FIELD_UNKNOWN',
        message: 'Cannot apply a fragment to Post: it has no field user',
      }),
    );
  });

  it('refuses a field builder that names no column type', () => {
    const { client } = fragments();
    expect(() =>
      client.fragment(
        blindCast<
          { readonly kind: ReturnType<typeof field.column<typeof textColumn>> },
          'a JavaScript caller passes a named type builder'
        >({ kind: field.namedType('user_type') }),
        (rows) => rows.limit(1),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'Cannot define the fragment: the field builder for kind names no column type',
      }),
    );
  });

  describe('list fields', () => {
    it('refuses a declaration of one value for a list field', () => {
      const { client, plain, runtime } = fragments();
      const labelled = client.fragment({ labels: field.column(textColumn) }, (rows) =>
        rows.limit(1),
      );
      expect(() => untyped(labelled)(plain.Tag)).toThrow(
        expect.objectContaining({
          code: 'ORM.FIELD_UNKNOWN',
          message:
            'Cannot apply a fragment to Tag: its field labels does not match the declaration',
          why: 'The fragment was declared for models that have a field labels with codec pg/text@1 that is never null. Tag.labels is a list with codec pg/text@1 that is never null and whose elements are never null.',
          fix: 'Apply the fragment to a model whose labels field holds one value, or declare labels as a list whose elements are never null, with .many() or many: { elementNullable: false }.',
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
      const { client, plain } = fragments();
      const titles = client.fragment({ title: field.column(textColumn).many() }, (rows) =>
        rows.limit(1),
      );
      expect(() => untyped(titles)(plain.Post)).toThrow(
        expect.objectContaining({
          code: 'ORM.FIELD_UNKNOWN',
          why: 'The fragment was declared for models that have a list field title with codec pg/text@1 that is never null and whose elements are never null. Post.title has codec pg/text@1 and is never null.',
          fix: 'Apply the fragment to a model whose title field is a list whose elements are never null, or declare title as one value, without .many() or many.',
        }),
      );
    });

    it('matches a list whose elements are never null with .many() or many: { elementNullable: false }', async () => {
      const { client, plain, runtime } = fragments();
      const built = client.fragment({ labels: field.column(textColumn).many() }, (rows) =>
        rows.where((r) => r.labels.eq(['a'])),
      );
      const literal = client.fragment(
        { labels: { codecId: 'pg/text@1', nullable: false, many: { elementNullable: false } } },
        (rows) => rows.where((r) => r.labels.eq(['a'])),
      );
      await plain.Tag.where((t) => t.labels.eq(['a'])).all();
      await plain.Tag.with(built).all();
      await plain.Tag.with(literal).all();
      const [inline, fromBuilder, fromLiteral] = runtime.executions;
      expect(fromBuilder?.plan.ast).toBeDefined();
      expect(fromBuilder?.plan.ast).toEqual(inline?.plan.ast);
      expect(fromLiteral?.plan.ast).toEqual(inline?.plan.ast);
    });

    it('refuses a list of elements that are never null for a list whose elements may be null', () => {
      const { client, plain } = fragments();
      const built = client.fragment({ notes: field.column(textColumn).many() }, (rows) =>
        rows.limit(1),
      );
      const literal = client.fragment(
        { notes: { codecId: 'pg/text@1', nullable: false, many: { elementNullable: false } } },
        (rows) => rows.limit(1),
      );
      for (const fragment of [built, literal]) {
        expect(() => untyped(fragment)(plain.Tag)).toThrow(
          expect.objectContaining({
            code: 'ORM.FIELD_UNKNOWN',
            message:
              'Cannot apply a fragment to Tag: its field notes does not match the declaration',
            why: 'The fragment was declared for models that have a list field notes with codec pg/text@1 that is never null and whose elements are never null. Tag.notes is a list with codec pg/text@1 that is never null and whose elements may be null.',
            fix: 'Apply the fragment to a model whose notes field is a list whose elements are never null, or declare notes as a list whose elements may be null, with .many({ elementsNullable: true }) or many: { elementNullable: true }.',
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
      const { client, plain, runtime } = fragments();
      const built = client.fragment(
        { notes: field.column(textColumn).many({ elementsNullable: true }) },
        (rows) => rows.where((r) => r.notes.eq(['a', null])),
      );
      const literal = client.fragment(
        { notes: { codecId: 'pg/text@1', nullable: false, many: { elementNullable: true } } },
        (rows) => rows.where((r) => r.notes.eq(['a', null])),
      );
      await plain.Tag.where((t) => t.notes.eq(['a', null])).all();
      await plain.Tag.with(built).all();
      await plain.Tag.with(literal).all();
      const [inline, fromBuilder, fromLiteral] = runtime.executions;
      expect(fromBuilder?.plan.ast).toBeDefined();
      expect(fromBuilder?.plan.ast).toEqual(inline?.plan.ast);
      expect(fromLiteral?.plan.ast).toEqual(inline?.plan.ast);
    });

    it('refuses a list of elements that may be null for a list whose elements are never null', () => {
      const { client, plain } = fragments();
      const built = client.fragment(
        { labels: field.column(textColumn).many({ elementsNullable: true }) },
        (rows) => rows.limit(1),
      );
      const literal = client.fragment(
        { labels: { codecId: 'pg/text@1', nullable: false, many: { elementNullable: true } } },
        (rows) => rows.limit(1),
      );
      for (const fragment of [built, literal]) {
        expect(() => untyped(fragment)(plain.Tag)).toThrow(
          expect.objectContaining({
            code: 'ORM.FIELD_UNKNOWN',
            why: 'The fragment was declared for models that have a list field labels with codec pg/text@1 that is never null and whose elements may be null. Tag.labels is a list with codec pg/text@1 that is never null and whose elements are never null.',
            fix: 'Apply the fragment to a model whose labels field is a list whose elements may be null, or declare labels as a list whose elements are never null, with .many() or many: { elementNullable: false }.',
            meta: expect.objectContaining({ many: { elementNullable: true } }),
          }),
        );
      }
    });

    it('matches a list of value objects, stored as one jsonb value, with a list declaration', async () => {
      const { client, plain, runtime } = fragments();
      const built = client.fragment({ addresses: field.column(jsonbColumn).many() }, (rows) =>
        rows.limit(1),
      );
      const literal = client.fragment(
        { addresses: { codecId: 'pg/jsonb@1', nullable: false, many: { elementNullable: false } } },
        (rows) => rows.limit(1),
      );
      await plain.Tag.limit(1).all();
      await plain.Tag.with(built).all();
      await plain.Tag.with(literal).all();
      const [inline, fromBuilder, fromLiteral] = runtime.executions;
      expect(fromBuilder?.plan.ast).toBeDefined();
      expect(fromBuilder?.plan.ast).toEqual(inline?.plan.ast);
      expect(fromLiteral?.plan.ast).toEqual(inline?.plan.ast);
    });

    it('refuses a declaration of one value for a list of value objects', () => {
      const { client, plain } = fragments();
      const oneValue = client.fragment({ addresses: field.column(jsonbColumn) }, (rows) =>
        rows.limit(1),
      );
      expect(() => untyped(oneValue)(plain.Tag)).toThrow(
        expect.objectContaining({
          code: 'ORM.FIELD_UNKNOWN',
          why: 'The fragment was declared for models that have a field addresses with codec pg/jsonb@1 that is never null. Tag.addresses is a list with codec pg/jsonb@1 that is never null and whose elements are never null.',
          fix: 'Apply the fragment to a model whose addresses field holds one value, or declare addresses as a list whose elements are never null, with .many() or many: { elementNullable: false }.',
        }),
      );
    });
  });

  describe('input from a JavaScript caller', () => {
    const fragmentOf = (fields: unknown, body: unknown) => () => {
      const { client } = fragments();
      return blindCast<(fields: unknown, body: unknown) => unknown, 'a JavaScript caller'>(
        client.fragment,
      )(fields, body);
    };
    const validBody = (rows: { limit(n: number): unknown }) => rows.limit(1);
    const validFields = { deletedAt: { codecId: 'pg/timestamptz-temporal@1', nullable: true } };

    it.each([
      ['undefined', undefined, 'undefined'],
      ['null', null, 'null'],
      ['a number', 3, 'a number'],
    ])('refuses %s as the field map', (_label, fields, received) => {
      expect(fragmentOf(fields, validBody)).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message: 'Cannot define the fragment: the fields are not an object',
          why: `The first argument of fragment maps the name of each field the fragment needs to its declaration; received ${received}.`,
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
      expect(fragmentOf({ title: declaration }, validBody)).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message:
            'Cannot define the fragment: the declaration of field title is not a field builder or { codecId, nullable }',
          why: `Each field of a fragment is declared with a field builder or with an object that has a string codecId, a boolean nullable and, for a list, many: { elementNullable } with a boolean elementNullable; received ${received} for title.`,
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
      expect(fragmentOf({ labels: builder }, validBody)).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message:
            'Cannot define the fragment: the field builder for labels builds a many that is not false or { elementNullable }',
          why: `A field builder's build() returns many as false or undefined for one value, or as { elementNullable } with a boolean elementNullable for a list; received ${received} for labels.`,
          fix: 'Declare each field with a field builder, such as field.temporal.timestamptz().optional(), or with { codecId, nullable }. Declare a list with .many() or many: { elementNullable: false }, or, when its elements may be null, with .many({ elementsNullable: true }) or many: { elementNullable: true }.',
          meta: { field: 'labels' },
        }),
      );
    });

    it('reads a field builder whose build() returns many as undefined as one value', () => {
      const { client, plain } = fragments();
      const builder = {
        build: () => ({ descriptor: { codecId: 'pg/text@1' }, nullable: false, many: undefined }),
      };
      const declared = blindCast<
        (fields: unknown, body: unknown) => unknown,
        'a JavaScript caller'
      >(client.fragment)({ title: builder }, validBody);
      expect(() => untyped(declared)(plain.Post)).not.toThrow();
    });

    it('accepts many: false as a declaration of one value', () => {
      const { client, plain } = fragments();
      const declared = blindCast<
        (fields: unknown, body: unknown) => unknown,
        'a JavaScript caller'
      >(client.fragment)(
        { title: { codecId: 'pg/text@1', nullable: false, many: false } },
        validBody,
      );
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
      expect(fragmentOf(validFields, body)).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message: 'Cannot define the fragment: the body is not a function',
          why: `The body of a fragment is a function that receives a collection and returns one; received ${received}.`,
        }),
      );
    });
  });
});
