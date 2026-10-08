import type { Contract, NamespaceId, StorageHashBase } from '@internal/contract/types';
import type { ContractWithTypeMaps, TypeMaps } from '@internal/sql-contract/types';
import { describe, expectTypeOf, test } from 'vitest';
import type { Collection } from '../src/collection';
import type {
  MutationCreateInput,
  MutationUpdateInput,
  UniqueConstraintCriterion,
} from '../src/types';

type CodecTypes = {
  'pg/int4@1': { output: number; traits: 'equality' | 'order' | 'numeric' };
  'pg/text@1': { output: string; traits: 'equality' | 'order' | 'textual' };
};

type FieldOutputTypes = {
  __unbound__: {
    Owner: { id: number; name: string };
    Account: { id: number; handle: string | null; ownerId: number | null };
  };
};

type NullableUniqueTypeMaps = TypeMaps<
  CodecTypes,
  Record<string, never>,
  FieldOutputTypes,
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  Record<string, never>
>;

type Storage = {
  storageHash: StorageHashBase<string>;
  namespaces: {
    __unbound__: {
      id: '__unbound__';
      kind: 'schema';
      entries: {
        table: {
          owner: {
            columns: {
              id: {
                readonly many: false;
                dataType: 'pg/int4';
                codecId: 'pg/int4@1';
                nullable: false;
              };
              name: {
                readonly many: false;
                dataType: 'pg/text';
                codecId: 'pg/text@1';
                nullable: false;
              };
            };
            primaryKey: { columns: ['id'] };
            uniques: [];
            indexes: [];
            foreignKeys: [];
          };
          account: {
            columns: {
              id: {
                readonly many: false;
                dataType: 'pg/int4';
                codecId: 'pg/int4@1';
                nullable: false;
              };
              handle: {
                readonly many: false;
                dataType: 'pg/text';
                codecId: 'pg/text@1';
                nullable: true;
              };
              ownerId: {
                readonly many: false;
                dataType: 'pg/int4';
                codecId: 'pg/int4@1';
                nullable: true;
              };
            };
            primaryKey: { columns: ['id'] };
            uniques: [{ columns: ['handle'] }];
            indexes: [];
            foreignKeys: [];
          };
        };
      };
    };
  };
};

type Models = {
  Owner: {
    storage: { table: 'owner'; fields: { id: { column: 'id' }; name: { column: 'name' } } };
    fields: {
      id: {
        readonly many: false;
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
        readonly nullable: false;
      };
      name: {
        readonly many: false;
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: false;
      };
    };
    relations: {
      accounts: {
        to: { readonly namespace: '__unbound__' & NamespaceId; readonly model: 'Account' };
        cardinality: '1:N';
        on: { localFields: readonly ['id']; targetFields: readonly ['ownerId'] };
      };
    };
  };
  Account: {
    storage: {
      table: 'account';
      fields: {
        id: { column: 'id' };
        handle: { column: 'handle' };
        ownerId: { column: 'ownerId' };
      };
    };
    fields: {
      id: {
        readonly many: false;
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
        readonly nullable: false;
      };
      handle: {
        readonly many: false;
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: true;
      };
      ownerId: {
        readonly many: false;
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
        readonly nullable: true;
      };
    };
    relations: Record<string, never>;
  };
};

type NullableUniqueContract = ContractWithTypeMaps<
  Omit<Contract<Storage>, 'domain' | 'capabilities'> & {
    readonly domain: { readonly namespaces: { readonly __unbound__: { readonly models: Models } } };
    readonly capabilities: { readonly postgres: { readonly returning: true } };
  },
  NullableUniqueTypeMaps
>;

type AccountCriterion = UniqueConstraintCriterion<NullableUniqueContract, 'Account'>;

declare const accounts: Collection<NullableUniqueContract, 'Account'>;
declare const handle: string | null;

describe('a unique criterion on a nullable unique column', () => {
  test('the column is nullable in the row', () => {
    expectTypeOf(accounts.first()).resolves.toExtend<{ handle: string | null } | null>();
    expectTypeOf<null>().toExtend<Awaited<ReturnType<typeof accounts.first>>>();
    expectTypeOf(accounts.where({ handle: null })).not.toBeAny();
  });

  test('has no null in its value', () => {
    expectTypeOf<AccountCriterion>().toEqualTypeOf<{ id: number } | { handle: string }>();
  });

  test('whereUnique accepts a value and refuses null', () => {
    expectTypeOf(accounts.whereUnique({ handle: 'a' })).not.toBeAny();
    expectTypeOf(accounts.whereUnique({ id: 1 })).not.toBeAny();
    // @ts-expect-error null cannot identify one row
    accounts.whereUnique({ handle: null });
    // @ts-expect-error a value that may be null cannot identify one row
    accounts.whereUnique({ handle });
  });

  test('conflictOn accepts a value and refuses null', () => {
    expectTypeOf(
      accounts.upsert({ create: { id: 1 }, update: {}, conflictOn: { handle: 'a' } }),
    ).not.toBeAny();
    expectTypeOf(
      accounts.upsert({ create: { id: 1 }, update: {}, conflictOn: { id: 1 } }),
    ).not.toBeAny();
    accounts.upsert({
      create: { id: 1 },
      update: {},
      // @ts-expect-error null cannot identify one row
      conflictOn: { handle: null },
    });
  });

  test('connect accepts a value and refuses null', () => {
    type Create = MutationCreateInput<NullableUniqueContract, 'Owner'>;
    const accepted: Create = {
      id: 1,
      name: 'a',
      accounts: (mutator) => mutator.connect([{ handle: 'a' }, { id: 1 }]),
    };
    expectTypeOf(accepted).toExtend<Create>();
    const refused: Create = {
      id: 1,
      name: 'a',
      accounts: (mutator) =>
        // @ts-expect-error null cannot identify one row
        mutator.connect({ handle: null }),
    };
    expectTypeOf(refused).toExtend<Create>();
  });

  test('disconnect accepts a value and refuses null', () => {
    type Update = MutationUpdateInput<NullableUniqueContract, 'Owner'>;
    const accepted: Update = {
      accounts: (mutator) => mutator.disconnect([{ handle: 'a' }]),
    };
    expectTypeOf(accepted).toExtend<Update>();
    const refused: Update = {
      accounts: (mutator) =>
        // @ts-expect-error null cannot identify one row
        mutator.disconnect([{ handle: null }]),
    };
    expectTypeOf(refused).toExtend<Update>();
  });
});
