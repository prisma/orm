import postgresAdapter from '@internal/adapter-postgres/runtime';
import pgvectorRuntime from '@internal/extension-pgvector/runtime';
import { Collection } from '@internal/sql-orm-client';
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
function buildTagWithUpdatedAtContract(
  codecId: 'pg/timestamptz-temporal@1' | 'pg/timestamptz-string@1' = 'pg/timestamptz-temporal@1',
): TestContract {
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
    type: { kind: 'scalar', codecId },
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
    codecId,
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

function setupTagCollection(codecId?: 'pg/timestamptz-temporal@1' | 'pg/timestamptz-string@1'): {
  collection: Collection<TestContract, 'Tag'>;
  runtime: MockRuntime;
  contract: TestContract;
} {
  const contract = buildTagWithUpdatedAtContract(codecId);
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

function planParams(execution: { plan: unknown } | undefined): readonly unknown[] {
  const plan = execution?.plan as { params?: readonly unknown[] } | undefined;
  return plan?.params ?? [];
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

    // The guarantee belongs to the generator, not to a representation, so it has to hold for a
    // column authored either way. `timestampNow` hands the driver a wire-level `Date` that never
    // passes through a codec, which is what lets one clock serve both.
    it('gives every row in an insert one value on a *String column too', async () => {
      const { collection, runtime } = setupTagCollection('pg/timestamptz-string@1');
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

      const dateParams = planParams(runtime.executions[0]).filter(
        (p) => p instanceof Date,
      ) as Date[];

      expect(dateParams).toHaveLength(2);
      expect(dateParams[1]).toBe(dateParams[0]);
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
});
