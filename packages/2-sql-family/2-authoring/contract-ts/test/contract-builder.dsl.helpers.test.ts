import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import { describe, expect, it, vi } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import {
  testSqlTypeLookups,
  testTypeLookups,
} from '../../../1-core/contract/test/test-type-lookups';
import {
  fixtureDataTypeEntries,
  fixtureDataTypes,
} from '../../contract-psl/test/fixture-data-types';
import { defineContract, rel } from '../src/contract-builder';
import { documentScopedTypes } from './cross-ref-helpers';
import { unboundTables } from './unbound-tables';

type PortableSqlCodecTypes = {
  readonly 'app/test-enum@1': { output: string };
  readonly 'sql/char@1': { output: string };
};

const sqlFamilyPackBase = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  dataTypes: fixtureDataTypes,
  authoring: {
    dataTypes: fixtureDataTypeEntries,
  },
} as const satisfies FamilyPackRef<'sql'>;

const sqlFamilyPack: typeof sqlFamilyPackBase & {
  readonly __dataTypeArguments?: {
    readonly 'pg/int4': { readonly argument: number; readonly parameter: number };
    readonly 'pg/text': { readonly argument: string; readonly parameter: string };
  };
} = sqlFamilyPackBase;

const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
  authoring: {
    type: {
      enum: {
        kind: 'typeConstructor',
        args: [{ kind: 'value', dataType: 'pg/text' }],
        output: {
          codecId: 'app/test-enum@1',
          typeParams: {
            name: { kind: 'arg', index: 0 },
            values: ['USER', 'ADMIN'],
          },
        },
      },
    },
  },
} as const satisfies TargetPackRef<'sql', 'postgres'> & {
  readonly __codecTypes?: PortableSqlCodecTypes;
};

const pgvectorExtensionPack = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  authoring: {
    type: {
      pgvector: {
        Vector: {
          kind: 'typeConstructor',
          args: [{ kind: 'value', dataType: 'pg/int4', name: 'length' }],
          output: {
            codecId: 'pg/vector@1',
            typeParams: {
              length: { kind: 'arg', index: 0 },
            },
          },
        },
      },
    },
  },
} as const satisfies ExtensionPackRef<'sql', 'postgres'>;

const char36 = {
  kind: 'codec-instance',
  codecId: 'sql/char@1',
  typeParams: { length: 36 },
} as const;

const roleTypes = {
  Role: {
    kind: 'codec-instance',
    codecId: 'app/test-enum@1',
    typeParams: { values: ['USER', 'ADMIN'] },
  },
} as const;

function expectTypedFallbackWarnings(run: () => void, expectedFragments: readonly string[]): void {
  const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});

  try {
    run();

    for (const fragment of expectedFragments) {
      expect(emitWarning).toHaveBeenCalledWith(
        expect.stringContaining(fragment),
        expect.objectContaining({
          code: 'PN_CONTRACT_TYPED_FALLBACK_AVAILABLE',
        }),
      );
    }
  } finally {
    emitWarning.mockRestore();
  }
}

describe('contract DSL helper vocabulary', () => {
  it('lowers a codec instance constant inline', () => {
    const contract = defineContract(
      {
        ...testSqlTypeLookups({ 'app/test-enum@1': 'role' }),
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ field, model }) => ({
        models: {
          User: model('User', {
            fields: {
              role: field.column(roleTypes.Role),
            },
          }).sql({
            table: 'app_user',
          }),
        },
      }),
    );

    expect({
      types: contract.storage.types,
      role: unboundTables(contract.storage)['app_user']!.columns['role'],
    }).toEqual({
      types: undefined,
      role: {
        codecId: 'app/test-enum@1',
        dataType: 'app/test-enum',
        nullable: false,
        many: false,
        typeParams: { values: ['USER', 'ADMIN'] },
      },
    });
  });

  it.each([
    {
      name: 'a string relation target',
      run: () =>
        defineContract(
          {
            ...testTypeLookups,
            family: sqlFamilyPack,
            target: postgresTargetPack,
            createNamespace: createTestSqlNamespace,
          },
          ({ field, model }) => {
            const User = model('User', {
              fields: {
                id: field.column(char36).id(),
              },
            }).sql({
              table: 'app_user',
            });

            return {
              models: {
                User,
                Post: model('Post', {
                  fields: {
                    id: field.column(char36).id(),
                    userId: field.column(char36),
                  },
                  relations: {
                    user: rel.belongsTo('User', { from: 'userId', to: 'id' }),
                  },
                }).sql({
                  table: 'blog_post',
                }),
              },
            };
          },
        ),
      expectedFragments: [
        `rel.belongsTo('User', { from: 'userId', to: 'id' })`,
        `Use rel.belongsTo(User, { from: 'userId', to: 'id' })`,
      ],
    },
    {
      name: 'constraints.ref fallback',
      run: () =>
        defineContract(
          {
            ...testTypeLookups,
            family: sqlFamilyPack,
            target: postgresTargetPack,
            createNamespace: createTestSqlNamespace,
          },
          ({ field, model }) => {
            const User = model('User', {
              fields: {
                id: field.column(char36).id(),
              },
            }).sql({
              table: 'app_user',
            });

            return {
              models: {
                User,
                Post: model('Post', {
                  fields: {
                    id: field.column(char36).id(),
                    userId: field.column(char36),
                  },
                }).sql(({ cols, constraints }) => ({
                  table: 'blog_post',
                  foreignKeys: [constraints.foreignKey(cols.userId, constraints.ref('User', 'id'))],
                })),
              },
            };
          },
        ),
      expectedFragments: [`constraints.ref('User', 'id')`, 'Use User.refs.id'],
    },
  ])('emits typed fallback guidance for $name', ({ run, expectedFragments }) => {
    expectTypedFallbackWarnings(run, expectedFragments);
  });

  it('supports integrated contract callbacks with target-owned type helpers', () => {
    const contract = defineContract(
      {
        ...testSqlTypeLookups({ 'app/test-enum@1': 'enum' }),
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
      },
      ({ type, field, model }) => {
        const Role = field.column(type.enum('role'));

        return {
          models: {
            User: model('User', {
              fields: {
                role: Role,
              },
            }).sql({
              table: 'app_user',
            }),
          },
        };
      },
    );

    expect(documentScopedTypes(contract)).toBeUndefined();
    expect(unboundTables(contract.storage)['app_user']!.columns['role']).toMatchObject({
      codecId: 'app/test-enum@1',
      typeParams: { name: 'role', values: ['USER', 'ADMIN'] },
    });
  });

  it('supports integrated contract callbacks with extension-owned type helpers', () => {
    const contract = defineContract(
      {
        ...testTypeLookups,
        family: sqlFamilyPack,
        target: postgresTargetPack,
        createNamespace: createTestSqlNamespace,
        extensions: {
          pgvector: pgvectorExtensionPack,
        },
      },
      ({ type, field, model }) => {
        const Embedding1536 = field.column(type.pgvector.Vector(1536));

        return {
          models: {
            Document: model('Document', {
              fields: {
                embedding: Embedding1536,
              },
            }).sql({
              table: 'document',
            }),
          },
        };
      },
    );

    expect(documentScopedTypes(contract)).toBeUndefined();
    expect(unboundTables(contract.storage)['document']!.columns['embedding']).toMatchObject({
      codecId: 'pg/vector@1',
      typeParams: { length: 1536 },
    });
  });

  it.each([
    {
      name: 'type helper names',
      conflictingPack: {
        kind: 'extension',
        id: 'conflicting-pack',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        authoring: {
          type: {
            enum: {
              kind: 'typeConstructor',
              args: [{ kind: 'value', dataType: 'pg/text' }],
              output: {
                codecId: 'conflict/enum@1',
                typeParams: { name: { kind: 'arg', index: 0 } },
              },
            },
          },
        },
      } as const satisfies ExtensionPackRef<'sql', 'postgres'>,
      error: /Duplicate authoring type helper "enum"/,
    },
  ])('rejects duplicate authoring $name across composed packs', ({ conflictingPack, error }) => {
    expect(() =>
      defineContract(
        {
          ...testTypeLookups,
          family: sqlFamilyPack,
          target: postgresTargetPack,
          createNamespace: createTestSqlNamespace,
          extensions: {
            conflictingPack,
          },
        },
        () => ({
          models: {},
        }),
      ),
    ).toThrow(error);
  });
});
