import { describe, expectTypeOf, test } from 'vitest';
import type {
  FieldTypesFromDomain,
  ParameterizedOutputTypesFunction,
  StoredValueType,
  ValueObjectTypesFromStorage,
} from '../src/exports/types';

type CodecTypes = {
  readonly 'test/text@1': { readonly input: string; readonly output: string };
  readonly 'test/char@1': { readonly input: string; readonly output: string };
  readonly 'test/int@1': { readonly input: number | bigint; readonly output: bigint };
  readonly 'test/json@1': { readonly input: unknown; readonly output: unknown };
  readonly 'test/decimal@1': {
    readonly input: string;
    readonly output: string;
    readonly keepsWrittenForm: true;
  };
};

type Char<N extends number> = string & { readonly __length: N };

type CharOutputTypeMap<TypeParams> = {
  readonly 'test/char@1': TypeParams extends { readonly length: infer N extends number }
    ? Char<N>
    : never;
};

interface CharOutputTypes extends ParameterizedOutputTypesFunction {
  readonly outputTypes: CharOutputTypeMap<this['typeParams']>;
}

type Scalar<CodecId extends string> = { readonly kind: 'scalar'; readonly codecId: CodecId };

type ValueObjectRef<Name extends string, Ns extends string = 'shared'> = {
  readonly kind: 'valueObject';
  readonly plane: 'storage';
  readonly namespaceId: Ns;
  readonly entityKind: 'valueObject';
  readonly entityName: Name;
};

type Domain = {
  readonly app: {
    readonly models: {
      readonly User: {
        readonly fields: {
          readonly id: {
            readonly nullable: false;
            readonly type: Scalar<'test/char@1'> & { readonly typeParams: { readonly length: 24 } };
          };
          readonly count: { readonly nullable: false; readonly type: Scalar<'test/int@1'> };
          readonly mood: { readonly nullable: true; readonly type: Scalar<'test/text@1'> };
          readonly settings: { readonly nullable: false; readonly type: Scalar<'test/json@1'> };
          readonly tags: {
            readonly nullable: false;
            readonly type: Scalar<'test/text@1'>;
            readonly many: { readonly elementNullable: true };
          };
          readonly codes: {
            readonly nullable: true;
            readonly type: Scalar<'test/char@1'> & { readonly typeParams: { readonly length: 2 } };
            readonly many: { readonly elementNullable: false };
          };
          readonly labels: {
            readonly nullable: false;
            readonly type: Scalar<'test/text@1'>;
            readonly dict: true;
          };
          readonly single: {
            readonly nullable: false;
            readonly type: Scalar<'test/text@1'>;
            readonly many: false;
          };
          readonly unknownCodec: {
            readonly nullable: false;
            readonly type: Scalar<'test/missing@1'>;
          };
          readonly withoutNullable: { readonly type: Scalar<'test/text@1'> };
          readonly optionalNullable: {
            readonly nullable?: true;
            readonly type: Scalar<'test/text@1'>;
          };
          readonly homeWithoutNullable: {
            readonly type: ValueObjectRef<'Point'>;
          };
          readonly home: {
            readonly nullable: true;
            readonly type: ValueObjectRef<'Address'>;
          };
          readonly pastHomes: {
            readonly nullable: false;
            readonly type: ValueObjectRef<'Address'>;
            readonly many: { readonly elementNullable: false };
          };
          readonly elsewhere: {
            readonly nullable: false;
            readonly type: ValueObjectRef<'Address', 'other'>;
          };
          readonly contact: {
            readonly nullable: false;
            readonly type: {
              readonly kind: 'union';
              readonly members: readonly [Scalar<'test/text@1'>, ValueObjectRef<'Address'>];
            };
          };
        };
      };
      readonly Empty: { readonly fields: Record<never, never> };
    };
  };
};

type Storage = {
  readonly shared: {
    readonly entries: {
      readonly valueObject: {
        readonly Address: {
          readonly fields: {
            readonly street: { readonly nullable: false; readonly type: Scalar<'test/text@1'> };
            readonly code: {
              readonly nullable: false;
              readonly type: Scalar<'test/char@1'> & {
                readonly typeParams: { readonly length: 5 };
              };
            };
            readonly geo: {
              readonly nullable: true;
              readonly type: ValueObjectRef<'Point'>;
            };
            readonly kind: { readonly nullable: true; readonly type: Scalar<'test/text@1'> };
            readonly meta: { readonly nullable: false; readonly type: Scalar<'test/json@1'> };
          };
        };
        readonly Point: {
          readonly fields: {
            readonly x: { readonly nullable: false; readonly type: Scalar<'test/int@1'> };
          };
        };
        readonly Nothing: { readonly fields: Record<never, never> };
        readonly Tree: {
          readonly fields: {
            readonly children: {
              readonly nullable: false;
              readonly type: ValueObjectRef<'Tree'>;
              readonly many: { readonly elementNullable: false };
            };
          };
        };
      };
    };
  };
  readonly other: {
    readonly entries: {
      readonly valueObject: {
        readonly Address: {
          readonly fields: {
            readonly elsewhere: { readonly nullable: false; readonly type: Scalar<'test/int@1'> };
          };
        };
      };
    };
  };
};

type Overrides = {
  readonly app: {
    readonly models: {
      readonly User: {
        readonly mood: { readonly output: 'happy' | 'sad'; readonly input: 'happy' | 'sad' };
        readonly settings: { readonly output: { readonly theme: string } };
      };
    };
  };
  readonly shared: {
    readonly valueObjects: {
      readonly Address: {
        readonly kind: { readonly output: 'home' | 'work'; readonly input: 'home' | 'work' };
        readonly meta: { readonly output: { readonly floor: number } };
      };
    };
  };
};

type Output = FieldTypesFromDomain<
  Domain,
  CodecTypes,
  CharOutputTypes,
  Overrides,
  'output',
  Storage
>;
type Input = FieldTypesFromDomain<Domain, CodecTypes, CharOutputTypes, Overrides, 'input', Storage>;
type User = Output['app']['User'];
type UserInput = Input['app']['User'];

type AddressOutput = {
  readonly street: string;
  readonly code: Char<5>;
  readonly geo: { readonly x: bigint } | null;
  readonly kind: 'home' | 'work' | null;
  readonly meta: { readonly floor: number };
};
type AddressInput = {
  readonly street: string;
  readonly code: string;
  readonly geo: { readonly x: number | bigint } | null;
  readonly kind: 'home' | 'work' | null;
  readonly meta: unknown;
};

describe('field types from a contract domain', () => {
  test('a scalar field reads as its codec output and writes as its codec input', () => {
    expectTypeOf<User['count']>().toEqualTypeOf<bigint>();
    expectTypeOf<UserInput['count']>().toEqualTypeOf<number | bigint>();
  });

  test('a field with type parameters reads as the type its pack gives it, and writes as the codec input', () => {
    expectTypeOf<User['id']>().toEqualTypeOf<Char<24>>();
    expectTypeOf<UserInput['id']>().toEqualTypeOf<string>();
  });

  test('an override, such as the members of a value set, replaces the codec type on the sides it gives, before nullability', () => {
    expectTypeOf<User['mood']>().toEqualTypeOf<'happy' | 'sad' | null>();
    expectTypeOf<UserInput['mood']>().toEqualTypeOf<'happy' | 'sad' | null>();
    expectTypeOf<User['settings']>().toEqualTypeOf<{ readonly theme: string }>();
    expectTypeOf<UserInput['settings']>().toEqualTypeOf<unknown>();
  });

  test('a list wraps the element type, with null for nullable elements, then nullability', () => {
    expectTypeOf<User['tags']>().toEqualTypeOf<ReadonlyArray<string | null>>();
    expectTypeOf<User['codes']>().toEqualTypeOf<ReadonlyArray<Char<2>> | null>();
    expectTypeOf<User['single']>().toEqualTypeOf<string>();
  });

  test('a dictionary maps string keys to the value type', () => {
    expectTypeOf<User['labels']>().toEqualTypeOf<Readonly<Record<string, string>>>();
  });

  test('a field without a nullable key, or with an optional one, is not nullable', () => {
    expectTypeOf<User['withoutNullable']>().toEqualTypeOf<string>();
    expectTypeOf<UserInput['withoutNullable']>().toEqualTypeOf<string>();
    expectTypeOf<User['optionalNullable']>().toEqualTypeOf<string>();
    expectTypeOf<User['homeWithoutNullable']>().toEqualTypeOf<{ readonly x: bigint }>();
  });

  test('a codec the codec types lack reads as unknown', () => {
    expectTypeOf<User['unknownCodec']>().toEqualTypeOf<unknown>();
  });

  test('a value object field takes its override, such as the members of an enum or rendered type text, before nullability', () => {
    expectTypeOf<NonNullable<User['home']>['kind']>().toEqualTypeOf<'home' | 'work' | null>();
    expectTypeOf<NonNullable<UserInput['home']>['kind']>().toEqualTypeOf<'home' | 'work' | null>();
    expectTypeOf<NonNullable<User['home']>['meta']>().toEqualTypeOf<{ readonly floor: number }>();
    expectTypeOf<NonNullable<UserInput['home']>['meta']>().toEqualTypeOf<unknown>();
  });

  test('a value object field is an object of its fields, typed by the same rules, nested value objects included', () => {
    expectTypeOf<User['home']>().toEqualTypeOf<AddressOutput | null>();
    expectTypeOf<UserInput['home']>().toEqualTypeOf<AddressInput | null>();
    expectTypeOf<User['pastHomes']>().toEqualTypeOf<ReadonlyArray<AddressOutput>>();
  });

  test('a value object field reads the value object of the storage namespace its reference names', () => {
    expectTypeOf<User['elsewhere']>().toEqualTypeOf<{ readonly elsewhere: bigint }>();
  });

  test('the storage namespaces are required, so no value object field goes untyped', () => {
    // @ts-expect-error FieldTypesFromDomain reads both planes and takes the storage namespaces
    expectTypeOf<FieldTypesFromDomain<Domain, CodecTypes, CharOutputTypes, Overrides, 'output'>>();
  });

  test('a union field is the union of its members, a scalar member taking its plain codec type', () => {
    expectTypeOf<User['contact']>().toEqualTypeOf<string | AddressOutput>();
    expectTypeOf<UserInput['contact']>().toEqualTypeOf<string | AddressInput>();
  });

  test('a model without fields has open output types and closed input types', () => {
    expectTypeOf<Output['app']['Empty']>().toEqualTypeOf<Record<never, never>>();
    expectTypeOf<Input['app']['Empty']>().toEqualTypeOf<Record<string, never>>();
  });
});

describe('value object types from contract storage', () => {
  type ValueObjects = ValueObjectTypesFromStorage<
    Storage,
    CodecTypes,
    CharOutputTypes,
    Overrides,
    'output'
  >;
  type ValueObjectInputs = ValueObjectTypesFromStorage<
    Storage,
    CodecTypes,
    CharOutputTypes,
    Overrides,
    'input'
  >;

  test('each value object is keyed by namespace and name', () => {
    expectTypeOf<ValueObjects['shared']['Address']>().toEqualTypeOf<AddressOutput>();
    expectTypeOf<ValueObjectInputs['shared']['Address']>().toEqualTypeOf<AddressInput>();
  });

  test('a value object is keyed by the storage namespace that holds it', () => {
    expectTypeOf<ValueObjects['other']['Address']>().toEqualTypeOf<{
      readonly elsewhere: bigint;
    }>();
  });

  test('a value object without fields is closed on both sides', () => {
    expectTypeOf<ValueObjects['shared']['Nothing']>().toEqualTypeOf<Record<string, never>>();
    expectTypeOf<ValueObjectInputs['shared']['Nothing']>().toEqualTypeOf<Record<string, never>>();
  });

  test('a value object that holds itself resolves one level at a time', () => {
    type Tree = ValueObjects['shared']['Tree'];
    expectTypeOf<Tree['children'][number]['children'][number]>().toEqualTypeOf<Tree>();
  });
});

describe('the value type of one storage entry', () => {
  type Entry = { readonly nullable: true; readonly many: false };

  test('applies the type parameters, the codec type and nullability', () => {
    expectTypeOf<
      StoredValueType<
        Entry,
        'test/char@1',
        { readonly length: 3 },
        never,
        CodecTypes,
        CharOutputTypes,
        'output'
      >
    >().toEqualTypeOf<Char<3> | null>();
    expectTypeOf<
      StoredValueType<Entry, 'test/char@1', undefined, never, CodecTypes, CharOutputTypes, 'input'>
    >().toEqualTypeOf<string | null>();
  });

  test('an entry without a nullable key is not nullable', () => {
    expectTypeOf<
      StoredValueType<
        { readonly many: false },
        'test/text@1',
        undefined,
        never,
        CodecTypes,
        CharOutputTypes,
        'output'
      >
    >().toEqualTypeOf<string>();
  });

  test("ignores an override for a codec whose data type compares values by an equality key, which keeps the codec's type", () => {
    type Members = { readonly output: '0.5' | '1.50'; readonly input: '0.5' | '1.50' };
    expectTypeOf<
      StoredValueType<
        { readonly many: false },
        'test/decimal@1',
        undefined,
        Members,
        CodecTypes,
        CharOutputTypes,
        'output'
      >
    >().toEqualTypeOf<string>();
    expectTypeOf<
      StoredValueType<
        { readonly many: false },
        'test/text@1',
        undefined,
        Members,
        CodecTypes,
        CharOutputTypes,
        'output'
      >
    >().toEqualTypeOf<'0.5' | '1.50'>();
  });
});
