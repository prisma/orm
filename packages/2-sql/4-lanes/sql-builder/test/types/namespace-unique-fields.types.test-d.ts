import type { ContractWithTypeMaps } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { Db } from '../../src/exports/types';
import type { ContractToQC } from '../../src/types/table-proxy';
import type {
  CodecTypes,
  Contract,
  StorageColumnInputTypes,
  StorageColumnTypes,
  TypeMaps,
} from '../fixtures/generated/contract';

/**
 * Regression: the same bare table name in two namespaces, each with a
 * namespace-UNIQUE column, must be selectable through its own namespace facet
 * and resolve to that namespace's own column type.
 *
 * The generated fixture declares `public.users` with a unique `email` column.
 * Here we extend it with an `auth` namespace that declares the SAME bare table
 * name `users` but with a DIFFERENT unique column `token`.
 *
 * `Namespace<C, Ns>['users']` resolves to `TableProxy<C, Ns, 'users'>`, which
 * derives its selectable columns from the table at that namespace coordinate
 * (`storage.namespaces[Ns].entries.table.users`) rather than a cross-namespace
 * union. So each namespace's unique column is selectable through its own facet,
 * and resolves to its own type, while the other namespace's column is absent.
 */

type TwoNamespaceStorageColumnTypes = StorageColumnTypes & {
  readonly auth: {
    readonly users: {
      readonly id: CodecTypes['pg/int4@1']['output'];
      readonly token: CodecTypes['pg/text@1']['output'];
    };
  };
};

type TwoNamespaceStorageColumnInputTypes = StorageColumnInputTypes & {
  readonly auth: {
    readonly users: {
      readonly id: CodecTypes['pg/int4@1']['input'];
      readonly token: CodecTypes['pg/text@1']['input'];
    };
  };
};

type TwoNamespaceTypeMaps = TypeMaps & {
  readonly storageColumnTypes: TwoNamespaceStorageColumnTypes;
  readonly storageColumnInputTypes: TwoNamespaceStorageColumnInputTypes;
};

type TwoNamespaceContractBase = Omit<Contract, 'storage'> & {
  readonly storage: Omit<Contract['storage'], 'namespaces'> & {
    readonly namespaces: Contract['storage']['namespaces'] & {
      readonly auth: {
        readonly id: 'auth';
        readonly kind: 'postgres-schema';
        readonly entries: {
          readonly table: {
            readonly users: {
              readonly columns: {
                readonly id: {
                  readonly many: false;
                  readonly nativeType: 'int4';
                  readonly codecId: 'pg/int4@1';
                  readonly nullable: false;
                };
                readonly token: {
                  readonly many: false;
                  readonly nativeType: 'text';
                  readonly codecId: 'pg/text@1';
                  readonly nullable: false;
                };
              };
              readonly primaryKey: { readonly columns: readonly ['id'] };
              readonly uniques: readonly [];
              readonly indexes: readonly [];
              readonly foreignKeys: readonly [];
            };
          };
          readonly type: Record<string, never>;
        };
      };
    };
  };
};

type TwoNamespaceContract = ContractWithTypeMaps<TwoNamespaceContractBase, TwoNamespaceTypeMaps>;

declare const db: Db<TwoNamespaceContract>;

type PublicUsersColumns = ContractToQC<
  TwoNamespaceContract,
  'public',
  'users'
>['resolvedColumnOutputTypes'];
type AuthUsersColumns = ContractToQC<
  TwoNamespaceContract,
  'auth',
  'users'
>['resolvedColumnOutputTypes'];

test('the public-namespace users facet selects `email` and resolves it to its own type', () => {
  // Selectable through the public facet — a compile error if it were not.
  db.public.users.select('id', 'email').build();

  expectTypeOf<PublicUsersColumns['id']>().toEqualTypeOf<number>();
  expectTypeOf<PublicUsersColumns['email']>().toEqualTypeOf<string>();
  // `token` belongs to auth.users, not public.users.
  expectTypeOf<'token' extends keyof PublicUsersColumns ? true : false>().toEqualTypeOf<false>();
});

test('the auth-namespace users facet selects `token` and resolves it to its own type', () => {
  // Selectable through the auth facet — a compile error if it were not.
  db.auth.users.select('id', 'token').build();

  expectTypeOf<AuthUsersColumns['id']>().toEqualTypeOf<number>();
  expectTypeOf<AuthUsersColumns['token']>().toEqualTypeOf<string>();
  // `email` belongs to public.users, not auth.users.
  expectTypeOf<'email' extends keyof AuthUsersColumns ? true : false>().toEqualTypeOf<false>();
});
