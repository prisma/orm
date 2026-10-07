import { validateSqlContractFully } from '@internal/sql-contract/validators';
import {
  BinaryExpr,
  ColumnRef,
  JsonArrayAggExpr,
  LockingClause,
  NativeJsonValueProjection,
  OrderByItem,
  ParamRef,
  ProjectionItem,
  TableSource,
  WindowFuncExpr,
} from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { describe, expect, it } from 'vitest';
import { buildSelectAst, emptyState } from '../../src/runtime/builder-base';
import { sql } from '../../src/runtime/sql';
import { contract as contractJson } from '../fixtures/contract';
import type { Contract } from '../fixtures/generated/contract';
import { usersScope } from './test-helpers';

const countOnlyAggregateRegistry = {
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

const stubBase = {
  operations: {},
  codecs: {},
  queryOperations: { entries: () => ({}) },
  aggregateDescriptors: countOnlyAggregateRegistry,
  types: {},
  applyMutationDefaults: () => [],
};

function dbWith(capabilities: Record<string, Record<string, boolean>>) {
  const contract = validateSqlContractFully<Contract>({ ...contractJson, capabilities });
  return sql({
    context: { ...stubBase, contract } as unknown as ExecutionContext<typeof contract>,
    rawCodecInferer: { inferCodec: () => 'pg/text@1' },
  });
}

const db = () => dbWith(contractJson.capabilities);

const withoutFlag = (group: 'sql' | 'postgres', flag: string) =>
  dbWith({
    ...contractJson.capabilities,
    [group]: { ...contractJson.capabilities[group], [flag]: false },
  });

const lockIncompatible = (conflict: string, message: string) =>
  expect.objectContaining({
    name: 'StructuredError',
    code: 'ORM.LOCK_INCOMPATIBLE',
    message,
    meta: { conflict },
  });

const capabilityMissing = (method: string, capability: string) =>
  expect.objectContaining({
    name: 'StructuredError',
    code: 'ORM.CAPABILITY_MISSING',
    message: `${method}() requires capability ${capability}`,
    meta: { method, capability },
  });

describe('row locking', () => {
  it.each(['forUpdate', 'forNoKeyUpdate', 'forShare', 'forKeyShare'] as const)(
    '%s puts its clause on the built tree',
    (method) => {
      const plan = db().public.users.select('id')[method]().build();

      expect(plan.ast).toMatchObject({ locking: [LockingClause.of(method)] });
    },
  );

  it('of, nowait and skipLocked land on the clause', () => {
    const users = db().public.users;

    expect(
      users
        .select('id')
        .forUpdate({ of: ['users'], nowait: true })
        .build().ast,
    ).toMatchObject({
      locking: [LockingClause.of('forUpdate', { of: ['users'], waitPolicy: 'nowait' })],
    });
    expect(users.select('id').forShare({ skipLocked: true }).build().ast).toMatchObject({
      locking: [LockingClause.of('forShare', { waitPolicy: 'skipLocked' })],
    });
  });

  it('two calls append two clauses in order', () => {
    const d = db();
    const plan = d.public.users
      .innerJoin(d.public.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
      .select('title')
      .forUpdate({ of: ['users'] })
      .forKeyShare({ of: ['posts'], skipLocked: true })
      .build();

    expect(plan.ast).toMatchObject({
      locking: [
        LockingClause.of('forUpdate', { of: ['users'] }),
        LockingClause.of('forKeyShare', { of: ['posts'], waitPolicy: 'skipLocked' }),
      ],
    });
  });

  it('the lock survives later where, orderBy, limit and offset calls', () => {
    const plan = db()
      .public.users.select('id')
      .forUpdate()
      .where((f, fns) => fns.eq(f.id, 1))
      .orderBy('id')
      .limit(1)
      .offset(2)
      .build();

    expect(plan.ast).toMatchObject({ locking: [LockingClause.of('forUpdate')], limit: 1 });
  });

  describe('build() refuses', () => {
    it('a lock with an aggregate projection', () => {
      const query = db()
        .public.users.select('n', (_f, fns) => fns.count())
        .forUpdate();

      expect(() => query.build()).toThrow(
        lockIncompatible(
          'aggregate',
          'A locking clause cannot be combined with an aggregate or window function in the projection (column "n")',
        ),
      );
    });

    it('a locked select used as a subquery through as()', () => {
      const locked = db().public.users.select('id').forUpdate();

      expect(() => locked.as('u')).toThrow(
        lockIncompatible('subquery', 'A locked select cannot be used as a subquery'),
      );
    });

    it('a locked select used as a subquery expression', () => {
      const d = db();
      const locked = d.public.posts.select('id').forUpdate();

      expect(() => d.public.users.select('id').where((_f, fns) => fns.exists(locked))).toThrow(
        lockIncompatible('subquery', 'A locked select cannot be used as a subquery'),
      );
    });

    it.each([
      ['distinct', (q: ReturnType<typeof lockedUsers>) => q.distinct()],
      ['distinctOn', (q: ReturnType<typeof lockedUsers>) => q.distinctOn('id')],
      ['groupBy', (q: ReturnType<typeof lockedUsers>) => q.groupBy('id')],
    ] as const)('a lock followed by %s', (conflict, apply) => {
      expect(() => apply(lockedUsers()).build()).toThrow(
        lockIncompatible(conflict, `A locking clause cannot be combined with ${conflict}`),
      );
    });

    it('distinctOn followed by a lock', () => {
      expect(() => db().public.users.select('id').distinctOn('id').forShare().build()).toThrow(
        lockIncompatible('distinctOn', 'A locking clause cannot be combined with distinctOn'),
      );
    });

    it('a lock with having', () => {
      const state = {
        ...emptyState(TableSource.named('users'), usersScope),
        projections: [ProjectionItem.of('id', ColumnRef.of('users', 'id'))],
        having: BinaryExpr.gt(ColumnRef.of('users', 'id'), ParamRef.of(1)),
        locking: [LockingClause.of('forUpdate')],
      };

      expect(() => buildSelectAst(state)).toThrow(
        lockIncompatible('having', 'A locking clause cannot be combined with having'),
      );
    });

    it.each([
      {
        kind: 'window-func',
        expr: WindowFuncExpr.rowNumber({ orderBy: [OrderByItem.asc(ColumnRef.of('users', 'id'))] }),
      },
      {
        kind: 'json-array-agg',
        expr: JsonArrayAggExpr.of(new NativeJsonValueProjection(ColumnRef.of('users', 'id'))),
      },
    ])('a lock with a $kind projection', ({ expr }) => {
      const state = {
        ...emptyState(TableSource.named('users'), usersScope),
        projections: [ProjectionItem.of('n', expr)],
        locking: [LockingClause.of('forUpdate')],
      };

      expect(() => buildSelectAst(state)).toThrow(
        lockIncompatible(
          'aggregate',
          'A locking clause cannot be combined with an aggregate or window function in the projection (column "n")',
        ),
      );
    });
  });

  describe('capabilities', () => {
    it.each([
      { method: 'forUpdate', group: 'sql' },
      { method: 'forShare', group: 'sql' },
      { method: 'forNoKeyUpdate', group: 'postgres' },
      { method: 'forKeyShare', group: 'postgres' },
    ] as const)('$method throws without $group.$method', ({ method, group }) => {
      const query = withoutFlag(group, method).public.users.select('id') as unknown as Record<
        string,
        () => unknown
      >;

      expect(() => query[method]!()).toThrow(capabilityMissing(method, `${group}.${method}`));
    });

    it.each([
      { flag: 'lockOf', options: { of: ['users'] } },
      { flag: 'lockNowait', options: { nowait: true } },
      { flag: 'lockSkipLocked', options: { skipLocked: true } },
    ])('an option throws without sql.$flag', ({ flag, options }) => {
      const query = withoutFlag('sql', flag).public.users.select('id') as unknown as {
        forUpdate(options: unknown): unknown;
      };

      expect(() => query.forUpdate(options)).toThrow(capabilityMissing('forUpdate', `sql.${flag}`));
    });

    it('refuses nowait and skipLocked together', () => {
      const query = db().public.users.select('id') as unknown as {
        forUpdate(options: unknown): unknown;
      };

      expect(() => query.forUpdate({ nowait: true, skipLocked: true })).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message: 'forUpdate() takes nowait or skipLocked, not both',
        }),
      );
    });
  });
});

function lockedUsers() {
  return db().public.users.select('id').forUpdate();
}
