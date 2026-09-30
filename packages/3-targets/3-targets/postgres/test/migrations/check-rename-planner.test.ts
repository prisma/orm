/**
 * Check-constraint rename post-pass: a `not-found` and a `not-expected` check
 * on the same table whose wire-name hashes match but whose prefixes differ
 * collapse into one `ALTER TABLE … RENAME CONSTRAINT`.
 *
 * Only the index pass's hash-pairing phase is cloned. There is no content
 * pairing for checks: a live body is whatever Postgres reprinted, so it never
 * byte-matches the authored text, and pairing by content would bless whatever
 * predicate is live. Adoption of an exact-named check stays drop + add.
 */

import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { MigrationOperationClass } from '@internal/framework-components/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { CheckConstraint, SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

const TABLE_NAME = 'items';
const OTHER_TABLE = 'others';
const EXPRESSION = `"email" <> ''`;

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
const NO_WIDENING_POLICY = { allowedOperationClasses: ['additive', 'destructive'] as const };

interface LooseCheck {
  readonly name: string;
  readonly prefix?: string;
  readonly expression?: string;
  readonly table?: string;
}

const columns = {
  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
  email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
};

function storageTable(checks: readonly LooseCheck[]): StorageTable {
  return new StorageTable({
    columns,
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    ...(checks.length > 0
      ? {
          checks: checks.map(
            (c) =>
              new CheckConstraint({
                naming: parseNaming(c.name, c.prefix),
                expression: c.expression ?? EXPRESSION,
              }),
          ),
        }
      : {}),
  });
}

function buildContract(
  checks: readonly LooseCheck[],
  extraTables: readonly string[] = [],
): Contract<SqlStorage> {
  const tables: Record<string, StorageTable> = {};
  const names = new Set([...checks.map((c) => c.table ?? TABLE_NAME), TABLE_NAME, ...extraTables]);
  for (const tableName of names) {
    tables[tableName] = storageTable(checks.filter((c) => (c.table ?? TABLE_NAME) === tableName));
  }
  const schema = new PostgresSchema({ id: 'public', entries: { table: tables } });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('check-rename-planner-test'),
    storage: new SqlStorage({
      storageHash: coreHash('check-rename-planner-test'),
      namespaces: { public: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function tableNode(name: string, checks: readonly LooseCheck[]): PostgresTableSchemaNode {
  return new PostgresTableSchemaNode({
    name,
    columns: {
      id: { name: 'id', nativeType: 'int4', nullable: false },
      email: { name: 'email', nativeType: 'text', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    checks: checks.map((c) => ({
      naming: parseNaming(c.name, c.prefix),
      expression: c.expression ?? EXPRESSION,
      dependsOn: undefined,
    })),
    rlsEnabled: false,
  });
}

function actualSchema(checks: readonly LooseCheck[]): PostgresDatabaseSchemaNode {
  const names = new Set(checks.map((c) => c.table ?? TABLE_NAME));
  names.add(TABLE_NAME);
  const tables: Record<string, PostgresTableSchemaNode> = {};
  for (const name of names) {
    tables[name] = tableNode(
      name,
      checks.filter((c) => (c.table ?? TABLE_NAME) === name),
    );
  }
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({ schemaName: 'public', tables }),
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

function wire(prefix: string, hash: string, rest?: Partial<LooseCheck>): LooseCheck {
  return { name: `${prefix}_${hash}`, prefix, ...rest };
}

describe('hash pairing (prefix-only rename)', () => {
  it('plans exactly one RENAME CONSTRAINT — no drop, no add', async () => {
    const opIds = await planOpIds(
      buildContract([wire('items_email_present', 'ab12cd34')]),
      actualSchema([wire('items_email_check', 'ab12cd34')]),
      ALL_CLASSES_POLICY,
    );
    expect(opIds).toEqual([
      `checkConstraint.public.${TABLE_NAME}.items_email_check_ab12cd34.rename`,
    ]);
  });

  it('plans the rename without the destructive allowance', async () => {
    const opIds = await planOpIds(
      buildContract([wire('items_email_present', 'ab12cd34')]),
      actualSchema([wire('items_email_check', 'ab12cd34')]),
      NO_DESTRUCTIVE_POLICY,
    );
    expect(opIds).toEqual([
      `checkConstraint.public.${TABLE_NAME}.items_email_check_ab12cd34.rename`,
    ]);
  });

  it('multi-candidate groups pair deterministically by sorted name', async () => {
    const opIds = await planOpIds(
      buildContract([wire('a_new', 'ab12cd34'), wire('b_new', 'ab12cd34')]),
      actualSchema([wire('z_old', 'ab12cd34'), wire('y_old', 'ab12cd34')]),
      ALL_CLASSES_POLICY,
    );
    // Missing sorted: a_new_…, b_new_…; candidates sorted: y_old_…, z_old_….
    expect(opIds).toEqual([
      `checkConstraint.public.${TABLE_NAME}.y_old_ab12cd34.rename`,
      `checkConstraint.public.${TABLE_NAME}.z_old_ab12cd34.rename`,
    ]);
  });

  it('pairs within a table — a same-hash check on another table is not a candidate', async () => {
    const opIds = await planOpIds(
      buildContract([wire('items_email_present', 'ab12cd34')], [OTHER_TABLE]),
      actualSchema([wire('others_email_check', 'ab12cd34', { table: OTHER_TABLE })]),
      ALL_CLASSES_POLICY,
    );
    expect(opIds).toEqual([
      `dropCheckConstraint.${OTHER_TABLE}.others_email_check_ab12cd34`,
      `checkConstraint.${TABLE_NAME}.items_email_present_ab12cd34`,
    ]);
  });
});

describe('what does not pair', () => {
  it('an expression change alongside the prefix change stays drop + add', async () => {
    // Different hash — the predicate changed too, so there is nothing to rename.
    const opIds = await planOpIds(
      buildContract([wire('items_email_present', '11111111', { expression: `"email" <> 'x'` })]),
      actualSchema([wire('items_email_check', '00000000')]),
      ALL_CLASSES_POLICY,
    );
    expect(opIds).toEqual([
      `dropCheckConstraint.${TABLE_NAME}.items_email_check_00000000`,
      `checkConstraint.${TABLE_NAME}.items_email_present_11111111`,
    ]);
  });

  it('an exact-named live check never pairs — adoption stays drop + add', async () => {
    const opIds = await planOpIds(
      buildContract([wire('items_email_check', 'ab12cd34')]),
      actualSchema([{ name: 'items_email_check' }]),
      ALL_CLASSES_POLICY,
    );
    expect(opIds).toEqual([
      `dropCheckConstraint.${TABLE_NAME}.items_email_check`,
      `checkConstraint.${TABLE_NAME}.items_email_check_ab12cd34`,
    ]);
  });

  it('a wire-shaped live check whose hash matches nothing expected is just dropped', async () => {
    const opIds = await planOpIds(
      buildContract([wire('items_email_present', 'ab12cd34')]),
      actualSchema([
        wire('items_email_check', '99999999'),
        wire('items_email_present', 'ab12cd34'),
      ]),
      ALL_CLASSES_POLICY,
    );
    expect(opIds).toEqual([`dropCheckConstraint.${TABLE_NAME}.items_email_check_99999999`]);
  });
});

describe('policy gating', () => {
  it('without widening the pair degrades to drop + add', async () => {
    const opIds = await planOpIds(
      buildContract([wire('items_email_present', 'ab12cd34')]),
      actualSchema([wire('items_email_check', 'ab12cd34')]),
      NO_WIDENING_POLICY,
    );
    expect(opIds).toEqual([
      `dropCheckConstraint.${TABLE_NAME}.items_email_check_ab12cd34`,
      `checkConstraint.${TABLE_NAME}.items_email_present_ab12cd34`,
    ]);
  });

  it('degrades to a bare add of the new name under an additive-only policy', async () => {
    const opIds = await planOpIds(
      buildContract([wire('items_email_present', 'ab12cd34')]),
      actualSchema([wire('items_email_check', 'ab12cd34')]),
      ADDITIVE_ONLY_POLICY,
    );
    expect(opIds).toEqual([`checkConstraint.${TABLE_NAME}.items_email_present_ab12cd34`]);
  });
});
