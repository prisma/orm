import { validateSqlContractFully } from '@internal/sql-contract/validators';
import {
  AndExpr,
  BinaryExpr,
  type ColumnRef,
  DerivedTableSource,
  ExistsExpr,
  IdentifierRef,
  ParamRef,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { describe, expect, it, vi } from 'vitest';
import { sql } from '../../src/runtime/sql';
import { contract as contractJson } from '../fixtures/contract';
import type { Contract } from '../fixtures/generated/contract';

/** The one aggregate these plan-shape cases invoke; every other pair stays undeclared and is rejected. */
const emptyAggregateRegistry = {
  resolve: (operation: string) =>
    operation === 'count'
      ? {
          operation,
          output: { codecId: 'pg/int8@1' },
          nullable: false as const,
          emptyResultJson: '0',
          lower: undefined,
        }
      : undefined,
  values: function* () {
    yield {
      operation: 'count',
      input: { kind: 'any' as const },
      output: { kind: 'codec' as const, codecId: 'pg/int8@1' },
      nullable: false as const,
      emptyResultJson: '0',
    };
  },
};

// ---------------------------------------------------------------------------
// Fixture: real contract with users + posts
// ---------------------------------------------------------------------------

const sqlContract = validateSqlContractFully<Contract>(contractJson);

const stubBase = {
  operations: {},
  codecs: {},
  queryOperations: { entries: () => ({}) },
  aggregateDescriptors: emptyAggregateRegistry,
  types: {},
  applyMutationDefaults: () => [],
};

const stubInferer = { inferCodec: () => 'pg/text@1' };

function db() {
  return sql({
    context: { ...stubBase, contract: sqlContract } as unknown as ExecutionContext<
      typeof sqlContract
    >,
    rawCodecInferer: stubInferer,
  });
}

function dbNoCapabilities() {
  const noLateralContract = validateSqlContractFully<Contract>({
    ...contractJson,
    capabilities: { sql: {}, postgres: {} },
  });
  return sql({
    context: { ...stubBase, contract: noLateralContract } as unknown as ExecutionContext<
      typeof noLateralContract
    >,
    rawCodecInferer: stubInferer,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAst(builder: { buildAst(): SelectAst }): SelectAst {
  return builder.buildAst();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sql', () => {
  it('exposes table proxies for all tables in contract', () => {
    const d = db();
    expect(d.public.users).toBeDefined();
    expect(d.public.posts).toBeDefined();
  });

  it('returns undefined for an unknown table in a namespace', () => {
    const d = db();
    expect((d.public as Record<string, unknown>)['nonexistent']).toBeUndefined();
  });
});

describe('TableProxy', () => {
  it('as() produces proxy with rebound alias', () => {
    const d = db();
    const u1 = d.public.users.as('u1');
    const ast = u1.buildAst() as TableSource;
    expect(ast).toBeInstanceOf(TableSource);
    expect(ast.name).toBe('users');
    expect(ast.alias).toBe('u1');
    expect(ast.namespaceId).toBe('public');
  });
});

describe('select', () => {
  it('select by column names produces ProjectionItems', () => {
    const ast = getAst(db().public.users.select('id', 'name'));
    expect(ast.projection).toHaveLength(2);
    expect(ast.projection[0]!.alias).toBe('id');
    expect(ast.projection[0]!.expr).toBeInstanceOf(IdentifierRef);
    expect((ast.projection[0]!.expr as IdentifierRef).name).toBe('id');
    expect(ast.projection[1]!.alias).toBe('name');
  });

  it('select with aliased expression', () => {
    const ast = getAst(db().public.users.select('upper_name', (f, _fns) => f.name));
    expect(ast.projection).toHaveLength(1);
    expect(ast.projection[0]!.alias).toBe('upper_name');
    expect(ast.projection[0]!.expr).toBeInstanceOf(IdentifierRef);
  });

  it('select with callback record', () => {
    const ast = getAst(db().public.users.select((f) => ({ myId: f.id, myName: f.name })));
    expect(ast.projection).toHaveLength(2);
    expect(ast.projection[0]!.alias).toBe('myId');
    expect(ast.projection[1]!.alias).toBe('myName');
  });

  it('chained select accumulates projections', () => {
    const ast = getAst(db().public.users.select('id').select('name'));
    expect(ast.projection).toHaveLength(2);
    expect(ast.projection[0]!.alias).toBe('id');
    expect(ast.projection[1]!.alias).toBe('name');
  });
});

describe('where', () => {
  it('single where produces BinaryExpr', () => {
    const ast = getAst(
      db()
        .public.users.select('id')
        .where((f, fns) => fns.eq(f.id, 1)),
    );
    expect(ast.where).toBeInstanceOf(BinaryExpr);
    expect((ast.where as BinaryExpr).op).toBe('eq');
  });

  it('multiple where calls produce AndExpr', () => {
    const ast = getAst(
      db()
        .public.users.select('id')
        .where((f, fns) => fns.eq(f.id, 1))
        .where((f, fns) => fns.gt(f.id, 0)),
    );
    expect(ast.where).toBeInstanceOf(AndExpr);
    expect((ast.where as AndExpr).exprs).toHaveLength(2);
  });
});

describe('immutability', () => {
  it('where does not mutate original builder', () => {
    const base = db().public.users.select('id');
    const filtered = base.where((f, fns) => fns.eq(f.id, 1));
    expect(getAst(base).where).toBeUndefined();
    expect(getAst(filtered).where).toBeDefined();
  });

  it('select does not mutate original builder', () => {
    const base = db().public.users.select('id');
    const extended = base.select('name');
    expect(getAst(base).projection).toHaveLength(1);
    expect(getAst(extended).projection).toHaveLength(2);
  });
});

describe('joins', () => {
  it('innerJoin produces JoinAst with inner type', () => {
    const ast = getAst(
      db()
        .public.users.innerJoin(db().public.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
        .select('name', 'title'),
    );
    expect(ast.joins).toHaveLength(1);
    expect(ast.joins![0]!.joinType).toBe('inner');
    expect(ast.joins![0]!.source).toBeInstanceOf(TableSource);
    expect(ast.joins![0]!.on).toBeInstanceOf(BinaryExpr);
  });

  it('outerLeftJoin produces JoinAst with left type', () => {
    const ast = getAst(
      db()
        .public.users.outerLeftJoin(db().public.posts, (f, fns) =>
          fns.eq(f.users.id, f.posts.user_id),
        )
        .select('name'),
    );
    expect(ast.joins![0]!.joinType).toBe('left');
  });

  it('outerRightJoin produces JoinAst with right type', () => {
    const ast = getAst(
      db()
        .public.users.outerRightJoin(db().public.posts, (f, fns) =>
          fns.eq(f.users.id, f.posts.user_id),
        )
        .select('title'),
    );
    expect(ast.joins![0]!.joinType).toBe('right');
  });

  it('outerFullJoin produces JoinAst with full type', () => {
    const ast = getAst(
      db()
        .public.users.outerFullJoin(db().public.posts, (f, fns) =>
          fns.eq(f.users.id, f.posts.user_id),
        )
        .select((f) => ({ name: f.users.name })),
    );
    expect(ast.joins![0]!.joinType).toBe('full');
  });

  it('join on expression references columns from both sides', () => {
    const ast = getAst(
      db()
        .public.users.innerJoin(db().public.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
        .select('name'),
    );
    const on = ast.joins![0]!.on as BinaryExpr;
    const left = on.left as ColumnRef;
    const right = on.right as ColumnRef;
    expect(left.table).toBe('users');
    expect(left.column).toBe('id');
    expect(right.table).toBe('posts');
    expect(right.column).toBe('user_id');
  });
});

describe('self-join via as()', () => {
  it('self-join with aliased tables', () => {
    const d = db();
    const u1 = d.public.users.as('u1');
    const u2 = d.public.users.as('u2');
    const ast = getAst(
      u1
        .innerJoin(u2, (f, fns) => fns.eq(f.u1.id, f.u2.invited_by_id))
        .select((f) => ({ inviter: f.u1.name, invitee: f.u2.name })),
    );
    expect(ast.from).toBeInstanceOf(TableSource);
    expect((ast.from as TableSource).alias).toBe('u1');
    expect(ast.joins).toHaveLength(1);
    expect((ast.joins![0]!.source as TableSource).alias).toBe('u2');
  });
});

describe('orderBy', () => {
  it('orderBy string with desc direction', () => {
    const ast = getAst(
      db().public.users.select('id', 'name').orderBy('name', { direction: 'desc' }),
    );
    expect(ast.orderBy).toHaveLength(1);
    expect(ast.orderBy![0]!.dir).toBe('desc');
    expect(ast.orderBy![0]!.expr).toBeInstanceOf(IdentifierRef);
    expect((ast.orderBy![0]!.expr as IdentifierRef).name).toBe('name');
  });

  it('orderBy defaults to asc', () => {
    const ast = getAst(db().public.users.select('id').orderBy('id'));
    expect(ast.orderBy![0]!.dir).toBe('asc');
  });

  it('orderBy with expression callback', () => {
    const ast = getAst(
      db()
        .public.users.select('id')
        .orderBy((f) => f.id),
    );
    expect(ast.orderBy).toHaveLength(1);
    expect(ast.orderBy![0]!.expr).toBeInstanceOf(IdentifierRef);
  });

  it('multiple orderBy calls accumulate', () => {
    const ast = getAst(
      db().public.users.select('id', 'name').orderBy('id').orderBy('name', { direction: 'desc' }),
    );
    expect(ast.orderBy).toHaveLength(2);
  });

  it('nulls option reaches the AST for the string overload', () => {
    const ast = getAst(
      db().public.users.select('id', 'name').orderBy('name', { direction: 'desc', nulls: 'last' }),
    );
    expect(ast.orderBy![0]!.dir).toBe('desc');
    expect(ast.orderBy![0]!.nulls).toBe('last');
  });

  it('nulls option reaches the AST for the expression-callback overload', () => {
    const ast = getAst(
      db()
        .public.users.select('id')
        .orderBy((f) => f.id, { nulls: 'first' }),
    );
    expect(ast.orderBy![0]!.dir).toBe('asc');
    expect(ast.orderBy![0]!.nulls).toBe('first');
  });

  it('omitting nulls leaves placement to the target default', () => {
    const ast = getAst(db().public.users.select('id').orderBy('id', { direction: 'desc' }));
    expect(ast.orderBy![0]!.nulls).toBeUndefined();
  });
});

describe('groupBy and having', () => {
  it('groupBy transitions builder and produces groupBy on AST', () => {
    const ast = getAst(db().public.posts.select('user_id').groupBy('user_id'));
    expect(ast.groupBy).toHaveLength(1);
    expect(ast.groupBy![0]).toBeInstanceOf(IdentifierRef);
    expect((ast.groupBy![0] as IdentifierRef).name).toBe('user_id');
  });

  it('having adds HAVING clause', () => {
    const ast = getAst(
      db()
        .public.posts.select('user_id')
        .select('cnt', (_f, fns) => fns.count())
        .groupBy('user_id')
        .having((_f, fns) => fns.gt(fns.count(), 1)),
    );
    expect(ast.having).toBeDefined();
    expect(ast.having).toBeInstanceOf(BinaryExpr);
  });

  it('groupBy with expression callback', () => {
    const ast = getAst(
      db()
        .public.posts.select('user_id')
        .groupBy((f) => f.user_id),
    );
    expect(ast.groupBy).toHaveLength(1);
  });
});

describe('limit and offset', () => {
  it('limit sets limit on AST', () => {
    const ast = getAst(db().public.users.select('id').limit(10));
    expect(ast.limit).toBe(10);
  });

  it('offset sets offset on AST', () => {
    const ast = getAst(db().public.users.select('id').offset(5));
    expect(ast.offset).toBe(5);
  });

  it('limit and offset together', () => {
    const ast = getAst(db().public.users.select('id').limit(10).offset(5));
    expect(ast.limit).toBe(10);
    expect(ast.offset).toBe(5);
  });
});

describe('distinct', () => {
  it('distinct sets distinct on AST', () => {
    const ast = getAst(db().public.users.select('id').distinct());
    expect(ast.distinct).toBe(true);
  });

  it('distinctOn sets distinctOn on AST', () => {
    const ast = getAst(db().public.users.select('id', 'name').distinctOn('id'));
    expect(ast.distinctOn).toHaveLength(1);
    expect(ast.distinctOn![0]).toBeInstanceOf(IdentifierRef);
  });

  it('distinctOn throws without capability', () => {
    const query = dbNoCapabilities().public.users.select('id') as unknown as {
      distinctOn(s: string): void;
    };
    expect(() => query.distinctOn('id')).toThrow(
      'distinctOn() requires capability postgres.distinctOn',
    );
  });
});

describe('lateral joins', () => {
  it('lateralJoin produces lateral JoinAst with DerivedTableSource', () => {
    const d = db();
    const ast = getAst(
      d.public.users
        .lateralJoin('recent_posts', (lateral) =>
          lateral
            .from(d.public.posts)
            .select('title')
            .where((f, fns) => fns.eq(f.posts.user_id, f.users.id))
            .limit(3),
        )
        .select('name', 'title'),
    );
    expect(ast.joins).toHaveLength(1);
    expect(ast.joins![0]!.lateral).toBe(true);
    expect(ast.joins![0]!.source).toBeInstanceOf(DerivedTableSource);
    expect((ast.joins![0]!.source as DerivedTableSource).alias).toBe('recent_posts');
  });

  it('lateralJoin throws without capability', () => {
    const d = dbNoCapabilities();
    const users = d.public.users as unknown as { lateralJoin(alias: string, fn: unknown): void };
    expect(() =>
      users.lateralJoin(
        'x',
        (lateral: { from(t: unknown): { select(...args: string[]): unknown } }) =>
          lateral.from(d.public.posts).select('id'),
      ),
    ).toThrow('lateralJoin() requires capability sql.lateral');
  });
});

describe('subquery as join source', () => {
  it('select query .as() produces JoinSource backed by DerivedTableSource', () => {
    const sub = db().public.posts.select('user_id').as('sub');
    const source = sub.buildAst() as DerivedTableSource;
    expect(source).toBeInstanceOf(DerivedTableSource);
    expect(source.alias).toBe('sub');
  });

  it('subquery can be used in innerJoin', () => {
    const d = db();
    const sub = d.public.posts.select('user_id').as('sub');
    const ast = getAst(
      d.public.users.innerJoin(sub, (f, fns) => fns.eq(f.users.id, f.sub.user_id)).select('name'),
    );
    expect(ast.joins).toHaveLength(1);
    expect(ast.joins![0]!.source).toBeInstanceOf(DerivedTableSource);
  });
});

describe('subquery in exists/in', () => {
  it('subquery implements buildAst for exists()', () => {
    const d = db();
    const sub = d.public.posts.select('id');
    // sub should have buildAst() for Subquery interface
    const ast = sub.buildAst();
    expect(ast).toBeInstanceOf(SelectAst);
  });

  it('subquery used in where with exists', () => {
    const d = db();
    const ast = getAst(
      d.public.users
        .select('id')
        .where((f, fns) =>
          fns.exists(d.public.posts.select('id').where((pf, pfns) => pfns.eq(pf.user_id, f.id))),
        ),
    );
    expect(ast.where).toBeInstanceOf(ExistsExpr);
  });
});

describe('grouped query methods', () => {
  it('grouped query supports orderBy', () => {
    const ast = getAst(
      db()
        .public.posts.select('user_id')
        .groupBy('user_id')
        .orderBy('user_id', { direction: 'desc' }),
    );
    expect(ast.orderBy).toHaveLength(1);
    expect(ast.orderBy![0]!.dir).toBe('desc');
  });

  it('grouped query supports limit/offset', () => {
    const ast = getAst(db().public.posts.select('user_id').groupBy('user_id').limit(5).offset(10));
    expect(ast.limit).toBe(5);
    expect(ast.offset).toBe(10);
  });

  it('grouped query supports distinct', () => {
    const ast = getAst(db().public.posts.select('user_id').groupBy('user_id').distinct());
    expect(ast.distinct).toBe(true);
  });

  it('grouped query supports as() for subquery', () => {
    const sub = db().public.posts.select('user_id').groupBy('user_id').as('grouped');
    const source = sub.buildAst() as DerivedTableSource;
    expect(source).toBeInstanceOf(DerivedTableSource);
    expect(source.alias).toBe('grouped');
  });

  it('grouped query supports chained groupBy', () => {
    const ast = getAst(
      db().public.posts.select('user_id', 'views').groupBy('user_id').groupBy('views'),
    );
    expect(ast.groupBy).toHaveLength(2);
  });
});

describe('mutation defaults', () => {
  function dbWithSpy() {
    const spy = vi.fn(() => []);
    const d = sql({
      context: {
        ...stubBase,
        contract: sqlContract,
        applyMutationDefaults: spy,
      } as unknown as ExecutionContext<typeof sqlContract>,
      rawCodecInferer: stubInferer,
    });
    return { d, spy };
  }

  it('INSERT calls applyMutationDefaults with op create', () => {
    const { d, spy } = dbWithSpy();
    d.public.users.insert([{ id: 1, name: 'A', email: 'a@b.com' }]).build();
    expect(spy).toHaveBeenCalledWith({
      op: 'create',
      table: 'users',
      namespace: 'public',
      values: { id: 1, name: 'A', email: 'a@b.com' },
    });
  });

  it('UPDATE calls applyMutationDefaults with op update', () => {
    const { d, spy } = dbWithSpy();
    d.public.users
      .update({ name: 'B' })
      .where((f, fns) => fns.eq(f.id, 1))
      .build();
    expect(spy).toHaveBeenCalledWith({
      op: 'update',
      table: 'users',
      namespace: 'public',
      values: { name: 'B' },
    });
  });
});

describe('INSERT multi-row', () => {
  it('empty array throws at build time', () => {
    expect(() => db().public.users.insert([]).build()).toThrow(
      'insert() called with an empty row array — at least one row is required',
    );
  });

  it('single row via array calls applyMutationDefaults once', () => {
    const spy = vi.fn(() => []);
    const d = sql({
      context: {
        ...stubBase,
        contract: sqlContract,
        applyMutationDefaults: spy,
      } as unknown as ExecutionContext<typeof sqlContract>,
      rawCodecInferer: stubInferer,
    });
    d.public.users.insert([{ id: 1, name: 'A' }]).build();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      op: 'create',
      table: 'users',
      namespace: 'public',
      values: { id: 1, name: 'A' },
    });
  });

  it('multi-row calls applyMutationDefaults once per row', () => {
    const spy = vi.fn(() => [{ column: 'email', value: 'default@x.com' }]);
    const d = sql({
      context: {
        ...stubBase,
        contract: sqlContract,
        applyMutationDefaults: spy,
      } as unknown as ExecutionContext<typeof sqlContract>,
      rawCodecInferer: stubInferer,
    });
    const plan = d.public.users
      .insert([
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ])
      .build();
    expect(spy).toHaveBeenCalledTimes(2);
    const params = plan.ast.collectParamRefs();
    expect(params).toHaveLength(6); // id + name + email (default) for each of 2 rows
  });

  it('multi-row with differing column sets passes each row through with its own columns only', () => {
    const d = db();
    const plan = d.public.users
      .insert([
        { id: 1, name: 'A' },
        { id: 2, email: 'b@x.com' },
      ])
      .build();
    const ast = plan.ast;
    expect(ast.kind).toBe('insert');
    if (ast.kind !== 'insert') throw new Error('expected insert');
    expect(ast.rows).toHaveLength(2);
    // each row carries exactly the columns the caller supplied — no cross-row fill
    expect(Object.keys(ast.rows[0]!).sort()).toEqual(['id', 'name']);
    expect(Object.keys(ast.rows[1]!).sort()).toEqual(['email', 'id']);
  });

  it('multi-row with defaults hook: each row gets its own defaults independently', () => {
    const spy = vi.fn((args: { values: Record<string, unknown> }) => {
      if ('id' in args.values && (args.values['id'] as number) === 1) {
        return [{ column: 'email', value: 'default@x.com' }];
      }
      return [];
    });
    const d = sql({
      context: {
        ...stubBase,
        contract: sqlContract,
        applyMutationDefaults: spy,
      } as unknown as ExecutionContext<typeof sqlContract>,
      rawCodecInferer: stubInferer,
    });
    const plan = d.public.users
      .insert([
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ])
      .build();
    expect(spy).toHaveBeenCalledTimes(2);
    const ast = plan.ast;
    if (ast.kind !== 'insert') throw new Error('expected insert');
    expect(ast.rows).toHaveLength(2);
    // row 0 got email from defaults; row 1 did not — no cross-row fill
    expect(Object.keys(ast.rows[0]!).sort()).toEqual(['email', 'id', 'name']);
    expect(Object.keys(ast.rows[1]!).sort()).toEqual(['id', 'name']);
  });
});

describe('UPDATE callback overload', () => {
  it('set clause carries a non-ParamRef expression node for callback-assigned column', () => {
    const d = db();
    const plan = d.public.users
      .update((f) => ({ name: f.name }))
      .where((f, fns) => fns.eq(f.id, 1))
      .build();
    const ast = plan.ast;
    if (ast.kind !== 'update') throw new Error('expected update');
    const nameValue = ast.set['name'];
    expect(nameValue).toBeDefined();
    expect(nameValue).not.toBeInstanceOf(ParamRef);
    expect(nameValue!.kind).toBe('identifier-ref');
  });

  it('mutation defaults hook fires once with op update for callback overload', () => {
    const spy = vi.fn(() => []);
    const d = sql({
      context: {
        ...stubBase,
        contract: sqlContract,
        applyMutationDefaults: spy,
      } as unknown as ExecutionContext<typeof sqlContract>,
      rawCodecInferer: stubInferer,
    });
    d.public.users
      .update((f) => ({ name: f.name }))
      .where((f, fns) => fns.eq(f.id, 1))
      .build();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ op: 'update', table: 'users' }));
  });

  it('where and returning clauses are identical between object and callback overloads', () => {
    const d = db();
    const objectPlan = d.public.users
      .update({ name: 'x' })
      .where((f, fns) => fns.eq(f.id, 42))
      .returning('id')
      .build();
    const callbackPlan = d.public.users
      .update((f) => ({ name: f.name }))
      .where((f, fns) => fns.eq(f.id, 42))
      .returning('id')
      .build();
    const objectAst = objectPlan.ast;
    const callbackAst = callbackPlan.ast;
    if (objectAst.kind !== 'update' || callbackAst.kind !== 'update') {
      throw new Error('expected update');
    }
    expect(callbackAst.where).toEqual(objectAst.where);
    expect(callbackAst.returning).toEqual(objectAst.returning);
  });
});
