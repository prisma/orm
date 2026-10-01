import type { Contract as ContractType, StorageHashBase } from '@internal/contract/types';
import type { ContractWithTypeMaps, TypeMaps } from '@internal/sql-contract/types';

// A hand-authored stand-in for an emitted `contract.d.ts`, trimmed to the
// shape the facade reachability tests need: a single `public` namespace whose
// storage carries a `users` table and whose domain carries a `User` model.
// Mirrors the structural literal an emitted contract produces (so it stays
// assignable to the facade's `Contract<SqlStorage>` bound) without depending
// on a target's generated codec type maps.

type Models = {
  readonly User: {
    readonly fields: {
      readonly id: {
        readonly many: false;
        readonly nullable: false;
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
      };
      readonly name: {
        readonly many: false;
        readonly nullable: false;
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
      };
    };
    readonly relations: Record<string, never>;
    readonly storage: {
      readonly table: 'users';
      readonly fields: {
        readonly id: { readonly column: 'id' };
        readonly name: { readonly column: 'name' };
      };
    };
  };
};

type Storage = {
  readonly storageHash: StorageHashBase<'namespaced-facade-fixture'>;
  readonly namespaces: {
    readonly public: {
      readonly id: 'public';
      readonly kind: 'postgres-schema';
      readonly entries: {
        readonly table: {
          readonly users: {
            columns: {
              readonly id: {
                readonly many: false;
                readonly nativeType: 'int4';
                readonly codecId: 'pg/int4@1';
                readonly nullable: false;
              };
              readonly name: {
                readonly many: false;
                readonly nativeType: 'text';
                readonly codecId: 'pg/text@1';
                readonly nullable: false;
              };
            };
            primaryKey: { readonly columns: readonly ['id'] };
            uniques: readonly [];
            indexes: readonly [];
            foreignKeys: readonly [];
          };
        };
      };
    };
  };
};

type ContractBase = Omit<ContractType<Storage>, 'roots' | 'domain'> & {
  readonly target: 'postgres';
  readonly targetFamily: 'sql';
  readonly roots: Record<string, never>;
  readonly domain: {
    readonly namespaces: {
      readonly public: { readonly models: Models };
    };
  };
};

export type Contract = ContractWithTypeMaps<ContractBase, TypeMaps>;
