import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  ListExpression,
  NotExpr,
  NullCheckExpr,
  OrExpr,
  ParamRef,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { bindCollectionTables } from '../src/collection-tables';
import { all, and, not, or, shorthandToWhereExpr } from '../src/filters';
import { createModelAccessor } from '../src/model-accessor';
import { getTestContext, getTestContract, withPatchedDomainModels } from './helpers';
import { unboundTables } from './unbound-tables';

describe('filters', () => {
  const contract = getTestContract();
  const context = getTestContext();

  function paramRef(table: string, column: string, value: unknown): ParamRef {
    const tables = unboundTables(context.contract.storage) as Record<
      string,
      { columns: Record<string, { codecId?: string }> } | undefined
    >;
    const codecId = tables[table]?.columns[column]?.codecId;
    return codecId ? ParamRef.of(value, { codec: { codecId } }) : ParamRef.of(value);
  }

  it('and(), or(), not(), and all() use rich where objects', () => {
    const user = createModelAccessor(
      context,
      'public',
      'User',
      bindCollectionTables(context.contract, 'public', 'User'),
    );

    const andExpr = and(user['name']!.eq('Alice'), user['email']!.neq('bob@example.com'));
    expect(andExpr).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('users', 'name'), paramRef('users', 'name', 'Alice')),
        BinaryExpr.neq(
          ColumnRef.of('users', 'email'),
          paramRef('users', 'email', 'bob@example.com'),
        ),
      ]),
    );

    const orExpr = or(user['name']!.eq('Alice'), user['name']!.eq('Bob'));
    expect(orExpr).toEqual(
      OrExpr.of([
        BinaryExpr.eq(ColumnRef.of('users', 'name'), paramRef('users', 'name', 'Alice')),
        BinaryExpr.eq(ColumnRef.of('users', 'name'), paramRef('users', 'name', 'Bob')),
      ]),
    );

    expect(not(user['name']!.eq('Alice'))).toEqual(
      new NotExpr(BinaryExpr.eq(ColumnRef.of('users', 'name'), paramRef('users', 'name', 'Alice'))),
    );
    expect(not(user['posts']!.some()).kind).toBe('not');
    expect(not(user['email']!.isNull())).toEqual(
      new NotExpr(NullCheckExpr.isNull(ColumnRef.of('users', 'email'))),
    );
    expect(
      not(and(user['name']!.eq('Alice'), or(user['email']!.eq('a'), user['email']!.eq('b')))),
    ).toEqual(
      new NotExpr(
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('users', 'name'), paramRef('users', 'name', 'Alice')),
          OrExpr.of([
            BinaryExpr.eq(ColumnRef.of('users', 'email'), paramRef('users', 'email', 'a')),
            BinaryExpr.eq(ColumnRef.of('users', 'email'), paramRef('users', 'email', 'b')),
          ]),
        ]),
      ),
    );
    expect(all()).toEqual(AndExpr.true());
  });

  it('wraps scalar binary operators in NotExpr', () => {
    const user = createModelAccessor(
      context,
      'public',
      'User',
      bindCollectionTables(context.contract, 'public', 'User'),
    );

    expect(not(user['id']!.neq(1))).toEqual(
      new NotExpr(BinaryExpr.neq(ColumnRef.of('users', 'id'), paramRef('users', 'id', 1))),
    );
    expect(not(user['id']!.lt(1))).toEqual(
      new NotExpr(BinaryExpr.lt(ColumnRef.of('users', 'id'), paramRef('users', 'id', 1))),
    );
    expect(not(user['id']!.gte(1))).toEqual(
      new NotExpr(BinaryExpr.gte(ColumnRef.of('users', 'id'), paramRef('users', 'id', 1))),
    );
    expect(not(user['id']!.lte(1))).toEqual(
      new NotExpr(BinaryExpr.lte(ColumnRef.of('users', 'id'), paramRef('users', 'id', 1))),
    );
    expect(not(user['id']!.in([1, 2]))).toEqual(
      new NotExpr(
        BinaryExpr.in(
          ColumnRef.of('users', 'id'),
          ListExpression.of([paramRef('users', 'id', 1), paramRef('users', 'id', 2)]),
        ),
      ),
    );
    expect(not(user['id']!.notIn([1, 2]))).toEqual(
      new NotExpr(
        BinaryExpr.notIn(
          ColumnRef.of('users', 'id'),
          ListExpression.of([paramRef('users', 'id', 1), paramRef('users', 'id', 2)]),
        ),
      ),
    );
  });

  it('eq(null) / neq(null) lower to IS NULL / IS NOT NULL', () => {
    const post = createModelAccessor(
      context,
      'public',
      'Post',
      bindCollectionTables(context.contract, 'public', 'Post'),
    );
    const userId = post['userId']! as { eq: (v: unknown) => unknown; neq: (v: unknown) => unknown };

    expect(userId.eq(null)).toEqual(NullCheckExpr.isNull(ColumnRef.of('posts', 'user_id')));
    expect(userId.neq(null)).toEqual(NullCheckExpr.isNotNull(ColumnRef.of('posts', 'user_id')));
  });

  it('wraps like in NotExpr', () => {
    const user = createModelAccessor(
      context,
      'public',
      'User',
      bindCollectionTables(context.contract, 'public', 'User'),
    );

    expect(not(user['name']!.like('%a%'))).toEqual(
      new NotExpr(BinaryExpr.like(ColumnRef.of('users', 'name'), paramRef('users', 'name', '%a%'))),
    );
  });

  it('shorthandToWhereExpr() maps nulls, skips undefined, and combines multiple fields', () => {
    const expr = shorthandToWhereExpr(
      context,
      'public',
      'Post',
      {
        id: 1,
        userId: null,
        views: undefined,
      },
      bindCollectionTables(context.contract, 'public', 'Post').root,
    );

    expect(expr).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'id'), paramRef('posts', 'id', 1)),
        NullCheckExpr.isNull(ColumnRef.of('posts', 'user_id')),
      ]),
    );
  });

  it('shorthandToWhereExpr() rejects equality-shorthand on a field without the equality trait', () => {
    // Drop the descriptor's `traits` to model a codec that doesn't advertise equality (the descriptor-based trait gate replaces the legacy `codecs.traitsOf(codecId)` read; both branches — descriptor present without trait, descriptor missing entirely — must error).
    const stubbedContext = {
      ...context,
      codecDescriptors: {
        ...context.codecDescriptors,
        descriptorFor: () => ({
          codecId: 'pg/text@1' as const,
          traits: [] as const,
          paramsSchema: {
            '~standard': {
              version: 1 as const,
              vendor: 'test',
              validate: () => ({ value: undefined }),
            },
          },
          factory: () => () => ({}) as never,
        }),
      },
    } as unknown as typeof context;

    expect(() =>
      shorthandToWhereExpr(
        stubbedContext,
        'public',
        'User',
        { email: 'a@b.com' },
        bindCollectionTables(stubbedContext.contract, 'public', 'User').root,
      ),
    ).toThrow(/does not support equality comparisons/);
  });

  it('shorthandToWhereExpr() rejects equality-shorthand on a non-scalar field type', () => {
    // When `fieldType?.kind !== 'scalar'` (e.g. the field doesn't have a codec id resolvable from a scalar type), the trait array is empty and the filter throws — this models a relation-shorthand attempt through the scalar code path.
    expect(() =>
      shorthandToWhereExpr(
        context,
        'public',
        'User',
        { posts: 'oops' } as never,
        bindCollectionTables(context.contract, 'public', 'User').root,
      ),
    ).toThrow(/does not support equality comparisons/);
  });

  it('shorthandToWhereExpr() rejects equality-shorthand when no descriptor is registered for the codec', () => {
    // `descriptorFor` returns `undefined` — the trait array short-circuits to `[]` and `equality` is missing.
    const stubbedContext = {
      ...context,
      codecDescriptors: {
        ...context.codecDescriptors,
        descriptorFor: () => undefined,
      },
    } as unknown as typeof context;

    expect(() =>
      shorthandToWhereExpr(
        stubbedContext,
        'public',
        'User',
        { email: 'a@b.com' },
        bindCollectionTables(stubbedContext.contract, 'public', 'User').root,
      ),
    ).toThrow(/does not support equality comparisons/);
  });

  it('shorthandToWhereExpr() supports storage and model-name fallbacks', () => {
    expect(
      shorthandToWhereExpr(
        context,
        'public',
        'User',
        {},
        bindCollectionTables(context.contract, 'public', 'User').root,
      ),
    ).toBeUndefined();

    expect(
      shorthandToWhereExpr(
        context,
        'public',
        'User',
        {
          email: 'alice@example.com',
        },
        bindCollectionTables(context.contract, 'public', 'User').root,
      ),
    ).toEqual(
      BinaryExpr.eq(
        ColumnRef.of('users', 'email'),
        paramRef('users', 'email', 'alice@example.com'),
      ),
    );

    const withoutStorageFields = withPatchedDomainModels(contract, (models) => ({
      ...models,
      User: {
        ...(models['User'] as Record<string, unknown>),
        fields: {},
        storage: { namespaceId: 'public', table: 'users' },
      },
    }));

    expect(
      shorthandToWhereExpr(
        { ...context, contract: withoutStorageFields } as never,
        'public',
        'User',
        {
          unknownField: null,
        } as never,
        bindCollectionTables(withoutStorageFields, 'public', 'User').root,
      ),
    ).toEqual(NullCheckExpr.isNull(ColumnRef.of('users', 'unknownField')));
  });
});
