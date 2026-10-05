import { textColumn, timestamptzTemporalColumn } from '@internal/adapter-postgres/column-types';
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
        why: 'The scope was declared for models that have a field deletedAt of column type pg/timestamptz-temporal@1 that may be null.',
        meta: {
          model: 'Tag',
          namespace: 'public',
          field: 'deletedAt',
          codecId: 'pg/timestamptz-temporal@1',
          nullable: true,
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
        why: 'The scope was declared for models that have a field title of column type pg/timestamptz-temporal@1 that is never null. Post.title has column type pg/text@1 and is never null.',
        fix: 'Apply the scope to a model whose title field has that column type and nullability, or change the declaration in the scope.',
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
    ])('refuses %s as a field declaration', (_label, declaration, received) => {
      expect(scopeOf({ title: declaration }, validBody)).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message:
            'Cannot define the scope: the declaration of field title is not a field builder or { codecId, nullable }',
          why: `Each field of a scope is declared with a field builder or with an object that has a string codecId and a boolean nullable; received ${received} for title.`,
        }),
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
