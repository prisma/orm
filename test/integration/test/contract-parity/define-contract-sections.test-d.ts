import type { NamespacedEnums } from '@internal/contract/enum-accessor';
import type {
  ApplyParameterizedOutputTypes,
  ParameterizedOutputTypesFunction,
} from '@internal/contract/types';
import type { ParameterizedOutputTypesForTypeParams as PgvectorOutputTypes } from '@internal/extension-pgvector/codec-types';
import type { TypeMapsPhantomKey } from '@internal/sql-contract/types';
import type { TableIndexReferences } from '@internal/sql-relational-core/index-reference';
import type { ParameterizedOutputTypesForTypeParams as PostgresOutputTypes } from '@internal/target-postgres/codec-types';
import { describe, expectTypeOf, test } from 'vitest';
import type { Built, DifferingKeys, Emitted, Fixtures, SameType } from './parity-types';

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;

/** Every key of every member of a union, where `keyof` alone gives only the shared ones. */
type AllKeys<T> = T extends unknown ? keyof T : never;

type ValuesOf<T> = T[keyof T];

/** For each fixture, `'<fixture>: <key>'` for every key of the named part of either contract that is neither compared nor excluded. */
type UnclassifiedPerFixture<Name extends PartName, Compared extends PropertyKey, Excluded> = {
  [F in keyof Fixtures]: `${F}: ${Exclude<
    AllKeys<Part<Built<F>, Name> | Part<Emitted<F>, Name>>,
    Compared | keyof Excluded
  > &
    string}`;
}[keyof Fixtures];

/** For each fixture, `'<fixture>: <name> <key>'` for every entry of the named map that differs. */
type MapDifferences<Name extends PartName> = {
  [F in keyof Fixtures]: `${F}: ${Name} ${DifferingKeys<
    Part<Built<F>, Name>,
    Part<Emitted<F>, Name>
  > &
    string}`;
}[keyof Fixtures];

// ---------------------------------------------------------------------------------------------
// Top level
// ---------------------------------------------------------------------------------------------

type ComparedSections =
  | 'target'
  | 'targetFamily'
  | 'meta'
  | 'defaultControlPolicy'
  | 'capabilities'
  | 'execution'
  | 'storage'
  | 'domain'
  | TypeMapsPhantomKey;

type ExcludedSections = {
  readonly roots: 'Keyed by table name, or by namespace and table name where two namespaces share a table name, which the build resolves at run time. No type reads roots: the ORM and the SQL builder find models through domain.';
  readonly profileHash: 'A hash the build computes at run time; the emitter writes it as a literal.';
  readonly extensions: 'The built contract holds each extension pack, the emitted one its serialized metadata. No type reads them; their capabilities are compared below.';
};

type TopLevelKeys<F extends keyof Fixtures> = AllKeys<Built<F> | Emitted<F>>;

type SectionDifferences<Key extends string> = {
  [F in keyof Fixtures]: Key extends keyof Built<F>
    ? Key extends keyof Emitted<F>
      ? SameType<Built<F>[Key], Emitted<F>[Key]> extends true
        ? never
        : `${F}: ${Key}`
      : `${F}: ${Key} (built only)`
    : `${F}: ${Key} (emitted only)`;
}[keyof Fixtures];

describe('the comparisons see what they compare', () => {
  test('a value that is any on one side only differs', () => {
    // What `JSON.parse` returns: `any`, as a type that cannot be resolved becomes.
    type Planted = ReturnType<typeof JSON.parse>;
    expectTypeOf<SameType<Planted, string>>().toEqualTypeOf<false>();
    expectTypeOf<SameType<string, Planted>>().toEqualTypeOf<false>();
    expectTypeOf<
      DifferingKeys<
        { readonly id: Planted; readonly name: string },
        { readonly id: number; readonly name: string }
      >
    >().toEqualTypeOf<'id'>();
    expectTypeOf<SameType<Planted, Planted>>().toEqualTypeOf<true>();
  });

  test('two instantiations of an alias built from conditional types are told apart', () => {
    type Conditional<T> = { readonly value: T extends string ? 'text' : 'other' };
    expectTypeOf<SameType<Conditional<string>, Conditional<number>>>().toEqualTypeOf<false>();
  });

  test('each compared map holds the fixtures entries', () => {
    expectTypeOf<'public.profiles.settings'>().toExtend<
      keyof Part<Built<'postgresParity'>, 'column'>
    >();
    expectTypeOf<'auth.accounts'>().toExtend<keyof Part<Emitted<'postgresParity'>, 'table'>>();
    expectTypeOf<'public.Profile.settings'>().toExtend<
      keyof Part<Built<'postgresParity'>, 'field'>
    >();
    expectTypeOf<'auth.Account'>().toExtend<
      keyof Part<Emitted<'postgresParity'>, 'model storage'>
    >();
    expectTypeOf<'auth.Account.user' | 'public.User.badges' | 'public.Employee.manager'>().toExtend<
      keyof Part<Built<'postgresParity'>, 'relation'>
    >();
    expectTypeOf<'__unbound__.Post.tags'>().toExtend<
      keyof Part<Emitted<'sqliteParity'>, 'relation'>
    >();
  });
});

describe('every section of a defineContract contract equals the emitted one, or is excluded with its reason', () => {
  test('every top-level key is compared or excluded', () => {
    type Unclassified = {
      [F in keyof Fixtures]: `${F}: ${Exclude<TopLevelKeys<F>, ComparedSections | keyof ExcludedSections> & string}`;
    }[keyof Fixtures];
    expectTypeOf<Unclassified>().toBeNever();
  });

  test('target, family, meta and control policy', () => {
    expectTypeOf<
      SectionDifferences<'target' | 'targetFamily' | 'meta' | 'defaultControlPolicy'>
    >().toBeNever();
  });

  test('enabled capabilities', () => {
    type Enabled<Capabilities> = {
      readonly [Namespace in keyof Capabilities]: {
        readonly [Flag in keyof Capabilities[Namespace] as Capabilities[Namespace][Flag] extends true
          ? Flag
          : never]: true;
      };
    };
    type Differences = {
      [F in keyof Fixtures]: SameType<
        Enabled<Built<F>['capabilities']>,
        Enabled<Emitted<F>['capabilities']>,
        2
      > extends true
        ? never
        : F;
    }[keyof Fixtures];
    expectTypeOf<Differences>().toBeNever();
  });

  test('enums, as db.enums reads them', () => {
    type Differences = {
      [F in keyof Fixtures]: SameType<
        NamespacedEnums<Built<F>>,
        NamespacedEnums<Emitted<F>>,
        4
      > extends true
        ? never
        : F;
    }[keyof Fixtures];
    expectTypeOf<Differences>().toBeNever();
  });
});

// ---------------------------------------------------------------------------------------------
// execution
// ---------------------------------------------------------------------------------------------

type ExecutionOf<Contract> = Contract extends { readonly execution?: infer Execution }
  ? NonNullable<Execution>
  : never;

type DefaultEntries<Contract> =
  ExecutionOf<Contract> extends {
    readonly mutations: { readonly defaults: ReadonlyArray<infer Entry> };
  }
    ? Entry
    : never;

type DefaultRefs<Entry> = Entry extends { readonly ref: infer Ref } ? Ref : never;

describe('execution', () => {
  test('every key is compared or excluded', () => {
    type Excluded = {
      readonly executionHash: 'A hash the build computes at run time; the emitter writes its branded type.';
    };
    expectTypeOf<UnclassifiedPerFixture<'execution', 'mutations', Excluded>>().toBeNever();
    expectTypeOf<
      UnclassifiedPerFixture<'mutations', 'defaults', Record<never, never>>
    >().toBeNever();
  });

  // The built entries type each phase as optional, so only the columns are compared; the ORM reads a default's column to make the field optional in create.
  test('each client-generated default names the same column', () => {
    type Differences = {
      [F in keyof Fixtures]: SameType<
        DefaultRefs<DefaultEntries<Built<F>>>,
        DefaultRefs<DefaultEntries<Emitted<F>>>
      > extends true
        ? never
        : F;
    }[keyof Fixtures];
    expectTypeOf<Differences>().toBeNever();
  });
});

// ---------------------------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------------------------

type StorageOf<Contract> = Contract extends { readonly storage: infer Storage } ? Storage : never;
type StorageNamespaces<Contract> =
  StorageOf<Contract> extends { readonly namespaces: infer N } ? N : never;
type StorageEntries<Contract> =
  ValuesOf<StorageNamespaces<Contract>> extends infer Namespace
    ? Namespace extends { readonly entries: infer Entries }
      ? Entries
      : never
    : never;

/** Every table of the contract, keyed `'<namespace>.<table>'`. */
type Tables<Contract> = UnionToIntersection<
  {
    [Ns in keyof StorageNamespaces<Contract> & string]: StorageNamespaces<Contract>[Ns] extends {
      readonly entries: { readonly table: infer TableMap };
    }
      ? { readonly [Table in keyof TableMap & string as `${Ns}.${Table}`]: TableMap[Table] }
      : never;
  }[keyof StorageNamespaces<Contract> & string]
>;

/** Every column of the contract, keyed `'<namespace>.<table>.<column>'`. */
type Columns<Contract> = UnionToIntersection<
  {
    [Table in keyof Tables<Contract> & string]: Tables<Contract>[Table] extends {
      readonly columns: infer ColumnMap;
    }
      ? { readonly [Column in keyof ColumnMap & string as `${Table}.${Column}`]: ColumnMap[Column] }
      : never;
  }[keyof Tables<Contract> & string]
>;

/**
 * Codecs whose type parameters only the run time knows: a native enum's type name, qualified by the namespace of the column that uses it, and an arktype schema's expression and IR. Their types give the general shape, so the comparison leaves the values out. Their field types are compared in the type map test.
 */
type TypeParamsResolvedAtRunTime = 'pg/enum@1' | 'arktype/json@1';

type ComparedColumn<Column> = {
  readonly codecId: Column extends { readonly codecId: infer CodecId } ? CodecId : never;
  readonly nullable: Column extends { readonly nullable: infer Nullable } ? Nullable : never;
  readonly many: Column extends { readonly many: infer Many } ? Many : never;
  readonly typeParams: Column extends { readonly codecId: TypeParamsResolvedAtRunTime }
    ? 'resolved at run time'
    : Column extends { readonly typeParams: infer TypeParams }
      ? TypeParams
      : undefined;
  readonly hasDefault: Column extends { readonly default: unknown } ? true : false;
};

type ComparedTable<Table> = {
  readonly primaryKey: Table extends { readonly primaryKey: { readonly columns: infer Columns } }
    ? Columns
    : undefined;
  readonly uniques: Table extends { readonly uniques: ReadonlyArray<infer Unique> }
    ? Unique extends { readonly columns: infer Columns }
      ? Columns
      : never
    : never;
};

describe('storage', () => {
  test('every key is compared or excluded', () => {
    expectTypeOf<
      UnclassifiedPerFixture<
        'storage',
        'namespaces',
        {
          readonly storageHash: 'A hash the build computes at run time; the emitter writes it as a literal.';
          readonly types: 'The database types a contract space registers. No type reads them.';
        }
      >
    >().toBeNever();
    expectTypeOf<
      UnclassifiedPerFixture<
        'storage namespace',
        'id' | 'entries',
        {
          readonly kind: 'A fact of the target the build reads from createNamespace at run time; the built type gives string. No type reads it.';
        }
      >
    >().toBeNever();
    expectTypeOf<
      UnclassifiedPerFixture<
        'storage entries',
        'table',
        {
          readonly valueSet: 'Stored enum values, which only migrations read. A defineContract contract types the value sets of enums authored with enumType, not those of native enum types. Enum values reach the ORM through the enums comparison above.';
        }
      >
    >().toBeNever();
    expectTypeOf<
      UnclassifiedPerFixture<
        'table keys',
        'columns' | 'primaryKey' | 'uniques' | 'indexes',
        {
          readonly foreignKeys: 'No type reads them; relations, compared under domain, carry the joins the ORM uses.';
        }
      >
    >().toBeNever();
    expectTypeOf<
      UnclassifiedPerFixture<
        'column keys',
        'codecId' | 'nullable' | 'many' | 'typeParams' | 'default',
        {
          readonly dataType: 'The built type gives string; the ORM and the SQL builder read codecId.';
        }
      >
    >().toBeNever();
  });

  test('tables, primary keys and unique keys', () => {
    expectTypeOf<MapDifferences<'table'>>().toBeNever();
  });

  // Compared as the ORM and the SQL builder read them: each table's index references, keyed by the name the source gave each, with their columns, type and options.
  test('indexes', () => {
    type IndexDifferences = {
      [F in keyof Fixtures]: {
        [Table in
          | keyof Part<Built<F>, 'index'>
          | keyof Part<Emitted<F>, 'index'>]: Table extends keyof Part<Built<F>, 'index'>
          ? Table extends keyof Part<Emitted<F>, 'index'>
            ? SameType<
                Part<Built<F>, 'index'>[Table],
                Part<Emitted<F>, 'index'>[Table],
                4
              > extends true
              ? never
              : `${F}: indexes of ${Table & string}`
            : `${F}: ${Table & string} (built only)`
          : `${F}: ${Table & string} (emitted only)`;
      }[keyof Part<Built<F>, 'index'> | keyof Part<Emitted<F>, 'index'>];
    }[keyof Fixtures];
    expectTypeOf<IndexDifferences>().toBeNever();
    expectTypeOf<'search_docs' | 'users_handle_idx'>().toExtend<
      keyof Part<Built<'postgresParity'>, 'index'>['public.users']
    >();
  });

  test('columns', () => {
    expectTypeOf<MapDifferences<'column'>>().toBeNever();
  });
});

// ---------------------------------------------------------------------------------------------
// domain
// ---------------------------------------------------------------------------------------------

type DomainNamespaces<Contract> = Contract extends {
  readonly domain: { readonly namespaces: infer N };
}
  ? N
  : never;

/** Every model of the contract, keyed `'<namespace>.<model>'`. */
type Models<Contract> = UnionToIntersection<
  {
    [Ns in keyof DomainNamespaces<Contract> & string]: DomainNamespaces<Contract>[Ns] extends {
      readonly models: infer ModelMap;
    }
      ? { readonly [Model in keyof ModelMap & string as `${Ns}.${Model}`]: ModelMap[Model] }
      : never;
  }[keyof DomainNamespaces<Contract> & string]
>;

type ModelPart<Contract, Part extends string> = {
  readonly [Model in keyof Models<Contract>]: Models<Contract>[Model] extends {
    readonly [K in Part]: infer Value;
  }
    ? Value
    : never;
};

/** Every relation of the contract, keyed `'<namespace>.<model>.<relation>'`. The emitter writes a model without relations as `Record<string, never>`, which has none. */
type Relations<Contract> = UnionToIntersection<
  {
    [Model in keyof Models<Contract> & string]: Models<Contract>[Model] extends {
      readonly relations: infer RelationMap;
    }
      ? string extends keyof RelationMap
        ? Record<never, never>
        : {
            readonly [Relation in keyof RelationMap &
              string as `${Model}.${Relation}`]: RelationMap[Relation];
          }
      : never;
  }[keyof Models<Contract> & string]
>;

/** Every field of the contract, keyed `'<namespace>.<model>.<field>'`, with the type parameters the build resolves at run time left out. */
type Fields<Contract> = UnionToIntersection<
  {
    [Model in keyof Models<Contract> & string]: Models<Contract>[Model] extends {
      readonly fields: infer FieldMap;
    }
      ? {
          readonly [Field in keyof FieldMap & string as `${Model}.${Field}`]: ComparedField<
            FieldMap[Field]
          >;
        }
      : never;
  }[keyof Models<Contract> & string]
>;

type ComparedField<Field> = Field extends {
  readonly type: { readonly codecId: TypeParamsResolvedAtRunTime };
}
  ? Omit<Field, 'type'> & { readonly type: Omit<Field['type'], 'typeParams'> }
  : Field;

type DomainOf<Contract> = Contract extends { readonly domain: infer Domain } ? Domain : never;

/** Each enum of the contract's domain, keyed `'<namespace>.<enum>'`, as `Slot` types it: `'enum'` with its codec id and stored members, `'enumMemberTypes'` with the members as read. */
type DomainEnums<Contract, Slot extends 'enum' | 'enumMemberTypes'> = UnionToIntersection<
  {
    [Ns in keyof DomainNamespaces<Contract> & string]: DomainNamespaces<Contract>[Ns] extends {
      readonly [K in Slot]?: infer Enums;
    }
      ? {
          readonly [Name in keyof NonNullable<Enums> &
            string as `${Ns}.${Name}`]: NonNullable<Enums>[Name];
        }
      : Record<never, never>;
  }[keyof DomainNamespaces<Contract> & string]
>;

type EnumDifferences<Slot extends 'enum' | 'enumMemberTypes'> = {
  [F in keyof Fixtures]: {
    [Name in
      | keyof DomainEnums<Built<F>, Slot>
      | keyof DomainEnums<Emitted<F>, Slot>]: Name extends keyof DomainEnums<Built<F>, Slot>
      ? Name extends keyof DomainEnums<Emitted<F>, Slot>
        ? SameType<
            DomainEnums<Built<F>, Slot>[Name],
            DomainEnums<Emitted<F>, Slot>[Name],
            3
          > extends true
          ? never
          : `${F}: ${Slot} ${Name & string}`
        : `${F}: ${Slot} ${Name & string} (built only)`
      : `${F}: ${Slot} ${Name & string} (emitted only)`;
  }[keyof DomainEnums<Built<F>, Slot> | keyof DomainEnums<Emitted<F>, Slot>];
}[keyof Fixtures];

describe('domain', () => {
  test('every key is compared or excluded', () => {
    expectTypeOf<
      UnclassifiedPerFixture<'domain', 'namespaces', Record<never, never>>
    >().toBeNever();
    expectTypeOf<
      UnclassifiedPerFixture<
        'domain namespace',
        'models' | 'enum' | 'enumMemberTypes',
        Record<never, never>
      >
    >().toBeNever();
    expectTypeOf<
      UnclassifiedPerFixture<'model', 'storage' | 'fields' | 'relations', Record<never, never>>
    >().toBeNever();
  });

  test('model storage', () => {
    expectTypeOf<MapDifferences<'model storage'>>().toBeNever();
  });

  // Each enum's codec id and stored members, and the members as the application reads them. A member that is not a JSON value, such as a bigint or a Date, is typed JsonValue in the built enum, where the emitted one has its stored literal; only migrations read stored values. db.enums reads enumMemberTypes, compared above through NamespacedEnums and here directly.
  test('enum members, as stored and as read', () => {
    expectTypeOf<EnumDifferences<'enum'>>().toBeNever();
    expectTypeOf<EnumDifferences<'enumMemberTypes'>>().toBeNever();
    expectTypeOf<'public.Plan'>().toExtend<keyof DomainEnums<Built<'postgresParity'>, 'enum'>>();
    expectTypeOf<'public.Plan'>().toExtend<
      keyof DomainEnums<Emitted<'postgresParity'>, 'enumMemberTypes'>
    >();
  });

  test('fields', () => {
    expectTypeOf<MapDifferences<'field'>>().toBeNever();
  });

  test('relations, in every namespace', () => {
    expectTypeOf<MapDifferences<'relation'>>().toBeNever();
  });
});

type DeclaredCodecs<Outputs extends ParameterizedOutputTypesFunction> =
  keyof ApplyParameterizedOutputTypes<Outputs, Record<string, unknown>>;

/** The codecs a fixture's emitted contract stores in a column with type parameters. */
type CodecsWithTypeParams = {
  [F in keyof Fixtures]: ValuesOf<Columns<Emitted<F>>> extends infer Column
    ? Column extends { readonly codecId: infer CodecId; readonly typeParams: object }
      ? CodecId
      : never
    : never;
}[keyof Fixtures];

describe('parameterized output types a pack declares', () => {
  // The emitted contract and the built one both type these columns through the pack's type function; rendered-output-types.test.ts checks every parameterized codec is declared there or classified.
  test('each is exercised with type parameters by a parity fixture, so the field type comparison checks it', () => {
    expectTypeOf<
      Exclude<
        DeclaredCodecs<PostgresOutputTypes> | DeclaredCodecs<PgvectorOutputTypes>,
        CodecsWithTypeParams
      >
    >().toBeNever();
    expectTypeOf<'pg/vector@1' | 'pg/numeric@1'>().toExtend<CodecsWithTypeParams>();
  });
});

type PartName =
  | 'execution'
  | 'mutations'
  | 'storage'
  | 'storage namespace'
  | 'storage entries'
  | 'table keys'
  | 'column keys'
  | 'table'
  | 'index'
  | 'column'
  | 'domain'
  | 'domain namespace'
  | 'model'
  | 'model storage'
  | 'field'
  | 'relation';

/** The named part of a contract: an object whose keys are classified, or a map whose entries are compared. */
type Part<Contract, Name extends PartName> = Name extends 'execution'
  ? ExecutionOf<Contract>
  : Name extends 'mutations'
    ? ExecutionOf<Contract> extends { readonly mutations: infer Mutations }
      ? Mutations
      : never
    : Name extends 'storage'
      ? StorageOf<Contract>
      : Name extends 'storage namespace'
        ? ValuesOf<StorageNamespaces<Contract>>
        : Name extends 'storage entries'
          ? StorageEntries<Contract>
          : Name extends 'table keys'
            ? ValuesOf<Tables<Contract>>
            : Name extends 'column keys'
              ? ValuesOf<Columns<Contract>>
              : Name extends 'table'
                ? {
                    readonly [Table in keyof Tables<Contract>]: ComparedTable<
                      Tables<Contract>[Table]
                    >;
                  }
                : Name extends 'index'
                  ? {
                      readonly [Table in keyof Tables<Contract>]: TableIndexReferences<
                        Tables<Contract>[Table]
                      >;
                    }
                  : Name extends 'column'
                    ? {
                        readonly [Column in keyof Columns<Contract>]: ComparedColumn<
                          Columns<Contract>[Column]
                        >;
                      }
                    : Name extends 'domain'
                      ? DomainOf<Contract>
                      : Name extends 'domain namespace'
                        ? ValuesOf<DomainNamespaces<Contract>>
                        : Name extends 'model'
                          ? ValuesOf<Models<Contract>>
                          : Name extends 'model storage'
                            ? ModelPart<Contract, 'storage'>
                            : Name extends 'field'
                              ? Fields<Contract>
                              : Relations<Contract>;
