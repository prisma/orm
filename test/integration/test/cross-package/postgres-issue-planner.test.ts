import postgresAdapterControl, {
  createPostgresBuiltinCodecLookup,
  PostgresControlAdapter,
} from '@internal/adapter-postgres/control';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { sqlTypeLookupsOf } from '@internal/family-sql/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  SqlStorage,
  type SqlStorageInput,
  type StorageTableInput,
} from '@internal/sql-contract/types';
import postgresTargetControl from '@internal/target-postgres/control';
import { createPostgresBuiltinDataTypeLookup } from '@internal/target-postgres/data-types';
import { buildPostgresPlanDiff } from '@internal/target-postgres/diff-database-schema';
import { coalesceSubtreeIssues, planIssues } from '@internal/target-postgres/issue-planner';
import type { CreateTableCall } from '@internal/target-postgres/op-factory-call';
import { createPostgresMigrationPlanner } from '@internal/target-postgres/planner';
import { renderCallsToTypeScript } from '@internal/target-postgres/render-typescript';
import {
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
  PostgresSchema,
  PostgresTableSchemaNode,
  PostgresUnboundSchema,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';

const testAdapter = new PostgresControlAdapter(
  createPostgresBuiltinCodecLookup(),
  createPostgresBuiltinDataTypeLookup(),
);
const frameworkComponents = [postgresTargetControl, postgresAdapterControl];

function makeContract(
  overrides: {
    entries?: {
      table?: Record<string, StorageTableInput>;
    };
  } = {},
): Contract<SqlStorage> {
  const { table = {} } = overrides.entries ?? {};
  const unboundNs = postgresCreateNamespace({
    id: UNBOUND_NAMESPACE_ID,
    entries: { table },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash('contract'),
      namespaces: { [UNBOUND_NAMESPACE_ID]: unboundNs },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

/** An empty introspected tree — every table in `contract` surfaces as `not-found`. */
const emptyRoot = new PostgresDatabaseSchemaNode({
  namespaces: {},
  roles: [],
  existingSchemas: ['public'],
  pgVersion: 'unknown',
});

/**
 * Diffs `contract` against `actual` via the one differ, coalesces the
 * redundant subtree issues (the differ is total), and plans the node issues
 * with the real strategy list unless `strategies` overrides it. Mirrors the
 * production wiring in `PostgresMigrationPlanner.planSql`.
 */
function planAgainst(
  contract: Contract<SqlStorage>,
  actual: PostgresDatabaseSchemaNode,
  options: {
    readonly fromContract?: Contract<SqlStorage> | null;
    readonly strategies?: readonly [];
  } = {},
) {
  const { issues } = buildPostgresPlanDiff({
    contract,
    actualSchema: actual,
    frameworkComponents,
  });
  const coalesced = coalesceSubtreeIssues(issues);
  return planIssues({
    issues: coalesced,
    toContract: contract,
    fromContract: options.fromContract ?? null,
    schemaName: 'public',
    codecHooks: new Map(),
    types: sqlTypeLookupsOf(frameworkComponents),
    storageTypes: contract.storage.types ?? {},
    ...(options.strategies !== undefined ? { strategies: options.strategies } : {}),
  });
}

describe('planIssues', () => {
  describe('missing_table', () => {
    it('emits CreateTableCall with columns', () => {
      const toContract = makeContract({
        entries: {
          table: {
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
          },
        },
      });

      const result = planAgainst(toContract, emptyRoot);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.calls).toHaveLength(1);
      expect(result.value.calls[0]).toMatchObject({
        factoryName: 'createTable',
        tableName: 'user',
        operationClass: 'additive',
      });
    });
  });

  describe('notNullBackfill call strategy', () => {
    function contractWithStatus(): Contract<SqlStorage> {
      return makeContract({
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                status: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });
    }

    function actualWithoutStatus(): PostgresDatabaseSchemaNode {
      return new PostgresDatabaseSchemaNode({
        namespaces: {
          public: new PostgresNamespaceSchemaNode({
            schemaName: 'public',
            tables: {
              user: new PostgresTableSchemaNode({
                name: 'user',
                columns: {
                  id: {
                    name: 'id',
                    nativeType: 'uuid',
                    nullable: false,
                    resolvedNativeType: 'uuid',
                  },
                },
                primaryKey: { columns: ['id'] },
                foreignKeys: [],
                uniques: [],
                indexes: [],
                policies: [],
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

    it('emits AddColumnCall(nullable) + DataTransformCall + SetNotNullCall', () => {
      const result = planAgainst(contractWithStatus(), actualWithoutStatus());

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls).toHaveLength(3);
      expect(calls[0]).toMatchObject({ factoryName: 'addColumn' });
      expect(calls[1]).toMatchObject({ factoryName: 'dataTransform' });
      expect(calls[2]).toMatchObject({ factoryName: 'setNotNull' });
    });

    it('DataTransformCall.toOp() throws MIGRATION.UNFILLED_PLACEHOLDER', () => {
      const result = planAgainst(contractWithStatus(), actualWithoutStatus());

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const dtCall = result.value.calls[1]!;
      expect(dtCall.factoryName).toBe('dataTransform');
      expect(() => dtCall.toOp()).toThrow(
        expect.objectContaining({ code: 'MIGRATION.UNFILLED_PLACEHOLDER' }),
      );
    });
  });

  describe('nullableTightening call strategy', () => {
    it('emits DataTransformCall + SetNotNullCall', () => {
      const toContract = makeContract({
        entries: {
          table: {
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
          },
        },
      });
      const actual = new PostgresDatabaseSchemaNode({
        namespaces: {
          public: new PostgresNamespaceSchemaNode({
            schemaName: 'public',
            tables: {
              user: new PostgresTableSchemaNode({
                name: 'user',
                columns: {
                  id: {
                    name: 'id',
                    nativeType: 'uuid',
                    nullable: false,
                    resolvedNativeType: 'uuid',
                  },
                  email: {
                    name: 'email',
                    nativeType: 'text',
                    nullable: true,
                    resolvedNativeType: 'text',
                  },
                },
                primaryKey: { columns: ['id'] },
                foreignKeys: [],
                uniques: [],
                indexes: [],
                policies: [],
                rlsEnabled: false,
              }),
            },
          }),
        },
        roles: [],
        existingSchemas: ['public'],
        pgVersion: 'unknown',
      });

      const result = planAgainst(toContract, actual);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({ factoryName: 'dataTransform' });
      expect(calls[1]).toMatchObject({ factoryName: 'setNotNull' });
    });
  });

  describe('typeChange call strategy', () => {
    function actualWithAge(nativeType: string, codecId: string): PostgresDatabaseSchemaNode {
      return new PostgresDatabaseSchemaNode({
        namespaces: {
          public: new PostgresNamespaceSchemaNode({
            schemaName: 'public',
            tables: {
              user: new PostgresTableSchemaNode({
                name: 'user',
                columns: {
                  id: {
                    name: 'id',
                    nativeType: 'uuid',
                    nullable: false,
                    resolvedNativeType: 'uuid',
                  },
                  age: {
                    name: 'age',
                    nativeType,
                    nullable: false,
                    resolvedNativeType: nativeType,
                    codecRef: { codecId },
                  },
                },
                primaryKey: { columns: ['id'] },
                foreignKeys: [],
                uniques: [],
                indexes: [],
                policies: [],
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

    it('emits AlterColumnTypeCall for safe widening', () => {
      const toContract = makeContract({
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                age: { nativeType: 'int8', codecId: 'pg/int8@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });

      // `typeChangeCallStrategy` only fires when the planner has a prior
      // contract (`migration plan`); any non-null contract satisfies the
      // gate, it is never otherwise read by this strategy.
      const result = planAgainst(toContract, actualWithAge('int4', 'pg/int4@1'), {
        fromContract: toContract,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ factoryName: 'alterColumnType' });
    });

    it('emits DataTransformCall + AlterColumnTypeCall for unsafe change', () => {
      const toContract = makeContract({
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                age: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });

      const result = planAgainst(toContract, actualWithAge('int4', 'pg/int4@1'), {
        fromContract: toContract,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({ factoryName: 'dataTransform' });
      expect(calls[1]).toMatchObject({ factoryName: 'alterColumnType' });
    });
  });

  describe('index missing on an existing table', () => {
    function actualDocWithoutIndex(): PostgresDatabaseSchemaNode {
      return new PostgresDatabaseSchemaNode({
        namespaces: {
          public: new PostgresNamespaceSchemaNode({
            schemaName: 'public',
            tables: {
              doc: new PostgresTableSchemaNode({
                name: 'doc',
                columns: {
                  id: {
                    name: 'id',
                    nativeType: 'uuid',
                    nullable: false,
                    resolvedNativeType: 'uuid',
                  },
                  body: {
                    name: 'body',
                    nativeType: 'text',
                    nullable: false,
                    resolvedNativeType: 'text',
                  },
                },
                primaryKey: { columns: ['id'] },
                foreignKeys: [],
                uniques: [],
                indexes: [],
                policies: [],
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

    it('threads contract index type and options into CreateIndexCall', () => {
      const toContract = makeContract({
        entries: {
          table: {
            doc: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                body: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [
                {
                  name: 'doc_body_gin_idx',
                  columns: ['body'],
                  unique: false,
                  type: 'gin',
                  options: { fastupdate: false },
                },
              ],
              foreignKeys: [],
            },
          },
        },
      });

      const result = planAgainst(toContract, actualDocWithoutIndex());

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.calls).toHaveLength(1);
      expect(result.value.calls[0]).toMatchObject({
        factoryName: 'createIndex',
        tableName: 'doc',
        indexType: 'gin',
        options: { fastupdate: false },
      });
    });

    it('uses the contract index name when set', () => {
      const toContract = makeContract({
        entries: {
          table: {
            doc: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                body: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [
                {
                  columns: ['body'],
                  name: 'doc_body_bm25_idx',
                  unique: false,
                  type: 'bm25',
                  options: { key_field: 'id' },
                },
              ],
              foreignKeys: [],
            },
          },
        },
      });

      const result = planAgainst(toContract, actualDocWithoutIndex());

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.calls[0]).toMatchObject({
        factoryName: 'createIndex',
        tableName: 'doc',
        indexName: 'doc_body_bm25_idx',
        indexType: 'bm25',
        options: { key_field: 'id' },
      });
    });

    it('falls back to a default index name when the contract index has no name', () => {
      const toContract = makeContract({
        entries: {
          table: {
            doc: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                body: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [{ name: 'doc_body_idx', columns: ['body'], unique: false }],
              foreignKeys: [],
            },
          },
        },
      });

      const result = planAgainst(toContract, actualDocWithoutIndex());

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.value.calls[0]).toMatchObject({
        factoryName: 'createIndex',
        tableName: 'doc',
        indexName: 'doc_body_idx',
        indexType: undefined,
        options: undefined,
      });
    });
  });

  describe('strategies override', () => {
    it('bypasses data-safety strategies when strategies: [] is passed', () => {
      const toContract = makeContract({
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                status: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });
      const actual = new PostgresDatabaseSchemaNode({
        namespaces: {
          public: new PostgresNamespaceSchemaNode({
            schemaName: 'public',
            tables: {
              user: new PostgresTableSchemaNode({
                name: 'user',
                columns: {
                  id: {
                    name: 'id',
                    nativeType: 'uuid',
                    nullable: false,
                    resolvedNativeType: 'uuid',
                  },
                },
                primaryKey: { columns: ['id'] },
                foreignKeys: [],
                uniques: [],
                indexes: [],
                policies: [],
                rlsEnabled: false,
              }),
            },
          }),
        },
        roles: [],
        existingSchemas: ['public'],
        pgVersion: 'unknown',
      });

      const result = planAgainst(toContract, actual, { strategies: [] });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const calls = result.value.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ factoryName: 'addColumn' });
      expect(calls.some((c) => c.factoryName === 'dataTransform')).toBe(false);
      expect(calls.some((c) => c.factoryName === 'setNotNull')).toBe(false);
    });
  });

  describe('renderTypeScript round-trip', () => {
    it('renders calls to valid TypeScript', () => {
      const toContract = makeContract({
        entries: {
          table: {
            user: {
              columns: {
                id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
                status: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });
      const actual = new PostgresDatabaseSchemaNode({
        namespaces: {
          public: new PostgresNamespaceSchemaNode({
            schemaName: 'public',
            tables: {
              user: new PostgresTableSchemaNode({
                name: 'user',
                columns: {
                  id: {
                    name: 'id',
                    nativeType: 'uuid',
                    nullable: false,
                    resolvedNativeType: 'uuid',
                  },
                },
                primaryKey: { columns: ['id'] },
                foreignKeys: [],
                uniques: [],
                indexes: [],
                policies: [],
                rlsEnabled: false,
              }),
            },
          }),
        },
        roles: [],
        existingSchemas: ['public'],
        pgVersion: 'unknown',
      });

      const result = planAgainst(toContract, actual);
      if (!result.ok) throw new Error('expected ok');

      const ts = renderCallsToTypeScript(result.value.calls, {
        from: 'a'.repeat(64),
        to: 'b'.repeat(64),
        snapshotsImportPath: '../../snapshots',
      });

      expect(ts).toContain('export default class M extends Migration');
      expect(ts).toContain('addColumn(');
      expect(ts).toContain('this.dataTransform(');
      expect(ts).toContain('placeholder(');
      expect(ts).toContain('setNotNull(');
      expect(ts).toContain("from '@internal/postgres/migration'");
    });
  });

  describe('missing_schema', () => {
    function makeNamespacedContract(
      namespaces: Record<string, { entries: { table: Record<string, StorageTableInput> } }>,
    ): Contract<SqlStorage> {
      const nsMap: SqlStorageInput['namespaces'] = {
        [UNBOUND_NAMESPACE_ID]: PostgresUnboundSchema.instance,
        ...Object.fromEntries(
          Object.entries(namespaces).map(([id, ns]) => [
            id,
            new PostgresSchema({ id, entries: { table: ns.entries.table } }),
          ]),
        ),
      };
      return {
        target: 'postgres',
        targetFamily: 'sql',
        profileHash: profileHash('test'),
        storage: new SqlStorage({
          storageHash: coreHash('contract'),
          namespaces: nsMap,
        }),
        roots: {},
        domain: applicationDomainOf({ models: {} }),
        capabilities: {},
        extensions: {},
        meta: {},
      };
    }

    /**
     * Runs the FULL production wiring through `PostgresMigrationPlanner.plan`
     * (the namespace-presence stitch, prepended internally, is a private
     * implementation detail — exercising it through the public planner is
     * the faithful way to pin its behaviour).
     */
    async function planWithNamespaceStitch(
      contract: Contract<SqlStorage>,
      actual: PostgresDatabaseSchemaNode,
    ) {
      const planner = createPostgresMigrationPlanner(testAdapter);
      const result = planner.plan({
        contract,
        schema: actual,
        policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
        fromContract: null,
        frameworkComponents,
        spaceId: 'app',
        snapshotsImportPath: '../../snapshots',
      });
      if (result.kind !== 'success') throw new Error('expected planner success');
      return await Promise.all(result.plan.operations);
    }

    it('translates a missing schema into a CREATE SCHEMA op ordered before the table', async () => {
      const userTable: StorageTableInput = {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };
      const toContract = makeNamespacedContract({
        auth: { entries: { table: { user: userTable } } },
      });
      const actual = new PostgresDatabaseSchemaNode({
        namespaces: {},
        roles: [],
        existingSchemas: ['public'],
        pgVersion: 'unknown',
      });

      const ops = await planWithNamespaceStitch(toContract, actual);
      const opIds = ops.map((op) => op.id);

      const createSchemaIdx = opIds.findIndex((id) => id.startsWith('schema.'));
      const createTableIdx = opIds.findIndex((id) => id.startsWith('table.'));
      expect(createSchemaIdx).toBeGreaterThanOrEqual(0);
      expect(createTableIdx).toBeGreaterThanOrEqual(0);
      expect(createSchemaIdx).toBeLessThan(createTableIdx);
      expect(opIds[createSchemaIdx]).toBe('schema.auth');
    });

    it('emits a CREATE SCHEMA IF NOT EXISTS DDL statement', async () => {
      const toContract = makeNamespacedContract({ auth: { entries: { table: {} } } });
      const actual = new PostgresDatabaseSchemaNode({
        namespaces: {},
        roles: [],
        existingSchemas: ['public'],
        pgVersion: 'unknown',
      });

      const ops = await planWithNamespaceStitch(toContract, actual);
      const createSchemaOp = ops.find((op) => op.id === 'schema.auth');
      expect(createSchemaOp).toBeDefined();
      expect(createSchemaOp?.execute?.[0]?.sql).toContain('CREATE SCHEMA IF NOT EXISTS "auth"');
    });
  });

  describe('multi-namespace DDL qualification', () => {
    it('emits correctly-qualified DDL for each same-named table under its own namespace', () => {
      const userTable: StorageTableInput = {
        columns: {
          id: { nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };
      const toContract: Contract<SqlStorage> = {
        target: 'postgres',
        targetFamily: 'sql',
        profileHash: profileHash('test'),
        storage: new SqlStorage({
          storageHash: coreHash('multi-namespace-contract'),
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: PostgresUnboundSchema.instance,
            tenant_a: new PostgresSchema({
              id: 'tenant_a',
              entries: { table: { users: userTable } },
            }),
            tenant_b: new PostgresSchema({
              id: 'tenant_b',
              entries: { table: { users: userTable } },
            }),
          },
        }),
        roots: {},
        domain: applicationDomainOf({ models: {} }),
        capabilities: {},
        extensions: {},
        meta: {},
      };
      const actual = new PostgresDatabaseSchemaNode({
        namespaces: {},
        roles: [],
        existingSchemas: ['public', 'tenant_a', 'tenant_b'],
        pgVersion: 'unknown',
      });

      const result = planAgainst(toContract, actual);

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      const createTableCalls = result.value.calls.filter(
        (c) => c.factoryName === 'createTable',
      ) as CreateTableCall[];
      expect(createTableCalls).toHaveLength(2);
      expect(createTableCalls.map((c) => `${c.schemaName}.${c.tableName}`).sort()).toEqual([
        'tenant_a.users',
        'tenant_b.users',
      ]);
    });
  });
});
