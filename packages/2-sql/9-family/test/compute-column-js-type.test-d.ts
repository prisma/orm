import type { Contract, StorageHashBase } from '@internal/contract/types';
import type { SqlStorage, TypeMaps, TypeMapsPhantomKey } from '@internal/sql-contract/types';
import type { ComputeColumnJsType } from '@internal/sql-relational-core/types';

type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<_T extends true> = never;

/**
 * Direct test of `ComputeColumnJsType`. The resolver takes an explicit
 * namespace coordinate and reads the refined output from the emitter's
 * namespace-nested `FieldOutputTypes[ns][model][field]` map, so a parameterized
 * column keeps its refined type (`Float32Array`) rather than degrading to the
 * bare codec output (`number[]`). A storage column with no backing model field
 * falls back to the codec output.
 */

type TestCodecTypes = {
  readonly 'pg/vector@1': { readonly output: number[] };
  readonly 'pg/int4@1': { readonly output: number };
  readonly 'pg/text@1': { readonly output: string };
};

type Col<Codec extends string, Nullable extends boolean = false> = {
  readonly nativeType: string;
  readonly codecId: Codec;
  readonly nullable: Nullable;
  readonly many: false;
};

type ScalarField<Codec extends string, Nullable extends boolean = false> = {
  readonly nullable: Nullable;
  readonly many: false;
  readonly type: { readonly kind: 'scalar'; readonly codecId: Codec };
};

// `vectors` carries `id` (plain) + `embedding` (parameterized) model columns,
// plus `shadow` — a storage column with NO corresponding model field, to
// exercise the codec-output fallback path.
type VectorsTable = {
  readonly columns: {
    readonly id: Col<'pg/int4@1'>;
    readonly embedding: Col<'pg/vector@1'>;
    readonly shadow: Col<'pg/text@1'>;
  };
  readonly uniques: readonly [];
  readonly indexes: readonly [];
  readonly foreignKeys: readonly [];
};

type VectorsModel = {
  readonly fields: {
    readonly id: ScalarField<'pg/int4@1'>;
    readonly embedding: ScalarField<'pg/vector@1'>;
  };
  readonly relations: Record<string, never>;
  readonly storage: {
    readonly table: 'vectors';
    readonly fields: {
      readonly id: { readonly column: 'id' };
      readonly embedding: { readonly column: 'embedding' };
    };
  };
};

// `embedding`'s refined output is `Float32Array`; the codec output for
// `pg/vector@1` is the unrefined `number[]`.
type TestFieldOutputTypes = {
  readonly public: {
    readonly Vectors: {
      readonly id: number;
      readonly embedding: Float32Array;
    };
  };
};

type TestFieldInputTypes = {
  readonly public: {
    readonly Vectors: {
      readonly id: number;
      readonly embedding: number[];
    };
  };
};

type TestTypeMaps = TypeMaps<
  TestCodecTypes,
  Record<string, never>,
  TestFieldOutputTypes,
  TestFieldInputTypes
>;

type TestContract = Omit<Contract<SqlStorage>, 'storage' | 'domain'> & {
  readonly storage: {
    readonly storageHash: StorageHashBase<'family-sql-compute-column'>;
    readonly namespaces: {
      readonly public: {
        readonly id: 'public';
        readonly kind: 'postgres-schema';
        readonly entries: {
          readonly table: { readonly vectors: VectorsTable };
          readonly type: Record<string, never>;
        };
      };
    };
  };
  readonly domain: {
    readonly namespaces: {
      readonly public: { readonly models: { readonly Vectors: VectorsModel } };
    };
  };
} & {
  readonly [K in TypeMapsPhantomKey]?: TestTypeMaps;
};

// ── Scenario 1: parameterized column resolves the refined per-namespace output ──
export type _ParameterizedRefined = Assert<
  IsEqual<
    ComputeColumnJsType<TestContract, 'public', 'vectors', 'embedding', TestCodecTypes>,
    Float32Array
  >
>;

// ── Scenario 2: plain column resolves the base output ────────────────────────
export type _BaseOutput = Assert<
  IsEqual<ComputeColumnJsType<TestContract, 'public', 'vectors', 'id', TestCodecTypes>, number>
>;

// ── Scenario 3: storage column with no model field falls back to codec output ─
export type _CodecFallback = Assert<
  IsEqual<ComputeColumnJsType<TestContract, 'public', 'vectors', 'shadow', TestCodecTypes>, string>
>;

// ── Scenario 4: nullable parameterized column keeps its refined output | null ──
type NullableVectorsModel = {
  readonly fields: {
    readonly embedding: ScalarField<'pg/vector@1', true>;
  };
  readonly relations: Record<string, never>;
  readonly storage: {
    readonly table: 'vectors';
    readonly fields: {
      readonly embedding: { readonly column: 'embedding' };
    };
  };
};

type NullableContract = Omit<Contract<SqlStorage>, 'storage' | 'domain'> & {
  readonly storage: {
    readonly storageHash: StorageHashBase<'family-sql-compute-column-nullable'>;
    readonly namespaces: {
      readonly public: {
        readonly id: 'public';
        readonly kind: 'postgres-schema';
        readonly entries: {
          readonly table: {
            readonly vectors: {
              readonly columns: { readonly embedding: Col<'pg/vector@1', true> };
              readonly uniques: readonly [];
              readonly indexes: readonly [];
              readonly foreignKeys: readonly [];
            };
          };
          readonly type: Record<string, never>;
        };
      };
    };
  };
  readonly domain: {
    readonly namespaces: {
      readonly public: { readonly models: { readonly Vectors: NullableVectorsModel } };
    };
  };
} & {
  readonly [K in TypeMapsPhantomKey]?: TypeMaps<
    TestCodecTypes,
    Record<string, never>,
    { readonly public: { readonly Vectors: { readonly embedding: Float32Array | null } } },
    { readonly public: { readonly Vectors: { readonly embedding: number[] | null } } }
  >;
};

export type _NullableRefined = Assert<
  IsEqual<
    ComputeColumnJsType<NullableContract, 'public', 'vectors', 'embedding', TestCodecTypes>,
    Float32Array | null
  >
>;
