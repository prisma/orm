import postgresAdapter from '@internal/adapter-postgres/runtime';
import pgvectorRuntime from '@internal/extension-pgvector/runtime';
import { Collection } from '@internal/sql-orm-client';
import { ColumnRef, type ParamRef } from '@internal/sql-relational-core/ast';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { withReturningCapability } from './collection-fixtures';
import type { MockRuntime, TestContract } from './helpers';
import { createMockRuntime, deserializeTestContract, getTestContract } from './helpers';
import { unboundTables } from './unbound-tables';

// Synthetic 36-char Tag ids — Tag.id is typed `Char<36>` in the test contract.
type TestModels =
  TestContract['domain']['namespaces'][keyof TestContract['domain']['namespaces']]['models'];
const TAG_ID_1 =
  '00000000-0000-4000-8000-000000000001' as TestModels['Tag']['fields']['id']['type'] extends {
    codecId: 'sql/char@1';
  }
    ? string
    : string;
type TagId = Parameters<Collection<TestContract, 'Tag'>['create']>[0]['id'];
const tagId = (s: string): TagId => s as unknown as TagId;

// Builds a contract clone where `Tag` has a non-nullable `updatedAt`
// timestamp wired to the canonical `timestampNow` mutation default for
// both onCreate and onUpdate. The postgres test stack already registers
// the `timestampNow` runtime generator, so the contract round-trips.
function buildTagWithUpdatedAtContract(): TestContract {
  const contract = JSON.parse(
    JSON.stringify(withReturningCapability(getTestContract())),
  ) as TestContract;

  const tagModel = contract.domain.namespaces['public']!.models['Tag'] as
    | Record<string, unknown>
    | undefined;
  if (!tagModel) {
    throw new Error('Test contract is missing the Tag model');
  }
  const tagFields = tagModel['fields'] as Record<string, unknown>;
  tagFields['updatedAt'] = {
    nullable: false,
    type: { kind: 'scalar', codecId: 'pg/timestamptz@1' },
  };
  const tagStorage = tagModel['storage'] as Record<string, unknown>;
  const tagStorageFields = tagStorage['fields'] as Record<string, unknown>;
  tagStorageFields['updatedAt'] = { column: 'updated_at' };

  const tagsTable = unboundTables(contract.storage)['tags'] as
    | { columns: Record<string, unknown> }
    | undefined;
  if (!tagsTable) {
    throw new Error('Test contract is missing the tags table');
  }
  tagsTable.columns['updated_at'] = {
    nativeType: 'timestamptz',
    codecId: 'pg/timestamptz@1',
    nullable: false,
  };

  const execution = contract.execution as unknown as
    | { mutations: { defaults: Array<Record<string, unknown>> } }
    | undefined;
  if (!execution) {
    throw new Error('Test contract is missing the execution block');
  }
  execution.mutations.defaults.push({
    ref: { namespace: 'public', table: 'tags', column: 'updated_at' },
    onCreate: { kind: 'generator', id: 'timestampNow' },
    onUpdate: { kind: 'generator', id: 'timestampNow' },
  });

  return deserializeTestContract(contract);
}

// Same shape as `buildTagWithUpdatedAtContract`, but the generated column is a
// `createdAt` carrying an onCreate default and no onUpdate one — the case where
// sourcing the column from `excluded` on conflict would silently restamp an
// existing row's creation time.
function buildTagWithCreatedAtContract(): TestContract {
  const contract = JSON.parse(
    JSON.stringify(withReturningCapability(getTestContract())),
  ) as TestContract;

  const tagModel = contract.domain.namespaces['public']!.models['Tag'] as Record<string, unknown>;
  const tagFields = tagModel['fields'] as Record<string, unknown>;
  tagFields['createdAt'] = {
    nullable: false,
    type: { kind: 'scalar', codecId: 'pg/timestamptz@1' },
  };
  const tagStorage = tagModel['storage'] as Record<string, unknown>;
  (tagStorage['fields'] as Record<string, unknown>)['createdAt'] = { column: 'created_at' };

  const tagsTable = unboundTables(contract.storage)['tags'] as { columns: Record<string, unknown> };
  tagsTable.columns['created_at'] = {
    nativeType: 'timestamptz',
    codecId: 'pg/timestamptz@1',
    nullable: false,
  };

  const execution = contract.execution as unknown as {
    mutations: { defaults: Array<Record<string, unknown>> };
  };
  execution.mutations.defaults.push({
    ref: { namespace: 'public', table: 'tags', column: 'created_at' },
    onCreate: { kind: 'generator', id: 'timestampNow' },
  });

  return deserializeTestContract(contract);
}

function setupTagCollection(): {
  collection: Collection<TestContract, 'Tag'>;
  runtime: MockRuntime;
  contract: TestContract;
} {
  const contract = buildTagWithUpdatedAtContract();
  const context = createExecutionContext({
    contract,
    stack: createSqlExecutionStack({
      target: postgresTarget,
      adapter: postgresAdapter,
      extensions: [pgvectorRuntime],
    }),
  });
  const runtime = createMockRuntime();
  const collection = new Collection({ runtime, context }, 'Tag', { namespaceId: 'public' });
  return { collection, runtime, contract };
}

function setupCreatedAtTagCollection(): {
  collection: Collection<TestContract, 'Tag'>;
  runtime: MockRuntime;
} {
  const contract = buildTagWithCreatedAtContract();
  const context = createExecutionContext({
    contract,
    stack: createSqlExecutionStack({
      target: postgresTarget,
      adapter: postgresAdapter,
      extensions: [pgvectorRuntime],
    }),
  });
  const runtime = createMockRuntime();
  const collection = new Collection({ runtime, context }, 'Tag', { namespaceId: 'public' });
  return { collection, runtime };
}

function planParams(execution: { plan: unknown } | undefined): readonly unknown[] {
  const plan = execution?.plan as { params?: readonly unknown[] } | undefined;
  return plan?.params ?? [];
}

function conflictSet(execution: { plan: unknown } | undefined): Record<string, unknown> {
  const plan = execution?.plan as
    | { ast?: { onConflict?: { action?: { set?: Record<string, unknown> } } } }
    | undefined;
  return plan?.ast?.onConflict?.action?.set ?? {};
}

const TAG_A_ID = `${TAG_ID_1.slice(0, -1)}A` as string;
const TAG_B_ID = `${TAG_ID_1.slice(0, -1)}B` as string;
const TAG_C_ID = `${TAG_ID_1.slice(0, -1)}C` as string;

describe('@updatedAt mutation defaults via Collection', () => {
  describe('create', () => {
    it('inserts a generated timestamp when updatedAt is omitted', async () => {
      const { collection, runtime } = setupTagCollection();
      runtime.setNextResults([
        [{ id: TAG_ID_1, name: 'eng', updated_at: new Date('2026-01-01T00:00:00.000Z') }],
      ]);

      const before = new Date();
      await collection.create({ id: tagId(TAG_ID_1), name: 'eng' });
      const after = new Date();

      const params = planParams(runtime.executions[0]);
      const generated = params.find((p) => p instanceof Date) as Date | undefined;
      expect(generated).toBeInstanceOf(Date);
      expect(generated?.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(generated?.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('preserves an explicit updatedAt value on create', async () => {
      const { collection, runtime } = setupTagCollection();
      const explicit = new Date('2001-02-03T04:05:06.000Z');
      runtime.setNextResults([[{ id: TAG_ID_1, name: 'eng', updated_at: explicit }]]);

      await collection.create({
        id: tagId(TAG_ID_1),
        name: 'eng',
        // The injected `updatedAt` field is not in the static contract.d.ts —
        // bypass the typed input shape to test the runtime path.
        ...({ updatedAt: explicit } as Record<string, unknown>),
      });

      const params = planParams(runtime.executions[0]);
      const dateParams = params.filter((p) => p instanceof Date) as Date[];
      expect(dateParams).toHaveLength(1);
      expect(dateParams[0]?.getTime()).toBe(explicit.getTime());
    });
  });

  describe('createAll (bulk)', () => {
    it('reuses one timestamp across every row in the bulk insert', async () => {
      const { collection, runtime } = setupTagCollection();
      runtime.setNextResults([
        [
          { id: TAG_A_ID, name: 'one', updated_at: new Date() },
          { id: TAG_B_ID, name: 'two', updated_at: new Date() },
          { id: TAG_C_ID, name: 'three', updated_at: new Date() },
        ],
      ]);

      await collection
        .createAll([
          { id: tagId(TAG_A_ID), name: 'one' },
          { id: tagId(TAG_B_ID), name: 'two' },
          { id: tagId(TAG_C_ID), name: 'three' },
        ])
        .toArray();

      const params = planParams(runtime.executions[0]);
      const dateParams = params.filter((p) => p instanceof Date) as Date[];
      expect(dateParams).toHaveLength(3);
      // All three rows must observe the same Date instance — stability: 'query'.
      // Identity (===) rather than .getTime() equality, so the assertion fails
      // if three distinct Dates happen to be allocated within the same ms.
      const first = dateParams[0];
      expect(first).toBeInstanceOf(Date);
      expect(dateParams[1]).toBe(first);
      expect(dateParams[2]).toBe(first);
    });

    it("keeps per-row variability for stability: 'field' generators (id stays distinct)", async () => {
      const { collection, runtime } = setupTagCollection();
      runtime.setNextResults([
        [
          { id: TAG_A_ID, name: 'one', updated_at: new Date() },
          { id: TAG_B_ID, name: 'two', updated_at: new Date() },
        ],
      ]);

      await collection
        .createAll([
          { id: tagId(TAG_A_ID), name: 'one' },
          { id: tagId(TAG_B_ID), name: 'two' },
        ])
        .toArray();

      const params = planParams(runtime.executions[0]);
      // Explicit ids stay distinct — the cache only reuses values from
      // stability: 'query' generators, never user-supplied values.
      expect(params).toContain(TAG_A_ID);
      expect(params).toContain(TAG_B_ID);
    });
  });

  describe('updateAll', () => {
    it('adds a generated updatedAt to the SET clause on a non-empty update', async () => {
      const { collection, runtime } = setupTagCollection();
      runtime.setNextResults([[{ id: TAG_ID_1, name: 'eng-v2', updated_at: new Date() }]]);

      const before = new Date();
      await collection
        .where({ id: tagId(TAG_ID_1) })
        .updateAll({ name: 'eng-v2' })
        .toArray();
      const after = new Date();

      const params = planParams(runtime.executions[0]);
      const dateParam = params.find((p) => p instanceof Date) as Date | undefined;
      expect(dateParam).toBeInstanceOf(Date);
      expect(dateParam?.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(dateParam?.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(params).toContain('eng-v2');
    });

    it('preserves an explicit updatedAt and does not overwrite it', async () => {
      const { collection, runtime } = setupTagCollection();
      const explicit = new Date('2001-02-03T04:05:06.000Z');
      runtime.setNextResults([[{ id: TAG_ID_1, name: 'eng-v2', updated_at: explicit }]]);

      await collection
        .where({ id: tagId(TAG_ID_1) })
        .updateAll({
          name: 'eng-v2',
          ...({ updatedAt: explicit } as Record<string, unknown>),
        })
        .toArray();

      const params = planParams(runtime.executions[0]);
      const dateParams = params.filter((p) => p instanceof Date) as Date[];
      expect(dateParams).toHaveLength(1);
      expect(dateParams[0]?.getTime()).toBe(explicit.getTime());
    });

    it('emits no SQL and no timestamp on an empty update payload', async () => {
      const { collection, runtime } = setupTagCollection();

      await collection
        .where({ id: tagId(TAG_ID_1) })
        .updateAll({})
        .toArray();

      expect(runtime.executions).toHaveLength(0);
    });
  });

  describe('updateAndCount', () => {
    it('adds a generated updatedAt to the SET clause on a non-empty update', async () => {
      const { collection, runtime } = setupTagCollection();
      runtime.setNextStats([{ affectedRows: 1 }]);

      const count = await collection
        .where({ id: tagId(TAG_ID_1) })
        .updateAndCount({ name: 'eng-v2' });

      expect(count).toBe(1);
      expect(runtime.executions).toHaveLength(1);
      expect(runtime.executions[0]?.operation).toBe('execute');
      const params = planParams(runtime.executions[0]);
      const dateParam = params.find((p) => p instanceof Date);
      expect(dateParam).toBeInstanceOf(Date);
    });

    it('returns zero and emits no SQL on an empty update payload', async () => {
      const { collection, runtime } = setupTagCollection();

      const count = await collection.where({ id: tagId(TAG_ID_1) }).updateAndCount({});

      expect(count).toBe(0);
      expect(runtime.executions).toHaveLength(0);
    });
  });

  describe('upsert', () => {
    it('generates updatedAt for the create branch values', async () => {
      const { collection, runtime } = setupTagCollection();
      runtime.setNextResults([[{ id: TAG_ID_1, name: 'eng', updated_at: new Date() }]]);

      await collection.upsert({
        create: { id: tagId(TAG_ID_1), name: 'eng' },
        update: { name: 'eng-v2' },
        conflictOn: { id: tagId(TAG_ID_1) },
      });

      const params = planParams(runtime.executions[0]);
      const dateParams = params.filter((p) => p instanceof Date) as Date[];
      // Both the INSERT values and the DO UPDATE SET clause should carry a
      // generated timestamp, so we expect at least two Dates in the params.
      expect(dateParams.length).toBeGreaterThanOrEqual(2);
    });

    it('does not advance updatedAt when update branch is empty', async () => {
      const { collection, runtime } = setupTagCollection();
      runtime.setNextResults([[{ id: TAG_ID_1, name: 'eng', updated_at: new Date() }]]);

      await collection.upsert({
        create: { id: tagId(TAG_ID_1), name: 'eng' },
        update: {},
        conflictOn: { id: tagId(TAG_ID_1) },
      });

      const params = planParams(runtime.executions[0]);
      const dateParams = params.filter((p) => p instanceof Date) as Date[];
      // Only the create branch's timestamp; the empty update branch must not
      // generate or apply one.
      expect(dateParams).toHaveLength(1);
    });
  });

  describe('upsertAll (bulk)', () => {
    it('advances updatedAt through an onUpdate literal, not through excluded', async () => {
      const { collection, runtime } = setupTagCollection();
      runtime.setNextResults([
        [
          { id: TAG_A_ID, name: 'one', updated_at: new Date() },
          { id: TAG_B_ID, name: 'two', updated_at: new Date() },
        ],
      ]);

      await collection
        .upsertAll([
          { id: tagId(TAG_A_ID), name: 'one' },
          { id: tagId(TAG_B_ID), name: 'two' },
        ])
        .toArray();

      // `updated_at` is not a caller-supplied column, so it stays out of the
      // implicit update set and is bound as the onUpdate default instead.
      const set = conflictSet(runtime.executions[0]);
      expect(Object.keys(set)).toEqual(['name', 'updated_at']);
      expect(set['name']).toEqual(ColumnRef.of('excluded', 'name'));
      expect((set['updated_at'] as ParamRef).value).toBeInstanceOf(Date);

      const dateParams = planParams(runtime.executions[0]).filter(
        (p) => p instanceof Date,
      ) as Date[];
      // Two create-branch Dates sharing one generated value, then the onUpdate literal.
      expect(dateParams).toHaveLength(3);
      expect(dateParams[1]).toBe(dateParams[0]);
    });

    it('applies an onUpdate default the explicit update list omits', async () => {
      const { collection, runtime } = setupTagCollection();
      runtime.setNextResults([[{ id: TAG_A_ID, name: 'one', updated_at: new Date() }]]);

      await collection
        .upsertAll([{ id: tagId(TAG_A_ID), name: 'one' }], { update: ['name'] })
        .toArray();

      const set = conflictSet(runtime.executions[0]);
      expect(Object.keys(set)).toEqual(['name', 'updated_at']);
      expect(set['name']).toEqual(ColumnRef.of('excluded', 'name'));

      const dateParams = planParams(runtime.executions[0]).filter(
        (p) => p instanceof Date,
      ) as Date[];
      // One Date in the INSERT row, a second as the `updated_at` assignment.
      expect(dateParams).toHaveLength(2);
      expect((set['updated_at'] as ParamRef).value).toBe(dateParams[1]);
    });

    it('keeps an onCreate-only column out of the conflict update', async () => {
      const { collection, runtime } = setupCreatedAtTagCollection();
      runtime.setNextResults([[{ id: TAG_A_ID, name: 'one' }]]);

      const rows = await collection
        .select('id', 'name')
        .upsertAll([{ id: tagId(TAG_A_ID), name: 'one' }])
        .toArray();

      expect(rows).toEqual([{ id: TAG_A_ID, name: 'one' }]);

      // `created_at` is generated for the insert branch only. Assigning it from
      // `excluded` would restamp the creation time of a row that already exists.
      const set = conflictSet(runtime.executions[0]);
      expect(Object.keys(set)).toEqual(['name']);
      expect(set['name']).toEqual(ColumnRef.of('excluded', 'name'));
    });

    it('does not advance updatedAt when the update list is empty', async () => {
      const { collection, runtime } = setupTagCollection();
      runtime.setNextResults([[{ id: TAG_A_ID, name: 'one', updated_at: new Date() }]]);

      await collection.upsertAll([{ id: tagId(TAG_A_ID), name: 'one' }], { update: [] }).toArray();

      const params = planParams(runtime.executions[0]);
      const dateParams = params.filter((p) => p instanceof Date) as Date[];
      expect(dateParams).toHaveLength(1);
    });
  });
});
