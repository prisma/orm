import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import type { ExtractFieldInputTypes, ExtractFieldOutputTypes } from '@internal/sql-contract/types';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { createComposedAuthoringHelpers } from '../src/composed-authoring-helpers';
import { defineContract } from '../src/contract-builder';

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'sql'>;

type PostgresIntegerRepresentationCodecTypes = {
  readonly 'pg/int8number@1': { readonly input: number; readonly output: number };
  readonly 'pg/unboundedint@1': { readonly input: bigint; readonly output: bigint };
};

const postgresTargetPackBase = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
  authoring: {
    type: {
      BigIntNumber: {
        kind: 'typeConstructor',
        output: { codecId: 'pg/int8number@1' },
      },
      UnboundedInt: {
        kind: 'typeConstructor',
        output: { codecId: 'pg/unboundedint@1' },
      },
    },
  },
} as const satisfies TargetPackRef<'sql', 'postgres'>;

const postgresTargetPack: typeof postgresTargetPackBase & {
  readonly __codecTypes?: PostgresIntegerRepresentationCodecTypes;
} = postgresTargetPackBase;

type SqliteIntegerRepresentationCodecTypes = {
  readonly 'sqlite/bigintnumber@1': { readonly input: number; readonly output: number };
};

const sqliteTargetPackBase = {
  kind: 'target',
  id: 'sqlite',
  familyId: 'sql',
  targetId: 'sqlite',
  version: '0.0.1',
  defaultNamespaceId: '__unbound__',
  authoring: {
    type: {
      BigIntNumber: {
        kind: 'typeConstructor',
        output: { codecId: 'sqlite/bigintnumber@1' },
      },
    },
  },
} as const satisfies TargetPackRef<'sql', 'sqlite'>;

const sqliteTargetPack: typeof sqliteTargetPackBase & {
  readonly __codecTypes?: SqliteIntegerRepresentationCodecTypes;
} = sqliteTargetPackBase;

const postgresContract = defineContract(
  {
    ...testTypeLookups,
    family: sqlFamilyPack,
    target: postgresTargetPack,
    createNamespace: createTestSqlNamespace,
  },
  ({ field, model, type }) => {
    const types = {
      BigIntNumber: type.BigIntNumber(),
      UnboundedInt: type.UnboundedInt(),
    } as const;

    return {
      types,
      models: {
        Sample: model('Sample', {
          fields: {
            bounded: field.namedType(types.BigIntNumber),
            unbounded: field.namedType(types.UnboundedInt),
          },
        }).sql({ table: 'sample' }),
      },
    };
  },
);

const sqliteContract = defineContract(
  {
    ...testTypeLookups,
    family: sqlFamilyPack,
    target: sqliteTargetPack,
    createNamespace: createTestSqlNamespace,
  },
  ({ field, model, type }) => {
    const types = {
      BigIntNumber: type.BigIntNumber(),
    } as const;

    return {
      types,
      models: {
        Sample: model('Sample', {
          fields: {
            bounded: field.namedType(types.BigIntNumber),
          },
        }).sql({ table: 'sample' }),
      },
    };
  },
);

describe('integer representation type helpers', () => {
  it('composes only the constructors contributed by the active target', () => {
    const postgresHelpers = createComposedAuthoringHelpers({
      ...testTypeLookups,
      family: sqlFamilyPack,
      target: postgresTargetPack,
      extensions: {},
    });
    const sqliteHelpers = createComposedAuthoringHelpers({
      ...testTypeLookups,
      family: sqlFamilyPack,
      target: sqliteTargetPack,
      extensions: {},
    });

    expect(postgresHelpers.type.BigIntNumber()).toEqual({
      kind: 'codec-instance',
      codecId: 'pg/int8number@1',
      typeParams: {},
    });
    expect(postgresHelpers.type.UnboundedInt()).toEqual({
      kind: 'codec-instance',
      codecId: 'pg/unboundedint@1',
      typeParams: {},
    });
    expect(sqliteHelpers.type.BigIntNumber()).toEqual({
      kind: 'codec-instance',
      codecId: 'sqlite/bigintnumber@1',
      typeParams: {},
    });
    expect(sqliteHelpers.type).not.toHaveProperty('UnboundedInt');
    expect(postgresHelpers.field).not.toHaveProperty('bigIntNumber');
    expect(postgresHelpers.field).not.toHaveProperty('unboundedInt');
    expect(sqliteHelpers.field).not.toHaveProperty('bigIntNumber');
  });

  it('lowers PostgreSQL named type builders with number and bigint application types', () => {
    expect(postgresContract).toMatchObject({
      storage: {
        namespaces: {
          public: {
            entries: {
              table: {
                sample: {
                  columns: {
                    bounded: { codecId: 'pg/int8number@1' },
                    unbounded: { codecId: 'pg/unboundedint@1' },
                  },
                },
              },
            },
          },
        },
      },
    });

    type Output = ExtractFieldOutputTypes<typeof postgresContract>['public']['Sample'];
    type Input = ExtractFieldInputTypes<typeof postgresContract>['public']['Sample'];
    expectTypeOf<Output['bounded']>().toEqualTypeOf<number>();
    expectTypeOf<Input['bounded']>().toEqualTypeOf<number>();
    expectTypeOf<Output['unbounded']>().toEqualTypeOf<bigint>();
    expectTypeOf<Input['unbounded']>().toEqualTypeOf<bigint>();
  });

  it('lowers the SQLite named type builder with a number application type', () => {
    expect(sqliteContract).toMatchObject({
      storage: {
        namespaces: {
          __unbound__: {
            entries: {
              table: {
                sample: {
                  columns: {
                    bounded: { codecId: 'sqlite/bigintnumber@1' },
                  },
                },
              },
            },
          },
        },
      },
    });

    type Output = ExtractFieldOutputTypes<typeof sqliteContract>['__unbound__']['Sample'];
    type Input = ExtractFieldInputTypes<typeof sqliteContract>['__unbound__']['Sample'];
    expectTypeOf<Output['bounded']>().toEqualTypeOf<number>();
    expectTypeOf<Input['bounded']>().toEqualTypeOf<number>();
  });
});
