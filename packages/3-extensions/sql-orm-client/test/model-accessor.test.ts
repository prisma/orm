import { dataTypeId } from '@internal/framework-components/codec';
import { createSqlOperationRegistry } from '@internal/sql-operations';
import type { CodecTrait } from '@internal/sql-relational-core/ast';
import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  JoinAst,
  ListExpression,
  NotExpr,
  NullCheckExpr,
  OperationExpr,
  OrderByItem,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createModelAccessor } from '../src/model-accessor';
import {
  buildMixedPolyContract,
  getTestContext,
  getTestContract,
  withPatchedDomainModels,
} from './helpers';
import { unboundTables } from './unbound-tables';

describe('createModelAccessor', () => {
  const context = getTestContext();

  function paramRef(table: string, column: string, value: unknown): ParamRef {
    const tables = unboundTables(context.contract.storage) as Record<
      string,
      { columns: Record<string, { codecId?: string }> } | undefined
    >;
    const codecId = tables[table]?.columns[column]?.codecId;
    return codecId ? ParamRef.of(value, { codec: { codecId } }) : ParamRef.of(value);
  }

  function expectBinaryParam(
    actual: unknown,
    table: string,
    column: string,
    op: BinaryExpr['op'],
    value: unknown,
  ) {
    expect(actual).toEqual(
      new BinaryExpr(op, ColumnRef.of(table, column), paramRef(table, column, value)),
    );
  }

  function makeDescriptors(
    entries: Record<string, readonly CodecTrait[]>,
  ): typeof context.codecDescriptors {
    const map = new Map(
      Object.entries(entries).map(([codecId, traits]) => [
        codecId,
        {
          codecId,
          traits,
          targetTypes: [] as readonly string[],
          paramsSchema: {
            '~standard': {
              version: 1 as const,
              vendor: 'test',
              validate: (_value: unknown) => ({ value: undefined }),
            },
          },
          isParameterized: false,
          dataType: dataTypeId('demo/fixture'),
          // The trait-gating tests don't materialize codecs; the factory is shape-only and never invoked.
          factory: () => () => {
            throw new Error('test descriptor factory not exercised');
          },
        },
      ]),
    );
    return {
      descriptorFor: (id) => map.get(id),
      codecRefForColumn: () => undefined,
      values: function* () {
        yield* map.values();
      },
      byTargetType: () => Object.freeze([]),
    };
  }

  it('creates scalar comparison operators and maps fields to columns', () => {
    const user = createModelAccessor(context, 'public', 'User');
    const post = createModelAccessor(context, 'public', 'Post');

    expectBinaryParam(user['name']!.eq('Alice'), 'users', 'name', 'eq', 'Alice');
    expectBinaryParam(
      user['email']!.neq('test@example.com'),
      'users',
      'email',
      'neq',
      'test@example.com',
    );
    expectBinaryParam(post['views']!.gt(1000), 'posts', 'views', 'gt', 1000);
    expectBinaryParam(post['views']!.lt(100), 'posts', 'views', 'lt', 100);
    expectBinaryParam(post['id']!.gte(5), 'posts', 'id', 'gte', 5);
    expectBinaryParam(post['id']!.lte(10), 'posts', 'id', 'lte', 10);
    expectBinaryParam(post['userId']!.eq(42), 'posts', 'user_id', 'eq', 42);
    expectBinaryParam(user['name']!.like('%Ali%'), 'users', 'name', 'like', '%Ali%');
  });

  it('creates ilike as trait-matched extension operation returning predicate', () => {
    const user = createModelAccessor(context, 'public', 'User');
    const ilike = user['name']!.ilike;
    const result = ilike('%ali%');
    expect(result).toBeInstanceOf(OperationExpr);
    const op = result as OperationExpr;
    expect(op.method).toBe('ilike');
    expect(op.self).toEqual(ColumnRef.of('users', 'name'));
  });

  it('does not expose ilike on non-textual fields', () => {
    const post = createModelAccessor(context, 'public', 'Post');
    const field = post['views'] as unknown as Record<string, unknown>;
    expect(field['ilike']).toBeUndefined();
  });

  it('creates list literal, null check, and order directive helpers', () => {
    const accessor = createModelAccessor(context, 'public', 'Post');

    expect(accessor['id']!.in([1, 2, 3])).toEqual(
      BinaryExpr.in(
        ColumnRef.of('posts', 'id'),
        ListExpression.of([
          paramRef('posts', 'id', 1),
          paramRef('posts', 'id', 2),
          paramRef('posts', 'id', 3),
        ]),
      ),
    );
    expect(accessor['id']!.notIn([4, 5])).toEqual(
      BinaryExpr.notIn(
        ColumnRef.of('posts', 'id'),
        ListExpression.of([paramRef('posts', 'id', 4), paramRef('posts', 'id', 5)]),
      ),
    );
    expect(accessor['id']!.asc()).toEqual(OrderByItem.asc(ColumnRef.of('posts', 'id')));
    expect(accessor['id']!.desc()).toEqual(OrderByItem.desc(ColumnRef.of('posts', 'id')));

    const user = createModelAccessor(context, 'public', 'User');
    expect(user['email']!.isNull()).toEqual(NullCheckExpr.isNull(ColumnRef.of('users', 'email')));
    expect(user['email']!.isNotNull()).toEqual(
      NullCheckExpr.isNotNull(ColumnRef.of('users', 'email')),
    );
  });

  it('creates some() relation filters as EXISTS subqueries', () => {
    const accessor = createModelAccessor(context, 'public', 'User');

    expect(accessor['posts']!.some()).toEqual(
      ExistsExpr.exists(
        SelectAst.from(TableSource.named('posts', undefined, 'public'))
          .withProjection([ProjectionItem.of('_exists', ColumnRef.of('posts', 'user_id'))])
          .withWhere(BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id'))),
      ),
    );
  });

  it('creates none() and every() relation filters with NOT EXISTS semantics', () => {
    const accessor = createModelAccessor(context, 'public', 'User');

    const noneExpr = accessor['posts']!.none({ views: 10 }) as ExistsExpr;
    expect(noneExpr.notExists).toBe(true);
    expect(noneExpr.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
        BinaryExpr.eq(ColumnRef.of('posts', 'views'), paramRef('posts', 'views', 10)),
      ]),
    );

    const everyExpr = accessor['posts']!.every((post) => post['views']!.gt(10)) as ExistsExpr;
    expect(everyExpr.notExists).toBe(true);
    expect(everyExpr.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
        new NotExpr(BinaryExpr.gt(ColumnRef.of('posts', 'views'), paramRef('posts', 'views', 10))),
      ]),
    );
  });

  it('treats every({}) as vacuously true and none() as a plain anti-exists join', () => {
    const accessor = createModelAccessor(context, 'public', 'User');

    expect(accessor['posts']!.every({})).toEqual(AndExpr.true());

    const expr = accessor['posts']!.none() as ExistsExpr;
    expect(expr.notExists).toBe(true);
    expect(expr.subquery.where).toEqual(
      BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
    );
  });

  it('supports nested relation filters', () => {
    const accessor = createModelAccessor(context, 'public', 'User');
    const expr = accessor['posts']!.some((post) =>
      post['comments']!.some((comment) => comment['body']!.like('%urgent%')),
    ) as ExistsExpr;

    expect(expr.subquery.where!.kind).toBe('and');
    const where = expr.subquery.where! as AndExpr;
    expect(where.exprs[1]!.kind).toBe('exists');
  });

  it('aliases both directions of ordinary self-relation predicates', () => {
    const children = createModelAccessor(context, 'public', 'User')['invitedUsers']!.some(
      (invitee) => invitee['name']!.eq('Bob'),
    ) as ExistsExpr;
    const inviter = createModelAccessor(context, 'public', 'User')['invitedBy']!.some((invitedBy) =>
      invitedBy['name']!.eq('Alice'),
    ) as ExistsExpr;

    expect(children.subquery.from).toEqual(TableSource.named('users', '__orm_rel_1', 'public'));
    expect(children.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('__orm_rel_1', 'invited_by_id'), ColumnRef.of('users', 'id')),
        BinaryExpr.eq(ColumnRef.of('__orm_rel_1', 'name'), paramRef('users', 'name', 'Bob')),
      ]),
    );
    expect(inviter.subquery.from).toEqual(TableSource.named('users', '__orm_rel_1', 'public'));
    expect(inviter.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('__orm_rel_1', 'id'), ColumnRef.of('users', 'invited_by_id')),
        BinaryExpr.eq(ColumnRef.of('__orm_rel_1', 'name'), paramRef('users', 'name', 'Alice')),
      ]),
    );
  });

  it('allocates distinct aliases for sibling predicates from one accessor', () => {
    const accessor = createModelAccessor(context, 'public', 'User');
    const children = accessor['invitedUsers']!.some((invitee) =>
      invitee['name']!.eq('Bob'),
    ) as ExistsExpr;
    const inviter = accessor['invitedBy']!.some((invitedBy) =>
      invitedBy['name']!.eq('Alice'),
    ) as ExistsExpr;

    expect(children.subquery.from).toEqual(TableSource.named('users', '__orm_rel_1', 'public'));
    expect(inviter.subquery.from).toEqual(TableSource.named('users', '__orm_rel_2', 'public'));
  });

  it('correlates repeated self-relation predicates to the immediate parent alias', () => {
    const expr = createModelAccessor(context, 'public', 'User')['invitedUsers']!.some((child) =>
      child['invitedUsers']!.some((grandchild) => grandchild['name']!.eq('Dan')),
    ) as ExistsExpr;
    const outerWhere = expr.subquery.where as AndExpr;
    const nested = outerWhere.exprs[1] as ExistsExpr;

    expect(expr.subquery.from).toEqual(TableSource.named('users', '__orm_rel_1', 'public'));
    expect(outerWhere.exprs[0]).toEqual(
      BinaryExpr.eq(ColumnRef.of('__orm_rel_1', 'invited_by_id'), ColumnRef.of('users', 'id')),
    );
    expect(nested.subquery.from).toEqual(TableSource.named('users', '__orm_rel_2', 'public'));
    expect(nested.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(
          ColumnRef.of('__orm_rel_2', 'invited_by_id'),
          ColumnRef.of('__orm_rel_1', 'id'),
        ),
        BinaryExpr.eq(ColumnRef.of('__orm_rel_2', 'name'), paramRef('users', 'name', 'Dan')),
      ]),
    );
  });

  it('keeps proxy symbol access undefined and relation shorthand maps null and undefined', () => {
    const user = createModelAccessor(context, 'public', 'User');
    expect((user as Record<PropertyKey, unknown>)[Symbol.iterator]).toBeUndefined();

    // Unknown fields in a shorthand predicate are surfaced loudly — silent skip would drop user intent (a typo'd filter would match every row).
    expect(() => user['posts']!.some({ unknown: 'value' })).toThrow(
      /Shorthand filter on "Post\.unknown": field is not defined on the model/,
    );

    // Undefined values are skipped before the field lookup, so a shorthand with an unknown field and undefined value is a no-op.
    const someUndefined = user['posts']!.some({ unknown: undefined }) as ExistsExpr;
    expect(someUndefined.subquery.where).toEqual(
      BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
    );

    const post = createModelAccessor(context, 'public', 'Post');
    const nullExpr = post['comments']!.some({ body: null }) as ExistsExpr;
    expect(nullExpr.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('comments', 'post_id'), ColumnRef.of('posts', 'id')),
        NullCheckExpr.isNull(ColumnRef.of('comments', 'body')),
      ]),
    );
  });

  it('throws when relation metadata is incomplete', () => {
    const base = getTestContract();
    const brokenJoinContract = withPatchedDomainModels(base, (models) => ({
      ...models,
      User: {
        ...(models['User'] as Record<string, unknown>),
        relations: {
          posts: {
            to: { model: 'Post', namespace: 'public' },
            cardinality: '1:N',
            on: {
              localFields: [],
              targetFields: [],
            },
          },
        },
      },
    }));

    expect(() =>
      (
        createModelAccessor(
          { ...context, contract: brokenJoinContract } as never,
          'public',
          'User',
        ) as unknown as Record<string, { some: () => unknown }>
      )['posts']!.some(),
    ).toThrow(/missing join columns/);
  });

  it('supports composite relation joins and first-target fallback projection', () => {
    const base = getTestContract();
    const compositeContract = withPatchedDomainModels(base, (models) => {
      const user = models['User'] as {
        storage: Record<string, unknown>;
        relations: Record<string, unknown>;
      };
      return {
        ...models,
        User: {
          ...user,
          storage: {
            ...user.storage,
            table: 'users_alt',
          },
          relations: {
            ...user.relations,
            posts: {
              to: { model: 'Post', namespace: 'public' },
              cardinality: '1:N',
              on: {
                localFields: ['id', 'email'],
                targetFields: ['userId', 'title'],
              },
            },
          },
        },
      };
    });

    const compositeExpr = (
      createModelAccessor(
        { ...context, contract: compositeContract } as never,
        'public',
        'User',
      ) as unknown as Record<string, { some: () => unknown }>
    )['posts']!.some() as ExistsExpr;
    expect(compositeExpr.subquery.projection).toEqual([
      ProjectionItem.of('_exists', ColumnRef.of('posts', 'user_id')),
    ]);
    expect(compositeExpr.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users_alt', 'id')),
        BinaryExpr.eq(ColumnRef.of('posts', 'title'), ColumnRef.of('users_alt', 'email')),
      ]),
    );

    const noTargetFieldsContract = withPatchedDomainModels(base, (models) => {
      const user = models['User'] as {
        storage: Record<string, unknown>;
        relations: Record<string, unknown>;
      };
      return {
        ...models,
        User: {
          ...user,
          storage: {
            ...user.storage,
            table: 'users_alt',
          },
          relations: {
            ...user.relations,
            posts: {
              to: { model: 'Post', namespace: 'public' },
              cardinality: '1:N',
              on: {
                localFields: ['id', 'name'],
                targetFields: [undefined, 'title'],
              },
            },
          },
        },
      };
    });

    const fallbackExpr = (
      createModelAccessor(
        { ...context, contract: noTargetFieldsContract } as never,
        'public',
        'User',
      ) as unknown as Record<string, { some: () => unknown }>
    )['posts']!.some() as ExistsExpr;
    expect(fallbackExpr.subquery.projection).toEqual([
      ProjectionItem.of('_exists', ColumnRef.of('posts', 'id')),
    ]);
  });

  it('returns undefined for fields whose storage table is not declared', () => {
    const base = getTestContract();
    const storageFallbackContract = withPatchedDomainModels(base, (models) => {
      const user = models['User'] as { storage: Record<string, unknown> };
      return {
        ...models,
        User: {
          ...user,
          storage: {
            ...user.storage,
            table: 'users_storage',
          },
        },
      };
    });

    // Contract claims the User model lives in `users_storage`, but storage.tables has no entry for it. The Proxy returns undefined for fields whose column cannot be resolved, matching plain JS object semantics. Downstream consumers (or TypeScript at compile time) are responsible for noticing the missing column.
    const accessor = createModelAccessor(
      { ...context, contract: storageFallbackContract } as never,
      'public',
      'User',
    );
    expect(accessor['name']).toBeUndefined();
  });

  it('resolves column when storage.table maps to a declared table with the field', () => {
    const base = getTestContract();
    const modelNameFallbackContract = withPatchedDomainModels(base, (models) => ({
      ...models,
      User: {
        ...(models['User'] as Record<string, unknown>),
        storage: { namespaceId: 'public', table: 'users' },
        relations: {},
      },
    }));

    expect(
      createModelAccessor(
        { ...context, contract: modelNameFallbackContract } as never,
        'public',
        'User',
      )['name']!.isNull(),
    ).toEqual(NullCheckExpr.isNull(ColumnRef.of('users', 'name')));
  });

  it('combines relation shorthand fields with and() and rejects missing join arrays', () => {
    const accessor = createModelAccessor(context, 'public', 'User');
    const predicate = accessor['posts']!.some({ title: 'A', views: 1 }) as ExistsExpr;

    expect(predicate.subquery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('posts', 'title'), paramRef('posts', 'title', 'A')),
          BinaryExpr.eq(ColumnRef.of('posts', 'views'), paramRef('posts', 'views', 1)),
        ]),
      ]),
    );

    const base = getTestContract();
    const contractWithoutJoinArrays = withPatchedDomainModels(base, (models) => ({
      ...models,
      User: {
        ...(models['User'] as Record<string, unknown>),
        relations: {
          posts: {
            to: { model: 'Post', namespace: 'public' },
            cardinality: '1:N',
            on: { localFields: [], targetFields: [] },
          },
        },
      },
    }));

    expect(() =>
      (
        createModelAccessor(
          { ...context, contract: contractWithoutJoinArrays } as never,
          'public',
          'User',
        ) as unknown as Record<string, { some: () => unknown }>
      )['posts']!.some(),
    ).toThrow(/missing join columns/);
  });

  describe('runtime trait-gating', () => {
    it('only creates equality methods when codec has equality trait', () => {
      const codecDescriptors = makeDescriptors({ 'pg/int4@1': ['equality'] });
      const accessor = createModelAccessor({ ...context, codecDescriptors }, 'public', 'Post');
      const field = accessor['id'] as unknown as Record<string, unknown>;

      expect(typeof field['eq']).toBe('function');
      expect(typeof field['neq']).toBe('function');
      expect(typeof field['in']).toBe('function');
      expect(typeof field['notIn']).toBe('function');
      expect(typeof field['isNull']).toBe('function');
      expect(typeof field['isNotNull']).toBe('function');

      expect(field['gt']).toBeUndefined();
      expect(field['lt']).toBeUndefined();
      expect(field['gte']).toBeUndefined();
      expect(field['lte']).toBeUndefined();
      expect(field['like']).toBeUndefined();
      expect(field['asc']).toBeUndefined();
      expect(field['desc']).toBeUndefined();
    });

    it('creates all methods when codec has all relevant traits', () => {
      const codecDescriptors = makeDescriptors({
        'pg/text@1': ['equality', 'order', 'textual'],
      });
      const accessor = createModelAccessor({ ...context, codecDescriptors }, 'public', 'User');
      const field = accessor['name'] as unknown as Record<string, unknown>;

      for (const method of [
        'eq',
        'neq',
        'gt',
        'lt',
        'gte',
        'lte',
        'like',
        'in',
        'notIn',
        'isNull',
        'isNotNull',
        'asc',
        'desc',
      ]) {
        expect(typeof field[method]).toBe('function');
      }
    });

    it('throws when relation shorthand filter targets a field without equality trait', () => {
      const codecDescriptors = makeDescriptors({ 'pg/int4@1': ['order'] });
      const accessor = createModelAccessor({ ...context, codecDescriptors }, 'public', 'Post');

      expect(() => accessor['comments']!.some({ postId: 42 })).toThrow(
        /does not support equality comparisons/,
      );
    });
  });

  describe('variant-aware field resolution', () => {
    const polyContext = { ...context, contract: buildMixedPolyContract() };

    // Codecs come from the patched poly contract's storage, not the base
    // test contract that the outer `paramRef` helper reads.
    function polyParam(table: string, column: string, value: unknown): ParamRef {
      const tables = unboundTables(polyContext.contract.storage) as Record<
        string,
        { columns: Record<string, { codecId?: string }> } | undefined
      >;
      const codecId = tables[table]?.columns[column]?.codecId;
      return codecId ? ParamRef.of(value, { codec: { codecId } }) : ParamRef.of(value);
    }

    // The base `Task` accessor type carries only base fields; the patched poly
    // contract adds variant columns at runtime. View the accessor as a bag of
    // comparison methods so the runtime resolution can be asserted regardless
    // of the static base type.
    interface FieldOps {
      eq(value: unknown): unknown;
      gte(value: unknown): unknown;
    }
    type FieldBag = Record<string, FieldOps | undefined>;

    it('resolves an MTI variant column against the joined variant table', () => {
      const feature = createModelAccessor(
        polyContext,
        'public',
        'Task',
        'Feature',
      ) as unknown as FieldBag;
      // `priority` lives on the joined `features` table, not the base `tasks`.
      expect(feature['priority']!.gte(3)).toEqual(
        new BinaryExpr(
          'gte',
          ColumnRef.of('features', 'priority'),
          polyParam('features', 'priority', 3),
        ),
      );
    });

    it('keeps base columns qualified against the base table when a variant is selected', () => {
      const feature = createModelAccessor(
        polyContext,
        'public',
        'Task',
        'Feature',
      ) as unknown as FieldBag;
      expect(feature['title']!.eq('Dark mode')).toEqual(
        new BinaryExpr(
          'eq',
          ColumnRef.of('tasks', 'title'),
          polyParam('tasks', 'title', 'Dark mode'),
        ),
      );
    });

    it('does not expose another variant column for the selected variant', () => {
      const feature = createModelAccessor(
        polyContext,
        'public',
        'Task',
        'Feature',
      ) as unknown as FieldBag;
      expect(feature['priority']).toBeDefined();
      const bug = createModelAccessor(polyContext, 'public', 'Task', 'Bug') as unknown as FieldBag;
      // Bug is STI — its `severity` rides the base table, never the features join.
      expect(bug['severity']!.eq('critical')).toEqual(
        new BinaryExpr(
          'eq',
          ColumnRef.of('tasks', 'severity'),
          polyParam('tasks', 'severity', 'critical'),
        ),
      );
      // Selecting an STI variant must not surface the MTI variant column.
      expect(bug['priority']).toBeUndefined();
    });

    it('leaves base resolution untouched when no variant is selected', () => {
      const task = createModelAccessor(polyContext, 'public', 'Task') as unknown as FieldBag;
      expect(task['title']!.eq('x')).toEqual(
        new BinaryExpr('eq', ColumnRef.of('tasks', 'title'), polyParam('tasks', 'title', 'x')),
      );
      // Without a selected variant the MTI variant column is not resolvable.
      expect(task['priority']).toBeUndefined();
    });
  });

  describe('variant-aware relation resolution', () => {
    const polyContext = { ...context, contract: buildMixedPolyContract() };

    interface RelationOps {
      some(predicate?: unknown): unknown;
    }
    type RelationBag = Record<string, RelationOps | undefined>;

    it('correlates an MTI variant relation predicate against the variant table', () => {
      const feature = createModelAccessor(
        polyContext,
        'public',
        'Task',
        'Feature',
      ) as unknown as RelationBag;

      const expr = feature['assignee']!.some() as ExistsExpr;

      expect(expr.notExists).toBe(false);
      expect(expr.subquery.from).toEqual(TableSource.named('assignees', undefined, 'public'));
      expect(expr.subquery.projection).toEqual([
        ProjectionItem.of('_exists', ColumnRef.of('assignees', 'id')),
      ]);
      expect(expr.subquery.where).toEqual(
        BinaryExpr.eq(ColumnRef.of('assignees', 'id'), ColumnRef.of('features', 'assignee_id')),
      );
    });

    it('correlates an STI variant relation predicate against the base table', () => {
      const bug = createModelAccessor(
        polyContext,
        'public',
        'Task',
        'Bug',
      ) as unknown as RelationBag;

      const expr = bug['assignee']!.some() as ExistsExpr;

      expect(expr.notExists).toBe(false);
      expect(expr.subquery.from).toEqual(TableSource.named('assignees', undefined, 'public'));
      expect(expr.subquery.where).toEqual(
        BinaryExpr.eq(ColumnRef.of('assignees', 'id'), ColumnRef.of('tasks', 'assignee_id')),
      );
    });

    it('does not expose the variant-declared relation without narrowing', () => {
      const task = createModelAccessor(polyContext, 'public', 'Task') as unknown as RelationBag;
      expect(task['assignee']).toBeUndefined();
    });

    it('keeps a base relation resolving against the base table when a variant is selected', () => {
      const feature = createModelAccessor(
        polyContext,
        'public',
        'Task',
        'Feature',
      ) as unknown as RelationBag;

      const expr = feature['subtasks']!.some() as ExistsExpr;

      expect(expr.subquery.from).toEqual(TableSource.named('tasks', '__orm_rel_1', 'public'));
      expect(expr.subquery.where).toEqual(
        BinaryExpr.eq(ColumnRef.of('__orm_rel_1', 'parent_id'), ColumnRef.of('tasks', 'id')),
      );
    });

    it('does not consume an alias when resolving an already joined variant source', () => {
      const feature = createModelAccessor(
        polyContext,
        'public',
        'Task',
        'Feature',
      ) as unknown as RelationBag;

      feature['assignee']!.some();
      const expr = feature['subtasks']!.some() as ExistsExpr;

      expect(expr.subquery.from).toEqual(TableSource.named('tasks', '__orm_rel_1', 'public'));
    });
  });

  describe('M:N relation filters via junction', () => {
    it('some() emits EXISTS through junction (single-key)', () => {
      const accessor = createModelAccessor(context, 'public', 'User') as unknown as Record<
        string,
        { some: (pred?: unknown) => unknown }
      >;

      const expr = accessor['tags']!.some() as ExistsExpr;

      expect(expr.notExists).toBe(false);
      expect(expr.subquery.from).toEqual(TableSource.named('tags', undefined, 'public'));
      expect(expr.subquery.joins).toEqual([
        JoinAst.inner(
          TableSource.named('user_tags', undefined, 'public'),
          BinaryExpr.eq(ColumnRef.of('user_tags', 'tag_id'), ColumnRef.of('tags', 'id')),
        ),
      ]);
      expect(expr.subquery.where).toEqual(
        BinaryExpr.eq(ColumnRef.of('user_tags', 'user_id'), ColumnRef.of('users', 'id')),
      );
    });

    it('some(pred) AND-s junction correlation with predicate', () => {
      const accessor = createModelAccessor(context, 'public', 'User') as unknown as Record<
        string,
        { some: (pred: (c: unknown) => unknown) => unknown }
      >;

      const expr = accessor['tags']!.some((c: unknown) =>
        (c as Record<string, { eq: (v: unknown) => unknown }>)['name']!.eq('Rust'),
      ) as ExistsExpr;

      expect(expr.notExists).toBe(false);
      expect(expr.subquery.where).toEqual(
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('user_tags', 'user_id'), ColumnRef.of('users', 'id')),
          BinaryExpr.eq(ColumnRef.of('tags', 'name'), paramRef('tags', 'name', 'Rust')),
        ]),
      );
    });

    it('none() emits NOT EXISTS through junction', () => {
      const accessor = createModelAccessor(context, 'public', 'User') as unknown as Record<
        string,
        { none: (pred?: unknown) => unknown }
      >;

      const expr = accessor['tags']!.none() as ExistsExpr;
      expect(expr.notExists).toBe(true);
      expect(expr.subquery.where).toEqual(
        BinaryExpr.eq(ColumnRef.of('user_tags', 'user_id'), ColumnRef.of('users', 'id')),
      );
    });

    it('every(pred) emits NOT EXISTS(… AND NOT(pred)) through junction', () => {
      const accessor = createModelAccessor(context, 'public', 'User') as unknown as Record<
        string,
        { every: (pred: (c: unknown) => unknown) => unknown }
      >;

      const expr = accessor['tags']!.every((c: unknown) =>
        (c as Record<string, { eq: (v: unknown) => unknown }>)['name']!.eq('Rust'),
      ) as ExistsExpr;

      expect(expr.notExists).toBe(true);
      expect(expr.subquery.where).toEqual(
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('user_tags', 'user_id'), ColumnRef.of('users', 'id')),
          new NotExpr(
            BinaryExpr.eq(ColumnRef.of('tags', 'name'), paramRef('tags', 'name', 'Rust')),
          ),
        ]),
      );
    });

    it('every({}) is vacuously true for M:N relations', () => {
      const accessor = createModelAccessor(context, 'public', 'User') as unknown as Record<
        string,
        { every: (pred: unknown) => unknown }
      >;

      expect(accessor['tags']!.every({})).toEqual(AndExpr.true());
    });

    it('some() emits EXISTS with composite-key AND-ed junction join', () => {
      const accessor = createModelAccessor(context, 'public', 'Project') as unknown as Record<
        string,
        { some: () => unknown }
      >;

      const expr = accessor['related']!.some() as ExistsExpr;

      expect(expr.subquery.joins).toEqual([
        JoinAst.inner(
          TableSource.named('project_links', undefined, 'public'),
          AndExpr.of([
            BinaryExpr.eq(
              ColumnRef.of('project_links', 'dst_tenant_id'),
              ColumnRef.of('__orm_rel_1', 'tenant_id'),
            ),
            BinaryExpr.eq(
              ColumnRef.of('project_links', 'dst_id'),
              ColumnRef.of('__orm_rel_1', 'id'),
            ),
          ]),
        ),
      ]);
      expect(expr.subquery.where).toEqual(
        AndExpr.of([
          BinaryExpr.eq(
            ColumnRef.of('project_links', 'src_tenant_id'),
            ColumnRef.of('projects', 'tenant_id'),
          ),
          BinaryExpr.eq(ColumnRef.of('project_links', 'src_id'), ColumnRef.of('projects', 'id')),
        ]),
      );
    });

    it('aliases the related table for self-referential M:N predicates', () => {
      const accessor = createModelAccessor(context, 'public', 'Project') as unknown as Record<
        string,
        { some: (pred: (c: unknown) => unknown) => unknown }
      >;

      const expr = accessor['related']!.some((c: unknown) =>
        (c as Record<string, { eq: (v: unknown) => unknown }>)['name']!.eq('Apollo'),
      ) as ExistsExpr;

      expect(expr.subquery.from).toEqual(TableSource.named('projects', '__orm_rel_1', 'public'));
      expect(expr.subquery.projection).toEqual([
        ProjectionItem.of('_exists', ColumnRef.of('__orm_rel_1', 'tenant_id')),
      ]);
      expect(expr.subquery.where).toEqual(
        AndExpr.of([
          AndExpr.of([
            BinaryExpr.eq(
              ColumnRef.of('project_links', 'src_tenant_id'),
              ColumnRef.of('projects', 'tenant_id'),
            ),
            BinaryExpr.eq(ColumnRef.of('project_links', 'src_id'), ColumnRef.of('projects', 'id')),
          ]),
          BinaryExpr.eq(
            ColumnRef.of('__orm_rel_1', 'name'),
            paramRef('projects', 'name', 'Apollo'),
          ),
        ]),
      );
    });

    it('uses distinct child and junction aliases for repeated self-referential M:N predicates', () => {
      const accessor = createModelAccessor(context, 'public', 'Project') as unknown as Record<
        string,
        { some: (pred: (c: unknown) => unknown) => unknown }
      >;

      const expr = accessor['related']!.some((related: unknown) =>
        (related as Record<string, { some: (pred: (c: unknown) => unknown) => unknown }>)[
          'related'
        ]!.some((nested: unknown) =>
          (nested as Record<string, { eq: (v: unknown) => unknown }>)['name']!.eq('Gamma'),
        ),
      ) as ExistsExpr;
      const outerWhere = expr.subquery.where as AndExpr;
      const nested = outerWhere.exprs[1] as ExistsExpr;

      expect(expr.subquery.from).toEqual(TableSource.named('projects', '__orm_rel_1', 'public'));
      expect(expr.subquery.joins).toEqual([
        JoinAst.inner(
          TableSource.named('project_links', undefined, 'public'),
          AndExpr.of([
            BinaryExpr.eq(
              ColumnRef.of('project_links', 'dst_tenant_id'),
              ColumnRef.of('__orm_rel_1', 'tenant_id'),
            ),
            BinaryExpr.eq(
              ColumnRef.of('project_links', 'dst_id'),
              ColumnRef.of('__orm_rel_1', 'id'),
            ),
          ]),
        ),
      ]);
      expect(nested.subquery.from).toEqual(TableSource.named('projects', '__orm_rel_2', 'public'));
      expect(nested.subquery.joins).toEqual([
        JoinAst.inner(
          TableSource.named('project_links', '__orm_junction_3', 'public'),
          AndExpr.of([
            BinaryExpr.eq(
              ColumnRef.of('__orm_junction_3', 'dst_tenant_id'),
              ColumnRef.of('__orm_rel_2', 'tenant_id'),
            ),
            BinaryExpr.eq(
              ColumnRef.of('__orm_junction_3', 'dst_id'),
              ColumnRef.of('__orm_rel_2', 'id'),
            ),
          ]),
        ),
      ]);
      expect(nested.subquery.where).toEqual(
        AndExpr.of([
          AndExpr.of([
            BinaryExpr.eq(
              ColumnRef.of('__orm_junction_3', 'src_tenant_id'),
              ColumnRef.of('__orm_rel_1', 'tenant_id'),
            ),
            BinaryExpr.eq(
              ColumnRef.of('__orm_junction_3', 'src_id'),
              ColumnRef.of('__orm_rel_1', 'id'),
            ),
          ]),
          BinaryExpr.eq(ColumnRef.of('__orm_rel_2', 'name'), paramRef('projects', 'name', 'Gamma')),
        ]),
      );
    });

    it('throws when M:N join metadata column counts differ', () => {
      const malformedContract = withPatchedDomainModels(getTestContract(), (models) => {
        const project = models['Project'] as { relations: Record<string, unknown> };
        const related = project.relations['related'] as { through: Record<string, unknown> };
        return {
          ...models,
          Project: {
            ...project,
            relations: {
              ...project.relations,
              related: {
                ...related,
                through: { ...related.through, targetColumns: ['tenant_id'] },
              },
            },
          },
        };
      });
      const accessor = createModelAccessor(
        { ...context, contract: malformedContract } as never,
        'public',
        'Project',
      ) as unknown as Record<string, { some: () => unknown }>;

      expect(() => accessor['related']!.some()).toThrow(
        /Relation metadata has mismatched join column counts/,
      );
    });

    it('throws when M:N join metadata omits a paired column', () => {
      const malformedContract = withPatchedDomainModels(getTestContract(), (models) => {
        const project = models['Project'] as { relations: Record<string, unknown> };
        const related = project.relations['related'] as { through: Record<string, unknown> };
        return {
          ...models,
          Project: {
            ...project,
            relations: {
              ...project.relations,
              related: {
                ...related,
                through: { ...related.through, childColumns: ['dst_tenant_id', ''] },
              },
            },
          },
        };
      });
      const accessor = createModelAccessor(
        { ...context, contract: malformedContract } as never,
        'public',
        'Project',
      ) as unknown as Record<string, { some: () => unknown }>;

      expect(() => accessor['related']!.some()).toThrow(
        /Relation metadata is missing a join column pair/,
      );
    });
  });

  describe('extension operations', () => {
    it('attaches trait-targeted op only when codec traits are a superset of required traits', () => {
      const queryOperations = createSqlOperationRegistry();
      queryOperations.register('synthetic', {
        self: { traits: ['equality', 'textual'] },
        impl: () => undefined as never,
      });

      const traitsByCodec: Record<string, readonly CodecTrait[]> = {
        'pg/text@1': ['equality', 'textual'],
        'pg/int4@1': ['equality'],
        'pg/bool@1': ['equality', 'boolean'],
      };
      const codecDescriptors = makeDescriptors(traitsByCodec);

      const ctx = { ...context, queryOperations, codecDescriptors };
      const user = createModelAccessor(ctx, 'public', 'User');
      const post = createModelAccessor(ctx, 'public', 'Post');

      const name = user['name'] as unknown as Record<string, unknown>;
      expect(typeof name['synthetic']).toBe('function');

      const views = post['views'] as unknown as Record<string, unknown>;
      expect(views['synthetic']).toBeUndefined();
    });
  });
});
