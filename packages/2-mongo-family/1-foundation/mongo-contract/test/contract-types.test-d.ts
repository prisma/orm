import type { CrossReference, ProfileHashBase, StorageHashBase } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import type {
  ExtractMongoFieldInputTypes,
  ExtractMongoFieldOutputTypes,
  InferModelRow,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
  MongoUnboundFieldInputTypes,
  MongoUnboundFieldOutputTypes,
} from '../src/contract-types';
import type { MongoCollection } from '../src/ir/mongo-collection';
import type { MongoCollectionOptionsAuthoringInput } from '../src/ir/mongo-collection-options';
import type { MongoIndexOptionsInput } from '../src/ir/mongo-index-options';

type RoleEnum = {
  readonly codecId: 'mongo/string@1';
  readonly members: readonly [
    { readonly name: 'User'; readonly value: 'user' },
    { readonly name: 'Admin'; readonly value: 'admin' },
  ];
};

type ContractWithEnum = MongoContractWithTypeMaps<
  {
    readonly target: 'mongo';
    readonly targetFamily: 'mongo';
    readonly profileHash: ProfileHashBase<'enum-test'>;
    readonly capabilities: Record<string, never>;
    readonly extensions: Record<string, never>;
    readonly meta: Record<string, never>;
    readonly roots: Record<string, never>;
    readonly domain: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly enum: { readonly Role: RoleEnum };
          readonly models: {
            readonly Account: {
              readonly fields: {
                readonly _id: {
                  readonly nullable: false;
                  readonly many: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
                };
                readonly role: {
                  readonly nullable: false;
                  readonly many: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                  readonly valueSet: {
                    readonly plane: 'domain';
                    readonly entityKind: 'enum';
                    readonly namespaceId: '__unbound__';
                    readonly entityName: 'Role';
                  };
                };
                readonly nullableRole: {
                  readonly nullable: true;
                  readonly many: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                  readonly valueSet: {
                    readonly plane: 'domain';
                    readonly entityKind: 'enum';
                    readonly namespaceId: '__unbound__';
                    readonly entityName: 'Role';
                  };
                };
                readonly manyRoles: {
                  readonly nullable: false;
                  readonly many: { readonly elementNullable: false };
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                  readonly valueSet: {
                    readonly plane: 'domain';
                    readonly entityKind: 'enum';
                    readonly namespaceId: '__unbound__';
                    readonly entityName: 'Role';
                  };
                };
                readonly manyNullableRoles: {
                  readonly nullable: true;
                  readonly many: { readonly elementNullable: false };
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                  readonly valueSet: {
                    readonly plane: 'domain';
                    readonly entityKind: 'enum';
                    readonly namespaceId: '__unbound__';
                    readonly entityName: 'Role';
                  };
                };
              };
              readonly relations: Record<string, never>;
              readonly storage: { readonly collection: 'accounts' };
            };
          };
          readonly valueObjects: Record<string, never>;
        };
      };
    };
    readonly storage: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly id: '__unbound__';
          readonly kind: 'mongo-namespace';
          readonly entries: { readonly collection: Record<string, never> };
        };
      };
      readonly storageHash: StorageHashBase<'enum-test-storage'>;
    };
  },
  MongoTypeMaps<
    {
      readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
      readonly 'mongo/string@1': { readonly input: string; readonly output: string };
    },
    {
      readonly __unbound__: {
        readonly Account: {
          readonly _id: string;
          readonly role: 'user' | 'admin';
          readonly nullableRole: 'user' | 'admin' | null;
          readonly manyRoles: ('user' | 'admin')[];
          readonly manyNullableRoles: ('user' | 'admin')[] | null;
        };
      };
    },
    {
      readonly __unbound__: {
        readonly Account: {
          readonly _id: string;
          readonly role: 'user' | 'admin';
          readonly nullableRole: 'user' | 'admin' | null;
          readonly manyRoles: ('user' | 'admin')[];
          readonly manyNullableRoles: ('user' | 'admin')[] | null;
        };
      };
    }
  >
>;

test('enum-typed field narrows to the literal value union', () => {
  type Row = InferModelRow<ContractWithEnum, 'Account'>;
  expectTypeOf<Row['role']>().toEqualTypeOf<'user' | 'admin'>();
});

test('nullable enum field narrows to value union | null', () => {
  type Row = InferModelRow<ContractWithEnum, 'Account'>;
  expectTypeOf<Row['nullableRole']>().toEqualTypeOf<'user' | 'admin' | null>();
});

test('many enum field narrows to value union array', () => {
  type Row = InferModelRow<ContractWithEnum, 'Account'>;
  expectTypeOf<Row['manyRoles']>().toEqualTypeOf<('user' | 'admin')[]>();
});

test('many + nullable enum field narrows to value union array | null', () => {
  type Row = InferModelRow<ContractWithEnum, 'Account'>;
  expectTypeOf<Row['manyNullableRoles']>().toEqualTypeOf<('user' | 'admin')[] | null>();
});

test('non-enum field still resolves via codec output', () => {
  type Row = InferModelRow<ContractWithEnum, 'Account'>;
  expectTypeOf<Row['_id']>().toEqualTypeOf<string>();
});

type TestCodecTypes = {
  readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
  readonly 'mongo/string@1': { readonly input: string; readonly output: string };
  readonly 'mongo/int32@1': { readonly input: number; readonly output: number };
};

type TestFieldOutputTypes = {
  readonly User: { readonly age: number };
};

type TestFieldInputTypes = {
  readonly User: { readonly age: number };
};

type ContractWithVO = MongoContractWithTypeMaps<
  {
    readonly target: 'mongo';
    readonly targetFamily: 'mongo';
    readonly profileHash: ProfileHashBase<'test'>;
    readonly capabilities: Record<string, never>;
    readonly extensions: Record<string, never>;
    readonly meta: Record<string, never>;
    readonly roots: { readonly users: CrossReference & { readonly model: 'User' } };
    readonly domain: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly models: {
            readonly User: {
              readonly fields: {
                readonly _id: {
                  readonly nullable: false;
                  readonly many: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
                };
                readonly homeAddress: {
                  readonly nullable: false;
                  readonly many: false;
                  readonly type: { readonly kind: 'valueObject'; readonly name: 'Address' };
                };
                readonly workAddress: {
                  readonly nullable: true;
                  readonly many: false;
                  readonly type: { readonly kind: 'valueObject'; readonly name: 'Address' };
                };
                readonly previousAddresses: {
                  readonly nullable: false;
                  readonly type: { readonly kind: 'valueObject'; readonly name: 'Address' };
                  readonly many: { readonly elementNullable: false };
                };
              };
              readonly relations: Record<string, never>;
              readonly storage: { readonly collection: 'users' };
            };
          };
          readonly valueObjects: {
            readonly Address: {
              readonly fields: {
                readonly street: {
                  readonly nullable: false;
                  readonly many: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                };
                readonly city: {
                  readonly nullable: false;
                  readonly many: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                };
                readonly zip: {
                  readonly nullable: true;
                  readonly many: false;
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                };
              };
            };
          };
        };
      };
    };
    readonly storage: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly id: '__unbound__';
          readonly kind: 'mongo-namespace';
          readonly entries: { readonly collection: { readonly users: MongoCollection } };
        };
      };
      readonly storageHash: StorageHashBase<'test-storage'>;
    };
  },
  MongoTypeMaps<
    TestCodecTypes,
    {
      readonly __unbound__: {
        readonly User: {
          readonly _id: string;
          readonly homeAddress: { street: string; city: string; zip: string | null };
          readonly workAddress: { street: string; city: string; zip: string | null } | null;
          readonly previousAddresses: { street: string; city: string; zip: string | null }[];
        };
      };
    },
    {
      readonly __unbound__: {
        readonly User: {
          readonly _id: string;
          readonly homeAddress: { street: string; city: string; zip: string | null };
          readonly workAddress: { street: string; city: string; zip: string | null } | null;
          readonly previousAddresses: { street: string; city: string; zip: string | null }[];
        };
      };
    }
  >
>;

type ExpectedAddress = {
  street: string;
  city: string;
  zip: string | null;
};

test('InferModelRow expands value object fields to nested object types', () => {
  type UserRow = InferModelRow<ContractWithVO, 'User'>;
  expectTypeOf<UserRow['homeAddress']>().toEqualTypeOf<ExpectedAddress>();
});

test('InferModelRow handles nullable value object fields', () => {
  type UserRow = InferModelRow<ContractWithVO, 'User'>;
  expectTypeOf<UserRow['workAddress']>().toEqualTypeOf<ExpectedAddress | null>();
});

test('InferModelRow handles list value object fields', () => {
  type UserRow = InferModelRow<ContractWithVO, 'User'>;
  expectTypeOf<UserRow['previousAddresses']>().toEqualTypeOf<ExpectedAddress[]>();
});

test('InferModelRow still handles scalar fields alongside value objects', () => {
  type UserRow = InferModelRow<ContractWithVO, 'User'>;
  expectTypeOf<UserRow['_id']>().toEqualTypeOf<string>();
});

test('MongoTypeMaps accepts fieldOutputTypes and fieldInputTypes parameters', () => {
  type TM = MongoTypeMaps<TestCodecTypes, TestFieldOutputTypes, TestFieldInputTypes>;
  expectTypeOf<TM['fieldOutputTypes']>().toEqualTypeOf<TestFieldOutputTypes>();
  expectTypeOf<TM['fieldInputTypes']>().toEqualTypeOf<TestFieldInputTypes>();
});

test('ExtractMongoFieldOutputTypes extracts fieldOutputTypes from contract', () => {
  type TM = MongoTypeMaps<TestCodecTypes, TestFieldOutputTypes, TestFieldInputTypes>;
  type C = MongoContractWithTypeMaps<
    {
      readonly target: 'mongo';
      readonly targetFamily: 'mongo';
      readonly profileHash: ProfileHashBase<'test'>;
      readonly capabilities: Record<string, never>;
      readonly extensions: Record<string, never>;
      readonly meta: Record<string, never>;
      readonly roots: Record<string, never>;
      readonly domain: {
        readonly namespaces: Record<string, { readonly models: Record<string, never> }>;
      };
      readonly storage: {
        readonly namespaces: Record<
          string,
          { readonly id: string; readonly entries: { readonly collection: Record<string, never> } }
        >;
        readonly storageHash: StorageHashBase<'s'>;
      };
    },
    TM
  >;
  expectTypeOf<ExtractMongoFieldOutputTypes<C>>().toEqualTypeOf<TestFieldOutputTypes>();
});

test('ExtractMongoFieldInputTypes extracts fieldInputTypes from contract', () => {
  type TM = MongoTypeMaps<TestCodecTypes, TestFieldOutputTypes, TestFieldInputTypes>;
  type C = MongoContractWithTypeMaps<
    {
      readonly target: 'mongo';
      readonly targetFamily: 'mongo';
      readonly profileHash: ProfileHashBase<'test'>;
      readonly capabilities: Record<string, never>;
      readonly extensions: Record<string, never>;
      readonly meta: Record<string, never>;
      readonly roots: Record<string, never>;
      readonly domain: {
        readonly namespaces: Record<string, { readonly models: Record<string, never> }>;
      };
      readonly storage: {
        readonly namespaces: Record<
          string,
          { readonly id: string; readonly entries: { readonly collection: Record<string, never> } }
        >;
        readonly storageHash: StorageHashBase<'s'>;
      };
    },
    TM
  >;
  expectTypeOf<ExtractMongoFieldInputTypes<C>>().toEqualTypeOf<TestFieldInputTypes>();
});

// The emitter nests `FieldOutputTypes`/`FieldInputTypes` by namespace id; Mongo
// is structurally single-namespace, so its refined per-model map lives under
// `__unbound__`. A refined (e.g. parameterized) field type carried in the map
// must survive resolution verbatim.
type RefinedAge = number & { readonly __unit: 'years' };

type MinimalContractWithFieldTypes<TFieldTypes extends Record<string, Record<string, unknown>>> =
  MongoContractWithTypeMaps<
    {
      readonly target: 'mongo';
      readonly targetFamily: 'mongo';
      readonly profileHash: ProfileHashBase<'test'>;
      readonly capabilities: Record<string, never>;
      readonly extensions: Record<string, never>;
      readonly meta: Record<string, never>;
      readonly roots: Record<string, never>;
      readonly domain: {
        readonly namespaces: Record<string, { readonly models: Record<string, never> }>;
      };
      readonly storage: {
        readonly namespaces: Record<
          string,
          { readonly id: string; readonly entries: { readonly collection: Record<string, never> } }
        >;
        readonly storageHash: StorageHashBase<'s'>;
      };
    },
    MongoTypeMaps<TestCodecTypes, TFieldTypes, TFieldTypes>
  >;

type NestedFieldTypes = { readonly __unbound__: { readonly User: { readonly age: RefinedAge } } };

test('MongoUnboundFieldOutputTypes reads the per-model map under the unbound namespace', () => {
  type Resolved = MongoUnboundFieldOutputTypes<MinimalContractWithFieldTypes<NestedFieldTypes>>;
  expectTypeOf<Resolved>().toEqualTypeOf<{ readonly User: { readonly age: RefinedAge } }>();
});

test('MongoUnboundFieldInputTypes reads the per-model map under the unbound namespace', () => {
  type Resolved = MongoUnboundFieldInputTypes<MinimalContractWithFieldTypes<NestedFieldTypes>>;
  expectTypeOf<Resolved>().toEqualTypeOf<{ readonly User: { readonly age: RefinedAge } }>();
});

test('Mongo index and collection option input types stay specific', () => {
  const typedIndexOptions: MongoIndexOptionsInput = {
    unique: true,
    collation: { locale: 'en', strength: 2 },
    wildcardProjection: { internal: 0, title: 1 },
  };
  const typedCollectionOptions: MongoCollectionOptionsAuthoringInput = {
    capped: true,
    collation: { locale: 'en', strength: 2 },
    timeseries: { timeField: 'createdAt', granularity: 'hours' },
    changeStreamPreAndPostImages: { enabled: true },
  };

  expectTypeOf(typedIndexOptions.collation).toEqualTypeOf<
    | import('../src/ir/mongo-collation-options').MongoCollationOptions
    | import('../src/ir/mongo-collation-options').MongoCollationOptionsInput
    | undefined
  >();
  expectTypeOf(typedCollectionOptions.timeseries?.granularity).toEqualTypeOf<
    'seconds' | 'minutes' | 'hours' | undefined
  >();
});

test('Mongo option input types reject unsupported keys', () => {
  // @ts-expect-error unknown Mongo index option
  const _invalidIndexOptions: MongoIndexOptionsInput = { unsupported: true };
  _invalidIndexOptions;

  // @ts-expect-error unknown Mongo collection option
  const _invalidCollectionOptions: MongoCollectionOptionsAuthoringInput = { unsupported: true };
  _invalidCollectionOptions;
});

type ScalarField<CId extends string, Nullable extends boolean = false> = {
  readonly nullable: Nullable;
  readonly many: false;
  readonly type: { readonly kind: 'scalar'; readonly codecId: CId };
};
type EnumField<
  CId extends string,
  NsId extends string,
  EName extends string,
  Nullable extends boolean = false,
> = {
  readonly nullable: Nullable;
  readonly many: false;
  readonly type: { readonly kind: 'scalar'; readonly codecId: CId };
  readonly valueSet: {
    readonly plane: 'domain';
    readonly entityKind: 'enum';
    readonly namespaceId: NsId;
    readonly entityName: EName;
  };
};
type ManyEnumField<
  CId extends string,
  NsId extends string,
  EName extends string,
  Nullable extends boolean = false,
> = {
  readonly nullable: Nullable;
  readonly many: { readonly elementNullable: false };
  readonly type: { readonly kind: 'scalar'; readonly codecId: CId };
  readonly valueSet: {
    readonly plane: 'domain';
    readonly entityKind: 'enum';
    readonly namespaceId: NsId;
    readonly entityName: EName;
  };
};

type BigModelEnum = {
  readonly codecId: 'mongo/string@1';
  readonly members: readonly [
    { readonly name: 'A'; readonly value: 'a' },
    { readonly name: 'B'; readonly value: 'b' },
    { readonly name: 'C'; readonly value: 'c' },
  ];
};

type BigContract = MongoContractWithTypeMaps<
  {
    readonly target: 'mongo';
    readonly targetFamily: 'mongo';
    readonly profileHash: ProfileHashBase<'stress'>;
    readonly capabilities: Record<string, never>;
    readonly extensions: Record<string, never>;
    readonly meta: Record<string, never>;
    readonly roots: Record<string, never>;
    readonly domain: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly enum: { readonly Status: BigModelEnum };
          readonly models: {
            readonly BigModel: {
              readonly relations: Record<string, never>;
              readonly storage: { readonly collection: 'big' };
              readonly fields: {
                readonly f01: ScalarField<'mongo/objectId@1'>;
                readonly f02: EnumField<'mongo/string@1', '__unbound__', 'Status'>;
                readonly f03: EnumField<'mongo/string@1', '__unbound__', 'Status', true>;
                readonly f04: ManyEnumField<'mongo/string@1', '__unbound__', 'Status'>;
                readonly f05: ManyEnumField<'mongo/string@1', '__unbound__', 'Status', true>;
                readonly f06: ScalarField<'mongo/string@1'>;
                readonly f07: ScalarField<'mongo/string@1', true>;
                readonly f08: EnumField<'mongo/string@1', '__unbound__', 'Status'>;
                readonly f09: EnumField<'mongo/string@1', '__unbound__', 'Status', true>;
                readonly f10: ManyEnumField<'mongo/string@1', '__unbound__', 'Status'>;
                readonly f11: ScalarField<'mongo/objectId@1'>;
                readonly f12: EnumField<'mongo/string@1', '__unbound__', 'Status'>;
                readonly f13: EnumField<'mongo/string@1', '__unbound__', 'Status', true>;
                readonly f14: ManyEnumField<'mongo/string@1', '__unbound__', 'Status'>;
                readonly f15: ManyEnumField<'mongo/string@1', '__unbound__', 'Status', true>;
                readonly f16: ScalarField<'mongo/string@1'>;
                readonly f17: ScalarField<'mongo/string@1', true>;
                readonly f18: EnumField<'mongo/string@1', '__unbound__', 'Status'>;
                readonly f19: EnumField<'mongo/string@1', '__unbound__', 'Status', true>;
                readonly f20: ManyEnumField<'mongo/string@1', '__unbound__', 'Status'>;
                readonly f21: ScalarField<'mongo/objectId@1'>;
                readonly f22: EnumField<'mongo/string@1', '__unbound__', 'Status'>;
                readonly f23: EnumField<'mongo/string@1', '__unbound__', 'Status', true>;
                readonly f24: ManyEnumField<'mongo/string@1', '__unbound__', 'Status'>;
                readonly f25: ManyEnumField<'mongo/string@1', '__unbound__', 'Status', true>;
                readonly f26: ScalarField<'mongo/string@1'>;
                readonly f27: ScalarField<'mongo/string@1', true>;
                readonly f28: EnumField<'mongo/string@1', '__unbound__', 'Status'>;
                readonly f29: EnumField<'mongo/string@1', '__unbound__', 'Status', true>;
                readonly f30: ManyEnumField<'mongo/string@1', '__unbound__', 'Status'>;
                readonly f31: ScalarField<'mongo/string@1'>;
                readonly f32: EnumField<'mongo/string@1', '__unbound__', 'Status'>;
              };
            };
          };
          readonly valueObjects: Record<string, never>;
        };
      };
    };
    readonly storage: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly id: '__unbound__';
          readonly kind: 'mongo-namespace';
          readonly entries: { readonly collection: Record<string, never> };
        };
      };
      readonly storageHash: StorageHashBase<'stress-storage'>;
    };
  },
  MongoTypeMaps<
    {
      readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
      readonly 'mongo/string@1': { readonly input: string; readonly output: string };
    },
    {
      readonly __unbound__: {
        readonly BigModel: {
          readonly f01: string;
          readonly f02: 'a' | 'b' | 'c';
          readonly f03: 'a' | 'b' | 'c' | null;
          readonly f04: ('a' | 'b' | 'c')[];
          readonly f05: ('a' | 'b' | 'c')[] | null;
          readonly f06: string;
          readonly f07: string | null;
          readonly f08: 'a' | 'b' | 'c';
          readonly f09: 'a' | 'b' | 'c' | null;
          readonly f10: ('a' | 'b' | 'c')[];
          readonly f11: string;
          readonly f12: 'a' | 'b' | 'c';
          readonly f13: 'a' | 'b' | 'c' | null;
          readonly f14: ('a' | 'b' | 'c')[];
          readonly f15: ('a' | 'b' | 'c')[] | null;
          readonly f16: string;
          readonly f17: string | null;
          readonly f18: 'a' | 'b' | 'c';
          readonly f19: 'a' | 'b' | 'c' | null;
          readonly f20: ('a' | 'b' | 'c')[];
          readonly f21: string;
          readonly f22: 'a' | 'b' | 'c';
          readonly f23: 'a' | 'b' | 'c' | null;
          readonly f24: ('a' | 'b' | 'c')[];
          readonly f25: ('a' | 'b' | 'c')[] | null;
          readonly f26: string;
          readonly f27: string | null;
          readonly f28: 'a' | 'b' | 'c';
          readonly f29: 'a' | 'b' | 'c' | null;
          readonly f30: ('a' | 'b' | 'c')[];
          readonly f31: string;
          readonly f32: 'a' | 'b' | 'c';
        };
      };
    },
    {
      readonly __unbound__: {
        readonly BigModel: {
          readonly f01: string;
          readonly f02: 'a' | 'b' | 'c';
          readonly f03: 'a' | 'b' | 'c' | null;
          readonly f04: ('a' | 'b' | 'c')[];
          readonly f05: ('a' | 'b' | 'c')[] | null;
          readonly f06: string;
          readonly f07: string | null;
          readonly f08: 'a' | 'b' | 'c';
          readonly f09: 'a' | 'b' | 'c' | null;
          readonly f10: ('a' | 'b' | 'c')[];
          readonly f11: string;
          readonly f12: 'a' | 'b' | 'c';
          readonly f13: 'a' | 'b' | 'c' | null;
          readonly f14: ('a' | 'b' | 'c')[];
          readonly f15: ('a' | 'b' | 'c')[] | null;
          readonly f16: string;
          readonly f17: string | null;
          readonly f18: 'a' | 'b' | 'c';
          readonly f19: 'a' | 'b' | 'c' | null;
          readonly f20: ('a' | 'b' | 'c')[];
          readonly f21: string;
          readonly f22: 'a' | 'b' | 'c';
          readonly f23: 'a' | 'b' | 'c' | null;
          readonly f24: ('a' | 'b' | 'c')[];
          readonly f25: ('a' | 'b' | 'c')[] | null;
          readonly f26: string;
          readonly f27: string | null;
          readonly f28: 'a' | 'b' | 'c';
          readonly f29: 'a' | 'b' | 'c' | null;
          readonly f30: ('a' | 'b' | 'c')[];
          readonly f31: string;
          readonly f32: 'a' | 'b' | 'c';
        };
      };
    }
  >
>;

test('InferModelRow on a 32-field model compiles without excessive depth error', () => {
  type Row = InferModelRow<BigContract, 'BigModel'>;
  expectTypeOf<Row['f01']>().toEqualTypeOf<string>();
  expectTypeOf<Row['f02']>().toEqualTypeOf<'a' | 'b' | 'c'>();
  expectTypeOf<Row['f03']>().toEqualTypeOf<'a' | 'b' | 'c' | null>();
  expectTypeOf<Row['f04']>().toEqualTypeOf<('a' | 'b' | 'c')[]>();
  expectTypeOf<Row['f05']>().toEqualTypeOf<('a' | 'b' | 'c')[] | null>();
  expectTypeOf<Row['f32']>().toEqualTypeOf<'a' | 'b' | 'c'>();
});

type FallbackCodecTypes = {
  readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
  readonly 'mongo/string@1': { readonly input: string; readonly output: string };
  readonly 'mongo/double@1': { readonly input: number; readonly output: number };
};

type ContractNoMap = MongoContractWithTypeMaps<
  {
    readonly target: 'mongo';
    readonly targetFamily: 'mongo';
    readonly profileHash: ProfileHashBase<'no-map'>;
    readonly capabilities: Record<string, never>;
    readonly extensions: Record<string, never>;
    readonly meta: Record<string, never>;
    readonly roots: Record<string, never>;
    readonly domain: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly models: {
            readonly Item: {
              readonly relations: Record<string, never>;
              readonly storage: { readonly collection: 'items' };
              readonly fields: {
                readonly _id: ScalarField<'mongo/objectId@1'>;
                readonly name: ScalarField<'mongo/string@1'>;
                readonly price: ScalarField<'mongo/double@1', true>;
                readonly tags: {
                  readonly nullable: false;
                  readonly many: { readonly elementNullable: false };
                  readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
                };
              };
            };
          };
          readonly valueObjects: Record<string, never>;
        };
      };
    };
    readonly storage: {
      readonly namespaces: {
        readonly __unbound__: {
          readonly id: '__unbound__';
          readonly kind: 'mongo-namespace';
          readonly entries: { readonly collection: Record<string, never> };
        };
      };
      readonly storageHash: StorageHashBase<'no-map-storage'>;
    };
  },
  MongoTypeMaps<
    FallbackCodecTypes,
    {
      readonly __unbound__: {
        readonly Item: {
          readonly _id: string;
          readonly name: string;
          readonly price: number | null;
          readonly tags: string[];
        };
      };
    },
    {
      readonly __unbound__: {
        readonly Item: {
          readonly _id: string;
          readonly name: string;
          readonly price: number | null;
          readonly tags: string[];
        };
      };
    }
  >
>;

test('InferModelRow resolves scalars from the precomputed field output map', () => {
  type Row = InferModelRow<ContractNoMap, 'Item'>;
  expectTypeOf<Row['_id']>().toEqualTypeOf<string>();
  expectTypeOf<Row['name']>().toEqualTypeOf<string>();
  expectTypeOf<Row['price']>().toEqualTypeOf<number | null>();
  expectTypeOf<Row['tags']>().toEqualTypeOf<string[]>();
});
