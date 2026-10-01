import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../src/contract-types';
import type { CrossReference } from '../src/cross-reference';
import type { ContractField, ContractModel, ModelStorageBase } from '../src/domain-types';
import type { NamespaceId } from '../src/namespace-id';
import type { StorageBase, StorageHashBase } from '../src/types';

type ExamplePostRef = CrossReference & {
  readonly namespace: NamespaceId;
  readonly model: 'Post';
};

// ── Example literal types for proofs ─────────────────────────────────────────

type ExampleModelStorage = {
  readonly table: 'user';
  readonly fields: {
    readonly id: { readonly column: 'id' };
    readonly email: { readonly column: 'email' };
  };
};

type ExampleModels = {
  readonly User: ContractModel<ExampleModelStorage> & {
    readonly fields: {
      readonly id: {
        readonly nullable: false;
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/int4@1' };
        readonly many: false;
      };
      readonly email: {
        readonly nullable: false;
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly many: false;
      };
    };
    readonly relations: {
      readonly posts: {
        readonly to: ExamplePostRef;
        readonly cardinality: '1:N';
        readonly on: {
          readonly localFields: readonly ['id'];
          readonly targetFields: readonly ['userId'];
        };
      };
    };
    readonly storage: ExampleModelStorage;
  };
};

type ExampleStorage = StorageBase<'abc123'> & {
  readonly namespaces: Record<string, never>;
  readonly tables: {
    readonly user: {
      readonly columns: {
        readonly id: { readonly nativeType: 'int4' };
        readonly email: { readonly nativeType: 'text' };
      };
    };
  };
};

type ExampleContract = Omit<Contract<ExampleStorage>, 'domain'> & {
  readonly domain: {
    readonly namespaces: {
      readonly public: { readonly models: ExampleModels };
    };
  };
};

// ── ContractModel generic storage ────────────────────────────────────────────

test('ContractModel with specific storage extends base ContractModel', () => {
  expectTypeOf<ContractModel<ExampleModelStorage>>().toExtend<ContractModel>();
});

test('ContractModel defaults to ModelStorageBase', () => {
  expectTypeOf<ContractModel>().toExtend<ContractModel<ModelStorageBase>>();
});

// ── StorageBase ──────────────────────────────────────────────────────────────

test('StorageBase with specific hash extends default StorageBase', () => {
  expectTypeOf<StorageBase<'abc123'>>().toExtend<StorageBase>();
});

// ── Literal type preservation ────────────────────────────────────────────────

test('preserves model field literal types through the domain namespace', () => {
  expectTypeOf<
    ExampleContract['domain']['namespaces']['public']['models']['User']['fields']['id']['type']['kind']
  >().toEqualTypeOf<'scalar'>();
});

test('preserves relation literal types through the domain namespace', () => {
  expectTypeOf<
    ExampleContract['domain']['namespaces']['public']['models']['User']['relations']['posts']['to']
  >().toEqualTypeOf<ExamplePostRef>();
});

test('preserves model storage bridge literals through the domain namespace', () => {
  expectTypeOf<
    ExampleContract['domain']['namespaces']['public']['models']['User']['storage']['table']
  >().toEqualTypeOf<'user'>();
});

test('preserves storage hash literal through TStorage', () => {
  expectTypeOf<ExampleContract['storage']['storageHash']>().toEqualTypeOf<
    StorageHashBase<'abc123'>
  >();
});

test('preserves storage table literal types through TStorage', () => {
  expectTypeOf<
    ExampleContract['storage']['tables']['user']['columns']['id']['nativeType']
  >().toEqualTypeOf<'int4'>();
});

// ── Framework consumer compatibility ─────────────────────────────────────────

test('emitted contract satisfies Contract', () => {
  expectTypeOf<ExampleContract>().toExtend<Contract>();
});

test('old many: true does not satisfy ContractField', () => {
  expectTypeOf<{
    readonly nullable: false;
    readonly type: { readonly kind: 'scalar'; readonly codecId: 'text' };
    readonly many: true;
  }>().not.toExtend<ContractField>();
});

test('ContractField has no sibling elementNullable property', () => {
  expectTypeOf<ContractField>().not.toHaveProperty('elementNullable');
});
