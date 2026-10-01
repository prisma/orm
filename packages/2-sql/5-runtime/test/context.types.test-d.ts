import type { Contract, StorageHashBase } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { ExecutionContext, TypeHelperRegistry } from '../src/sql-context';

// Contract type with storage.types using literal types (matching emission output)
type TestContract = Contract<{
  readonly storageHash: StorageHashBase<string>;
  readonly namespaces: {
    readonly __unbound__: {
      readonly id: '__unbound__';
      readonly kind: 'test-sql-namespace';
      readonly entries: {
        readonly table: {
          readonly document: {
            readonly columns: {
              readonly id: {
                readonly nativeType: 'int4';
                readonly codecId: 'pg/int4@1';
                readonly nullable: false;
                readonly many: false;
              };
            };
            readonly primaryKey: { readonly columns: readonly ['id'] };
            readonly uniques: readonly [];
            readonly indexes: readonly [];
            readonly foreignKeys: readonly [];
          };
        };
      };
    };
  };
  readonly types: {
    readonly Vector1536: {
      readonly kind: 'codec-instance';
      readonly codecId: 'pg/vector@1';
      readonly nativeType: 'vector';
      readonly typeParams: { readonly length: 1536 };
    };
  };
}>;

test('ExecutionContext.types is TypeHelperRegistry', () => {
  // ExecutionContext.types is intentionally loose (Record<string, unknown>)
  // The strong typing comes from schema(context).types via ExtractSchemaTypes
  expectTypeOf<ExecutionContext<TestContract>['types']>().toEqualTypeOf<TypeHelperRegistry>();

  // TypeHelperRegistry allows any values - the actual type depends on init hooks
  expectTypeOf<TypeHelperRegistry>().toEqualTypeOf<Record<string, unknown>>();
});

test('ExecutionContext preserves contract type parameter', () => {
  // Verify the contract type is preserved in ExecutionContext
  expectTypeOf<ExecutionContext<TestContract>['contract']>().toEqualTypeOf<TestContract>();

  // Verify we can access storage.types through the context's contract
  type ContractStorageTypes = ExecutionContext<TestContract>['contract']['storage']['types'];
  expectTypeOf<ContractStorageTypes>().toExtend<
    | {
        readonly Vector1536: {
          readonly kind: 'codec-instance';
          readonly codecId: 'pg/vector@1';
          readonly nativeType: 'vector';
          readonly typeParams: { readonly length: 1536 };
        };
      }
    | undefined
  >();
});

test('ExecutionContext accepts generic Contract', () => {
  // Verify ExecutionContext defaults work
  type DefaultContext = ExecutionContext;
  expectTypeOf<DefaultContext['contract']>().toExtend<Contract<SqlStorage>>();
  expectTypeOf<DefaultContext['types']>().toEqualTypeOf<TypeHelperRegistry>();
});
