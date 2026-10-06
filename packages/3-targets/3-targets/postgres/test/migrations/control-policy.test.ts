import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ControlPolicySubject, SuppressionRecord } from '@internal/family-sql/control';
import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  renderPostgresSuppression,
  resolvePostgresNodeIssueControlPolicySubject,
} from '../../src/core/migrations/control-policy';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresNativeEnumSchemaNode } from '../../src/core/schema-ir/postgres-native-enum-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import type { SqlSchemaDiffNode } from '../../src/core/schema-ir/schema-node-kinds';

/**
 * `resolvePostgresNodeIssueControlPolicySubject` resolves a table and a
 * native enum through the SAME generic `postgresNodeStorageCoordinate`
 * branch — no per-kind (table vs enum) special-casing. These tests pin that
 * a create issue for each kind produces an identically-shaped subject
 * differing only in `entityKind`/`entityName`, and that a dropped
 * (`not-expected`) enum now resolves its subject namespace the same way a
 * dropped table always has: to `UNBOUND_NAMESPACE_ID`, since neither is
 * claimed by any contract namespace.
 */

const MEMBERS = ['draft', 'review', 'done'] as const;

function makeContract(): Contract<SqlStorage> {
  const schema = new PostgresSchema({
    id: 'sales',
    entries: {
      table: {
        orders: new StorageTable({
          columns: { id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false } },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      native_enum: {
        order_status: {
          kind: 'postgres-enum',
          typeName: 'order_status',
          members: [...MEMBERS],
        },
      },
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('control-policy-subject-test'),
    defaultControlPolicy: 'managed',
    storage: new SqlStorage({
      storageHash: coreHash('control-policy-subject-test'),
      namespaces: { sales: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function tableNode(name: string): PostgresTableSchemaNode {
  return new PostgresTableSchemaNode({
    name,
    columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    policies: [],
    rlsEnabled: false,
  });
}

function enumNode(typeName: string, members: readonly string[]): PostgresNativeEnumSchemaNode {
  return new PostgresNativeEnumSchemaNode({ typeName, namespaceId: 'sales', members });
}

describe('resolvePostgresNodeIssueControlPolicySubject — generic entity coordinate', () => {
  const contract = makeContract();

  it('a table create issue and a native-enum create issue resolve the same shape, differing only in entityKind/entityName', () => {
    const tableIssue: SchemaDiffIssue<SqlSchemaDiffNode> = {
      path: ['database', 'sales', 'orders'],
      expected: tableNode('orders'),
    };
    const enumIssue: SchemaDiffIssue<SqlSchemaDiffNode> = {
      path: ['database', 'sales', 'native_enum:order_status'],
      expected: enumNode('order_status', MEMBERS),
    };

    expect(resolvePostgresNodeIssueControlPolicySubject(tableIssue, contract)).toEqual({
      namespaceId: 'sales',
      entityKind: 'table',
      entityName: 'orders',
      createsNewObject: true,
    });
    expect(resolvePostgresNodeIssueControlPolicySubject(enumIssue, contract)).toEqual({
      namespaceId: 'sales',
      entityKind: 'native_enum',
      entityName: 'order_status',
      createsNewObject: true,
    });
  });

  it('a dropped (not-expected) enum resolves namespaceId to UNBOUND, matching a dropped table', () => {
    const droppedEnumIssue: SchemaDiffIssue<SqlSchemaDiffNode> = {
      path: ['database', 'sales', 'native_enum:stray_mood'],
      actual: enumNode('stray_mood', ['happy', 'sad']),
    };
    const droppedTableIssue: SchemaDiffIssue<SqlSchemaDiffNode> = {
      path: ['database', 'sales', 'orphan'],
      actual: tableNode('orphan'),
    };

    // Enum drops now resolve like table drops: neither is claimed by any
    // contract namespace, so both fall back to UNBOUND_NAMESPACE_ID.
    expect(resolvePostgresNodeIssueControlPolicySubject(droppedEnumIssue, contract)).toEqual({
      namespaceId: UNBOUND_NAMESPACE_ID,
      entityKind: 'native_enum',
      entityName: 'stray_mood',
      createsNewObject: false,
    });
    expect(resolvePostgresNodeIssueControlPolicySubject(droppedTableIssue, contract)).toEqual({
      namespaceId: UNBOUND_NAMESPACE_ID,
      entityKind: 'table',
      entityName: 'orphan',
      createsNewObject: false,
    });
  });
});

/**
 * `renderPostgresSuppression` renders the label purely off the subject's own
 * `(entityKind, entityName)` coordinate — there is no target-owned
 * table-vs-enum vocabulary and no `factoryName`-derived label.
 */
describe('renderPostgresSuppression', () => {
  const contract = makeContract();

  const tableSubject: ControlPolicySubject = {
    namespaceId: 'sales',
    entityKind: 'table',
    entityName: 'orders',
    createsNewObject: true,
  };

  const enumSubject: ControlPolicySubject = {
    namespaceId: 'sales',
    entityKind: 'native_enum',
    entityName: 'order_status',
    createsNewObject: true,
  };

  it('a suppressed table creation names the table by coordinate and carries the creation factoryName', () => {
    const record: SuppressionRecord = {
      subject: tableSubject,
      policy: 'observed',
      factoryName: 'createTable',
      createsNewObject: true,
    };

    const conflict = renderPostgresSuppression(record, contract);

    expect({ summary: conflict.summary, factoryName: conflict.meta?.['factoryName'] }).toEqual({
      summary:
        "control policy suppressed: table \"sales.orders\" — namespace 'sales' has effective control 'observed'",
      factoryName: 'createTable',
    });
  });

  it('a suppressed native-enum creation names the enum type, not a table', () => {
    const record: SuppressionRecord = {
      subject: enumSubject,
      policy: 'observed',
      factoryName: 'createNativeEnumType',
      createsNewObject: true,
    };

    const conflict = renderPostgresSuppression(record, contract);

    expect({ summary: conflict.summary, factoryName: conflict.meta?.['factoryName'] }).toEqual({
      summary:
        "control policy suppressed: native_enum \"sales.order_status\" — namespace 'sales' has effective control 'observed'",
      factoryName: 'createNativeEnumType',
    });
  });

  it('a suppressed modification describes the subject by coordinate with no invented alter verb', () => {
    const record: SuppressionRecord = {
      subject: { ...enumSubject, createsNewObject: false },
      policy: 'tolerated',
      factoryName: undefined,
      createsNewObject: false,
    };

    const conflict = renderPostgresSuppression(record, contract);

    expect(conflict.summary).toContain('native_enum "sales.order_status"');
    expect(conflict.summary).not.toMatch(/alterTable|alterType|alterSchema/);
    expect('factoryName' in (conflict.meta ?? {})).toBe(false);
  });

  it('an external namespace overriding a declared managed policy reports the declaration generically', () => {
    const record: SuppressionRecord = {
      subject: { ...enumSubject, explicitNodeControlPolicy: 'managed' },
      policy: 'external',
      factoryName: 'createNativeEnumType',
      createsNewObject: true,
    };

    const conflict = renderPostgresSuppression(record, contract);

    expect(conflict.summary.endsWith("but declared 'managed'")).toBe(true);
    expect(conflict.summary).not.toContain('table');
  });
});
