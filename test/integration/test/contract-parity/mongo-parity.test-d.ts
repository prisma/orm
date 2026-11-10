import type { NamespacedEnums } from '@internal/contract/enum-accessor';
import type { ExtractMongoTypeMaps, MongoTypeMaps } from '@internal/mongo-contract';
import { describe, expectTypeOf, test } from 'vitest';
import type { contract as mongoParitySource } from './fixtures/mongo/contract';
import type { Contract as MongoParityEmitted } from './fixtures/mongo/generated/contract';
import type { DifferingKeys, DifferingPaths, SameType, UnclassifiedKeys } from './parity-types';

type Built = typeof mongoParitySource;
type Emitted = MongoParityEmitted;

type AllKeys<T> = T extends unknown ? keyof T : never;
type ValuesOf<T> = T[keyof T];

type Maps<Contract> = ExtractMongoTypeMaps<Contract>;

/** `'<namespace>.<model>.<field>'` for each entry of a field type map that differs. */
type NamespacedDifferingPaths<A, B> = {
  [Ns in (keyof A | keyof B) & string]: Ns extends keyof A
    ? Ns extends keyof B
      ? `${Ns}.${DifferingPaths<A[Ns], B[Ns]> & string}`
      : `${Ns} (built only)`
    : `${Ns} (emitted only)`;
}[(keyof A | keyof B) & string];

type PublicCodecTypes<CodecTypes> = {
  readonly [CodecId in keyof CodecTypes]: Pick<
    CodecTypes[CodecId],
    Extract<keyof CodecTypes[CodecId], 'input' | 'output' | 'traits'>
  >;
};

type Unclassified<Shape, Compared extends PropertyKey, Excluded> = Exclude<
  AllKeys<Shape>,
  Compared | keyof Excluded
>;

type Section<Contract, Key extends PropertyKey> = Contract extends { readonly [K in Key]: infer V }
  ? V
  : Contract extends { readonly [K in Key]?: infer V }
    ? NonNullable<V>
    : never;

type DomainNamespaces<Contract> = Section<Section<Contract, 'domain'>, 'namespaces'>;
type Namespace<Contract> = ValuesOf<DomainNamespaces<Contract>>;
type ModelsOf<Contract> = Section<Namespace<Contract>, 'models'>;
type ValueObjectsOf<Contract> = Section<Namespace<Contract>, 'valueObjects'>;
type ModelPart<Contract, Part extends string> = {
  readonly [Model in keyof ModelsOf<Contract>]: Section<ModelsOf<Contract>[Model], Part>;
};

/** Every field of every model, keyed `'<model>.<field>'`. */
type Fields<Contract> = {
  [Model in keyof ModelsOf<Contract> & string]: {
    readonly [Field in keyof Section<ModelsOf<Contract>[Model], 'fields'> &
      string as `${Model}.${Field}`]: Section<ModelsOf<Contract>[Model], 'fields'>[Field];
  };
}[keyof ModelsOf<Contract> & string];

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;

/** A field as types read it: an absent `many` is `false`, as the build writes it. */
type ComparedField<Field> = {
  readonly type: Section<Field, 'type'>;
  readonly nullable: Section<Field, 'nullable'>;
  readonly many: Field extends { readonly many: infer Many } ? Many : false;
};

type FieldMap<Contract> = {
  readonly [Key in keyof UnionToIntersection<Fields<Contract>>]: ComparedField<
    UnionToIntersection<Fields<Contract>>[Key]
  >;
};

/** A cross reference as types read it: the built one types its namespace as any namespace id, the emitted one as the literal. */
type ComparedReference<Reference> = { readonly model: Section<Reference, 'model'> };

type ComparedRelation<Relation> = Omit<Relation, 'to'> & {
  readonly to: ComparedReference<Section<Relation, 'to'>>;
};

type ComparedRelations<Contract> = {
  readonly [Model in keyof ModelsOf<Contract>]: {
    readonly [Relation in keyof Section<ModelsOf<Contract>[Model], 'relations'>]: ComparedRelation<
      Section<ModelsOf<Contract>[Model], 'relations'>[Relation]
    >;
  };
};

type ComparedValueObjects<Contract> = {
  readonly [Name in keyof ValueObjectsOf<Contract>]: {
    readonly [Field in keyof Section<ValueObjectsOf<Contract>[Name], 'fields'>]: ComparedField<
      Section<ValueObjectsOf<Contract>[Name], 'fields'>[Field]
    >;
  };
};

type ComparedModelReferences<Contract> = {
  readonly [Model in keyof ModelsOf<Contract>]: {
    readonly base: ModelsOf<Contract>[Model] extends { readonly base: infer Base }
      ? ComparedReference<Base>
      : undefined;
    readonly variants: ModelsOf<Contract>[Model] extends { readonly variants: infer Variants }
      ? { readonly [Value in keyof Variants]: ComparedReference<Variants[Value]> }
      : undefined;
  };
};

type ComparedRoots<Contract> = {
  readonly [Root in keyof Section<Contract, 'roots'>]: ComparedReference<
    Section<Contract, 'roots'>[Root]
  >;
};

describe('every type map of a Mongo defineContract contract equals the emitted one', () => {
  test('every type map is compared', () => {
    type Compared = 'codecTypes' | 'fieldOutputTypes' | 'fieldInputTypes';
    type AnyTypeMaps = MongoTypeMaps<
      Record<string, { output: unknown }>,
      Record<string, Record<string, unknown>>,
      Record<string, Record<string, unknown>>
    >;
    expectTypeOf<UnclassifiedKeys<AnyTypeMaps, Compared, Record<never, never>>>().toBeNever();
  });

  test('codec types', () => {
    expectTypeOf<
      DifferingKeys<
        PublicCodecTypes<Maps<Built>['codecTypes']>,
        PublicCodecTypes<Maps<Emitted>['codecTypes']>
      >
    >().toBeNever();
  });

  test('field output types', () => {
    expectTypeOf<
      NamespacedDifferingPaths<Maps<Built>['fieldOutputTypes'], Maps<Emitted>['fieldOutputTypes']>
    >().toBeNever();
  });

  test('field input types', () => {
    expectTypeOf<
      NamespacedDifferingPaths<Maps<Built>['fieldInputTypes'], Maps<Emitted>['fieldInputTypes']>
    >().toBeNever();
  });

  test('the comparison sees the fixture fields, a vector of a given length and the members of an enum', () => {
    type UserOutput = Maps<Built>['fieldOutputTypes']['__unbound__']['User'];
    expectTypeOf<'embedding' | 'home' | 'pastRoles'>().toExtend<keyof UserOutput>();
    expectTypeOf<UserOutput['role']>().toEqualTypeOf<'reader' | 'editor'>();
    expectTypeOf<NonNullable<UserOutput['home']>['kind']>().toEqualTypeOf<
      'reader' | 'editor' | null
    >();
    expectTypeOf<UserOutput['embedding']>().toEqualTypeOf<
      Maps<Emitted>['fieldOutputTypes']['__unbound__']['User']['embedding']
    >();
    expectTypeOf<UserOutput['embedding']>().not.toEqualTypeOf<readonly number[]>();
  });
});

type ComparedSections = 'target' | 'targetFamily' | 'domain' | 'storage' | 'roots' | 'execution';

type ExcludedSections = {
  readonly profileHash: 'A hash the build computes at run time; the emitter writes it as a literal.';
  readonly capabilities: 'Mongo declares no capabilities; the built type gives Record<string, never>, the emitted one the empty literal. No type reads them.';
  readonly extensions: 'The built contract holds each extension pack, the emitted one its serialized metadata. No type reads them.';
  readonly meta: 'The built type gives Record<string, never>, the emitted one the empty literal. No type reads it.';
  readonly defaultControlPolicy: 'Optional on the built type and absent from this fixture, so the emitted contract has none.';
  readonly '__@internal/mongo-core/typeMaps@__': 'The type maps, compared above.';
  readonly valueObjects: 'The emitted contract also lists the value objects at the top level, which no type reads; the field types read those of the namespace, compared below.';
};

describe('every section of a Mongo defineContract contract equals the emitted one, or is excluded with its reason', () => {
  test('every top-level key is compared or excluded', () => {
    expectTypeOf<Unclassified<Built | Emitted, ComparedSections, ExcludedSections>>().toBeNever();
  });

  test('target and family', () => {
    expectTypeOf<SameType<Built['target'], Emitted['target']>>().toEqualTypeOf<true>();
    expectTypeOf<SameType<Built['targetFamily'], Emitted['targetFamily']>>().toEqualTypeOf<true>();
  });

  test('roots', () => {
    expectTypeOf<DifferingKeys<ComparedRoots<Built>, ComparedRoots<Emitted>>>().toBeNever();
  });

  test('execution defaults', () => {
    expectTypeOf<
      Unclassified<
        Section<Built, 'execution'> | Section<Emitted, 'execution'>,
        never,
        {
          readonly executionHash: 'A hash the build computes at run time.';
          readonly mutations: 'This fixture has no defaults the client generates; the built type gives the general section.';
        }
      >
    >().toBeNever();
  });

  test('storage', () => {
    type StorageExcluded = {
      readonly storageHash: 'A hash the build computes at run time; the emitter writes it as a literal.';
      readonly namespaces: 'The collections and their options, which the build computes at run time and only migrations read. The built type keeps them general; the ORM finds collections through model storage, compared below.';
      readonly collections: 'The built type lists each collection a model names, which no type reads.';
    };
    expectTypeOf<
      Unclassified<Section<Built, 'storage'> | Section<Emitted, 'storage'>, never, StorageExcluded>
    >().toBeNever();
  });

  test('domain namespaces and their keys', () => {
    expectTypeOf<keyof DomainNamespaces<Built>>().toEqualTypeOf<keyof DomainNamespaces<Emitted>>();
    expectTypeOf<
      Unclassified<
        Namespace<Built> | Namespace<Emitted>,
        'models' | 'valueObjects' | 'enum' | 'enumMemberTypes',
        Record<never, never>
      >
    >().toBeNever();
  });

  test('every model key is compared', () => {
    expectTypeOf<
      Unclassified<
        ValuesOf<ModelsOf<Built>> | ValuesOf<ModelsOf<Emitted>>,
        'fields' | 'relations' | 'storage' | 'base' | 'discriminator' | 'variants' | 'owner',
        Record<never, never>
      >
    >().toBeNever();
  });

  test('fields', () => {
    expectTypeOf<DifferingKeys<FieldMap<Built>, FieldMap<Emitted>>>().toBeNever();
    expectTypeOf<'User.embedding' | 'Article.body'>().toExtend<keyof FieldMap<Built>>();
    expectTypeOf<
      SameType<
        FieldMap<Built>['Article.body'],
        {
          readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
          readonly nullable: false;
          readonly many: false;
        },
        2
      >
    >().toEqualTypeOf<true>();
  });

  test('relations, model storage, bases, discriminators and variants', () => {
    expectTypeOf<
      DifferingPaths<ComparedRelations<Built>, ComparedRelations<Emitted>>
    >().toBeNever();
    expectTypeOf<
      DifferingKeys<ModelPart<Built, 'storage'>, ModelPart<Emitted, 'storage'>>
    >().toBeNever();
    expectTypeOf<
      DifferingPaths<ComparedModelReferences<Built>, ComparedModelReferences<Emitted>>
    >().toBeNever();
    expectTypeOf<
      DifferingKeys<ModelPart<Built, 'discriminator'>, ModelPart<Emitted, 'discriminator'>>
    >().toBeNever();
  });

  test('value objects', () => {
    expectTypeOf<
      DifferingPaths<ComparedValueObjects<Built>, ComparedValueObjects<Emitted>>
    >().toBeNever();
  });

  test('enums, as db.enums reads them', () => {
    expectTypeOf<
      SameType<NamespacedEnums<Built>, NamespacedEnums<Emitted>, 4>
    >().toEqualTypeOf<true>();
  });
});
