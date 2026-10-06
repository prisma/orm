import type { Contract as ContractType, StorageHashBase } from '@internal/contract/types';
import type { ContractWithTypeMaps, TypeMaps } from '@internal/sql-contract/types';

// A hand-authored stand-in for an emitted `contract.d.ts`, trimmed to the
// shape the facade reachability tests need: a single `__unbound__` namespace
// (real sqlite contracts land in the unbound schema) whose storage carries a
// `users` table and whose domain carries a `User` model.
// Mirrors the structural literal an emitted contract produces (so it stays
// assignable to the facade's `Contract<SqlStorage>` bound) without depending
// on a target's generated codec type maps.

type Models = {
  readonly User: {
    readonly fields: {
      readonly id: {
        readonly many: false;
        readonly nullable: false;
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'sqlite/integer@1' };
      };
      readonly name: {
        readonly many: false;
        readonly nullable: false;
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'sqlite/text@1' };
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
    readonly __unbound__: {
      readonly id: '__unbound__';
      readonly kind: 'sqlite-namespace';
      readonly entries: {
        readonly table: {
          readonly users: {
            columns: {
              readonly id: {
                readonly many: false;
                readonly nativeType: 'integer';
                readonly codecId: 'sqlite/integer@1';
                readonly nullable: false;
              };
              readonly name: {
                readonly many: false;
                readonly nativeType: 'text';
                readonly codecId: 'sqlite/text@1';
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
  readonly target: 'sqlite';
  readonly targetFamily: 'sql';
  readonly roots: Record<string, never>;
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: { readonly models: Models };
    };
  };
};

export type Contract = ContractWithTypeMaps<ContractBase, TypeMaps>;
