import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type {
  MongoAppliedMutationDefault,
  MongoMutationDefaults,
  MongoMutationDefaultsOptions,
} from '@internal/mongo-contract';
import type { MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import { MongoFieldFilter } from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import ormContractJson from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import { createMongoCollection } from '../src/collection';
import type { MongoQueryExecutor } from '../src/executor';
import { mongoOrm } from '../src/mongo-orm';

const contract = ormContractJson as unknown as Contract;

const userData = {
  name: 'Alice',
  email: 'a@b.c',
  tags: [] as string[],
  homeAddress: null,
};

// The fixture types `loginCount` as required; these tests omit it on purpose so the fake default fills it.
function input(data: Record<string, unknown>): never {
  return data as never;
}

/**
 * Stands in for the execution context: `loginCount` gets 7 on create and 9 on a non-empty update, unless the write sets it.
 */
function fakeMutationDefaults(): MongoMutationDefaults & {
  readonly calls: MongoMutationDefaultsOptions[];
} {
  const calls: MongoMutationDefaultsOptions[] = [];
  return {
    calls,
    applyMutationDefaults(options): ReadonlyArray<MongoAppliedMutationDefault> {
      calls.push(options);
      const explicit = Object.keys(options.values).filter((k) => options.values[k] !== undefined);
      if (explicit.includes('loginCount')) return [];
      if (options.op === 'update') {
        return explicit.length === 0 ? [] : [{ field: 'loginCount', value: 9 }];
      }
      return [{ field: 'loginCount', value: 7 }];
    },
  };
}

function recordingExecutor(...responses: Array<unknown[] | { affectedRows: number }>) {
  const plans: MongoQueryPlan[] = [];
  let index = 0;
  const executor: MongoQueryExecutor = {
    query<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row> {
      plans.push(plan as MongoQueryPlan);
      const rows = (responses[index++] ?? []) as Row[];
      async function* gen(): AsyncGenerator<Row> {
        yield* rows;
      }
      return new AsyncIterableResult(gen());
    },
    async execute(plan: MongoQueryPlan) {
      plans.push(plan);
      return (responses[index++] ?? { affectedRows: 0 }) as { affectedRows: number };
    },
  };
  return { executor, plans };
}

function unwrap(value: unknown): unknown {
  if (value instanceof MongoParamRef) return value.value;
  if (Array.isArray(value)) return value.map(unwrap);
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unwrap(v)]));
  }
  return value;
}

function commandOf(plans: readonly MongoQueryPlan[], kind: string) {
  const plan = plans.find((p) => p.command.kind === kind);
  if (!plan) throw new Error(`no ${kind} command`);
  return plan.command as unknown as Record<string, unknown>;
}

function users(executor: MongoQueryExecutor, defaults: MongoMutationDefaults) {
  return createMongoCollection(contract, 'User', executor, defaults);
}

const byEmail = MongoFieldFilter.eq('email', 'a@b.c');

describe('ORM create paths apply onCreate defaults', () => {
  it('create writes the generated value and returns it on the row', async () => {
    const defaults = fakeMutationDefaults();
    const { executor, plans } = recordingExecutor([{ insertedId: 'id-1' }]);
    const row = await users(executor, defaults).create(input(userData));
    expect(unwrap(commandOf(plans, 'insertOne')['document'])).toEqual({
      ...userData,
      loginCount: 7,
    });
    expect(row).toEqual({ _id: 'id-1', ...userData, loginCount: 7 });
    expect(defaults.calls).toEqual([
      expect.objectContaining({
        op: 'create',
        namespace: '__unbound__',
        entry: 'users',
        values: userData,
      }),
    ]);
  });

  it('create keeps an explicit value', async () => {
    const { executor, plans } = recordingExecutor([{ insertedId: 'id-1' }]);
    await users(executor, fakeMutationDefaults()).create(input({ ...userData, loginCount: 3 }));
    expect(unwrap(commandOf(plans, 'insertOne')['document'])).toMatchObject({ loginCount: 3 });
  });

  it('createAll applies defaults per document through one shared cache', async () => {
    const defaults = fakeMutationDefaults();
    const { executor, plans } = recordingExecutor([{ insertedIds: ['a', 'b'] }]);
    const rows = await users(executor, defaults)
      .createAll([input(userData), input({ ...userData, name: 'Bob' })])
      .toArray();
    expect(unwrap(commandOf(plans, 'insertMany')['documents'])).toEqual([
      { ...userData, loginCount: 7 },
      { ...userData, name: 'Bob', loginCount: 7 },
    ]);
    expect(rows.map((r) => r.loginCount)).toEqual([7, 7]);
    expect(defaults.calls).toHaveLength(2);
    expect(defaults.calls[0]?.defaultValueCache).toBeDefined();
    expect(defaults.calls[1]?.defaultValueCache).toBe(defaults.calls[0]?.defaultValueCache);
  });

  it('createAndCount treats an explicit undefined as absent', async () => {
    const defaults = fakeMutationDefaults();
    const { executor, plans } = recordingExecutor([{ insertedCount: 1 }]);
    await users(executor, defaults).createAndCount([input({ ...userData, loginCount: undefined })]);
    expect(unwrap(commandOf(plans, 'insertMany')['documents'])).toEqual([
      { ...userData, loginCount: 7 },
    ]);
    expect(defaults.calls[0]?.values).toEqual(userData);
  });
});

describe('ORM update paths apply onUpdate defaults', () => {
  it('update adds the generated value to $set', async () => {
    const defaults = fakeMutationDefaults();
    const { executor, plans } = recordingExecutor([]);
    await users(executor, defaults).where(byEmail).update({ name: 'X' });
    expect(unwrap(commandOf(plans, 'findOneAndUpdate')['update'])).toEqual({
      $set: { name: 'X', loginCount: 9 },
    });
    expect(defaults.calls).toEqual([expect.objectContaining({ op: 'update', entry: 'users' })]);
    expect(Object.keys(defaults.calls[0]?.values ?? {})).toEqual(['name']);
  });

  it('update with an empty payload adds nothing', async () => {
    const { executor, plans } = recordingExecutor([]);
    await users(executor, fakeMutationDefaults()).where(byEmail).update({});
    expect(unwrap(commandOf(plans, 'findOneAndUpdate')['update'])).toEqual({ $set: {} });
  });

  it('update with field operations counts every touched field as explicit', async () => {
    const defaults = fakeMutationDefaults();
    const { executor, plans } = recordingExecutor([]);
    await users(executor, defaults)
      .where(byEmail)
      .update((u) => [u.name.set('X'), u.email.unset()]);
    expect(unwrap(commandOf(plans, 'findOneAndUpdate')['update'])).toMatchObject({
      $set: { name: 'X', loginCount: 9 },
    });
    expect(Object.keys(defaults.calls[0]?.values ?? {}).sort()).toEqual(['email', 'name']);
  });

  it('updateAndCount adds the generated value to $set', async () => {
    const { executor, plans } = recordingExecutor({ affectedRows: 1 });
    await users(executor, fakeMutationDefaults()).where(byEmail).updateAndCount({ name: 'X' });
    expect(unwrap(commandOf(plans, 'updateMany')['update'])).toEqual({
      $set: { name: 'X', loginCount: 9 },
    });
  });

  it('updateAll adds the generated value to $set', async () => {
    const { executor, plans } = recordingExecutor([{ _id: 'id-1' }], [], []);
    await users(executor, fakeMutationDefaults()).where(byEmail).updateAll({ name: 'X' }).toArray();
    expect(unwrap(commandOf(plans, 'updateMany')['update'])).toEqual({
      $set: { name: 'X', loginCount: 9 },
    });
  });
});

describe('ORM upsert applies both halves', () => {
  it('puts update defaults in $set and the remaining create defaults in $setOnInsert', async () => {
    const defaults = fakeMutationDefaults();
    const { executor, plans } = recordingExecutor([]);
    await users(executor, defaults)
      .where(byEmail)
      .upsert({ create: input(userData), update: { name: 'X' } });
    const { name: _, ...insertOnly } = userData;
    expect(unwrap(commandOf(plans, 'findOneAndUpdate')['update'])).toEqual({
      $set: { name: 'X', loginCount: 9 },
      $setOnInsert: insertOnly,
    });
    expect(defaults.calls.map((c) => c.op).sort()).toEqual(['create', 'update']);
    expect(defaults.calls[1]?.defaultValueCache).toBe(defaults.calls[0]?.defaultValueCache);
  });

  it('with an empty update half, writes the create defaults on insert only', async () => {
    const { executor, plans } = recordingExecutor([]);
    await users(executor, fakeMutationDefaults())
      .where(byEmail)
      .upsert({ create: input(userData), update: {} });
    expect(unwrap(commandOf(plans, 'findOneAndUpdate')['update'])).toEqual({
      $setOnInsert: { ...userData, loginCount: 7 },
    });
  });
});

describe('mongoOrm', () => {
  it('refuses a contract with execution defaults when mutationDefaults is missing', () => {
    const { executor } = recordingExecutor();
    const withDefaults = {
      ...contract,
      execution: {
        executionHash: 'test',
        mutations: {
          defaults: [
            {
              ref: { namespace: '__unbound__', entry: 'users', field: 'loginCount' },
              onCreate: { kind: 'generator', id: 'timestampNow' },
            },
          ],
        },
      },
    } as unknown as Contract;
    expect(() => mongoOrm({ contract: withDefaults, executor })).toThrow(
      expect.objectContaining({
        code: 'ORM.MUTATION_DEFAULTS_MISSING',
        message: expect.stringContaining('mutationDefaults: context'),
      }),
    );
  });

  it('builds a contract without execution defaults without mutationDefaults', () => {
    const { executor } = recordingExecutor();
    expect(() => mongoOrm({ contract, executor })).not.toThrow();
  });

  it('passes mutationDefaults to every root collection', async () => {
    const { executor, plans } = recordingExecutor([{ insertedId: 'id-1' }]);
    const orm = mongoOrm({ contract, executor, mutationDefaults: fakeMutationDefaults() });
    await orm.users.create(input(userData));
    expect(unwrap(commandOf(plans, 'insertOne')['document'])).toMatchObject({ loginCount: 7 });
  });
});
