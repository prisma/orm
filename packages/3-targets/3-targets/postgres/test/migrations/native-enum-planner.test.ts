/**
 * Managed native-enum create/delete at the planner level (Phase 2 Slice A):
 * a missing managed enum lowers to `CREATE TYPE … AS ENUM` ordered before the
 * dependent table DDL; an unclaimed live enum lowers to `DROP TYPE` ordered
 * after dependent-table removal; a non-suffix-append member-value change is a
 * NAMED unsupported diagnostic (never silent, never drop-and-recreate) — see
 * `native-enum-planner.add-value.test.ts` for the full append/refusal
 * classification (Phase 2 Slice B); rendering is schema-qualified, quoted,
 * declaration-ordered, and literal-escaped; a sibling-space-owned live enum
 * is never dropped.
 */
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY, type MigrationOperationPolicy } from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type {
  SchemaEntityCoordinate,
  SchemaOwnership,
} from '@internal/framework-components/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { coordinateKey } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { buildPostgresPlanDiff } from '../../src/core/migrations/diff-database-schema';
import { coalesceSubtreeIssues, planIssues } from '../../src/core/migrations/issue-planner';
import {
  CreateNativeEnumTypeCall,
  DropNativeEnumTypeCall,
} from '../../src/core/migrations/op-factory-call';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { isPostgresSchema, PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresNativeEnumSchemaNode } from '../../src/core/schema-ir/postgres-native-enum-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import { PostgresCreateType, PostgresDropType } from '../../src/exports/ddl';

const MEMBERS = ['draft', 'review', 'done'] as const;

const stubLowerer: ExecuteRequestLowerer = {
  lower(_ast, _ctx) {
    return { sql: 'stub', params: [] };
  },
  renderColumnDefault: async () => '',
  async lowerToExecuteRequest(_ast, _ctx) {
    return { sql: 'stub', params: [] };
  },
};

// Captures the DDL nodes an op lowers so a test can assert the node it built
// (the node → SQL rendering is verified in the adapter's ddl-create-type test).
function recordingLowerer(): { lowerer: ExecuteRequestLowerer; received: unknown[] } {
  const received: unknown[] = [];
  return {
    received,
    lowerer: {
      lower(ast, _ctx) {
        received.push(ast);
        return { sql: 'stub', params: [] };
      },
      renderColumnDefault: async () => '',
      async lowerToExecuteRequest(ast, _ctx) {
        received.push(ast);
        return { sql: 'stub', params: [] };
      },
    },
  };
}

const DB_UPDATE_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

function makeContract(options: { readonly withEnum: boolean }): Contract<SqlStorage> {
  const schema = new PostgresSchema({
    id: 'sales',
    entries: {
      table: {
        orders: new StorageTable({
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            ...(options.withEnum
              ? { status: { nativeType: 'order_status', codecId: 'pg/enum@1', nullable: false } }
              : {}),
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      ...(options.withEnum
        ? {
            native_enum: {
              order_status: {
                kind: 'postgres-enum',
                typeName: 'order_status',
                members: [...MEMBERS],
              },
            },
          }
        : {}),
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('native-enum-planner'),
    defaultControlPolicy: 'managed',
    storage: new SqlStorage({
      storageHash: coreHash('native-enum-planner'),
      namespaces: { sales: schema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function ordersTableNode(options: { readonly withStatusColumn: boolean }) {
  return new PostgresTableSchemaNode({
    name: 'orders',
    columns: {
      id: { name: 'id', nativeType: 'int4', nullable: false, resolvedNativeType: 'int4' },
      ...(options.withStatusColumn
        ? {
            status: {
              name: 'status',
              nativeType: 'order_status',
              nullable: false,
              resolvedNativeType: 'order_status',
            },
          }
        : {}),
    },
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    policies: [],
    rlsEnabled: false,
  });
}

function liveTree(options: {
  readonly tables: Readonly<Record<string, PostgresTableSchemaNode>>;
  readonly nativeEnums?: readonly { typeName: string; values: readonly string[] }[];
}): PostgresDatabaseSchemaNode {
  const nativeEnums = options.nativeEnums ?? [];
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      sales: new PostgresNamespaceSchemaNode({
        schemaName: 'sales',
        tables: options.tables,
        nativeEnums: nativeEnums.map(
          (entry) =>
            new PostgresNativeEnumSchemaNode({
              typeName: entry.typeName,
              namespaceId: 'sales',
              members: entry.values,
            }),
        ),
      }),
    },
    roles: [],
    existingSchemas: ['sales'],
    pgVersion: 'unknown',
  });
}

function planResultFor(contract: Contract<SqlStorage>, actual: PostgresDatabaseSchemaNode) {
  const { issues } = buildPostgresPlanDiff({
    contract,
    actualSchema: actual,
    frameworkComponents: [],
  });
  return planIssues({
    issues: coalesceSubtreeIssues(issues),
    toContract: contract,
    fromContract: null,
    schemaName: 'sales',
    codecHooks: new Map(),
    storageTypes: contract.storage.types ?? {},
    strategies: [],
  });
}

function callsFor(contract: Contract<SqlStorage>, actual: PostgresDatabaseSchemaNode) {
  const result = planResultFor(contract, actual);
  if (!result.ok) throw new Error(`expected ok, got conflicts: ${JSON.stringify(result.failure)}`);
  return result.value.calls;
}

// A two-space composition ownership oracle shaped like the real
// `ContractSpaceAggregate`: `declaresEntity` answers over every space's
// `native_enum` entities on the storage-`entries` coordinate. The entry key is
// the enum's PHYSICAL type name (ADR 221), so the query
// `declaresEntity({… entityKind: 'native_enum', entityName: '<type>'})` matches
// directly — the same coordinate walk the real aggregate performs.
function twoSpaceOwnership(...storages: readonly SqlStorage[]): SchemaOwnership {
  const ownedCoordinates = new Set<string>();
  for (const storage of storages) {
    for (const [namespaceId, ns] of Object.entries(storage.namespaces)) {
      const enums = isPostgresSchema(ns) ? (ns.entries.native_enum ?? {}) : {};
      for (const typeName of Object.keys(enums)) {
        ownedCoordinates.add(
          coordinateKey({ namespaceId, entityKind: 'native_enum', entityName: typeName }),
        );
      }
    }
  }
  return {
    declaresEntity: (coordinate) => ownedCoordinates.has(coordinateKey(coordinate)),
  };
}

describe('managed enum create lowering + ordering', () => {
  it('a missing managed enum lowers to createNativeEnumType ordered BEFORE the dependent createTable', () => {
    const contract = makeContract({ withEnum: true });
    const actual = liveTree({ tables: {} });

    const factoryNames = callsFor(contract, actual).map((c) => c.factoryName);
    expect(factoryNames).toContain('createNativeEnumType');
    expect(factoryNames).toContain('createTable');
    expect(factoryNames.indexOf('createNativeEnumType')).toBeLessThan(
      factoryNames.indexOf('createTable'),
    );
  });

  it('the create call carries the schema, type name, and declaration-ordered members', () => {
    const contract = makeContract({ withEnum: true });
    const calls = callsFor(contract, liveTree({ tables: {} }));
    const create = calls.find((c) => c.factoryName === 'createNativeEnumType');
    expect(create).toMatchObject({
      schemaName: 'sales',
      typeName: 'order_status',
      members: [...MEMBERS],
    });
  });
});

describe('unclaimed enum drop lowering + ordering', () => {
  it('a live enum with no contract entity lowers to dropNativeEnumType ordered AFTER the dependent dropTable', () => {
    const contract = makeContract({ withEnum: false });
    const actual = liveTree({
      tables: { orders: ordersTableNode({ withStatusColumn: false }), legacy: legacyTable() },
      nativeEnums: [{ typeName: 'order_status', values: [...MEMBERS] }],
    });

    const factoryNames = callsFor(contract, actual).map((c) => c.factoryName);
    expect(factoryNames).toContain('dropNativeEnumType');
    expect(factoryNames).toContain('dropTable');
    expect(factoryNames.indexOf('dropTable')).toBeLessThan(
      factoryNames.indexOf('dropNativeEnumType'),
    );
  });

  // The enum type has no column→type edge in the graph this slice (the column
  // issue is coalesced under the whole-table drop), so ordering falls to the
  // `dropType` call bucket, which follows the general drop bucket. Names chosen
  // adversarially — `aaa_status` sorts before `zzz_widget` — so a bare path
  // tiebreak would drop the type first and error (type still in use).
  it('drops a table before a native enum even when the enum name sorts first', () => {
    const contract = makeContract({ withEnum: false });
    const zzzWidget = new PostgresTableSchemaNode({
      name: 'zzz_widget',
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
    const actual = liveTree({
      tables: { orders: ordersTableNode({ withStatusColumn: false }), zzz_widget: zzzWidget },
      nativeEnums: [{ typeName: 'aaa_status', values: [...MEMBERS] }],
    });

    const factoryNames = callsFor(contract, actual).map((c) => c.factoryName);
    expect(factoryNames).toContain('dropNativeEnumType');
    expect(factoryNames).toContain('dropTable');
    expect(factoryNames.indexOf('dropTable')).toBeLessThan(
      factoryNames.indexOf('dropNativeEnumType'),
    );
  });
});

function legacyTable() {
  return new PostgresTableSchemaNode({
    name: 'legacy',
    columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    policies: [],
    rlsEnabled: false,
  });
}

describe('member-value mismatch is a named unsupported diagnostic', () => {
  it('a managed enum with drifted members fails planning with the named diagnostic — never a silent plan', () => {
    const contract = makeContract({ withEnum: true });
    const actual = liveTree({
      tables: { orders: ordersTableNode({ withStatusColumn: true }) },
      nativeEnums: [{ typeName: 'order_status', values: ['review', 'draft', 'done'] }],
    });

    const result = planResultFor(contract, actual);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual([
      expect.objectContaining({
        kind: 'unsupportedOperation',
        summary: expect.stringMatching(/changed beyond appending new values/),
      }),
    ]);
    expect(result.failure[0]?.summary).toContain('order_status');
  });

  it('the mismatch diagnostic never plans a DROP TYPE + CREATE TYPE pair (no drop-recreate)', () => {
    const contract = makeContract({ withEnum: true });
    const actual = liveTree({
      tables: { orders: ordersTableNode({ withStatusColumn: true }) },
      nativeEnums: [{ typeName: 'order_status', values: ['review', 'draft', 'done'] }],
    });

    const result = planResultFor(contract, actual);
    expect(result.ok).toBe(false);
  });
});

describe('op building (typed DDL node)', () => {
  it('CREATE builds a PostgresCreateType carrying schema, type name, and declaration-ordered members', async () => {
    const { lowerer, received } = recordingLowerer();
    const call = new CreateNativeEnumTypeCall('sales', 'order status', [
      'draft',
      "it's reviewed",
      'done',
    ]);
    const op = await call.toOp(lowerer);
    const node = received.find((n): n is PostgresCreateType => n instanceof PostgresCreateType);
    expect(node?.schema).toBe('sales');
    expect(node?.name).toBe('order status');
    expect(node?.values).toEqual(['draft', "it's reviewed", 'done']);
    expect(op.operationClass).toBe('additive');
  });

  it('DROP builds a PostgresDropType carrying schema and type name', async () => {
    const { lowerer, received } = recordingLowerer();
    const op = await new DropNativeEnumTypeCall('sales', 'order_status').toOp(lowerer);
    const node = received.find((n): n is PostgresDropType => n instanceof PostgresDropType);
    expect(node?.schema).toBe('sales');
    expect(node?.name).toBe('order_status');
    expect(op.operationClass).toBe('destructive');
  });

  it('an unbound-namespace create builds a node with no schema so search_path resolves it', async () => {
    const { lowerer, received } = recordingLowerer();
    await new CreateNativeEnumTypeCall('__unbound__', 'mood', ['happy']).toOp(lowerer);
    const node = received.find((n): n is PostgresCreateType => n instanceof PostgresCreateType);
    expect(node?.schema).toBeUndefined();
    expect(node?.name).toBe('mood');
  });
});

describe('planner ownership + policy for enum extras', () => {
  const ownsOnly = (...coordinates: readonly SchemaEntityCoordinate[]): SchemaOwnership => {
    const owned = new Set(coordinates.map(coordinateKey));
    return { declaresEntity: (coordinate) => owned.has(coordinateKey(coordinate)) };
  };

  function planLive(
    ownership?: SchemaOwnership,
    policy: MigrationOperationPolicy = DB_UPDATE_POLICY,
  ) {
    const planner = createPostgresMigrationPlanner(stubLowerer);
    return planner.plan({
      contract: makeContract({ withEnum: false }),
      schema: liveTree({
        tables: { orders: ordersTableNode({ withStatusColumn: false }) },
        nativeEnums: [{ typeName: 'order_status', values: [...MEMBERS] }],
      }),
      policy,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
      ...(ownership !== undefined ? { ownership } : {}),
    });
  }

  it('never drops a live enum a sibling space declares (by physical type name)', async () => {
    // A sibling space declares `order_status` in `sales`; the entity keys under
    // its physical type name in `entries.native_enum`, so `declaresEntity`
    // matches the coordinate and the app plan leaves it untouched.
    const siblingStorage = new SqlStorage({
      storageHash: coreHash('sibling-owns-order-status'),
      namespaces: {
        sales: new PostgresSchema({
          id: 'sales',
          entries: {
            table: {},
            native_enum: {
              order_status: {
                kind: 'postgres-enum',
                typeName: 'order_status',
                members: [...MEMBERS],
              },
            },
          },
        }),
      },
    });
    const result = planLive(twoSpaceOwnership(siblingStorage));
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.some((op) => op.id.startsWith('dropNativeEnumType.'))).toBe(false);
  });

  it('drops a truly unclaimed live enum under a destructive policy', async () => {
    const result = planLive(ownsOnly());
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.some((op) => op.id.startsWith('dropNativeEnumType.'))).toBe(true);
  });

  it('never drops an enum additive-only, regardless of ownership', async () => {
    const result = planLive(undefined, INIT_ADDITIVE_POLICY);
    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.some((op) => op.id.startsWith('dropNativeEnumType.'))).toBe(false);
  });
});

describe('D2-F1: enum drop-safety resolves ownership by physical type name', () => {
  // A pack declares `native_enum Status { … @@map("order_status") }` in the
  // shared `public` schema. The entity keys under its physical type name
  // (`order_status`, the ADR 221 `entries.native_enum` key), so
  // `declaresEntity({… entityName: 'order_status'})` matches — the app plan must
  // not drop a type a sibling space owns in the same schema.
  function packStorageDeclaringRenamedEnum(): SqlStorage {
    return new SqlStorage({
      storageHash: coreHash('pack-renamed-enum'),
      namespaces: {
        public: new PostgresSchema({
          id: 'public',
          entries: {
            table: {},
            native_enum: {
              order_status: {
                kind: 'postgres-enum',
                typeName: 'order_status',
                members: [...MEMBERS],
              },
            },
          },
        }),
      },
    });
  }

  // An app whose managed contract shares the `public` schema and declares no
  // enum of its own; the pack-owned type must not be dropped from under it.
  function appContractInPublic(): Contract<SqlStorage> {
    const schema = new PostgresSchema({
      id: 'public',
      entries: {
        table: {
          orders: new StorageTable({
            columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
          }),
        },
      },
    });
    return {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: profileHash('app-public'),
      defaultControlPolicy: 'managed',
      storage: new SqlStorage({
        storageHash: coreHash('app-public'),
        namespaces: { public: schema },
      }),
      roots: {},
      domain: applicationDomainOf({ models: {} }),
      capabilities: {},
      extensions: {},
      meta: {},
    };
  }

  function liveInPublic(nativeEnums: readonly { typeName: string; values: readonly string[] }[]) {
    return new PostgresDatabaseSchemaNode({
      namespaces: {
        public: new PostgresNamespaceSchemaNode({
          schemaName: 'public',
          tables: {
            orders: new PostgresTableSchemaNode({
              name: 'orders',
              columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
              primaryKey: { columns: ['id'] },
              foreignKeys: [],
              uniques: [],
              indexes: [],
              policies: [],
              rlsEnabled: false,
            }),
          },
          nativeEnums: nativeEnums.map(
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

  it('does NOT drop a pack-owned @@map-renamed enum under a full migrate op set', async () => {
    const app = appContractInPublic();
    const planner = createPostgresMigrationPlanner(stubLowerer);
    const result = planner.plan({
      contract: app,
      schema: liveInPublic([{ typeName: 'order_status', values: [...MEMBERS] }]),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
      ownership: twoSpaceOwnership(app.storage, packStorageDeclaringRenamedEnum()),
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    expect(ops.some((op) => op.id === 'dropNativeEnumType.order_status')).toBe(false);
  });

  it('still drops a genuinely unowned extra enum in the same run (selectivity)', async () => {
    const app = appContractInPublic();
    const planner = createPostgresMigrationPlanner(stubLowerer);
    const result = planner.plan({
      contract: app,
      schema: liveInPublic([
        { typeName: 'order_status', values: [...MEMBERS] },
        { typeName: 'unowned_mood', values: ['happy', 'sad'] },
      ]),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
      ownership: twoSpaceOwnership(app.storage, packStorageDeclaringRenamedEnum()),
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = await Promise.all(result.plan.operations);
    const dropIds = ops.filter((op) => op.id.startsWith('dropNativeEnumType.')).map((op) => op.id);
    expect(dropIds).toEqual(['dropNativeEnumType.unowned_mood']);
  });
});
