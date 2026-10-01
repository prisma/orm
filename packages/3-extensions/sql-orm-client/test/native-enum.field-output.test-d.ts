import type { Contract, StorageHashBase } from '@internal/contract/types';
import type { ContractWithTypeMaps, TypeMaps } from '@internal/sql-contract/types';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import type { CreateInput, DefaultModelRow } from '../src/types';
import { createMockRuntime } from './helpers';

// ---------------------------------------------------------------------------
// Minimal native-Postgres-enum-typed contract fixture
//
// Mirrors `enum-type.field-output.test-d.ts` but with `codecId: 'pg/enum@1'`
// (the native-enum codec) and `FieldOutputTypes`/`FieldInputTypes` carrying
// the value union — exactly what the emitter produces for a native-enum
// column, via `resolveFieldValueSet` reading the STORAGE column's `valueSet`
// (not a domain-field `valueSet` — a native enum has no domain enum;
// querying-design.md §2.2). This proves ORM read/write typing for a native
// enum works with no domain enum involved, matching the real emitted shape.
// ---------------------------------------------------------------------------

type NativeEnumCodecTypes = {
  'pg/enum@1': {
    output: string;
    input: string;
    traits: 'equality' | 'order';
  };
};

type NativeEnumFieldOutputTypes = {
  auth: {
    AuthSession: {
      aal: 'aal1' | 'aal2' | 'aal3';
    };
  };
};

type NativeEnumFieldInputTypes = {
  auth: {
    AuthSession: {
      aal: 'aal1' | 'aal2' | 'aal3';
    };
  };
};

type NativeEnumTypeMaps = TypeMaps<
  NativeEnumCodecTypes,
  Record<string, never>,
  NativeEnumFieldOutputTypes,
  NativeEnumFieldInputTypes
>;

type NativeEnumStorage = {
  storageHash: StorageHashBase<string>;
  namespaces: {
    auth: {
      id: 'auth';
      kind: 'schema';
      entries: {
        table: {
          AuthSession: {
            columns: {
              aal: { nativeType: 'aal_level'; codecId: 'pg/enum@1'; nullable: false };
            };
            primaryKey: { columns: ['aal'] };
            uniques: [];
            indexes: [];
            foreignKeys: [];
          };
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
      };
    };
    // No `valueSet` on the domain field — a native enum has no domain enum.
    fields: {
      aal: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/enum@1' };
        readonly nullable: false;
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

type NativeEnumContract = ContractWithTypeMaps<NativeEnumContractBase, NativeEnumTypeMaps>;

// ---------------------------------------------------------------------------
// Read output: DefaultModelRow uses FieldOutputTypes
// ---------------------------------------------------------------------------

type AuthSessionRow = DefaultModelRow<NativeEnumContract, 'AuthSession'>;

test('ORM read output: native-enum field is the member-value union, not string', () => {
  expectTypeOf<AuthSessionRow['aal']>().toEqualTypeOf<'aal1' | 'aal2' | 'aal3'>();
});

test('ORM read output: native-enum field is not bare string', () => {
  expectTypeOf<AuthSessionRow['aal']>().not.toEqualTypeOf<string>();
});

// ---------------------------------------------------------------------------
// Write input: CreateInput uses FieldInputTypes
// ---------------------------------------------------------------------------

type AuthSessionCreateInput = CreateInput<NativeEnumContract, 'AuthSession'>;

test('ORM write input: native-enum field rejects out-of-set literal', () => {
  const runtime = createMockRuntime();
  const context = {} as unknown as ExecutionContext<NativeEnumContract>;
  const collection = new Collection<NativeEnumContract, 'AuthSession'>(
    { runtime, context },
    'AuthSession',
    { namespaceId: 'auth' },
  );

  // @ts-expect-error 'nope' is not in the 'aal1' | 'aal2' | 'aal3' union
  collection.create({
    aal: 'nope',
  });
});

test('ORM write input: native-enum field accepts in-set literal', () => {
  expectTypeOf<AuthSessionCreateInput['aal']>().toEqualTypeOf<'aal1' | 'aal2' | 'aal3'>();
});
