/**
 * Managed native-enum member-value changes at the planner level (Phase 2
 * Slice B): a suffix-append (the database's ordered members are a strict
 * prefix of the contract's) lowers to one `addNativeEnumValue` op per
 * appended value, in declaration order; every other member change — rename,
 * removal, reorder, or the database holding members the contract lacks — is
 * refused with the exact operator-worded diagnostic and zero ops. Covers the
 * `AddNativeEnumValueCall` op's rendering, prechecks/postchecks, and
 * non-transactional-caveat description.
 */
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { isStructuredError } from '@internal/utils/structured-error';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { buildPostgresPlanDiff } from '../../src/core/migrations/diff-database-schema';
import { coalesceSubtreeIssues, planIssues } from '../../src/core/migrations/issue-planner';
import {
  AddNativeEnumValueCall,
  type PostgresOpFactoryCall,
} from '../../src/core/migrations/op-factory-call';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresNativeEnumSchemaNode } from '../../src/core/schema-ir/postgres-native-enum-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import {
  introspectedColumn,
  postgresTypeComponents,
  postgresTypeLookups,
} from '../postgres-type-lookups';
import { planTrees } from './node-issue-planner-fixtures';

const EXPECTED_MEMBERS = ['draft', 'review', 'done'] as const;

function makeContract(members: readonly string[]): Contract<SqlStorage> {
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
        order_status: { kind: 'postgres-enum', typeName: 'order_status', members: [...members] },
      },
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('native-enum-add-value'),
    defaultControlPolicy: 'managed',
    storage: new SqlStorage({
      storageHash: coreHash('native-enum-add-value'),
      namespaces: { sales: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function ordersTableNode(): PostgresTableSchemaNode {
  return new PostgresTableSchemaNode({
    name: 'orders',
    columns: {
      id: introspectedColumn({
        name: 'id',
        typeText: 'int4',
        nullable: false,
      }),
    },
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    policies: [],
    rlsEnabled: false,
  });
}

function liveTree(actualMembers: readonly string[]): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    extensions: undefined,
    namespaces: {
      sales: new PostgresNamespaceSchemaNode({
        schemaName: 'sales',
        tables: { orders: ordersTableNode() },
        nativeEnums: [
          new PostgresNativeEnumSchemaNode({
            typeName: 'order_status',
            namespaceId: 'sales',
            members: actualMembers,
          }),
        ],
      }),
    },
    roles: [],
    existingSchemas: ['sales'],
    pgVersion: 'unknown',
  });
}

function planResultFor(contract: Contract<SqlStorage>, actual: PostgresDatabaseSchemaNode) {
  const { issues, expected } = buildPostgresPlanDiff({
    contract,
    actualSchema: actual,
    frameworkComponents: postgresTypeComponents,
  });
  return planIssues({
    issues: coalesceSubtreeIssues(issues),
    ...planTrees(actual, expected),
    toContract: contract,
    fromContract: null,
    schemaName: 'sales',
    codecHooks: new Map(),
    types: postgresTypeLookups,
    strategies: [],
  });
}

function isAddValueCall(call: PostgresOpFactoryCall): call is AddNativeEnumValueCall {
  return call.factoryName === 'addNativeEnumValue';
}

function refusalMessage(
  expectedMembers: readonly string[],
  actualMembers: readonly string[],
): string {
  return (
    'Native enum type "sales"."order_status" changed beyond appending new values ' +
    `(contract declares [${expectedMembers.join(', ')}], database has [${actualMembers.join(', ')}]). ` +
    "Prisma 8 does not modify a native enum's existing values (rename, removal, reorder) — " +
    'see https://pris.ly/d/postgres-native-enums. Author the change manually with `migration new`.'
  );
}

describe('suffix-append plans addNativeEnumValue ops', () => {
  it('single append lowers to exactly one op carrying the appended value', () => {
    const contract = makeContract([...EXPECTED_MEMBERS]);
    const result = planResultFor(contract, liveTree(['draft', 'review']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const addValueCalls = result.value.calls.filter(isAddValueCall);
    expect(addValueCalls).toHaveLength(1);
    expect(addValueCalls[0]).toMatchObject({
      schemaName: 'sales',
      typeName: 'order_status',
      value: 'done',
    });
  });

  it('multi append lowers to one op per value, in declaration order', () => {
    const expected = ['draft', 'review', 'done', 'archived'];
    const contract = makeContract(expected);
    const result = planResultFor(contract, liveTree(['draft']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const addValueCalls = result.value.calls.filter(isAddValueCall);
    expect(addValueCalls.map((call) => call.value)).toEqual(['review', 'done', 'archived']);
    expect(addValueCalls.every((call) => call.typeName === 'order_status')).toBe(true);
  });

  it('an unclaimed append does not touch unrelated table planning (orders stays absent from the plan)', () => {
    const contract = makeContract([...EXPECTED_MEMBERS]);
    const result = planResultFor(contract, liveTree(['draft', 'review']));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.calls.some((call) => call.factoryName === 'createTable')).toBe(false);
    expect(result.value.calls.some((call) => call.factoryName === 'dropTable')).toBe(false);
  });
});

describe('non-suffix member changes are refused with the exact diagnostic and zero ops', () => {
  it('rename (same length, a value differs) is refused', () => {
    const expected = [...EXPECTED_MEMBERS];
    const actual = ['draft', 'reviewed', 'done'];
    const result = planResultFor(makeContract(expected), liveTree(actual));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual([
      {
        kind: 'unsupportedOperation',
        summary: refusalMessage(expected, actual),
        why: 'Use `migration new` to author a custom migration for this change.',
      },
    ]);
  });

  it('removal (the contract dropped a member the database still has) is refused', () => {
    const expected = ['draft', 'done'];
    const actual = [...EXPECTED_MEMBERS];
    const result = planResultFor(makeContract(expected), liveTree(actual));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual([
      {
        kind: 'unsupportedOperation',
        summary: refusalMessage(expected, actual),
        why: 'Use `migration new` to author a custom migration for this change.',
      },
    ]);
  });

  it('reorder (same members, different order) is refused', () => {
    const expected = [...EXPECTED_MEMBERS];
    const actual = ['review', 'draft', 'done'];
    const result = planResultFor(makeContract(expected), liveTree(actual));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual([
      {
        kind: 'unsupportedOperation',
        summary: refusalMessage(expected, actual),
        why: 'Use `migration new` to author a custom migration for this change.',
      },
    ]);
  });

  it('DB-ahead-of-contract (the database has a live-appended value the contract lacks) is refused', () => {
    const expected = [...EXPECTED_MEMBERS];
    const actual = ['draft', 'review', 'done', 'archived'];
    const result = planResultFor(makeContract(expected), liveTree(actual));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual([
      {
        kind: 'unsupportedOperation',
        summary: refusalMessage(expected, actual),
        why: 'Use `migration new` to author a custom migration for this change.',
      },
    ]);
  });
});

describe('AddNativeEnumValueCall op', () => {
  function recordingLowerer(): { lowerer: ExecuteRequestLowerer } {
    return {
      lowerer: {
        lower(_ast, _ctx) {
          return { sql: 'stub', params: [] };
        },
        renderColumnDefault: async () => '',
        async lowerToExecuteRequest(_ast, _ctx) {
          return { sql: 'stub-check-sql', params: [] };
        },
      },
    };
  }

  it('escapes a value containing a single quote', async () => {
    const { lowerer } = recordingLowerer();
    const op = await new AddNativeEnumValueCall('sales', 'order_status', "it's shipped").toOp(
      lowerer,
    );
    expect(op.execute[0]?.sql).toBe(`ALTER TYPE "sales"."order_status" ADD VALUE 'it''s shipped'`);
  });

  it('renders an unqualified type name for the unbound namespace', async () => {
    const { lowerer } = recordingLowerer();
    const op = await new AddNativeEnumValueCall(UNBOUND_NAMESPACE_ID, 'mood', 'happy').toOp(
      lowerer,
    );
    expect(op.execute[0]?.sql).toBe(`ALTER TYPE "mood" ADD VALUE 'happy'`);
  });

  it('the rendered description carries the non-transactional ADD VALUE caveat', () => {
    const call = new AddNativeEnumValueCall('sales', 'order_status', 'guest');
    expect(call.summary).toContain(
      'A newly added enum value cannot be used until the transaction that adds it commits',
    );
    expect(call.summary).toContain('will fail at apply');
  });

  it('throws when constructed with a value exceeding the 63-byte enum label limit', () => {
    const tooLong = 'x'.repeat(64);
    expect(() => new AddNativeEnumValueCall('sales', 'order_status', tooLong)).toThrow(
      'byte label limit',
    );
    let caught: unknown;
    try {
      new AddNativeEnumValueCall('sales', 'order_status', tooLong);
    } catch (error) {
      caught = error;
    }
    expect(isStructuredError(caught)).toBe(true);
    expect(caught).toMatchObject({
      code: 'CONTRACT.IDENTIFIER_INVALID',
      meta: { value: tooLong, context: 'enum-label' },
    });
  });

  it('throws when toOp is called without a lowerer', async () => {
    const call = new AddNativeEnumValueCall('sales', 'order_status', 'guest');
    await expect(call.toOp()).rejects.toThrow(/lowerer is required/);
  });
});
