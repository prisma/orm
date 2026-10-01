import { computeStorageHash } from '@internal/contract/hashing';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type {
  SqlControlExtensionDescriptor,
  SqlDescribedContractSpace,
} from '@internal/family-sql/control';
import sqlFamilyDescriptor from '@internal/family-sql/control';
import type { ContractSpace, ControlStack } from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import { flatPslModels } from '@internal/framework-components/psl-ast';
import { printPsl } from '@internal/psl-printer';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { SqlStorage } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { inferPostgresPslContract } from '../../src/core/psl-infer/infer-psl-contract';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import postgresTargetDescriptor from '../../src/exports/control';
import { inferBuildContext } from './fixtures';

const TARGET = 'postgres' as const;
const TARGET_FAMILY = 'sql' as const;

function idColumnTable(name: string, foreignKeys: PostgresTableSchemaNode['foreignKeys'] = []) {
  return new PostgresTableSchemaNode({
    name,
    columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
    primaryKey: { columns: ['id'] },
    foreignKeys,
    uniques: [],
    indexes: [],
    policies: [],
    rlsEnabled: false,
  });
}

function namespaceNode(schemaName: string, tables: Record<string, PostgresTableSchemaNode>) {
  return new PostgresNamespaceSchemaNode({ schemaName, tables });
}

function tree(namespaces: Record<string, PostgresNamespaceSchemaNode>) {
  return new PostgresDatabaseSchemaNode({
    namespaces,
    roles: [],
    existingSchemas: Object.keys(namespaces),
    pgVersion: '',
  });
}

/**
 * Builds a described contract — one of the values `inferPostgresPslContract`
 * receives in its `describedContracts` array — declaring the given tables
 * under each namespace id. Each namespace's record key is its own `.id`,
 * matching how a real contract space's storage is keyed. Carries no domain
 * models: only the tests exercising cross-space FK resolution need one (see
 * {@link describedContractWithModel}).
 */
function describedContract(
  namespaces: Readonly<Record<string, readonly string[]>>,
): SqlDescribedContractSpace {
  const storageNamespaces: Record<string, PostgresSchema> = {};
  for (const [namespaceId, tables] of Object.entries(namespaces)) {
    storageNamespaces[namespaceId] = new PostgresSchema({
      id: namespaceId,
      entries: {
        table: Object.fromEntries(
          tables.map((tableName) => [
            tableName,
            { columns: {}, uniques: [], indexes: [], foreignKeys: [] },
          ]),
        ),
      },
    });
  }

  const contract: Contract<SqlStorage> = {
    target: TARGET,
    targetFamily: TARGET_FAMILY,
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash('contract'),
      namespaces: storageNamespaces,
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };

  return { spaceId: 'pack', contract };
}

/**
 * Builds a described contract that declares exactly one table AND the domain
 * model that maps to it — the shape `inferPostgresPslContract` needs to
 * resolve a cross-space foreign key into a qualified relation: the owning
 * `spaceId`, the domain model name, and the pack's own field-name mapping
 * (so `references` resolves to the pack's field names, not a generic
 * column-name guess).
 */
function describedContractWithModel(options: {
  readonly spaceId: string;
  readonly namespaceId: string;
  readonly modelName: string;
  readonly tableName: string;
  readonly fields: Readonly<Record<string, string>>;
}): SqlDescribedContractSpace {
  const { spaceId, namespaceId, modelName, tableName, fields } = options;

  const contract: Contract<SqlStorage> = {
    target: TARGET,
    targetFamily: TARGET_FAMILY,
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash('contract'),
      namespaces: {
        [namespaceId]: new PostgresSchema({
          id: namespaceId,
          entries: {
            table: { [tableName]: { columns: {}, uniques: [], indexes: [], foreignKeys: [] } },
          },
        }),
      },
    }),
    roots: {},
    domain: {
      namespaces: {
        [namespaceId]: {
          models: {
            [modelName]: {
              fields: {},
              relations: {},
              storage: {
                namespaceId,
                table: tableName,
                fields: Object.fromEntries(
                  Object.entries(fields).map(([fieldName, column]) => [fieldName, { column }]),
                ),
              },
            },
          },
        },
      },
    },
    capabilities: {},
    extensions: {},
    meta: {},
  };

  return { spaceId, contract };
}

describe('inferPostgresPslContract — described-contract omission', () => {
  it('omits a table a described contract declares, keeps the rest', () => {
    const database = tree({
      public: namespaceNode('public', {
        app_table: idColumnTable('app_table'),
        t_owned: idColumnTable('t_owned'),
      }),
    });

    const ast = inferPostgresPslContract(database, inferBuildContext, [
      describedContract({ public: ['t_owned'] }),
    ]);
    const modelNames = flatPslModels(ast).map((m) => m.name);

    expect(modelNames).toContain('AppTable');
    expect(modelNames).not.toContain('TOwned');
  });

  it('produces byte-identical output for empty and absent describedContracts', () => {
    const database = tree({
      public: namespaceNode('public', {
        app_table: idColumnTable('app_table'),
        t_owned: idColumnTable('t_owned'),
      }),
    });

    const withoutArgument = printPsl(inferPostgresPslContract(database, inferBuildContext));
    const withEmptyList = printPsl(inferPostgresPslContract(database, inferBuildContext, []));

    expect(withEmptyList).toBe(withoutArgument);
  });

  it('keeps a table when a described contract declares a same-named table in a different namespace', () => {
    const database = tree({
      public: namespaceNode('public', { users: idColumnTable('users') }),
    });

    const ast = inferPostgresPslContract(database, inferBuildContext, [
      describedContract({ auth: ['users'] }),
    ]);

    expect(flatPslModels(ast).map((m) => m.name)).toContain('Users');
  });

  it('is entity-kind-precise: a non-table entity of the same name in the same namespace does not omit the table', () => {
    // The described contract declares "widgets" under a pack-contributed
    // entity kind, not `table`. The coordinate key includes `entityKind`, so
    // this must never suppress the introspected `widgets` table — proving
    // the omission is keyed on (namespaceId, entityKind, entityName), not a
    // table-specific predicate.
    const database = tree({
      public: namespaceNode('public', { widgets: idColumnTable('widgets') }),
    });
    const contractWithNonTableEntity: SqlDescribedContractSpace = {
      spaceId: 'pack',
      contract: {
        ...describedContract({}).contract,
        storage: new SqlStorage({
          storageHash: coreHash('contract'),
          namespaces: {
            public: new PostgresSchema({
              id: 'public',
              entries: { widget: { widgets: {} } },
            }),
          },
        }),
      },
    };

    const ast = inferPostgresPslContract(database, inferBuildContext, [contractWithNonTableEntity]);

    expect(flatPslModels(ast).map((m) => m.name)).toContain('Widgets');
  });

  it('an rls marker entity in a described contract does not omit the same-named table', () => {
    // The marker is keyed by table name (`entries.rls[tableName]`), so a
    // described contract marking a table RLS-controlled must not suppress the
    // introspected table itself — only a `table`-kind entry omits tables.
    const database = tree({
      public: namespaceNode('public', { profile: idColumnTable('profile') }),
    });
    const contractWithRlsMarker: SqlDescribedContractSpace = {
      spaceId: 'pack',
      contract: {
        ...describedContract({}).contract,
        storage: new SqlStorage({
          storageHash: coreHash('contract'),
          namespaces: {
            public: new PostgresSchema({
              id: 'public',
              entries: {
                rls: { profile: { kind: 'rls', tableName: 'profile', namespaceId: 'public' } },
              },
            }),
          },
        }),
      },
    };

    const ast = inferPostgresPslContract(database, inferBuildContext, [contractWithRlsMarker]);

    expect(flatPslModels(ast).map((m) => m.name)).toContain('Profile');
  });

  it('resolves a cross-space FK into a described contract as the qualified relation, omitting the target table', () => {
    const database = tree({
      public: namespaceNode('public', {
        profile: new PostgresTableSchemaNode({
          name: 'profile',
          columns: {
            id: { name: 'id', nativeType: 'uuid', nullable: false },
            userId: { name: 'userId', nativeType: 'uuid', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['userId'],
              referencedTable: 'users',
              referencedSchema: 'auth',
              referencedColumns: ['id'],
              onDelete: 'cascade',
            },
          ],
          uniques: [],
          indexes: [],
          policies: [],
          rlsEnabled: false,
        }),
      }),
    });

    const pack = describedContractWithModel({
      spaceId: 'supabase',
      namespaceId: 'auth',
      modelName: 'AuthUser',
      tableName: 'users',
      fields: { id: 'id', email: 'email' },
    });

    const ast = inferPostgresPslContract(database, inferBuildContext, [pack]);
    const modelNames = flatPslModels(ast).map((m) => m.name);
    const profileModel = flatPslModels(ast).find((m) => m.name === 'Profile');

    expect(modelNames).toContain('Profile');
    expect(modelNames).not.toContain('Users');
    expect(modelNames).not.toContain('AuthUser');

    const relationField = profileModel?.fields.find((f) => f.name === 'user');
    expect(relationField?.typeName).toBe('AuthUser');
    expect(relationField?.typeNamespaceId).toBe('auth');
    expect(relationField?.typeContractSpaceId).toBe('supabase');
    // A resolved cross-space FK is not dangling — it must not carry the
    // dangling-FK warning comment the "target neither in the tree nor owned"
    // case gets.
    expect(profileModel?.comment).toBeUndefined();

    const printed = printPsl(ast);
    expect(printed).toContain('supabase:auth.AuthUser');
    expect(printed).toContain(
      '@relation(fields: [userId], references: [id], onDelete: Cascade, index: false)',
    );
  });

  it('resolves the cross-space FK even when a same-bare-named local table survives (pack-owned coordinate wins over the local shadow)', () => {
    const database = tree({
      public: namespaceNode('public', {
        users: idColumnTable('users'),
        profile: new PostgresTableSchemaNode({
          name: 'profile',
          columns: {
            id: { name: 'id', nativeType: 'uuid', nullable: false },
            userId: { name: 'userId', nativeType: 'uuid', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['userId'],
              referencedTable: 'users',
              referencedSchema: 'auth',
              referencedColumns: ['id'],
              onDelete: 'cascade',
            },
          ],
          uniques: [],
          indexes: [],
          policies: [],
          rlsEnabled: false,
        }),
      }),
    });

    const pack = describedContractWithModel({
      spaceId: 'supabase',
      namespaceId: 'auth',
      modelName: 'AuthUser',
      tableName: 'users',
      fields: { id: 'id', email: 'email' },
    });

    const ast = inferPostgresPslContract(database, inferBuildContext, [pack]);
    const models = flatPslModels(ast);
    const modelNames = models.map((m) => m.name);
    const profileModel = models.find((m) => m.name === 'Profile');

    expect(modelNames).toContain('Profile');
    expect(modelNames).toContain('Users');

    const relationField = profileModel?.fields.find((f) => f.name === 'user');
    expect(relationField?.typeName).toBe('AuthUser');
    expect(relationField?.typeNamespaceId).toBe('auth');
    expect(relationField?.typeContractSpaceId).toBe('supabase');

    expect(profileModel?.fields.some((f) => f.typeName === 'Users')).toBe(false);

    const printed = printPsl(ast);
    expect(printed).toContain('supabase:auth.AuthUser');
  });

  it('throws when a described contract owns the referenced storage coordinate but declares no domain model mapped to it', () => {
    const database = tree({
      public: namespaceNode('public', {
        profile: new PostgresTableSchemaNode({
          name: 'profile',
          columns: {
            id: { name: 'id', nativeType: 'uuid', nullable: false },
            userId: { name: 'userId', nativeType: 'uuid', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['userId'],
              referencedTable: 'users',
              referencedSchema: 'auth',
              referencedColumns: ['id'],
              onDelete: 'cascade',
            },
          ],
          uniques: [],
          indexes: [],
          policies: [],
          rlsEnabled: false,
        }),
      }),
    });

    expect(() =>
      inferPostgresPslContract(database, inferBuildContext, [
        describedContract({ auth: ['users'] }),
      ]),
    ).toThrow(/owns storage coordinate "auth\.users" but declares no domain model/);
  });

  it('drops a genuinely dangling FK (target neither in the tree nor owned by any described contract), keeping the scalar column and explaining the drop with a comment', () => {
    const database = tree({
      public: namespaceNode('public', {
        posts: new PostgresTableSchemaNode({
          name: 'posts',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            ownerId: { name: 'ownerId', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['ownerId'],
              referencedTable: 'owners',
              referencedSchema: 'secure',
              referencedColumns: ['id'],
            },
          ],
          uniques: [],
          indexes: [],
          policies: [],
          rlsEnabled: false,
        }),
      }),
    });

    const ast = inferPostgresPslContract(database, inferBuildContext, []);
    const modelNames = flatPslModels(ast).map((m) => m.name);
    const postsModel = flatPslModels(ast).find((m) => m.name === 'Posts');

    expect(modelNames).toContain('Posts');
    expect(modelNames).not.toContain('Owners');
    expect(postsModel?.fields.some((f) => f.name === 'ownerId')).toBe(true);
    expect(postsModel?.fields.some((f) => f.attributes.some((a) => a.name === 'relation'))).toBe(
      false,
    );
    expect(postsModel?.comment).toBe(
      '// WARNING: Foreign key "ownerId" -> "secure.owners" exists in the database, but its ' +
        'target schema is outside the introspected scope, so no relation field was generated. ' +
        'If the target schema is described by an extension pack, add it to extensions and ' +
        're-run infer.',
    );
  });

  it('keeps a legitimate FK to a surviving same-named table when a different namespace omits that name', () => {
    const database = tree({
      auth: namespaceNode('auth', { users: idColumnTable('users') }),
      public: namespaceNode('public', {
        users: idColumnTable('users'),
        posts: new PostgresTableSchemaNode({
          name: 'posts',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            { columns: ['user_id'], referencedTable: 'users', referencedColumns: ['id'] },
          ],
          uniques: [],
          indexes: [],
          policies: [],
          rlsEnabled: false,
        }),
      }),
    });

    const ast = inferPostgresPslContract(database, inferBuildContext, [
      describedContract({ auth: ['users'] }),
    ]);
    const modelNames = flatPslModels(ast).map((m) => m.name);
    const postsModel = flatPslModels(ast).find((m) => m.name === 'Posts');

    expect(modelNames).not.toContain('AuthUsers');
    expect(modelNames).toContain('Users');
    expect(postsModel?.fields.some((f) => f.typeName === 'Users')).toBe(true);
    expect(postsModel?.fields.some((f) => f.attributes.some((a) => a.name === 'relation'))).toBe(
      true,
    );
    // A local FK that resolved to a real relation is not dangling — no warning comment.
    expect(postsModel?.comment).toBeUndefined();
  });

  it('omits a described-contract-claimed table before the cross-schema duplicate-name check', () => {
    const database = tree({
      public: namespaceNode('public', { t_owned: idColumnTable('t_owned') }),
      other: namespaceNode('other', { t_owned: idColumnTable('t_owned') }),
    });
    const describedContracts = [describedContract({ other: ['t_owned'] })];

    expect(() =>
      inferPostgresPslContract(database, inferBuildContext, describedContracts),
    ).not.toThrow();
    const ast = inferPostgresPslContract(database, inferBuildContext, describedContracts);
    expect(flatPslModels(ast).map((m) => m.name)).toContain('TOwned');
  });
});

/**
 * Builds a minimal extension pack descriptor whose `contractSpace` declares
 * one table in `public`, with a correctly computed `headRef.hash` — the real
 * family instance asserts descriptor self-consistency on load.
 */
function buildExtensionWithPublicTable(
  id: string,
  tableName: string,
): SqlControlExtensionDescriptor<'postgres'> {
  const table = { columns: {}, uniques: [], indexes: [], foreignKeys: [] };

  const hash = computeStorageHash({
    target: TARGET,
    targetFamily: TARGET_FAMILY,
    storage: {
      namespaces: { public: { id: 'public', entries: { table: { [tableName]: table } } } },
    },
    ...sqlContractCanonicalizationHooks,
  });

  const contract: Contract<SqlStorage> = {
    target: TARGET,
    targetFamily: TARGET_FAMILY,
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
    profileHash: profileHash('fixture-profile-v1'),
    storage: new SqlStorage({
      storageHash: coreHash(hash),
      namespaces: {
        public: new PostgresSchema({ id: 'public', entries: { table: { [tableName]: table } } }),
      },
    }),
  };

  return {
    kind: 'extension' as const,
    id,
    familyId: TARGET_FAMILY,
    targetId: TARGET,
    version: '0.0.1',
    contractSpace: {
      contractJson: contract,
      migrations: [],
      headRef: { hash, invariants: [] },
    } satisfies ContractSpace<Contract<SqlStorage>>,
    create: () => ({ familyId: TARGET_FAMILY, targetId: TARGET }),
  };
}

function makeRealPostgresStack(
  extensions: readonly SqlControlExtensionDescriptor<'postgres'>[],
): ControlStack<'sql', 'postgres'> {
  return createControlStack({
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: {
      kind: 'adapter',
      id: 'postgres',
      version: '0.0.1',
      familyId: TARGET_FAMILY,
      targetId: TARGET,
      create: () => ({ familyId: TARGET_FAMILY, targetId: TARGET }),
    },
    extensions: extensions,
  });
}

describe('SqlFamilyInstance#inferPslContract — real postgres descriptor + real family instance', () => {
  it('omits an extension-owned table from a real introspected Postgres tree', () => {
    const pack = buildExtensionWithPublicTable('pack', 't_owned');
    const familyInstance = sqlFamilyDescriptor.create(makeRealPostgresStack([pack]));

    const database = tree({
      public: namespaceNode('public', {
        app_table: idColumnTable('app_table'),
        t_owned: idColumnTable('t_owned'),
      }),
    });

    const ast = familyInstance.inferPslContract(database);
    const modelNames = flatPslModels(ast).map((m) => m.name);

    expect(modelNames).toContain('AppTable');
    expect(modelNames).not.toContain('TOwned');
  });
});
