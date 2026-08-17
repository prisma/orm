import postgresAdapterDescriptor, {
  createPostgresBuiltinCodecLookup,
  PostgresControlAdapter,
} from '@internal/adapter-postgres/control';
import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import type {
  CodecControlHooks,
  NativeTypeExpander,
  SqlMigrationPlanOperation,
  SqlPlannerResult,
} from '@internal/family-sql/control';
import {
  contractToSchemaIR as contractToSchemaIRImpl,
  detectDestructiveChanges,
  extractCodecControlHooks,
} from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { APP_SPACE_ID, type SchemaOwnership } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  SqlStorage,
  type SqlStorageInput,
  type StorageColumn,
  type StorageTable,
} from '@internal/sql-contract/types';
import { SqlForeignKeyIR } from '@internal/sql-schema-ir/types';
import { postgresRenderDefault } from '@internal/target-postgres/control';
import { createPostgresMigrationPlanner } from '@internal/target-postgres/planner';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import { resolveDdlSchemaForNamespaceStorage } from '@internal/target-postgres/schema-ir-annotations';
import {
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
  PostgresNativeEnumSchemaNode,
  PostgresTableSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import pgvectorDescriptor from '../../src/exports/control';

const testAdapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
const adapterCodecHooks = extractCodecControlHooks([postgresAdapterDescriptor]);
const expandParameterizedNativeType: NativeTypeExpander = (input) => {
  if (!input.codecId) return input.nativeType;
  const hooks = adapterCodecHooks.get(input.codecId);
  return hooks?.expandNativeType?.(input) ?? input.nativeType;
};

function ns(tables: Record<string, StorageTable>): Pick<SqlStorageInput, 'namespaces'> {
  return {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
        id: UNBOUND_NAMESPACE_ID,
        entries: { table: tables },
      }),
    },
  };
}

function col(overrides: Partial<StorageColumn> & { nativeType: string }): StorageColumn {
  return {
    codecId: 'pg/text@1',
    nullable: false,
    ...overrides,
  };
}

function table(
  overrides: Partial<StorageTable> & { columns: Record<string, StorageColumn> },
): StorageTable {
  return {
    uniques: [],
    indexes: [],
    foreignKeys: [],
    ...overrides,
  };
}

function createTestContract(
  storage: Omit<SqlStorageInput, 'storageHash'> | SqlStorage,
  overrides?: Partial<Contract<SqlStorage>>,
): Contract<SqlStorage> {
  const storageHashValue = coreHash('test');
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage:
      storage instanceof SqlStorage
        ? storage
        : new SqlStorage({ ...storage, storageHash: storageHashValue }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
    ...overrides,
  };
}

// Carry the contract's enum native-type names as `nativeEnums` nodes (the
// `PostgresNamespaceSchemaNode` field that records which enum types already
// exist — the signal the enum `planTypeOperations` hook reads to decide
// whether to emit a `CREATE TYPE`). Member values are irrelevant to that
// signal, so each node carries an empty `members` list.
function contractToSchemaIR(
  contract: Contract<SqlStorage> | null,
  options?: Omit<Parameters<typeof contractToSchemaIRImpl>[1], 'annotationNamespace'>,
): PostgresDatabaseSchemaNode {
  const sqlIr = contractToSchemaIRImpl(contract, { annotationNamespace: 'pg', ...options });
  const enums =
    contract === null
      ? []
      : Object.values(contract.storage.types ?? {}).map(
          (t) =>
            new PostgresNativeEnumSchemaNode({
              typeName: t.nativeType,
              namespaceId: 'public',
              members: [],
            }),
        );
  const tables = Object.fromEntries(
    Object.entries(sqlIr.tables).map(([name, t]) => [
      name,
      new PostgresTableSchemaNode({
        name: t.name,
        columns: t.columns,
        // The flat family `contractToSchemaIR` stamps `referencedSchema` only
        // for bound FK targets (absent = unbound namespace) and never resolves
        // `resolvedReferencedNamespace` — that fixup is `contractToPostgresDatabaseSchemaNode`'s
        // own responsibility. The differ pairs FK nodes by id, which folds in
        // `resolvedReferencedNamespace`, so this test double must apply the same
        // restoration and resolution the real Postgres tree-builder does, or an
        // unresolved FK here never pairs with the differ's Postgres-tree-derived
        // expected side and shows up as a spurious drop+recreate.
        foreignKeys:
          contract === null
            ? t.foreignKeys
            : t.foreignKeys.map(
                (fk) =>
                  new SqlForeignKeyIR({
                    columns: fk.columns,
                    referencedTable: fk.referencedTable,
                    referencedColumns: fk.referencedColumns,
                    referencedSchema: fk.referencedSchema ?? UNBOUND_NAMESPACE_ID,
                    ...(fk.name !== undefined ? { name: fk.name } : {}),
                    ...(fk.onDelete !== undefined ? { onDelete: fk.onDelete } : {}),
                    ...(fk.onUpdate !== undefined ? { onUpdate: fk.onUpdate } : {}),
                    resolvedReferencedNamespace: resolveDdlSchemaForNamespaceStorage(
                      contract.storage,
                      fk.referencedSchema ?? UNBOUND_NAMESPACE_ID,
                    ),
                  }),
              ),
        uniques: t.uniques,
        indexes: t.indexes,
        ...(t.primaryKey !== undefined ? { primaryKey: t.primaryKey } : {}),
        ...(t.annotations !== undefined ? { annotations: t.annotations } : {}),
        ...(t.checks !== undefined ? { checks: t.checks } : {}),
        rlsEnabled: false,
      }),
    ]),
  );
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables,
        nativeEnums: enums,
      }),
    },
    roles: [],
    existingSchemas: [],
    pgVersion: '',
  });
}

function planFromStorages(
  from: Omit<SqlStorageInput, 'storageHash'> | null,
  to: Omit<SqlStorageInput, 'storageHash'>,
): SqlPlannerResult<PostgresPlanTargetDetails> {
  const toContract = createTestContract(to);
  const fromSchemaIR = contractToSchemaIR(from ? createTestContract(from) : null, {
    expandNativeType: expandParameterizedNativeType,
    renderDefault: postgresRenderDefault,
  });
  const planner = createPostgresMigrationPlanner(testAdapter);
  return planner.plan({
    contract: toContract,
    schema: fromSchemaIR,
    policy: { allowedOperationClasses: ['additive'] },
    fromContract: null,
    frameworkComponents: [],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
}

describe('contractToSchemaIR → planner round-trip', () => {
  it('produces no ops when contract and schemaIR represent the same state', () => {
    const storage: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['email'] }],
          indexes: [{ name: 'user_name_idx', columns: ['name'], unique: false }],
          foreignKeys: [],
        },
      }),
    };

    const contract = createTestContract(storage);
    const schemaIR = contractToSchemaIR(createTestContract(storage), {
      expandNativeType: expandParameterizedNativeType,
      renderDefault: postgresRenderDefault,
    });
    const planner = createPostgresMigrationPlanner(testAdapter);

    const result = planner.plan({
      contract,
      schema: schemaIR,
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.plan.operations).toHaveLength(0);
    }
  });

  it('detects additive changes from empty state', async () => {
    const storage: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      }),
    };

    const contract = createTestContract(storage);
    const emptySchemaIR = contractToSchemaIR(null, {
      expandNativeType: expandParameterizedNativeType,
      renderDefault: postgresRenderDefault,
    });
    const planner = createPostgresMigrationPlanner(testAdapter);

    const result = planner.plan({
      contract,
      schema: emptySchemaIR,
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      const ops = (await Promise.all(
        result.plan.operations,
      )) as SqlMigrationPlanOperation<PostgresPlanTargetDetails>[];
      expect(ops.length).toBeGreaterThan(0);
      const tableOp = ops.find((op) => op.id.includes('user'));
      expect(tableOp).toBeDefined();
    }
  });

  it('detects incremental table addition', async () => {
    const fromStorage: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      }),
    };

    const toStorage: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
        post: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      }),
    };

    const contract = createTestContract(toStorage);
    const fromSchemaIR = contractToSchemaIR(createTestContract(fromStorage), {
      expandNativeType: expandParameterizedNativeType,
      renderDefault: postgresRenderDefault,
    });
    const planner = createPostgresMigrationPlanner(testAdapter);

    const result = planner.plan({
      contract,
      schema: fromSchemaIR,
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      const ops = (await Promise.all(
        result.plan.operations,
      )) as SqlMigrationPlanOperation<PostgresPlanTargetDetails>[];
      const postOp = ops.find((op) => op.id.includes('post'));
      expect(postOp).toBeDefined();
      const userOp = ops.find((op) => op.id.startsWith('table.') && op.id.includes('user'));
      expect(userOp).toBeUndefined();
    }
  });

  it('handles default values in round-trip', () => {
    const storage: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        item: {
          columns: {
            id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            status: {
              nativeType: 'text',
              codecId: 'pg/text@1',
              nullable: false,
              default: { kind: 'literal', value: 'active' },
            },
            createdAt: {
              nativeType: 'timestamptz',
              codecId: 'pg/timestamptz-temporal@1',
              nullable: false,
              default: { kind: 'function', expression: 'now()' },
            },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      }),
    };

    const contract = createTestContract(storage);
    const schemaIR = contractToSchemaIR(createTestContract(storage), {
      expandNativeType: expandParameterizedNativeType,
      renderDefault: postgresRenderDefault,
    });
    const planner = createPostgresMigrationPlanner(testAdapter);

    const result = planner.plan({
      contract,
      schema: schemaIR,
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.plan.operations).toHaveLength(0);
    }
  });
});

describe('planner — additive scenarios', () => {
  it('detects added column on existing table', async () => {
    const from: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            email: col({ nativeType: 'text', codecId: 'pg/text@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
      }),
    };

    const to: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            email: col({ nativeType: 'text', codecId: 'pg/text@1' }),
            age: col({ nativeType: 'int4', codecId: 'pg/int4@1', nullable: true }),
          },
          primaryKey: { columns: ['id'] },
        }),
      }),
    };

    const result = planFromStorages(from, to);

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      const ops = (await Promise.all(
        result.plan.operations,
      )) as SqlMigrationPlanOperation<PostgresPlanTargetDetails>[];
      const addColOp = ops.find((op) => op.id.includes('age'));
      expect(addColOp).toBeDefined();
      expect(addColOp!.label).toContain('age');
    }
  });

  it('detects added table', async () => {
    const from: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
      }),
    };

    const to: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
        post: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            title: col({ nativeType: 'text', codecId: 'pg/text@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
      }),
    };

    const result = planFromStorages(from, to);

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      const ops = (await Promise.all(
        result.plan.operations,
      )) as SqlMigrationPlanOperation<PostgresPlanTargetDetails>[];
      const tableOp = ops.find((op) => op.id.includes('post'));
      expect(tableOp).toBeDefined();
    }
  });

  it('detects multiple changes at once (table + unique + index)', async () => {
    const from: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
      }),
    };

    const to: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
        post: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            title: col({ nativeType: 'text', codecId: 'pg/text@1' }),
            slug: col({ nativeType: 'text', codecId: 'pg/text@1' }),
          },
          primaryKey: { columns: ['id'] },
          uniques: [{ columns: ['slug'] }],
          indexes: [{ name: 'post_title_idx', columns: ['title'], unique: false }],
        }),
      }),
    };

    const result = planFromStorages(from, to);

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      const ops = (await Promise.all(
        result.plan.operations,
      )) as SqlMigrationPlanOperation<PostgresPlanTargetDetails>[];
      expect(ops.length).toBeGreaterThanOrEqual(3);
      const ids = ops.map((op) => op.id);
      expect(ids.some((id) => id.includes('post'))).toBe(true);
      expect(ids.some((id) => id.includes('unique') || id.includes('slug'))).toBe(true);
      expect(ids.some((id) => id.includes('index') || id.includes('title'))).toBe(true);
    }
  });

  it('returns no ops when storages are identical', () => {
    const storage: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            email: col({ nativeType: 'text', codecId: 'pg/text@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
      }),
    };

    const result = planFromStorages(storage, storage);

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.plan.operations).toHaveLength(0);
    }
  });
});

describe('detectDestructiveChanges', () => {
  it('rejects column removal with conflict', () => {
    const from: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            email: col({ nativeType: 'text', codecId: 'pg/text@1' }),
            name: col({ nativeType: 'text', codecId: 'pg/text@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
      }),
    };

    const to: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            email: col({ nativeType: 'text', codecId: 'pg/text@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
      }),
    };

    const conflicts = detectDestructiveChanges(new SqlStorage(from), new SqlStorage(to));

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe('columnRemoved');
    expect(conflicts[0]!.summary).toContain('name');
  });

  it('rejects table removal with conflict', () => {
    const from: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: table({
          columns: { id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }) },
          primaryKey: { columns: ['id'] },
        }),
        post: table({
          columns: { id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }) },
          primaryKey: { columns: ['id'] },
        }),
      }),
    };

    const to: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: table({
          columns: { id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }) },
          primaryKey: { columns: ['id'] },
        }),
      }),
    };

    const conflicts = detectDestructiveChanges(new SqlStorage(from), new SqlStorage(to));

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe('tableRemoved');
    expect(conflicts[0]!.summary).toContain('post');
  });

  it('rejects multiple destructive changes with all conflicts', () => {
    const from: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            name: col({ nativeType: 'text', codecId: 'pg/text@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
        post: table({
          columns: { id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }) },
          primaryKey: { columns: ['id'] },
        }),
      }),
    };

    const to: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: table({
          columns: { id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }) },
          primaryKey: { columns: ['id'] },
        }),
      }),
    };

    const conflicts = detectDestructiveChanges(new SqlStorage(from), new SqlStorage(to));

    expect(conflicts).toHaveLength(2);
    const kinds = conflicts.map((c) => c.kind);
    expect(kinds).toContain('columnRemoved');
    expect(kinds).toContain('tableRemoved');
  });
});

describe('planner — type and nullability change behavior', () => {
  it('rejects type change (text → int4) as non-additive conflict', () => {
    const from: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            name: col({ nativeType: 'text', codecId: 'pg/text@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
      }),
    };

    const to: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            name: col({ nativeType: 'int4', codecId: 'pg/int4@1' }),
          },
          primaryKey: { columns: ['id'] },
        }),
      }),
    };

    const result = planFromStorages(from, to);

    expect(result.kind).toBe('failure');
    if (result.kind === 'failure') {
      expect(result.conflicts.length).toBeGreaterThanOrEqual(1);
      const typeConflict = result.conflicts.find(
        (c) => c.summary.includes('name') || c.summary.includes('type'),
      );
      expect(typeConflict).toBeDefined();
    }
  });

  it('rejects nullability tightening (nullable → non-nullable) as non-additive conflict', () => {
    const from: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            bio: col({ nativeType: 'text', codecId: 'pg/text@1', nullable: true }),
          },
          primaryKey: { columns: ['id'] },
        }),
      }),
    };

    const to: SqlStorageInput = {
      storageHash: coreHash('test'),
      ...ns({
        user: table({
          columns: {
            id: col({ nativeType: 'uuid', codecId: 'pg/uuid@1' }),
            bio: col({ nativeType: 'text', codecId: 'pg/text@1', nullable: false }),
          },
          primaryKey: { columns: ['id'] },
        }),
      }),
    };

    const result = planFromStorages(from, to);

    expect(result.kind).toBe('failure');
    if (result.kind === 'failure') {
      expect(result.conflicts.length).toBeGreaterThanOrEqual(1);
      const nullConflict = result.conflicts.find(
        (c) => c.summary.includes('bio') || c.summary.includes('null'),
      );
      expect(nullConflict).toBeDefined();
    }
  });
});

// --- Comprehensive incremental migration test (prisma-8-demo-like contract) ---

function createAdapterHooksComponent(): TargetBoundComponentDescriptor<'sql', string> {
  const parameterizedTypeHooks: CodecControlHooks = {
    expandNativeType: expandParameterizedNativeType,
  };

  // Intentionally minimal test double for planner/contractToSchemaIR wiring.
  // Concrete enum hook behavior is covered in adapter enum-control-hooks tests.
  const enumHooks: CodecControlHooks = {
    planTypeOperations: ({ typeName, typeInstance, schema, schemaName }) => {
      const values = typeInstance.typeParams?.['values'] as string[] | undefined;
      if (!values || values.length === 0) return { operations: [] };

      // The "enum already exists" signal lives in `nativeEnums` on the
      // per-schema `PostgresNamespaceSchemaNode`. The strategy layer hands
      // the hook that namespace node (the per-schema `SqlSchemaIR` shape),
      // so read the field directly off it.
      const existingEnumTypes = PostgresNamespaceSchemaNode.is(schema)
        ? schema.nativeEnums.map((e) => e.typeName)
        : [];

      if (existingEnumTypes.includes(typeInstance.nativeType)) {
        return { operations: [] };
      }

      return {
        operations: [
          {
            id: `type.${typeName}`,
            label: `Create type ${typeName}`,
            operationClass: 'additive' as const,
            target: { id: 'postgres' },
            precheck: [],
            execute: [
              {
                description: `create type "${typeName}"`,
                sql: `CREATE TYPE "${schemaName ?? 'public'}"."${typeInstance.nativeType}" AS ENUM (${values.map((v) => `'${v}'`).join(', ')})`,
              },
            ],
            postcheck: [],
          },
        ],
      };
    },
  };

  return {
    kind: 'adapter',
    id: 'test-adapter',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.0-test',
    types: {
      codecTypes: {
        controlPlaneHooks: {
          'sql/char@1': parameterizedTypeHooks,
          'pg/timestamptz-temporal@1': parameterizedTypeHooks,
          'app/test-type@1': enumHooks,
        },
      },
    },
  };
}

const DEMO_BASE_TABLES = {
  user: table({
    columns: {
      id: col({
        nativeType: 'character',
        codecId: 'sql/char@1',
        typeParams: { length: 36 },
      }),
      email: col({ nativeType: 'text', codecId: 'pg/text@1' }),
      createdAt: col({
        nativeType: 'timestamptz',
        codecId: 'pg/timestamptz-temporal@1',
        default: { kind: 'function', expression: 'now()' },
      }),
      kind: col({
        nativeType: 'user_type',
        codecId: 'app/test-type@1',
        typeRef: 'user_type',
      }),
    },
    primaryKey: { columns: ['id'] },
    uniques: [{ columns: ['email'] }],
  }),
  post: table({
    columns: {
      id: col({
        nativeType: 'character',
        codecId: 'sql/char@1',
        typeParams: { length: 36 },
      }),
      title: col({ nativeType: 'text', codecId: 'pg/text@1' }),
      userId: col({
        nativeType: 'character',
        codecId: 'sql/char@1',
        typeParams: { length: 36 },
      }),
      createdAt: col({
        nativeType: 'timestamptz',
        codecId: 'pg/timestamptz-temporal@1',
        default: { kind: 'function', expression: 'now()' },
      }),
      embedding: col({
        nativeType: 'vector',
        codecId: 'pg/vector@1',
        nullable: true,
      }),
    },
    primaryKey: { columns: ['id'] },
    foreignKeys: [
      {
        source: {
          namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
          tableName: 'post',
          columns: ['userId'],
        },
        target: {
          namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
          tableName: 'user',
          columns: ['id'],
        },
      },
    ],
  }),
};

const DEMO_BASE_STORAGE: SqlStorageInput = {
  storageHash: coreHash('test'),
  ...ns(DEMO_BASE_TABLES),
  types: {
    user_type: {
      kind: 'codec-instance',
      codecId: 'app/test-type@1',
      nativeType: 'user_type',
      typeParams: { values: ['admin', 'user'] },
    },
  },
};

function createDemoContract(
  storage: Omit<SqlStorageInput, 'storageHash'>,
  overrides?: Partial<Contract<SqlStorage>>,
): Contract<SqlStorage> {
  const storageHashValue = coreHash('demo');
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({ ...storage, storageHash: storageHashValue }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: { pgvector: {} },
    meta: {},
    ...overrides,
  };
}

// `user_type` is declared via `storage.types` (a codec-instance type managed
// by the test's `planTypeOperations` hook), not via `entries.native_enum` —
// so the app contract never "declares" it as a native_enum entity in the
// storage-entries sense. `contractToSchemaIR` still represents it as a live
// `enums` node (the signal `planTypeOperations` reads to skip a redundant
// CREATE TYPE), so without an ownership answer the differ would see an
// unpaired "extra" enum and plan a `dropNativeEnumType` for a type this
// space's own codec hook is actively managing. This oracle declares it owned,
// matching how a real `ContractSpaceAggregate` would answer once a pack
// declares the coordinate.
const ownsUserTypeEnum: SchemaOwnership = {
  declaresEntity: (coordinate) =>
    coordinate.entityKind === 'native_enum' && coordinate.entityName === 'user_type',
};

describe('incremental migration with full contract surface (enums, FKs)', () => {
  const frameworkComponents = [createAdapterHooksComponent(), pgvectorDescriptor];

  it('only emits ops for the actual change when adding a column to an existing table', async () => {
    const toStorage: Omit<SqlStorageInput, 'storageHash'> = {
      ...DEMO_BASE_STORAGE,
      ...ns({
        ...DEMO_BASE_TABLES,
        user: table({
          ...DEMO_BASE_TABLES['user']!,
          columns: {
            ...DEMO_BASE_TABLES['user']!.columns,
            name: col({ nativeType: 'text', codecId: 'pg/text@1', nullable: true }),
          },
        }),
      }),
    };

    const fromSchemaIR = contractToSchemaIR(createDemoContract(DEMO_BASE_STORAGE), {
      expandNativeType: expandParameterizedNativeType,
      renderDefault: postgresRenderDefault,
    });
    const toContract = createDemoContract(toStorage);
    const planner = createPostgresMigrationPlanner(testAdapter);

    const result = planner.plan({
      contract: toContract,
      schema: fromSchemaIR,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
      ownership: ownsUserTypeEnum,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }

    const ops = (await Promise.all(
      result.plan.operations,
    )) as SqlMigrationPlanOperation<PostgresPlanTargetDetails>[];
    const opIds = ops.map((op) => op.id);

    expect(opIds).toEqual(['column.__unbound__.user.name']);
    expect(opIds.filter((id) => id.startsWith('type.'))).toHaveLength(0);
  });

  it('produces no ops when from and to storages are identical (with types)', () => {
    const fromSchemaIR = contractToSchemaIR(createDemoContract(DEMO_BASE_STORAGE), {
      expandNativeType: expandParameterizedNativeType,
      renderDefault: postgresRenderDefault,
    });
    const toContract = createDemoContract(DEMO_BASE_STORAGE);
    const planner = createPostgresMigrationPlanner(testAdapter);

    const result = planner.plan({
      contract: toContract,
      schema: fromSchemaIR,
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
      ownership: ownsUserTypeEnum,
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }

    expect(result.plan.operations).toHaveLength(0);
  });

  it('emits all ops on initial migration from empty state', async () => {
    const fromSchemaIR = contractToSchemaIR(null, {
      expandNativeType: expandParameterizedNativeType,
      renderDefault: postgresRenderDefault,
    });
    const toContract = createDemoContract(DEMO_BASE_STORAGE);
    const planner = createPostgresMigrationPlanner(testAdapter);

    const result = planner.plan({
      contract: toContract,
      schema: fromSchemaIR,
      policy: { allowedOperationClasses: ['additive'] },
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error(`Expected success but got ${JSON.stringify(result)}`);
    }

    const ops = (await Promise.all(
      result.plan.operations,
    )) as SqlMigrationPlanOperation<PostgresPlanTargetDetails>[];
    const opIds = ops.map((op) => op.id);
    expect(opIds.some((id) => id.startsWith('type.'))).toBe(true);
    expect(opIds.some((id) => id.startsWith('table.'))).toBe(true);
  });

  it('the family contractToSchemaIR derives annotations from contract storage types', () => {
    const schemaIR = contractToSchemaIRImpl(createDemoContract(DEMO_BASE_STORAGE), {
      annotationNamespace: 'pg',
      expandNativeType: expandParameterizedNativeType,
      renderDefault: postgresRenderDefault,
    });
    const pgAnnotations = schemaIR.annotations?.['pg'] as Record<string, unknown> | undefined;
    const storageTypes = pgAnnotations?.['storageTypes'] as Record<string, unknown> | undefined;
    expect(storageTypes).toBeDefined();
    expect(storageTypes?.['user_type']).toMatchObject({
      codecId: 'app/test-type@1',
      nativeType: 'user_type',
    });
  });
});
