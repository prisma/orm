import {
  createPostgresBuiltinCodecLookup,
  PostgresControlAdapter,
} from '@internal/adapter-postgres/control';
import {
  asNamespaceId,
  type ColumnDefaultLiteralInputValue,
  type Contract,
  coreHash,
  profileHash,
} from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import { type CodecControlHooks, INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type SqlStorageInput, type StorageTable } from '@internal/sql-contract/types';
import { createPostgresMigrationPlanner } from '@internal/target-postgres/planner';
import { buildBuiltinIdentityValue } from '@internal/target-postgres/planner-identity-values';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import {
  PostgresDatabaseSchemaNode,
  PostgresNamespaceSchemaNode,
  PostgresTableSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import pgvectorDescriptor from '../../src/exports/control';

const testAdapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());

describe('PostgresMigrationPlanner - subset/superset/conflict handling', () => {
  const planner = createPostgresMigrationPlanner(testAdapter);
  const contract = createTestContract();

  it('returns empty plan when schema already satisfies contract (superset)', () => {
    const schema = new PostgresDatabaseSchemaNode({
      namespaces: {
        public: new PostgresNamespaceSchemaNode({
          schemaName: 'public',
          tables: {
            user: buildUserTableSchema(),
            post: buildPostTableSchema(),
            extra: new PostgresTableSchemaNode({
              name: 'extra',
              columns: {
                id: { name: 'id', nativeType: 'uuid', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              foreignKeys: [],
              indexes: [],
              rlsEnabled: false,
            }),
          },
        }),
      },
      roles: [],
      existingSchemas: [],
      pgVersion: '',
    });

    const result = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result).toMatchObject({
      kind: 'success',
      plan: { operations: [] },
    });
  });

  it('plans additive operations for subset schema (missing column/index/fk)', async () => {
    const schema = new PostgresDatabaseSchemaNode({
      namespaces: {
        public: new PostgresNamespaceSchemaNode({
          schemaName: 'public',
          tables: {
            user: new PostgresTableSchemaNode({
              name: 'user',
              columns: {
                id: { name: 'id', nativeType: 'uuid', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              foreignKeys: [],
              indexes: [],
              rlsEnabled: false,
            }),
          },
        }),
      },
      roles: [],
      existingSchemas: [],
      pgVersion: '',
    });

    const result = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') {
      throw new Error('expected planner success for additive subset');
    }
    const ops = await Promise.all(result.plan.operations);
    expect(ops.map((op) => op.id)).toEqual([
      'table.post',
      'column.user.email',
      'unique.user.user_email_key',
      'index.post.post_userId_idx',
      'index.user.user_email_idx',
      'foreignKey.post.post_userId_fkey',
    ]);
  });

  it('fails with conflicts when schema has incompatible column types', () => {
    const schema = new PostgresDatabaseSchemaNode({
      namespaces: {
        public: new PostgresNamespaceSchemaNode({
          schemaName: 'public',
          tables: {
            user: new PostgresTableSchemaNode({
              name: 'user',
              columns: {
                id: { name: 'id', nativeType: 'uuid', nullable: false },
                email: { name: 'email', nativeType: 'uuid', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              foreignKeys: [],
              indexes: [],
              rlsEnabled: false,
            }),
          },
        }),
      },
      roles: [],
      existingSchemas: [],
      pgVersion: '',
    });

    const result = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: [],
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });

    expect(result).toMatchObject({
      kind: 'failure',
      conflicts: [
        expect.objectContaining({
          kind: 'typeMismatch',
          location: {
            entityKind: 'table',
            entityName: 'user',
            column: 'email',
          },
        }),
      ],
    });
  });
});

describe('NOT NULL column without default uses temporary default', () => {
  const qualifiedUserTable = '"user"';

  it('emits 2-step execute (add with temp default, drop default) for NOT NULL text column', async () => {
    const addCol = await planAddColumn('name', {
      many: false,
      nativeType: 'text',
      codecId: 'pg/text@1',
      nullable: false,
    });

    // No empty-table precheck
    expect(addCol.precheck.map((p) => p.sql)).not.toContain(
      `SELECT NOT EXISTS (SELECT 1 AS "one" FROM ${qualifiedUserTable} LIMIT 1) AS "result"`,
    );

    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "name" text DEFAULT ('') NOT NULL`,
      `ALTER TABLE ${qualifiedUserTable} ALTER COLUMN "name" DROP DEFAULT`,
    ]);

    // Postcheck includes verification that temporary default was removed
    expect(addCol.postcheck.map((p) => p.description)).toContainEqual(
      expect.stringContaining('no default'),
    );
  });

  it('emits 2-step execute for NOT NULL int4 column', async () => {
    const addCol = await planAddColumn('age', {
      many: false,
      nativeType: 'int4',
      codecId: 'pg/int4@1',
      nullable: false,
    });

    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "age" int4 DEFAULT (0) NOT NULL`,
      `ALTER TABLE ${qualifiedUserTable} ALTER COLUMN "age" DROP DEFAULT`,
    ]);
  });

  it('uses length-aware temporary defaults for fixed-length bit columns', async () => {
    const addCol = await planAddColumn(
      'flags',
      {
        many: false,
        nativeType: 'bit',
        codecId: 'pg/bit@1',
        nullable: false,
        typeParams: { length: 4 },
      },
      {
        frameworkComponents: [
          createPlannerControlHookComponent('pg/bit@1', {
            expandNativeType: ({ nativeType, typeParams }) =>
              `${nativeType}(${String(typeParams?.['length'])})`,
          }),
        ],
      },
    );

    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "flags" bit(4) DEFAULT (B'0000') NOT NULL`,
      `ALTER TABLE ${qualifiedUserTable} ALTER COLUMN "flags" DROP DEFAULT`,
    ]);
  });

  it('uses empty-array temporary defaults for NOT NULL array columns', async () => {
    const addCol = await planAddColumn('tags', {
      many: false,
      nativeType: 'text[]',
      codecId: 'pg/text-array@1',
      nullable: false,
    });

    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "tags" text[] DEFAULT ('{}') NOT NULL`,
      `ALTER TABLE ${qualifiedUserTable} ALTER COLUMN "tags" DROP DEFAULT`,
    ]);
  });

  it('uses built-in temporary defaults for NOT NULL tsvector columns', async () => {
    const addCol = await planAddColumn('searchDocument', {
      many: false,
      nativeType: 'tsvector',
      codecId: 'pg/tsvector@1',
      nullable: false,
    });

    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "searchDocument" tsvector DEFAULT (''::tsvector) NOT NULL`,
      `ALTER TABLE ${qualifiedUserTable} ALTER COLUMN "searchDocument" DROP DEFAULT`,
    ]);
  });

  it('uses a json-typed identity literal for NOT NULL json columns', async () => {
    const addCol = await planAddColumn('metadata', {
      many: false,
      nativeType: 'json',
      codecId: 'pg/json@1',
      nullable: false,
    });

    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "metadata" json DEFAULT ('{}'::json) NOT NULL`,
      `ALTER TABLE ${qualifiedUserTable} ALTER COLUMN "metadata" DROP DEFAULT`,
    ]);
  });

  it('uses explicit UTC-offset temporary defaults for NOT NULL timetz columns', async () => {
    const addCol = await planAddColumn('opensAt', {
      many: false,
      nativeType: 'timetz',
      codecId: 'pg/timetz@1',
      nullable: false,
    });

    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "opensAt" timetz DEFAULT ('00:00:00+00') NOT NULL`,
      `ALTER TABLE ${qualifiedUserTable} ALTER COLUMN "opensAt" DROP DEFAULT`,
    ]);
  });

  it('uses codec hook temporary defaults for parameterized pgvector columns', async () => {
    const addCol = await planAddColumn(
      'embedding',
      {
        many: false,
        nativeType: 'vector',
        codecId: 'pg/vector@1',
        nullable: false,
        typeParams: { length: 3 },
      },
      { frameworkComponents: [pgvectorDescriptor] },
    );

    expect(addCol.precheck.map((p) => p.sql)).not.toContain(
      `SELECT NOT EXISTS (SELECT 1 AS "one" FROM ${qualifiedUserTable} LIMIT 1) AS "result"`,
    );
    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "embedding" vector(3) DEFAULT ('[0,0,0]'::vector) NOT NULL`,
      `ALTER TABLE ${qualifiedUserTable} ALTER COLUMN "embedding" DROP DEFAULT`,
    ]);
  });

  it('uses codec hook temporary defaults for parameterized pgvector storage type refs', async () => {
    const addCol = await planAddColumn(
      'embedding',
      {
        many: false,
        nativeType: 'vector',
        codecId: 'pg/vector@1',
        nullable: false,
        typeRef: 'Embedding3',
      },
      {
        frameworkComponents: [pgvectorDescriptor],
        extraStorageTypes: {
          Embedding3: {
            kind: 'codec-instance',
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 3 },
          },
        },
      },
    );

    expect(addCol.precheck.map((p) => p.sql)).not.toContain(
      `SELECT NOT EXISTS (SELECT 1 AS "one" FROM ${qualifiedUserTable} LIMIT 1) AS "result"`,
    );
    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "embedding" vector(3) DEFAULT ('[0,0,0]'::vector) NOT NULL`,
      `ALTER TABLE ${qualifiedUserTable} ALTER COLUMN "embedding" DROP DEFAULT`,
    ]);
  });

  it('uses the empty-table fallback when a codec hook declines a temporary default', async () => {
    const addCol = await planAddColumn(
      'name',
      { many: false, nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      {
        frameworkComponents: [
          createPlannerControlHookComponent('pg/text@1', {
            resolveIdentityValue: () => null,
          }),
        ],
      },
    );

    expect(addCol.precheck.map((p) => p.sql)).toContain(
      `SELECT NOT EXISTS (SELECT 1 AS "one" FROM ${qualifiedUserTable} LIMIT 1) AS "result"`,
    );
    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "name" text NOT NULL`,
    ]);
  });

  it('uses the empty-table fallback when the new column becomes a primary key later in the same plan', async () => {
    const operationsPromise = planUserTableOperations(
      {
        columns: {
          id: { many: false, nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          slug: { many: false, nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['slug'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
      new PostgresTableSchemaNode({
        name: 'user',
        columns: { id: { name: 'id', nativeType: 'uuid', nullable: false } },
        uniques: [],
        foreignKeys: [],
        indexes: [],
        rlsEnabled: false,
      }),
    );

    const addCol = await getRequiredOperation(operationsPromise, 'column.user.slug');
    expect(addCol.precheck.map((p) => p.sql)).toContain(
      `SELECT NOT EXISTS (SELECT 1 AS "one" FROM ${qualifiedUserTable} LIMIT 1) AS "result"`,
    );
    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "slug" text NOT NULL`,
    ]);
    const operations = await operationsPromise;
    expect(operations.map((op) => op.id)).toContain('primaryKey.user.user_pkey');
  });

  it('uses the empty-table fallback when the new column becomes unique later in the same plan', async () => {
    const operationsPromise = planUserTableOperations(
      {
        columns: {
          id: { many: false, nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          slug: { many: false, nativeType: 'text', codecId: 'pg/text@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [{ columns: ['slug'] }],
        indexes: [],
        foreignKeys: [],
      },
      buildUserTableSchemaWithoutEmail(),
    );

    const addCol = await getRequiredOperation(operationsPromise, 'column.user.slug');
    expect(addCol.precheck.map((p) => p.sql)).toContain(
      `SELECT NOT EXISTS (SELECT 1 AS "one" FROM ${qualifiedUserTable} LIMIT 1) AS "result"`,
    );
    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "slug" text NOT NULL`,
    ]);
    const operations = await operationsPromise;
    expect(operations.map((op) => op.id)).toContain('unique.user.user_slug_key');
  });

  it('uses the empty-table fallback when the new column becomes a foreign key later in the same plan', async () => {
    const operationsPromise = planUserTableOperations(
      {
        columns: {
          id: { many: false, nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
          orgId: { many: false, nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [
          {
            source: {
              namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
              tableName: 'user',
              columns: ['orgId'],
            },
            target: {
              namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
              tableName: 'org',
              columns: ['id'],
            },
          },
        ],
      },
      buildUserTableSchemaWithoutEmail(),
      {
        extraContractTables: {
          org: {
            columns: {
              id: { many: false, nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
        extraSchemaTables: {
          org: new PostgresTableSchemaNode({
            name: 'org',
            columns: {
              id: { name: 'id', nativeType: 'uuid', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            foreignKeys: [],
            indexes: [],
            rlsEnabled: false,
          }),
        },
      },
    );

    const addCol = await getRequiredOperation(operationsPromise, 'column.user.orgId');
    expect(addCol.precheck.map((p) => p.sql)).toContain(
      `SELECT NOT EXISTS (SELECT 1 AS "one" FROM ${qualifiedUserTable} LIMIT 1) AS "result"`,
    );
    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "orgId" uuid NOT NULL`,
    ]);
    const operations = await operationsPromise;
    expect(operations.map((op) => op.id)).toContain('foreignKey.user.user_orgId_fkey');
  });

  it('skips temporary default for nullable columns', async () => {
    const addCol = await planAddColumn('bio', {
      many: false,
      nativeType: 'text',
      codecId: 'pg/text@1',
      nullable: true,
    });

    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "bio" text`,
    ]);
  });

  it('skips temporary default for NOT NULL columns with explicit default', async () => {
    const addCol = await planAddColumn('active', {
      many: false,
      nativeType: 'bool',
      codecId: 'pg/bool@1',
      nullable: false,
      default: { kind: 'literal', value: true },
    });

    expect(addCol.execute.map((step) => step.sql)).toEqual([
      `ALTER TABLE ${qualifiedUserTable} ADD COLUMN "active" bool DEFAULT true NOT NULL`,
    ]);
  });
});

describe('buildBuiltinIdentityValue (built-in fallback)', () => {
  it.each([
    ['text', undefined, "''"],
    ['character', undefined, "''"],
    ['bpchar', undefined, "''"],
    ['character varying', undefined, "''"],
    ['varchar', undefined, "''"],
    ['int2', undefined, '0'],
    ['int4', undefined, '0'],
    ['int8', undefined, '0'],
    ['integer', undefined, '0'],
    ['bigint', undefined, '0'],
    ['smallint', undefined, '0'],
    ['float4', undefined, '0'],
    ['float8', undefined, '0'],
    ['real', undefined, '0'],
    ['double precision', undefined, '0'],
    ['numeric', undefined, '0'],
    ['decimal', undefined, '0'],
    ['bool', undefined, 'false'],
    ['boolean', undefined, 'false'],
    ['uuid', undefined, "'00000000-0000-0000-0000-000000000000'"],
    ['json', undefined, "'{}'::json"],
    ['jsonb', undefined, "'{}'::jsonb"],
    ['date', undefined, "'epoch'"],
    ['timestamp', undefined, "'epoch'"],
    ['timestamptz', undefined, "'epoch'"],
    ['time', undefined, "'00:00:00'"],
    ['time without time zone', undefined, "'00:00:00'"],
    ['timetz', undefined, "'00:00:00+00'"],
    ['time with time zone', undefined, "'00:00:00+00'"],
    ['interval', undefined, "'0'"],
    ['bytea', undefined, "''::bytea"],
    ['tsvector', undefined, "''::tsvector"],
    ['bit', undefined, "B'0'"],
    ['bit', { length: 4 }, "B'0000'"],
    ['bit varying', undefined, "B''"],
    ['varbit', undefined, "B''"],
    ['int4[]', undefined, "'{}'"],
    ['text[]', undefined, "'{}'"],
  ] as const)('returns %s with %j → %s', (nativeType, typeParams, expected) => {
    expect(buildBuiltinIdentityValue(nativeType, typeParams)).toBe(expected);
  });

  it('returns null for unknown types (enum, array, extension)', () => {
    expect(buildBuiltinIdentityValue('my_enum')).toBeNull();
    expect(buildBuiltinIdentityValue('tsquery')).toBeNull();
    expect(buildBuiltinIdentityValue('vector')).toBeNull();
    expect(buildBuiltinIdentityValue('bit', { length: 0 })).toBeNull();
  });
});

function createTestContract(
  overrides?: Partial<Omit<Contract<SqlStorage>, 'storage'>> & {
    storage?: Partial<Omit<SqlStorageInput, 'storageHash'>>;
  },
): Contract<SqlStorage> {
  const storageHashValue = coreHash('contract');
  const defaultTables = {
    user: {
      columns: {
        id: { many: false, nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        email: { many: false, nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      },
      primaryKey: { columns: ['id'] },
      uniques: [{ columns: ['email'] }],
      indexes: [{ name: 'user_email_idx', columns: ['email'], unique: false }],
      foreignKeys: [],
    },
    post: {
      columns: {
        id: { many: false, nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        userId: { many: false, nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        title: { many: false, nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      },
      primaryKey: { columns: ['id'] },
      uniques: [],
      // FK1: the backing index for the default (`index: true`) FK below is a
      // discrete, named entity materialized at contract emit — declared here
      // directly rather than relying on planner-time synthesis.
      indexes: [{ columns: ['userId'], name: 'post_userId_idx', unique: false }],
      foreignKeys: [
        {
          source: {
            namespaceId: UNBOUND_NAMESPACE_ID,
            tableName: 'post',
            columns: ['userId'],
          },
          target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
        },
      ],
    },
  };
  const storageInput = overrides?.storage ?? {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
        id: UNBOUND_NAMESPACE_ID,
        entries: { table: defaultTables },
      }),
    },
  };
  const { storage: _s, ...rest } = overrides ?? {};
  const namespaces = (storageInput.namespaces ?? {
    [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
      id: UNBOUND_NAMESPACE_ID,
      entries: { table: defaultTables },
    }),
  }) as SqlStorageInput['namespaces'];
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      ...(storageInput.types !== undefined ? { types: storageInput.types } : {}),
      namespaces,
      storageHash: storageHashValue,
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
    ...rest,
  };
}

function buildUserTableSchema(): PostgresTableSchemaNode {
  return new PostgresTableSchemaNode({
    name: 'user',
    columns: {
      id: { name: 'id', nativeType: 'uuid', nullable: false },
      email: { name: 'email', nativeType: 'text', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [{ columns: ['email'], name: 'user_email_key' }],
    foreignKeys: [],
    indexes: [
      {
        naming: { kind: 'exact', name: 'user_email_idx' },
        columns: ['email'],
        where: undefined,
        unique: false,
        partial: false,
        type: undefined,
        options: undefined,
        annotations: undefined,
        dependsOn: undefined,
      },
    ],
    rlsEnabled: false,
  });
}

/**
 * Plans adding a single column to the user table and returns the resulting operation.
 * The schema contains only the `id` column, so the planner generates an ADD COLUMN for `columnName`.
 */
function planAddColumn(
  columnName: string,
  columnDef: {
    readonly many: false;
    nativeType: string;
    codecId: string;
    nullable: boolean;
    typeParams?: Record<string, unknown>;
    typeRef?: string;
    default?: { kind: 'literal'; value: ColumnDefaultLiteralInputValue };
  },
  options?: {
    frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', 'postgres'>>;
    extraStorageTypes?: Contract<SqlStorage>['storage']['types'];
  },
) {
  const operationsPromise = planUserTableOperations(
    {
      columns: {
        id: { many: false, nativeType: 'uuid', codecId: 'pg/uuid@1', nullable: false },
        [columnName]: columnDef,
      },
      primaryKey: { columns: ['id'] },
      uniques: [],
      indexes: [],
      foreignKeys: [],
    },
    buildUserTableSchemaWithoutEmail(),
    options,
  );
  const usesAddColumnCall = columnDef.nullable || columnDef.default !== undefined;
  const opId = usesAddColumnCall
    ? `column.__unbound__.user.${columnName}`
    : `column.user.${columnName}`;
  return getRequiredOperation(operationsPromise, opId);
}

function createPlannerControlHookComponent(
  codecId: string,
  hooks: CodecControlHooks,
): TargetBoundComponentDescriptor<'sql', 'postgres'> {
  return {
    kind: 'extension',
    id: `test-hooks-${codecId}`,
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.0-test',

    create: () => ({ familyId: 'sql', targetId: 'postgres' }) as never,
    types: {
      codecTypes: {
        controlPlaneHooks: {
          [codecId]: hooks,
        },
      },
    },
  } as TargetBoundComponentDescriptor<'sql', 'postgres'>;
}

async function planUserTableOperations(
  userTable: StorageTable,
  schemaUserTable: PostgresTableSchemaNode,
  options?: {
    frameworkComponents?: ReadonlyArray<TargetBoundComponentDescriptor<'sql', 'postgres'>>;
    extraStorageTypes?: Contract<SqlStorage>['storage']['types'];
    extraContractTables?: Record<string, StorageTable>;
    extraSchemaTables?: Record<string, PostgresTableSchemaNode>;
  },
) {
  const planner = createPostgresMigrationPlanner(testAdapter);
  const contract = createTestContract({
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              ...(options?.extraContractTables ?? {}),
              user: userTable,
            },
          },
        }),
      },
      ...(options?.extraStorageTypes ? { types: options.extraStorageTypes } : {}),
    },
  });
  const schema = new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          ...(options?.extraSchemaTables ?? {}),
          user: schemaUserTable,
        },
      }),
    },
    roles: [],
    existingSchemas: [],
    pgVersion: '',
  });
  const result = planner.plan({
    contract,
    schema,
    policy: INIT_ADDITIVE_POLICY,
    fromContract: null,
    frameworkComponents: options?.frameworkComponents ?? [],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error('expected planner success');
  return Promise.all(result.plan.operations) as Promise<
    SqlMigrationPlanOperation<PostgresPlanTargetDetails>[]
  >;
}

async function getRequiredOperation(
  operationsPromise: ReturnType<typeof planUserTableOperations>,
  id: string,
) {
  const operations = await operationsPromise;
  const operation = operations.find((candidate) => candidate.id === id);
  if (!operation) {
    throw new Error(`operation ${id} not found`);
  }
  return operation;
}

function buildUserTableSchemaWithoutEmail(): PostgresTableSchemaNode {
  return new PostgresTableSchemaNode({
    name: 'user',
    columns: { id: { name: 'id', nativeType: 'uuid', nullable: false } },
    primaryKey: { columns: ['id'] },
    uniques: [],
    foreignKeys: [],
    indexes: [],
    rlsEnabled: false,
  });
}

function buildPostTableSchema(): PostgresTableSchemaNode {
  return new PostgresTableSchemaNode({
    name: 'post',
    columns: {
      id: { name: 'id', nativeType: 'uuid', nullable: false },
      userId: { name: 'userId', nativeType: 'uuid', nullable: false },
      title: { name: 'title', nativeType: 'text', nullable: false },
    },
    primaryKey: { columns: ['id'] },
    uniques: [],
    foreignKeys: [
      {
        columns: ['userId'],
        referencedTable: 'user',
        referencedColumns: ['id'],
        name: 'post_userId_fkey',
        // The differ pairs FK nodes by id, which folds in
        // `resolvedReferencedNamespace` — match what
        // `contractToPostgresDatabaseSchemaNode` stamps on the expected side
        // for an unbound-namespace FK target (resolves to the live `public`
        // DDL schema), or this hand-built actual node never pairs and shows
        // up as a spurious drop+recreate.
        resolvedReferencedNamespace: 'public',
      },
    ],
    indexes: [
      {
        naming: { kind: 'exact', name: 'post_userId_idx' },
        columns: ['userId'],
        where: undefined,
        unique: false,
        partial: false,
        type: undefined,
        options: undefined,
        annotations: undefined,
        dependsOn: undefined,
      },
    ],
    rlsEnabled: false,
  });
}
