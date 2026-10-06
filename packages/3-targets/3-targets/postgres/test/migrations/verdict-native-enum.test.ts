import type { ControlPolicy } from '@internal/contract/types';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { verifySqlSchemaByDiff } from '@internal/family-sql/diff';
import { issueOutcome } from '@internal/framework-components/control';
import type { SqlStorage as SqlStorageType } from '@internal/sql-contract/types';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { diffPostgresSchema } from '../../src/core/migrations/diff-database-schema';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresNativeEnumSchemaNode } from '../../src/core/schema-ir/postgres-native-enum-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import { postgresDiffSubjectGranularity } from '../../src/core/schema-ir/schema-node-kinds';
import { postgresTypeComponents } from '../postgres-type-lookups';

/**
 * Enum drift visibility end-to-end: the expected projection turns
 * `entries.native_enum` into diff-tree nodes, introspected enum nodes
 * become the actual-side nodes, the unified differ reports missing / extra /
 * value-mismatch, and the control-policy disposition grades them by the
 * DEFAULT reason→category path — with NO enum-specific classification. A
 * drifted enum is a `not-equal` → `declaredIncompatible` → strict fail under
 * both `managed` and `external`, warn under `observed`; a missing enum is
 * `not-found` → `declaredMissing` → fail; an undeclared live enum is a
 * `not-expected` extra (strict-gated) that `external` still suppresses.
 */

const MEMBERS = ['draft', 'review', 'done'] as const;

function makeContract(options: {
  readonly defaultControlPolicy?: ControlPolicy;
  readonly enumControl?: ControlPolicy;
  readonly withEnum?: boolean;
}): Contract<SqlStorageType> {
  const schema = new PostgresSchema({
    id: 'public',
    entries: {
      table: {
        orders: new StorageTable({
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      ...(options.withEnum === false
        ? {}
        : {
            native_enum: {
              OrderStatus: {
                kind: 'postgres-enum',
                typeName: 'order_status',
                members: [...MEMBERS],
                ...(options.enumControl !== undefined ? { control: options.enumControl } : {}),
              },
            },
          }),
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('native-enum-verdict-test'),
    ...(options.defaultControlPolicy !== undefined
      ? { defaultControlPolicy: options.defaultControlPolicy }
      : {}),
    storage: new SqlStorage({
      storageHash: coreHash('native-enum-verdict-test'),
      namespaces: { public: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function ordersTable(): PostgresTableSchemaNode {
  return new PostgresTableSchemaNode({
    name: 'orders',
    columns: {
      id: { name: 'id', nativeType: 'int4', nullable: false, resolvedNativeType: 'int4' },
    },
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    policies: [],
    rlsEnabled: false,
  });
}

function actualTree(entries: readonly { typeName: string; values: readonly string[] }[]) {
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: { orders: ordersTable() },
        nativeEnums: entries.map(
          (entry) =>
            new PostgresNativeEnumSchemaNode({
              typeName: entry.typeName,
              namespaceId: 'public',
              members: entry.values,
            }),
        ),
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: 'unknown',
  });
}

const MATCHING = [{ typeName: 'order_status', values: [...MEMBERS] }];
const REORDERED = [{ typeName: 'order_status', values: ['review', 'draft', 'done'] }];
const STRAY = [
  { typeName: 'order_status', values: [...MEMBERS] },
  { typeName: 'stray_mood', values: ['happy', 'sad'] },
];

function enumIssuesOf(contract: Contract<SqlStorageType>, actual: PostgresDatabaseSchemaNode) {
  return diffPostgresSchema({
    contract,
    schema: actual,
    frameworkComponents: postgresTypeComponents,
  }).issues.filter((issue) => issue.path.some((segment) => segment.startsWith('native_enum:')));
}

function verify(
  contract: Contract<SqlStorageType>,
  actual: PostgresDatabaseSchemaNode,
  strict: boolean,
) {
  return verifySqlSchemaByDiff({
    contract,
    schema: actual,
    strict,
    frameworkComponents: postgresTypeComponents,
    diffSchema: diffPostgresSchema,
    granularityOf: postgresDiffSubjectGranularity,
  });
}

describe('differ reports enum drift (issue shapes)', () => {
  const managed = makeContract({ defaultControlPolicy: 'managed' });

  it('missing: declared enum absent from the database', () => {
    const issues = enumIssuesOf(managed, actualTree([]));
    expect(issues).toEqual([
      expect.objectContaining({
        path: ['database', 'public', 'native_enum:order_status'],
      }),
    ]);
    expect(issues[0]?.expected).toMatchObject({
      typeName: 'order_status',
      members: [...MEMBERS],
    });
  });

  it('extra: live enum type not declared by the contract', () => {
    const issues = enumIssuesOf(managed, actualTree(STRAY));
    expect(issues).toEqual([
      expect.objectContaining({
        path: ['database', 'public', 'native_enum:stray_mood'],
      }),
    ]);
    expect(issues[0]?.actual).toMatchObject({
      typeName: 'stray_mood',
      members: ['happy', 'sad'],
    });
  });

  it('value-mismatch: same type name, different ordered members', () => {
    const issues = enumIssuesOf(managed, actualTree(REORDERED));
    expect(issues).toEqual([
      expect.objectContaining({
        path: ['database', 'public', 'native_enum:order_status'],
      }),
    ]);
    expect(issues[0]?.expected).toMatchObject({ members: [...MEMBERS] });
    expect(issues[0]?.actual).toMatchObject({ members: ['review', 'draft', 'done'] });
  });

  it('matching ordered members produce zero enum issues', () => {
    expect(enumIssuesOf(managed, actualTree(MATCHING))).toEqual([]);
  });
});

describe('db verify grades enum drift by control policy', () => {
  const managed = makeContract({ defaultControlPolicy: 'managed' });
  const external = makeContract({ defaultControlPolicy: 'external' });
  const observed = makeContract({ defaultControlPolicy: 'observed' });

  it('managed: missing enum fails verify', () => {
    expect(verify(managed, actualTree([]), false).ok).toBe(false);
  });

  it('managed: value-mismatch fails verify', () => {
    expect(verify(managed, actualTree(REORDERED), false).ok).toBe(false);
  });

  it('managed: extra live enum fails verify under --strict, passes lenient (entity extras are strict-gated)', () => {
    expect(verify(managed, actualTree(STRAY), true).ok).toBe(false);
    expect(verify(managed, actualTree(STRAY), false).ok).toBe(true);
  });

  it('managed: matching enums verify clean in both modes', () => {
    expect(verify(managed, actualTree(MATCHING), true).ok).toBe(true);
    expect(verify(managed, actualTree(MATCHING), false).ok).toBe(true);
  });

  it('external: value-mismatch FAILS (strict — no valueDrift forgiveness for enums)', () => {
    // A drifted enum is a plain `not-equal` → `declaredIncompatible`, which
    // `external` does NOT suppress (it only forgives EXTRA objects). Strict
    // verify: a member-drifted enum fails regardless of grade.
    const result = verify(external, actualTree(REORDERED), true);
    expect(result.ok).toBe(false);
    const mismatch = result.schema.issues.filter(
      (i) => issueOutcome(i) === 'not-equal' && i.path.some((p) => p.includes('order_status')),
    );
    expect(mismatch.length).toBeGreaterThan(0);
  });

  it('external: extra live enum is suppressed in both modes', () => {
    expect(verify(external, actualTree(STRAY), true).ok).toBe(true);
    expect(verify(external, actualTree(STRAY), false).ok).toBe(true);
  });

  it('external: missing enum still fails (existence divergences fail under external)', () => {
    expect(verify(external, actualTree([]), false).ok).toBe(false);
  });

  it('observed: value-mismatch warns instead of failing', () => {
    const result = verify(observed, actualTree(REORDERED), false);
    expect(result.ok).toBe(true);
    expect(result.schema.warnings?.issues).toEqual([
      expect.objectContaining({
        path: ['database', 'public', 'native_enum:order_status'],
      }),
    ]);
  });

  it('a per-entity external grade does NOT forgive member drift (strict verify)', () => {
    const mixedContract = makeContract({
      defaultControlPolicy: 'managed',
      enumControl: 'external',
    });
    expect(verify(mixedContract, actualTree(REORDERED), false).ok).toBe(false);
  });

  it('an enum-free contract against an enum-free database is unaffected (regression pin)', () => {
    const enumFree = makeContract({ defaultControlPolicy: 'managed', withEnum: false });
    const result = verify(enumFree, actualTree([]), true);
    expect(result.ok).toBe(true);
    expect(result.schema.issues).toEqual([]);
  });
});
