import { validateSqlContractFully } from '@internal/sql-contract/validators';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { sql } from '../../src/runtime/sql';
import { contract as contractJson } from '../fixtures/contract';
import type { Contract } from '../fixtures/generated/contract';

/** No target contributes aggregates to these plan-shape cases; resolution answers nothing and the codec slot stays empty. */
const emptyAggregateRegistry = {
  resolve: () => undefined,
  values: function* () {},
};

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

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('sql() builder structured error codes', () => {
  it('unknown select column raises ORM.COLUMN_UNKNOWN', () => {
    const users = db().public.users as unknown as { select(...cols: string[]): unknown };
    const error = capture(() => users.select('nope'));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'ORM.COLUMN_UNKNOWN',
      message: 'Column "nope" not found in scope',
      meta: { column: 'nope' },
    });
  });

  describe('a column name several joined tables have', () => {
    const sharedId = {
      code: 'ORM.COLUMN_AMBIGUOUS',
      meta: { column: 'id', candidates: ['users', 'posts', 'profiles'] },
    };
    const joined = () => {
      const d = db();
      return d.public.users
        .innerJoin(d.public.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
        .innerJoin(d.public.profiles, (f, fns) => fns.eq(f.users.id, f.profiles.user_id));
    };
    const selected = () =>
      joined().select('email') as unknown as {
        orderBy(arg: string): unknown;
        groupBy(...args: string[]): unknown;
        distinctOn(...args: string[]): unknown;
      };

    it('raises ORM.COLUMN_AMBIGUOUS in select, with the select call that names a table as its fix', () => {
      expect(capture(() => joined().select('id' as never))).toMatchObject({
        ...sharedId,
        message: 'Column "id" is in more than one joined table (users, posts, profiles)',
        fix: "Name the table the column comes from: select('id', (f) => f.users.id)",
      });
    });

    it('raises ORM.COLUMN_AMBIGUOUS in orderBy, groupBy and distinctOn, with a callback as its fix', () => {
      expect({
        orderBy: capture(() => selected().orderBy('id')),
        groupBy: capture(() => selected().groupBy('id')),
        distinctOn: capture(() => selected().distinctOn('id')),
      }).toMatchObject({
        orderBy: {
          ...sharedId,
          message:
            'Column "id" in orderBy is in more than one joined table (users, posts, profiles)',
          fix: 'Name the table the column comes from: orderBy((f) => f.users.id)',
        },
        groupBy: {
          ...sharedId,
          message:
            'Column "id" in groupBy is in more than one joined table (users, posts, profiles)',
          fix: 'Name the table the column comes from: groupBy((f) => f.users.id)',
        },
        distinctOn: {
          ...sharedId,
          message:
            'Column "id" in distinctOn is in more than one joined table (users, posts, profiles)',
          fix: 'Name the table the column comes from: distinctOn((f) => f.users.id)',
        },
      });
    });
  });

  it('invalid orderBy argument raises ORM.ARGUMENT_INVALID', () => {
    const query = db().public.users.select('name') as unknown as {
      orderBy(arg: unknown): unknown;
    };
    const error = capture(() => query.orderBy(123));
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'ORM.ARGUMENT_INVALID',
      message: 'Invalid orderBy argument',
    });
  });

  it('lateralJoin without capability raises ORM.CAPABILITY_MISSING', () => {
    const d = dbNoCapabilities();
    const users = d.public.users as unknown as { lateralJoin(alias: string, fn: unknown): void };
    const error = capture(() =>
      users.lateralJoin(
        'x',
        (lateral: { from(t: unknown): { select(...args: string[]): unknown } }) =>
          lateral.from(d.public.posts).select('id'),
      ),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'ORM.CAPABILITY_MISSING',
      message: 'lateralJoin() requires capability sql.lateral',
      meta: { method: 'lateralJoin', capability: 'sql.lateral' },
    });
  });

  it('a NaN limit raises ORM.ARGUMENT_INVALID when the query is built', () => {
    expect(() => db().public.users.select('id').limit(Number.NaN).build()).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: `limit must be an integer from 0 to ${Number.MAX_SAFE_INTEGER}, got NaN`,
        meta: { argument: 'limit' },
      }),
    );
  });

  it('a negative offset raises ORM.ARGUMENT_INVALID when the query is built', () => {
    expect(() => db().public.users.select('id').offset(-1).build()).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: `offset must be an integer from 0 to ${Number.MAX_SAFE_INTEGER}, got -1`,
        meta: { argument: 'offset' },
      }),
    );
  });

  it('empty insert row array raises ORM.MUTATION_DATA_MISSING', () => {
    const error = capture(() => db().public.users.insert([]).build());
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'ORM.MUTATION_DATA_MISSING',
      message: 'insert() called with an empty row array — at least one row is required',
    });
  });
});
