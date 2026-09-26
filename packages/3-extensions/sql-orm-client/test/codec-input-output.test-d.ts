import type { Contract, StorageHashBase } from '@internal/contract/types';
import type { ContractWithTypeMaps, TypeMaps } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { CreateInput, DefaultModelRow, MutationUpdateInput } from '../src/types';

// ---------------------------------------------------------------------------
// Codec whose input and output differ
//
// Mirrors the issue: an extension codec on a jsonb column that accepts a
// per-locale label map on write and decodes to the current-locale string on
// read. The emitted FieldInputTypes / FieldOutputTypes maps carry the two
// sides; mutation inputs must read the input side.
// ---------------------------------------------------------------------------

type LocalizedLabel = { readonly [locale: string]: string };

type LabelCodecTypes = {
  'acme/localized-label@1': {
    output: string;
    input: LocalizedLabel;
    traits: 'equality';
  };
  'pg/text@1': {
    output: string;
    input: string;
    traits: 'equality';
  };
};

type LabelFieldOutputTypes = {
  __unbound__: {
    Product: {
      sku: string;
      title: string;
    };
  };
};

type LabelFieldInputTypes = {
  __unbound__: {
    Product: {
      sku: string;
      title: LocalizedLabel;
    };
  };
};

type LabelTypeMaps = TypeMaps<
  LabelCodecTypes,
  Record<string, never>,
  LabelFieldOutputTypes,
  LabelFieldInputTypes
>;

type LabelStorage = {
  storageHash: StorageHashBase<string>;
  namespaces: {
    __unbound__: {
      id: '__unbound__';
      kind: 'schema';
      entries: {
        table: {
          Product: {
            columns: {
              sku: { nativeType: 'text'; codecId: 'pg/text@1'; nullable: false };
              title: {
                nativeType: 'jsonb';
                codecId: 'acme/localized-label@1';
                nullable: false;
              };
            };
            primaryKey: { columns: ['sku'] };
            uniques: [];
            indexes: [];
            foreignKeys: [];
          };
        };
      };
    };
  };
};

type LabelModels = {
  Product: {
    storage: {
      table: 'Product';
      fields: {
        sku: { column: 'sku' };
        title: { column: 'title' };
      };
    };
    fields: {
      sku: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'pg/text@1' };
        readonly nullable: false;
      };
      title: {
        readonly type: {
          readonly kind: 'scalar';
          readonly codecId: 'acme/localized-label@1';
        };
        readonly nullable: false;
      };
    };
    relations: Record<string, never>;
  };
};

type LabelContractBase = Omit<Contract<LabelStorage>, 'domain'> & {
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: { readonly models: LabelModels };
    };
  };
};

type LabelContract = ContractWithTypeMaps<LabelContractBase, LabelTypeMaps>;

type ProductRow = DefaultModelRow<LabelContract, 'Product'>;
type ProductCreateInput = CreateInput<LabelContract, 'Product'>;
type ProductUpdateInput = MutationUpdateInput<LabelContract, 'Product'>;

test('ORM read output: custom codec field decodes to the output type', () => {
  expectTypeOf<ProductRow['title']>().toEqualTypeOf<string>();
});

test('ORM create input: custom codec field accepts the input type', () => {
  expectTypeOf<ProductCreateInput['title']>().toEqualTypeOf<LocalizedLabel>();
});

test('ORM create input: custom codec field rejects the output-only shape', () => {
  expectTypeOf<ProductCreateInput['title']>().not.toEqualTypeOf<string>();
});

test('ORM create input: plain field keeps its scalar type', () => {
  expectTypeOf<ProductCreateInput['sku']>().toEqualTypeOf<string>();
});

test('ORM update input: custom codec field accepts the input type', () => {
  expectTypeOf<ProductUpdateInput['title']>().toEqualTypeOf<LocalizedLabel | undefined>();
});
