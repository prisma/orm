import type { CrossReference, ProfileHashBase, StorageHashBase } from '@internal/contract/types';
import type {
  MongoContractWithTypeMaps,
  MongoCollection as MongoStorageCollection,
  MongoTypeMaps,
} from '@internal/mongo-contract';
import { describe, expectTypeOf, test } from 'vitest';
import type { MongoCollection } from '../src/collection';
import type { MongoWhereFilter } from '../src/types';

type TestCodecTypes = {
  readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
  readonly 'mongo/string@1': { readonly input: string; readonly output: string };
};

type TestFieldTypes = {
  readonly __unbound__: {
    readonly Lists: {
      readonly _id: string;
      readonly name: string;
      readonly nickname: string | null;
      readonly strings: readonly string[];
      readonly nullableStrings: readonly (string | null)[];
      readonly optionalStrings: readonly string[] | null;
      readonly optionalNullableStrings: readonly (string | null)[] | null;
      readonly entries: readonly { value: string }[];
    };
  };
};

type ScalarField<Nullable extends boolean> = {
  readonly nullable: Nullable;
  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
};

type ListField<
  Nullable extends boolean,
  ElementNullable extends boolean,
> = ScalarField<Nullable> & {
  readonly many: { readonly elementNullable: ElementNullable };
};

type ListsContract = MongoContractWithTypeMaps<
  {
    readonly target: 'mongo';
    readonly targetFamily: 'mongo';
    readonly profileHash: ProfileHashBase<'test'>;
    readonly capabilities: Record<string, never>;
    readonly extensions: Record<string, never>;
    readonly meta: Record<string, never>;
    readonly roots: { readonly lists: CrossReference & { readonly model: 'Lists' } };
    readonly domain: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly models: {
            readonly Lists: {
              readonly fields: {
                readonly _id: {
                  readonly nullable: false;
                  readonly many: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
                };
                readonly name: ScalarField<false>;
                readonly nickname: ScalarField<true>;
                readonly strings: ListField<false, false>;
                readonly nullableStrings: ListField<false, true>;
                readonly optionalStrings: ListField<true, false>;
                readonly optionalNullableStrings: ListField<true, true>;
                readonly entries: {
                  readonly nullable: false;
                  readonly many: { readonly elementNullable: false };
                  readonly type: {
                    readonly kind: 'valueObject';
                    readonly plane: 'storage';
                    readonly namespaceId: '__unbound__';
                    readonly entityKind: 'valueObject';
                    readonly entityName: 'Entry';
                  };
                };
              };
              readonly relations: Record<string, never>;
              readonly storage: { readonly collection: 'lists' };
            };
          };
        };
      };
    };
    readonly storage: {
      readonly storageHash: StorageHashBase<'test-storage'>;
      readonly namespaces: {
        readonly __unbound__: {
          readonly id: '__unbound__';
          readonly kind: 'mongo-namespace';
          readonly entries: {
            readonly collection: { readonly lists: MongoStorageCollection };
            readonly valueObject: {
              readonly Entry: {
                readonly fields: { readonly value: ScalarField<false> };
              };
            };
          };
        };
      };
    };
  },
  MongoTypeMaps<TestCodecTypes, TestFieldTypes, TestFieldTypes>
>;

type Filter = MongoWhereFilter<ListsContract, 'Lists', TestCodecTypes>;

describe('where on a list whose container and items are not nullable (String[])', () => {
  test('takes one element or a whole list', () => {
    expectTypeOf<Filter['strings']>().toEqualTypeOf<string | readonly string[] | undefined>();
  });

  test('rejects null and a list holding null', () => {
    // @ts-expect-error the list itself is never null
    void ({ strings: null } satisfies Filter);
    // @ts-expect-error the items are never null
    void ({ strings: ['a', null] } satisfies Filter);
  });
});

describe('where on a list whose items may be null (String?[])', () => {
  test('takes one element or a whole list whose items may be null', () => {
    expectTypeOf<Filter['nullableStrings']>().toEqualTypeOf<
      string | readonly (string | null)[] | undefined
    >();
  });

  test('rejects null for the whole field', () => {
    // @ts-expect-error the list itself is never null
    void ({ nullableStrings: null } satisfies Filter);
  });
});

describe('where on a nullable list (String[]?)', () => {
  test('takes one element, a whole list or null', () => {
    expectTypeOf<Filter['optionalStrings']>().toEqualTypeOf<
      string | readonly string[] | null | undefined
    >();
  });

  test('rejects a list holding null', () => {
    // @ts-expect-error the items are never null
    void ({ optionalStrings: ['a', null] } satisfies Filter);
  });
});

describe('where on a nullable list whose items may be null (String?[]?)', () => {
  test('takes one element, a whole list whose items may be null, or null', () => {
    expectTypeOf<Filter['optionalNullableStrings']>().toEqualTypeOf<
      string | readonly (string | null)[] | null | undefined
    >();
  });
});

describe('where on fields that are not scalar lists', () => {
  test('a value-object list stays untyped', () => {
    expectTypeOf<Filter['entries']>().toEqualTypeOf<unknown>();
  });

  test('a scalar field takes only its codec output', () => {
    expectTypeOf<Filter['name']>().toEqualTypeOf<string | undefined>();
    // @ts-expect-error a scalar field takes no list
    void ({ name: ['a'] } satisfies Filter);
    // @ts-expect-error the field is never null
    void ({ name: null } satisfies Filter);
  });

  test('a nullable scalar field also takes null', () => {
    expectTypeOf<Filter['nickname']>().toEqualTypeOf<string | null | undefined>();
  });
});

test('collection.where() takes each newly allowed list value', () => {
  const lists = {} as MongoCollection<ListsContract, 'Lists'>;
  expectTypeOf(
    lists
      .where({ strings: ['a', 'b'] })
      .where({ nullableStrings: ['a', null] })
      .where({ optionalStrings: null })
      .where({ optionalStrings: [] })
      .where({ optionalNullableStrings: [null] })
      .where({ optionalNullableStrings: null })
      .where({ nickname: null }),
  ).toEqualTypeOf<MongoCollection<ListsContract, 'Lists'>>();
});
