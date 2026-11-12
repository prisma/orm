import type { Contract, StorageHashBase } from '@internal/contract/types';
import type { ContractWithTypeMaps, TypeMaps } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { Db } from '../src/types/db';

// ---------------------------------------------------------------------------
// Minimal enum-typed contract fixture for sql-builder lane
// ---------------------------------------------------------------------------

type EnumCodecTypes = {
  'pg/text@1': {
    output: string;
    input: string;
    traits: 'equality' | 'order' | 'textual';
  };
};

// Field-type maps are nested by namespace coordinate; this fixture's models
// live under the `__unbound__` storage namespace.
type EnumFieldOutputTypes = {
  __unbound__: {
    User: {
      role: 'user' | 'admin';
      status: 'active' | 'inactive' | null;
    };
  };
};

type EnumFieldInputTypes = {
  __unbound__: {
    User: {
      role: 'user' | 'admin';
      status: 'active' | 'inactive' | null;
    };
  };
};

type EnumStorageColumnTypes = {
  __unbound__: {
    User: {
      role: 'user' | 'admin';
      status: 'active' | 'inactive' | null;
    };
  };
};

type EnumStorageColumnInputTypes = {
  __unbound__: {
    User: {
      role: 'user' | 'admin';
      status: 'active' | 'inactive' | null;
    };
  };
};

type EnumTypeMaps = TypeMaps<
  EnumCodecTypes,
  Record<string, never>,
  EnumFieldOutputTypes,
  EnumFieldInputTypes,
  EnumStorageColumnTypes,
  EnumStorageColumnInputTypes
>;

type EnumStorage = {
  storageHash: StorageHashBase<string>;
  namespaces: {
    readonly __unbound__: {
      id: '__unbound__';
      kind: 'test-sql-namespace';
      entries: {
        readonly table: {
          readonly User: {
            columns: {
              readonly role: {
                readonly many: false;
                dataType: 'pg/text';
                codecId: 'pg/text@1';
                nullable: false;
              };
              readonly status: {
                readonly many: false;
                dataType: 'pg/text';
                codecId: 'pg/text@1';
                nullable: true;
              };
            };
            primaryKey: { columns: ['role'] };
            uniques: readonly [];
            indexes: readonly [];
            foreignKeys: readonly [];
          };
        };
      };
    };
  };
};

type EnumModels = {
  User: {
    storage: {
      table: 'User';
      fields: {
        role: { column: 'role' };
        status: { column: 'status' };
      };
    };
    fields: {
      role: {
        readonly many: false;
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: false;
      };
      status: {
        readonly many: false;
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: true;
      };
    };
    relations: Record<string, never>;
  };
};

type EnumContractBase = Omit<Contract<EnumStorage>, 'domain'> & {
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: { readonly models: EnumModels };
    };
  };
};

type EnumContract = ContractWithTypeMaps<EnumContractBase, EnumTypeMaps> & {
  readonly capabilities: Record<string, never>;
  readonly roots: Record<string, never>;
};

type EnumDb = Db<EnumContract>;

test('sql-builder: column output types for enum fields come from StorageColumnTypes', () => {
  type QC = import('../src/types/table-proxy').ContractToQC<EnumContract, '__unbound__', 'User'>;
  type RoleOutput = QC['resolvedColumnOutputTypes']['role'];
  type StatusOutput = QC['resolvedColumnOutputTypes']['status'];

  expectTypeOf<RoleOutput>().toEqualTypeOf<'user' | 'admin'>();
  expectTypeOf<StatusOutput>().toEqualTypeOf<'active' | 'inactive' | null>();
});

// ---------------------------------------------------------------------------
// Write input: insert() uses FieldInputTypes
// ---------------------------------------------------------------------------

test('sql-builder insert: non-nullable enum field rejects out-of-union literal', () => {
  const db = null as unknown as EnumDb;

  db.__unbound__.User.insert([
    {
      // @ts-expect-error 'nope' is not in the 'user' | 'admin' union
      role: 'nope',
    },
  ]);
});

test('sql-builder insert: in-union literal is accepted', () => {
  const db = null as unknown as EnumDb;

  db.__unbound__.User.insert([{ role: 'user' }]);
  db.__unbound__.User.insert([{ role: 'admin' }]);
  db.__unbound__.User.insert([{ role: 'user', status: 'active' }]);
  db.__unbound__.User.insert([{ role: 'user', status: null }]);
});

// ---------------------------------------------------------------------------
// Where comparisons: a raw value compared with an enum column uses its input type
// ---------------------------------------------------------------------------

test('sql-builder where: eq and ne reject an out-of-union literal on either side', () => {
  const db = null as unknown as EnumDb;
  const users = db.__unbound__.User.select('role');

  // @ts-expect-error 'nope' is not in the 'user' | 'admin' union
  users.where((f, fns) => fns.eq(f.role, 'nope'));
  // @ts-expect-error 'nope' is not in the 'user' | 'admin' union
  users.where((f, fns) => fns.eq('nope', f.role));
  // @ts-expect-error 'nope' is not in the 'user' | 'admin' union
  users.where((f, fns) => fns.ne(f.role, 'nope'));
  // @ts-expect-error 'nope' is not in the 'active' | 'inactive' union
  users.where((f, fns) => fns.eq(f.status, 'nope'));
});

test('sql-builder where: in and notIn reject an out-of-union literal', () => {
  const db = null as unknown as EnumDb;
  const users = db.__unbound__.User.select('role');

  // @ts-expect-error 'nope' is not in the 'user' | 'admin' union
  users.where((f, fns) => fns.in(f.role, ['user', 'nope']));
  // @ts-expect-error 'nope' is not in the 'user' | 'admin' union
  users.where((f, fns) => fns.notIn(f.role, ['nope']));
});

test('sql-builder where: in-union literals, null and column operands are accepted', () => {
  const db = null as unknown as EnumDb;
  const users = db.__unbound__.User.select('role');

  users.where((f, fns) => fns.eq(f.role, 'admin'));
  users.where((f, fns) => fns.eq('admin', f.role));
  users.where((f, fns) => fns.ne(f.role, 'user'));
  users.where((f, fns) => fns.eq(f.status, null));
  users.where((f, fns) => fns.eq(f.role, f.status));
  users.where((f, fns) => fns.in(f.role, ['user', 'admin']));
  users.where((f, fns) => fns.notIn(f.status, ['inactive']));
});

test('sql-builder where: a raw SQL operand keeps the codec input type', () => {
  const db = null as unknown as EnumDb;
  const users = db.__unbound__.User.select('role');

  users.where((_f, fns) => fns.eq(fns.raw`lower(role)`.returns('pg/text@1'), 'nope'));
});
