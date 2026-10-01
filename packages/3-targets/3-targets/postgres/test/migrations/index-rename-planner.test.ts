/**
 * Index rename post-pass: a `not-found` and a `not-expected` index on the
 * same table collapse into one `ALTER INDEX … RENAME TO` in two phases.
 * Hash pairing pairs wire-parseable names by content hash (prefix-only
 * rename); content pairing pairs remaining wire-named-missing nodes against any-shape extras by
 * content (exact→wire adoption). Multi-candidate groups pair
 * deterministically by sorted name; leftovers proceed as create/drop; under
 * an additive-only policy both phases are skipped and the pairing degrades
 * to the additive half.
 */

import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { MigrationOperationClass } from '@internal/framework-components/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import type { SerializedIndex } from '@internal/sql-contract/types';
import { indexInputFromSerialized, SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import type { SqlIndexIRInput } from '@internal/sql-schema-ir/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

const TABLE_NAME = 'items';
const stubLowerer: ExecuteRequestLowerer = {
  lower: () => ({ sql: 'stub', params: [] }),
  renderColumnDefault: async () => '',
  lowerToExecuteRequest: async () => ({ sql: 'stub', params: [] }),
};

const ALL_CLASSES_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};
const NO_DESTRUCTIVE_POLICY = { allowedOperationClasses: ['additive', 'widening'] as const };
const ADDITIVE_ONLY_POLICY = { allowedOperationClasses: ['additive'] as const };

type LooseIndexInput = {
  readonly name: string;
  readonly prefix?: string;
  readonly columns?: readonly string[];
  readonly expression?: string;
  readonly where?: string;
  readonly unique?: boolean;
  readonly type?: string;
  readonly options?: Record<string, unknown>;
};

function buildContract(looseIndexes: readonly LooseIndexInput[]): Contract<SqlStorage> {
  const indexes = looseIndexes.map((i) =>
    indexInputFromSerialized({ unique: false, ...i } as SerializedIndex),
  );
  const schema = new PostgresSchema({
    id: 'public',
    entries: {
      table: {
        [TABLE_NAME]: new StorageTable({
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            value: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes,
        }),
      },
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('index-rename-planner-test'),
    storage: new SqlStorage({
      storageHash: coreHash('index-rename-planner-test'),
      namespaces: { public: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

type LiveIndex = LooseIndexInput;

function actualSchema(indexes: readonly LiveIndex[]): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          [TABLE_NAME]: new PostgresTableSchemaNode({
            name: TABLE_NAME,
            columns: {
              id: { name: 'id', nativeType: 'int4', nullable: false },
              email: { name: 'email', nativeType: 'text', nullable: false },
              value: { name: 'value', nativeType: 'int4', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: indexes.map(
              (idx) =>
                ({
                  naming: parseNaming(idx.name, idx.prefix),
                  columns: idx.columns ?? (idx.expression !== undefined ? undefined : ['email']),
                  expression: idx.expression,
                  where: idx.where,
                  unique: idx.unique ?? false,
                  partial: idx.where !== undefined,
                  type: idx.type,
                  options: idx.options,
                  annotations: undefined,
                  dependsOn: undefined,
                }) as SqlIndexIRInput,
            ),
            rlsEnabled: false,
          }),
        },
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: 'unknown',
  });
}

async function planOpIds(
  contract: Contract<SqlStorage>,
  schema: PostgresDatabaseSchemaNode,
  policy: { readonly allowedOperationClasses: readonly MigrationOperationClass[] },
): Promise<readonly string[]> {
  const planner = createPostgresMigrationPlanner(stubLowerer);
  const result = planner.plan({
    contract,
    schema,
    policy: { allowedOperationClasses: [...policy.allowedOperationClasses] },
    fromContract: null,
    frameworkComponents: [],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  expect(result.kind).toBe('success');
  if (result.kind !== 'success') return [];
  const ops = await Promise.all(result.plan.operations);
  return ops.map((op) => op.id);
}

function wireNamedIndex(
  prefix: string,
  hash: string,
  rest?: Partial<LooseIndexInput>,
): LooseIndexInput {
  return {
    name: `${prefix}_${hash}`,
    prefix,
    columns: ['email'],
    unique: false,
    ...rest,
  };
}

describe('hash pairing (prefix-only rename)', () => {
  it('plans exactly one ALTER INDEX … RENAME TO — no drop, no create', async () => {
    const contract = buildContract([wireNamedIndex('items_email_lookup', 'ab12cd34')]);
    const schema = actualSchema([
      { name: 'items_email_idx_ab12cd34', prefix: 'items_email_idx', columns: ['email'] },
    ]);

    const opIds = await planOpIds(contract, schema, ALL_CLASSES_POLICY);
    expect(opIds).toEqual([`index.public.${TABLE_NAME}.items_email_idx_ab12cd34.rename`]);
  });

  it('plans the rename without the destructive allowance', async () => {
    const contract = buildContract([wireNamedIndex('items_email_lookup', 'ab12cd34')]);
    const schema = actualSchema([
      { name: 'items_email_idx_ab12cd34', prefix: 'items_email_idx', columns: ['email'] },
    ]);

    const opIds = await planOpIds(contract, schema, NO_DESTRUCTIVE_POLICY);
    expect(opIds).toEqual([`index.public.${TABLE_NAME}.items_email_idx_ab12cd34.rename`]);
  });

  it('degrades to a bare create of the new name under an additive-only policy', async () => {
    const contract = buildContract([wireNamedIndex('items_email_lookup', 'ab12cd34')]);
    const schema = actualSchema([
      { name: 'items_email_idx_ab12cd34', prefix: 'items_email_idx', columns: ['email'] },
    ]);

    const opIds = await planOpIds(contract, schema, ADDITIVE_ONLY_POLICY);
    expect(opIds).toEqual([`index.${TABLE_NAME}.items_email_lookup_ab12cd34`]);
  });

  it('a content edit (same prefix, different hash, different content) stays create + drop', async () => {
    const contract = buildContract([
      wireNamedIndex('items_email_idx', '11111111', { columns: ['email', 'value'] }),
    ]);
    const schema = actualSchema([
      { name: 'items_email_idx_00000000', prefix: 'items_email_idx', columns: ['email'] },
    ]);

    const opIds = await planOpIds(contract, schema, ALL_CLASSES_POLICY);
    expect(opIds).toEqual([
      `dropIndex.${TABLE_NAME}.items_email_idx_00000000`,
      `index.${TABLE_NAME}.items_email_idx_11111111`,
    ]);
  });

  it('a body edit under the same name plans only the create under an additive-only policy', async () => {
    const contract = buildContract([
      {
        name: 'items_email_eq_11111111',
        prefix: 'items_email_eq',
        expression: 'eql_v3.eq_term(lower(email))',
        unique: false,
      },
    ]);
    const schema = actualSchema([
      {
        name: 'items_email_eq_00000000',
        prefix: 'items_email_eq',
        expression: 'eql_v3.eq_term(email)',
      },
    ]);

    const opIds = await planOpIds(contract, schema, ADDITIVE_ONLY_POLICY);
    expect(opIds).toEqual([`index.${TABLE_NAME}.items_email_eq_11111111`]);
  });

  it('multi-candidate groups pair deterministically by sorted name', async () => {
    const contract = buildContract([
      wireNamedIndex('a_new', 'ab12cd34'),
      wireNamedIndex('b_new', 'ab12cd34'),
    ]);
    const schema = actualSchema([
      { name: 'z_old_ab12cd34', prefix: 'z_old', columns: ['email'] },
      { name: 'y_old_ab12cd34', prefix: 'y_old', columns: ['email'] },
    ]);

    const opIds = await planOpIds(contract, schema, ALL_CLASSES_POLICY);
    // Missing sorted: a_new_…, b_new_…; candidates sorted: y_old_…, z_old_….
    expect(opIds).toEqual([
      `index.public.${TABLE_NAME}.y_old_ab12cd34.rename`,
      `index.public.${TABLE_NAME}.z_old_ab12cd34.rename`,
    ]);
  });
});

describe('content pairing (exact→wire convergence)', () => {
  it('pairs a wire-named-missing fields-only index against an unparseable live name', async () => {
    const contract = buildContract([wireNamedIndex('items_email_idx', 'ab12cd34')]);
    const schema = actualSchema([{ name: 'items_email_idx', columns: ['email'] }]);

    const opIds = await planOpIds(contract, schema, ALL_CLASSES_POLICY);
    expect(opIds).toEqual([`index.public.${TABLE_NAME}.items_email_idx.rename`]);
  });

  it('pairs on expression and where bodies byte-for-byte', async () => {
    const contract = buildContract([
      {
        name: 'items_email_eq_ab12cd34',
        prefix: 'items_email_eq',
        expression: 'lower(email)',
        where: '(value > 0)',
        unique: true,
      },
    ]);
    const schema = actualSchema([
      {
        name: 'legacy_email_expr',
        expression: 'lower(email)',
        where: '(value > 0)',
        unique: true,
      },
    ]);

    const opIds = await planOpIds(contract, schema, ALL_CLASSES_POLICY);
    expect(opIds).toEqual([`index.public.${TABLE_NAME}.legacy_email_expr.rename`]);
  });

  it('a byte-different body does not pair — create + drop', async () => {
    const contract = buildContract([
      {
        name: 'items_email_eq_ab12cd34',
        prefix: 'items_email_eq',
        expression: 'lower(email)',
        unique: false,
      },
    ]);
    const schema = actualSchema([
      { name: 'legacy_email_expr', expression: 'lower((email)::text)', unique: false },
    ]);

    const opIds = await planOpIds(contract, schema, ALL_CLASSES_POLICY);
    expect(opIds).toEqual([
      `dropIndex.${TABLE_NAME}.legacy_email_expr`,
      `index.${TABLE_NAME}.items_email_eq_ab12cd34`,
    ]);
  });

  it("an authored 'btree' index content-pairs with a typeless live index", async () => {
    const contract = buildContract([
      wireNamedIndex('items_email_idx', 'ab12cd34', { type: 'btree' }),
    ]);
    const schema = actualSchema([{ name: 'legacy_email_idx', columns: ['email'] }]);

    const opIds = await planOpIds(contract, schema, ALL_CLASSES_POLICY);
    expect(opIds).toEqual([`index.public.${TABLE_NAME}.legacy_email_idx.rename`]);
  });

  it('an exact-named missing index never content-pairs (wire-named only)', async () => {
    const contract = buildContract([
      { name: 'items_email_exact', columns: ['email'], unique: false },
    ]);
    const schema = actualSchema([{ name: 'items_email_legacy', columns: ['email'] }]);

    const opIds = await planOpIds(contract, schema, ALL_CLASSES_POLICY);
    expect(opIds).toEqual([
      `dropIndex.${TABLE_NAME}.items_email_legacy`,
      `index.${TABLE_NAME}.items_email_exact`,
    ]);
  });

  it('remaining content pairs consume candidates deterministically by sorted name', async () => {
    const contract = buildContract([
      wireNamedIndex('a_wire', '11111111'),
      wireNamedIndex('b_wire', '22222222'),
    ]);
    const schema = actualSchema([
      { name: 'z_legacy', columns: ['email'] },
      { name: 'y_legacy', columns: ['email'] },
    ]);

    const opIds = await planOpIds(contract, schema, ALL_CLASSES_POLICY);
    // Missing sorted: a_wire_…, b_wire_…; candidates sorted: y_legacy, z_legacy.
    expect(opIds).toEqual([
      `index.public.${TABLE_NAME}.y_legacy.rename`,
      `index.public.${TABLE_NAME}.z_legacy.rename`,
    ]);
  });

  it('an unmatched extra stays a destructive drop leftover', async () => {
    const contract = buildContract([wireNamedIndex('items_email_idx', 'ab12cd34')]);
    const schema = actualSchema([
      { name: 'items_email_idx_ab12cd34', prefix: 'items_email_idx', columns: ['email'] },
      { name: 'stray_value_idx', columns: ['value'] },
    ]);

    const opIds = await planOpIds(contract, schema, ALL_CLASSES_POLICY);
    expect(opIds).toEqual([`dropIndex.${TABLE_NAME}.stray_value_idx`]);
  });
});
