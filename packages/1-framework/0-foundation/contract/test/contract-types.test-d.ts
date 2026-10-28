import { expectTypeOf, test } from 'vitest';
import type { Contract, ContractValueObjectAt } from '../src/contract-types';
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
        readonly id: { readonly dataType: 'example/int4' };
        readonly email: { readonly dataType: 'example/text' };
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

test('preserves storage hash literal through TStorage', () => {
  expectTypeOf<ExampleContract['storage']['storageHash']>().toEqualTypeOf<
    StorageHashBase<'abc123'>
  >();
});

test('preserves storage table literal types through TStorage', () => {
  expectTypeOf<
    ExampleContract['storage']['tables']['user']['columns']['id']['dataType']
  >().toEqualTypeOf<'example/int4'>();
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

test('ContractValueObjectAt finds the value object a reference names in its storage namespace', () => {
  type Point = { readonly fields: { readonly x: ContractField } };
  type Geo = { readonly fields: { readonly lat: ContractField } };
  type Storage = {
    readonly namespaces: {
      readonly public: { readonly entries: { readonly valueObject: { readonly Point: Point } } };
      readonly geo: { readonly entries: { readonly valueObject: { readonly Point: Geo } } };
    };
  };
  type Ref<Ns extends string, Name extends string> = {
    readonly namespaceId: Ns;
    readonly entityName: Name;
  };
  expectTypeOf<ContractValueObjectAt<Storage, Ref<'public', 'Point'>>>().toEqualTypeOf<Point>();
  expectTypeOf<ContractValueObjectAt<Storage, Ref<'geo', 'Point'>>>().toEqualTypeOf<Geo>();
  expectTypeOf<ContractValueObjectAt<Storage, Ref<'public', 'Missing'>>>().toBeNever();
  expectTypeOf<ContractValueObjectAt<Storage, Ref<'missing', 'Point'>>>().toBeNever();
});
