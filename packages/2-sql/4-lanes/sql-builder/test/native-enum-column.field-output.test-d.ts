import type { Contract, StorageHashBase } from '@internal/contract/types';
import type { ContractWithTypeMaps, TypeMaps } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { Db } from '../src/types/db';

// ---------------------------------------------------------------------------
// Minimal native-Postgres-enum-typed contract fixture for the sql-builder lane.
//
// Mirrors `enum-type.field-output.test-d.ts` but with `codecId: 'pg/enum@1'`
// (the native-enum codec) and NO `FieldOutputTypes`/`FieldInputTypes` entry —
// a native enum has no domain enum, so the domain-field typing path is not
// involved (querying-design.md §2.2). Only `StorageColumnTypes`/
// `StorageColumnInputTypes` carry the value union — the value-set → codec
// path (querying-design.md §2.1), the same one a check-enum column uses.
// ---------------------------------------------------------------------------

type NativeEnumCodecTypes = {
  'pg/enum@1': {
    output: string;
    input: string;
    traits: 'equality' | 'order';
  };
};

// Field-type maps are nested by namespace coordinate; this fixture's models
// live under the `auth` storage namespace. `factorType` is the nullable
// (`pg.enum(E)?`) variant — its column type is the union `| null`.
type NativeEnumStorageColumnTypes = {
  auth: {
    AuthSession: {
      aal: 'aal1' | 'aal2' | 'aal3';
      factorType: 'totp' | 'webauthn' | null;
    };
  };
};

type NativeEnumStorageColumnInputTypes = {
  auth: {
    AuthSession: {
      aal: 'aal1' | 'aal2' | 'aal3';
      factorType: 'totp' | 'webauthn' | null;
    };
  };
};

type NativeEnumTypeMaps = TypeMaps<
  NativeEnumCodecTypes,
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  NativeEnumStorageColumnTypes,
  NativeEnumStorageColumnInputTypes
>;

type NativeEnumStorage = {
  storageHash: StorageHashBase<string>;
  namespaces: {
    readonly auth: {
      id: 'auth';
      kind: 'test-sql-namespace';
      entries: {
        readonly table: {
          readonly AuthSession: {
            columns: {
              readonly aal: {
                nativeType: 'aal_level';
                codecId: 'pg/enum@1';
                nullable: false;
                valueSet: {
                  plane: 'storage';
                  entityKind: 'valueSet';
                  namespaceId: 'auth';
                  entityName: 'AalLevel';
                };
              };
              readonly factorType: {
                nativeType: 'factor_type';
                codecId: 'pg/enum@1';
                nullable: true;
                valueSet: {
                  plane: 'storage';
                  entityKind: 'valueSet';
                  namespaceId: 'auth';
                  entityName: 'FactorType';
                };
              };
            };
            primaryKey: { columns: ['aal'] };
            uniques: readonly [];
            indexes: readonly [];
            foreignKeys: readonly [];
          };
        };
        readonly valueSet: {
          readonly AalLevel: { kind: 'valueSet'; values: readonly ['aal1', 'aal2', 'aal3'] };
          readonly FactorType: { kind: 'valueSet'; values: readonly ['totp', 'webauthn'] };
        };
      };
    };
  };
};

type NativeEnumModels = {
  AuthSession: {
    storage: {
      namespaceId: 'auth';
      table: 'AuthSession';
      fields: {
        aal: { column: 'aal' };
        factorType: { column: 'factorType' };
      };
    };
    // No `valueSet` on the domain field — a native enum has no domain enum.
    fields: {
      aal: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/enum@1' };
        readonly nullable: false;
      };
      factorType: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/enum@1' };
        readonly nullable: true;
      };
    };
    relations: Record<string, never>;
  };
};

type NativeEnumContractBase = Omit<Contract<NativeEnumStorage>, 'domain'> & {
  readonly domain: {
    readonly namespaces: {
      readonly auth: { readonly models: NativeEnumModels };
    };
  };
};

type NativeEnumContract = ContractWithTypeMaps<NativeEnumContractBase, NativeEnumTypeMaps> & {
  readonly capabilities: Record<string, never>;
  readonly roots: Record<string, never>;
};

type NativeEnumDb = Db<NativeEnumContract>;

test('sql-builder: a native-enum column types as the member-value union, not string', () => {
  type QC = import('../src/types/table-proxy').ContractToQC<
    NativeEnumContract,
    'auth',
    'AuthSession'
  >;
  type AalOutput = QC['resolvedColumnOutputTypes']['aal'];

  expectTypeOf<AalOutput>().toEqualTypeOf<'aal1' | 'aal2' | 'aal3'>();
  expectTypeOf<AalOutput>().not.toEqualTypeOf<string>();
});

test('sql-builder: a nullable native-enum column (pg.enum(E)?) types as union | null', () => {
  type QC = import('../src/types/table-proxy').ContractToQC<
    NativeEnumContract,
    'auth',
    'AuthSession'
  >;
  type FactorTypeOutput = QC['resolvedColumnOutputTypes']['factorType'];

  expectTypeOf<FactorTypeOutput>().toEqualTypeOf<'totp' | 'webauthn' | null>();
});

test('sql-builder insert: a native-enum column rejects an out-of-set literal', () => {
  const db = null as unknown as NativeEnumDb;

  db.auth.AuthSession.insert([
    {
      // @ts-expect-error 'nope' is not in the 'aal1' | 'aal2' | 'aal3' union
      aal: 'nope',
    },
  ]);
});

test('sql-builder insert: an in-set literal is accepted', () => {
  const db = null as unknown as NativeEnumDb;

  db.auth.AuthSession.insert([{ aal: 'aal1' }]);
  db.auth.AuthSession.insert([{ aal: 'aal2' }]);
  db.auth.AuthSession.insert([{ aal: 'aal3' }]);
});
