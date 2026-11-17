import type { Contract, StorageHashBase } from '@internal/contract/types';
import type { SqlStorage, TypeMaps, TypeMapsPhantomKey } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { ComputeColumnJsType } from '../src/types';

/**
 * Two namespaces declare the SAME bare table name `users`, each with a
 * namespace-UNIQUE column: `public.users` has `email` (text) and a
 * parameterized `embedding` (vector), `auth.users` has `token` (int).
 *
 * `ComputeColumnJsType` is given an explicit namespace coordinate and must:
 *  - resolve each column to its OWN namespace's field type;
 *  - return the REFINED output (`FixtureVector<3>`) for the parameterized
 *    column, not the bare codec output (`readonly number[]`) — i.e. read the
 *    emitter's namespace-nested `FieldOutputTypes[ns][model][field]` map;
 *  - resolve to `never` for a column that exists only in the other namespace.
 *
 * A flat cross-namespace resolver would collapse `users` to the per-namespace
 * column intersection and reach neither unique column, and a codec-base
 * resolver would degrade the parameterized column to `readonly number[]`.
 */

// Stands in for an emitter-applied codec refinement (e.g. pgvector's
// `Vector<N>`); deliberately DISTINCT from the bare codec output
// `readonly number[]` so the assertions prove the refined map is read.
type FixtureVector<N extends number> = {
  readonly __dimension: N;
  readonly values: readonly number[];
};

type Col<Codec extends string> = {
  readonly dataType: string;
  readonly codecId: Codec;
  readonly nullable: false;
};

type FixtureCodecTypes = {
  readonly 'core/int4': { readonly output: number };
  readonly 'core/text': { readonly output: string };
  readonly 'core/vector': { readonly output: readonly number[] };
};

type PublicUsersTable = {
  readonly columns: {
    readonly id: Col<'core/int4'>;
    readonly email: Col<'core/text'>;
    readonly embedding: Col<'core/vector'>;
  };
  readonly uniques: readonly [];
  readonly indexes: readonly [];
  readonly foreignKeys: readonly [];
};

type AuthUsersTable = {
  readonly columns: {
    readonly id: Col<'core/int4'>;
    readonly token: Col<'core/int4'>;
  };
  readonly uniques: readonly [];
  readonly indexes: readonly [];
  readonly foreignKeys: readonly [];
};

type ScalarField<Codec extends string> = {
  readonly nullable: false;
  readonly type: { readonly kind: 'scalar'; readonly codecId: Codec };
};

type PublicUserModel = {
  readonly fields: {
    readonly id: ScalarField<'core/int4'>;
    readonly email: ScalarField<'core/text'>;
    readonly embedding: ScalarField<'core/vector'>;
  };
  readonly relations: Record<string, never>;
  readonly storage: {
    readonly table: 'users';
    readonly fields: {
      readonly id: { readonly column: 'id' };
      readonly email: { readonly column: 'email' };
      readonly embedding: { readonly column: 'embedding' };
    };
  };
};

type AuthUserModel = {
  readonly fields: {
    readonly id: ScalarField<'core/int4'>;
    readonly token: ScalarField<'core/int4'>;
  };
  readonly relations: Record<string, never>;
  readonly storage: {
    readonly table: 'users';
    readonly fields: {
      readonly id: { readonly column: 'id' };
      readonly token: { readonly column: 'token' };
    };
  };
};

// Namespace-nested output/input maps, as the emitter now emits them. The
// `public.User.embedding` entry carries the refined `FixtureVector<3>` — the
// codec output for `core/vector` is the unrefined `readonly number[]`.
type FixtureFieldOutputTypes = {
  readonly public: {
    readonly User: {
      readonly id: number;
      readonly email: string;
      readonly embedding: FixtureVector<3>;
    };
  };
  readonly auth: {
    readonly User: {
      readonly id: number;
      readonly token: number;
    };
  };
};

type FixtureFieldInputTypes = {
  readonly public: {
    readonly User: {
      readonly id: number;
      readonly email: string;
      readonly embedding: readonly number[];
    };
  };
  readonly auth: {
    readonly User: {
      readonly id: number;
      readonly token: number;
    };
  };
};

type FixtureTypeMaps = TypeMaps<
  FixtureCodecTypes,
  Record<string, never>,
  FixtureFieldOutputTypes,
  FixtureFieldInputTypes
>;

type TwoNamespaceContract = Omit<Contract<SqlStorage>, 'storage' | 'domain'> & {
  readonly storage: {
    readonly storageHash: StorageHashBase<'two-namespace-resolver-fixture'>;
    readonly namespaces: {
      readonly public: {
        readonly id: 'public';
        readonly kind: 'postgres-schema';
        readonly entries: {
          readonly table: { readonly users: PublicUsersTable };
          readonly type: Record<string, never>;
        };
      };
      readonly auth: {
        readonly id: 'auth';
        readonly kind: 'postgres-schema';
        readonly entries: {
          readonly table: { readonly users: AuthUsersTable };
          readonly type: Record<string, never>;
        };
      };
    };
  };
  readonly domain: {
    readonly namespaces: {
      readonly public: { readonly models: { readonly User: PublicUserModel } };
      readonly auth: { readonly models: { readonly User: AuthUserModel } };
    };
  };
} & {
  readonly [K in TypeMapsPhantomKey]?: FixtureTypeMaps;
};

test('public coordinate resolves its own unique column `email`', () => {
  expectTypeOf<
    ComputeColumnJsType<TwoNamespaceContract, 'public', 'users', 'email', FixtureCodecTypes>
  >().toEqualTypeOf<string>();
});

test('public coordinate keeps the parameterized `embedding` refined per namespace', () => {
  expectTypeOf<
    ComputeColumnJsType<TwoNamespaceContract, 'public', 'users', 'embedding', FixtureCodecTypes>
  >().toEqualTypeOf<FixtureVector<3>>();
});

test('auth coordinate resolves its own unique column `token`', () => {
  expectTypeOf<
    ComputeColumnJsType<TwoNamespaceContract, 'auth', 'users', 'token', FixtureCodecTypes>
  >().toEqualTypeOf<number>();
});

test('shared column `id` resolves within each coordinate', () => {
  expectTypeOf<
    ComputeColumnJsType<TwoNamespaceContract, 'public', 'users', 'id', FixtureCodecTypes>
  >().toEqualTypeOf<number>();
  expectTypeOf<
    ComputeColumnJsType<TwoNamespaceContract, 'auth', 'users', 'id', FixtureCodecTypes>
  >().toEqualTypeOf<number>();
});

test('public coordinate does not resolve the auth-only column `token`', () => {
  expectTypeOf<
    ComputeColumnJsType<TwoNamespaceContract, 'public', 'users', 'token', FixtureCodecTypes>
  >().toBeNever();
});

test('auth coordinate does not resolve the public-only column `email`', () => {
  expectTypeOf<
    ComputeColumnJsType<TwoNamespaceContract, 'auth', 'users', 'email', FixtureCodecTypes>
  >().toBeNever();
});
