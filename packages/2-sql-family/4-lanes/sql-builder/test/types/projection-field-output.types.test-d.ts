import type { Contract, StorageHashBase } from '@internal/contract/types';
import type { ResultType } from '@internal/framework-components/runtime';
import type { ContractWithTypeMaps, TypeMaps } from '@internal/sql-contract/types';
import { expectTypeOf, test } from 'vitest';
import type { ResolveRow } from '../../src/resolve';
import type { Db } from '../../src/types/db';
import type { RawLane } from '../../src/types/raw-query';

type JsonValue =
  | null
  | string
  | number
  | boolean
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type Codecs = {
  'pg/uuid@1': { input: string; output: string; traits: 'equality' | 'order' };
  'sql/varchar@1': { input: string; output: string; traits: 'equality' | 'order' | 'textual' };
  'pg/jsonb@1': { input: JsonValue; output: JsonValue; traits: 'equality' };
  'pg/int4@1': { input: number; output: number; traits: 'equality' | 'order' | 'numeric' };
  'pg/text@1': { input: string; output: string; traits: 'equality' | 'order' | 'textual' };
  'pg/enum@1': { input: string; output: string; traits: 'equality' | 'order' };
  'pg/bool@1': { input: boolean; output: boolean; traits: 'equality' };
};
type Column<Id extends keyof Codecs, Nullable extends boolean = false, Many = false> = {
  readonly dataType: string;
  readonly codecId: Id;
  readonly nullable: Nullable;
  readonly many: Many;
};
type Table<Columns> = {
  readonly columns: Columns;
  readonly primaryKey: { readonly columns: readonly ['id'] };
  readonly uniques: readonly [];
  readonly indexes: readonly [];
  readonly foreignKeys: readonly [];
};
type Storage = {
  readonly storageHash: StorageHashBase<string>;
  readonly namespaces: {
    readonly public: {
      readonly id: 'public';
      readonly kind: 'test-sql-namespace';
      readonly entries: {
        readonly table: {
          readonly alpha: Table<{
            readonly id: Column<'pg/int4@1'>;
            readonly label: Column<'pg/text@1'>;
            readonly payload: Column<'pg/jsonb@1'>;
            readonly status: Column<'pg/enum@1'>;
            readonly optional_status: Column<'pg/enum@1', true>;
            readonly tags: Column<'pg/text@1', false, { readonly elementNullable: true }>;
            readonly strict_tags: Column<'pg/text@1', false, { readonly elementNullable: false }>;
            readonly optional_tags: Column<'pg/text@1', true, { readonly elementNullable: true }>;
          }>;
          readonly beta: Table<{
            readonly id: Column<'pg/int4@1'>;
            readonly status: Column<'pg/enum@1'>;
          }>;
        };
      };
    };
  };
};
type Outputs = {
  public: {
    alpha: {
      id: number;
      label: string;
      payload: JsonValue;
      status: 'ALPHA' | 'OMEGA';
      optional_status: 'ALPHA' | 'OMEGA' | null;
      tags: readonly (string | null)[];
      strict_tags: readonly string[];
      optional_tags: readonly (string | null)[] | null;
    };
    beta: { id: number; status: 'BETA' | 'GAMMA' };
  };
};
type Maps = TypeMaps<
  Codecs,
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  Outputs,
  Outputs
>;
type Base = Omit<Contract<Storage>, 'domain'> & {
  readonly domain: {
    readonly namespaces: { readonly public: { readonly models: Record<string, never> } };
  };
};
type ProjectionContract = ContractWithTypeMaps<Base, Maps> & {
  readonly capabilities: { readonly sql: { readonly returning: true; readonly lateral: true } };
  readonly roots: Record<string, never>;
};
declare const db: Db<ProjectionContract>;
declare const raw: RawLane<ProjectionContract>;
type Tags = Outputs['public']['alpha']['tags'];
type AlphaStatus = Outputs['public']['alpha']['status'];
type BetaStatus = Outputs['public']['beta']['status'];

test('direct and renamed fields retain their own array and nullable enum types', () => {
  const direct = db.public.alpha.select('tags', 'strict_tags', 'optional_tags', 'status').build();
  const renamed = db.public.alpha
    .select((row) => ({
      values: row.tags,
      strict: row.strict_tags,
      optional: row.optional_tags,
      state: row.status,
      optional_state: row.optional_status,
    }))
    .build();
  expectTypeOf<ResultType<typeof direct>['tags']>().toEqualTypeOf<Tags>();
  expectTypeOf<ResultType<typeof direct>['strict_tags']>().toEqualTypeOf<readonly string[]>();
  expectTypeOf<ResultType<typeof direct>['optional_tags']>().toEqualTypeOf<Tags | null>();
  expectTypeOf<ResultType<typeof renamed>>().toEqualTypeOf<{
    values: Tags;
    strict: readonly string[];
    optional: Tags | null;
    state: AlphaStatus;
    optional_state: AlphaStatus | null;
  }>();
});

test('repeated table aliases do not change projected field provenance', () => {
  const plan = db.public.alpha
    .as('first')
    .as('second')
    .select(({ second }) => ({ values: second.tags, state: second.optional_status }))
    .build();
  expectTypeOf<ResultType<typeof plan>>().toEqualTypeOf<{
    values: Tags;
    state: AlphaStatus | null;
  }>();
});

test('joined fields with a base-table name retain the joined table output', () => {
  const plan = db.public.alpha
    .as('a')
    .innerJoin(db.public.beta.as('b'), ({ a, b }, fns) => fns.eq(a.id, b.id))
    .select(({ a, b }) => ({ status: b.status, renamed: b.status, values: a.tags }))
    .build();
  expectTypeOf<ResultType<typeof plan>>().toEqualTypeOf<{
    status: BetaStatus;
    renamed: BetaStatus;
    values: Tags;
  }>();
});

test('a scalar aliased to an array column name stays scalar', () => {
  const plan = db.public.alpha.select((row) => ({ tags: row.label, status: row.id })).build();
  expectTypeOf<ResultType<typeof plan>>().toEqualTypeOf<{ tags: string; status: number }>();
});

test('left joins preserve array element nullability and add row nullability', () => {
  const plan = db.public.beta
    .as('b')
    .outerLeftJoin(db.public.alpha.as('a'), ({ a, b }, fns) => fns.eq(a.id, b.id))
    .select(({ a, b }) => ({
      values: a.tags,
      strict: a.strict_tags,
      state: a.status,
      base: b.status,
    }))
    .build();
  expectTypeOf<ResultType<typeof plan>>().toEqualTypeOf<{
    values: Tags | null;
    strict: readonly string[] | null;
    state: AlphaStatus | null;
    base: BetaStatus;
  }>();
});

test('right and full joins carry the nullable source field output', () => {
  const right = db.public.alpha
    .as('a')
    .outerRightJoin(db.public.beta.as('b'), ({ a, b }, fns) => fns.eq(a.id, b.id))
    .select(({ a, b }) => ({ values: a.tags, state: b.status }))
    .build();
  const full = db.public.alpha
    .as('a')
    .outerFullJoin(db.public.beta.as('b'), ({ a, b }, fns) => fns.eq(a.id, b.id))
    .select(({ a, b }) => ({ values: a.tags, state: b.status }))
    .build();
  expectTypeOf<ResultType<typeof right>>().toEqualTypeOf<{
    values: Tags | null;
    state: BetaStatus;
  }>();
  expectTypeOf<ResultType<typeof full>>().toEqualTypeOf<{
    values: Tags | null;
    state: BetaStatus | null;
  }>();
});

test('a derived table keeps outputs through a second projection alias', () => {
  const derived = db.public.alpha
    .select((row) => ({ id: row.id, values: row.tags, state: row.optional_status }))
    .as('selected');
  const plan = db.public.beta
    .as('b')
    .innerJoin(derived, ({ b, selected }, fns) => fns.eq(b.id, selected.id))
    .select(({ selected }) => ({ final_values: selected.values, final_state: selected.state }))
    .build();
  expectTypeOf<ResultType<typeof plan>>().toEqualTypeOf<{
    final_values: Tags;
    final_state: AlphaStatus | null;
  }>();
});

test('outer lateral subqueries retain their selected output and nullability', () => {
  const plan = db.public.beta
    .as('b')
    .outerLateralJoin('selected', (lateral) =>
      lateral
        .from(db.public.alpha.as('a'))
        .where(({ a, b }, fns) => fns.eq(a.id, b.id))
        .select(({ a }) => ({ values: a.tags, state: a.optional_status }))
        .limit(1),
    )
    .select(({ selected }) => ({ values: selected.values, state: selected.state }))
    .build();
  expectTypeOf<ResultType<typeof plan>>().toEqualTypeOf<{
    values: Tags | null;
    state: AlphaStatus | null;
  }>();
});

test('mutation RETURNING keeps generated array and enum outputs', () => {
  const plan = db.public.alpha.update({ label: 'next' }).returning('tags', 'status').build();
  expectTypeOf<ResultType<typeof plan>>().toEqualTypeOf<{ tags: Tags; status: AlphaStatus }>();
});

test('raw row specs keep their separately keyed column-reference output map', () => {
  const inner = raw.sql`SELECT tags AS values, optional_status AS state FROM alpha`.returnsRow({
    values: db.public.alpha.columns.tags,
    state: db.public.alpha.columns.optional_status,
  });
  const plan =
    raw.sql`WITH selected AS (${inner}) SELECT values AS result, state AS status FROM selected`
      .returnsRow({
        result: inner.returns.values,
        status: inner.returns.state,
      })
      .build();
  expectTypeOf<ResultType<typeof plan>>().toEqualTypeOf<{
    result: Tags;
    status: AlphaStatus | null;
  }>();
});

test('codec-only list descriptors preserve array and container nullability', () => {
  type Rows = ResolveRow<
    {
      present: { codecId: 'pg/text@1'; nullable: false; many: true };
      optional: { codecId: 'pg/text@1'; nullable: true; many: true };
      scalar: { codecId: 'pg/text@1'; nullable: true };
    },
    Codecs
  >;
  expectTypeOf<Rows>().toEqualTypeOf<{
    present: readonly string[];
    optional: readonly string[] | null;
    scalar: string | null;
  }>();
});

test('required JSON keeps valid JSON null through direct and renamed projections', () => {
  const direct = db.public.alpha.select('payload').build();
  const renamed = db.public.alpha.select((row) => ({ document: row.payload })).build();
  expectTypeOf<ResultType<typeof direct>['payload']>().toEqualTypeOf<JsonValue>();
  expectTypeOf<ResultType<typeof renamed>['document']>().toEqualTypeOf<JsonValue>();
});

test('required JSON raw column references retain JSON null through a returns round trip', () => {
  const inner = raw.sql`SELECT payload FROM alpha`.returnsRow({
    payload: db.public.alpha.columns.payload,
  });
  const direct = inner.build();
  const nested = raw.sql`WITH source AS (${inner}) SELECT payload FROM source`
    .returnsRow({ payload: inner.returns.payload })
    .build();
  expectTypeOf<ResultType<typeof direct>['payload']>().toEqualTypeOf<JsonValue>();
  expectTypeOf<ResultType<typeof nested>['payload']>().toEqualTypeOf<JsonValue>();
  type Explicit = ResolveRow<
    { payload: { codecId: 'pg/jsonb@1'; nullable: false } },
    Codecs,
    { payload: JsonValue }
  >;
  expectTypeOf<Explicit['payload']>().toEqualTypeOf<JsonValue>();
});

test('standalone complete raw codec bindings distinguish arrays and container NULL', () => {
  const required = raw.sql`SELECT ARRAY['x', NULL]::text[] AS value`
    .returnsRow({
      value: { codecId: 'pg/text@1', codec: { codecId: 'pg/text@1', many: true } },
    })
    .build();
  const nullable = raw.sql`SELECT NULL::text[] AS value`
    .returnsRow({
      value: { codecId: 'pg/text@1', nullable: true, codec: { codecId: 'pg/text@1', many: true } },
    })
    .build();
  const scalar = raw.sql`SELECT 'x'::text AS value`
    .returnsRow({
      value: { codecId: 'pg/text@1', codec: { codecId: 'pg/text@1', many: false } },
    })
    .build();
  const integers = raw.sql`SELECT ARRAY[1, NULL]::int4[] AS value`
    .returnsRow({
      value: { codecId: 'pg/int4@1', codec: { codecId: 'pg/int4@1', many: true } },
    })
    .build();
  expectTypeOf<ResultType<typeof required>['value']>().toEqualTypeOf<readonly (string | null)[]>();
  expectTypeOf<ResultType<typeof nullable>['value']>().toEqualTypeOf<
    readonly (string | null)[] | null
  >();
  expectTypeOf<ResultType<typeof scalar>['value']>().toEqualTypeOf<string>();
  expectTypeOf<ResultType<typeof integers>['value']>().toEqualTypeOf<readonly (number | null)[]>();
});

test('standalone arrays survive raw reference composition while storage outputs stay precise', () => {
  const inner = raw.sql`SELECT ARRAY['x']::text[] AS value`.returnsRow({
    value: { codecId: 'pg/text@1', codec: { codecId: 'pg/text@1', many: true } },
  });
  const nested = raw.sql`WITH source AS (${inner}) SELECT value FROM source`
    .returnsRow({ value: inner.returns.value })
    .build();
  const strict = raw.sql`SELECT strict_tags AS value FROM alpha`
    .returnsRow({ value: db.public.alpha.columns.strict_tags })
    .build();
  expectTypeOf<ResultType<typeof nested>['value']>().toEqualTypeOf<readonly (string | null)[]>();
  expectTypeOf<ResultType<typeof strict>['value']>().toEqualTypeOf<readonly string[]>();
});

declare const dynamicMany: boolean;
declare const optionalBinding: { readonly codecId: 'pg/text@1'; readonly many?: boolean };
test('dynamic array codec flags conservatively retain scalar and array alternatives', () => {
  const dynamic = raw.sql`SELECT NULL AS value`
    .returnsRow({
      value: {
        codecId: 'pg/text@1',
        nullable: true,
        codec: { codecId: 'pg/text@1', many: dynamicMany },
      },
    })
    .build();
  const optional = raw.sql`SELECT 'x' AS value`
    .returnsRow({
      value: { codecId: 'pg/text@1', codec: optionalBinding },
    })
    .build();
  expectTypeOf<ResultType<typeof dynamic>['value']>().toEqualTypeOf<
    string | readonly (string | null)[] | null
  >();
  expectTypeOf<ResultType<typeof optional>['value']>().toEqualTypeOf<
    string | readonly (string | null)[]
  >();
});

test('parameterized and JSON standalone array descriptors preserve element output', () => {
  const parameterized = raw.sql`SELECT ARRAY['x', NULL]::varchar(16)[] AS value`
    .returnsRow({
      value: {
        codecId: 'sql/varchar@1',
        codec: { codecId: 'sql/varchar@1', typeParams: { length: 16 }, many: true },
      },
    })
    .build();
  const json = raw.sql`SELECT ARRAY['null'::jsonb, NULL::jsonb] AS value`
    .returnsRow({
      value: { codecId: 'pg/jsonb@1', codec: { codecId: 'pg/jsonb@1', many: true } },
    })
    .build();
  expectTypeOf<ResultType<typeof parameterized>['value']>().toEqualTypeOf<
    readonly (string | null)[]
  >();
  expectTypeOf<ResultType<typeof json>['value']>().toEqualTypeOf<readonly JsonValue[]>();
});

declare const mixedRawEntry:
  | 'pg/uuid@1'
  | {
      readonly codecId: 'pg/uuid@1';
      readonly codec: { readonly codecId: 'pg/uuid@1'; readonly many: true };
    };
test('a string codec-id or standalone array entry keeps both output alternatives', () => {
  const query = raw.sql`SELECT NULL AS value`.returnsRow({ value: mixedRawEntry }).build();
  expectTypeOf<ResultType<typeof query>['value']>().toEqualTypeOf<
    string | readonly (string | null)[]
  >();
});

declare const mixedRawBinding:
  | { readonly codecId: 'pg/uuid@1'; readonly many: true }
  | { readonly codecId: 'pg/uuid@1'; readonly many: false };
declare const mixedRawObject:
  | {
      readonly codecId: 'pg/uuid@1';
      readonly codec: { readonly codecId: 'pg/uuid@1'; readonly many: true };
    }
  | {
      readonly codecId: 'pg/uuid@1';
      readonly codec: { readonly codecId: 'pg/uuid@1'; readonly many: false };
    };
test('unions of array and scalar bindings preserve both physical shapes', () => {
  const binding = raw.sql`SELECT NULL AS value`
    .returnsRow({
      value: { codecId: 'pg/uuid@1', codec: mixedRawBinding },
    })
    .build();
  const objects = raw.sql`SELECT NULL AS value`.returnsRow({ value: mixedRawObject }).build();
  expectTypeOf<ResultType<typeof binding>['value']>().toEqualTypeOf<
    string | readonly (string | null)[]
  >();
  expectTypeOf<ResultType<typeof objects>['value']>().toEqualTypeOf<
    string | readonly (string | null)[]
  >();
});

declare const nullableMixedRawEntry:
  | 'pg/uuid@1'
  | {
      readonly codecId: 'pg/uuid@1';
      readonly nullable: true;
      readonly codec: { readonly codecId: 'pg/uuid@1'; readonly many: true };
    };
declare const strictStorageOrScalar: typeof db.public.alpha.columns.strict_tags | 'pg/text@1';
test('union members retain their own container nullability and precise storage output', () => {
  const nullable = raw.sql`SELECT NULL AS value`
    .returnsRow({ value: nullableMixedRawEntry })
    .build();
  const strict = raw.sql`SELECT NULL AS value`.returnsRow({ value: strictStorageOrScalar }).build();
  expectTypeOf<ResultType<typeof nullable>['value']>().toEqualTypeOf<
    string | readonly (string | null)[] | null
  >();
  expectTypeOf<ResultType<typeof strict>['value']>().toEqualTypeOf<string | readonly string[]>();
});

declare const arrayOrImplicitScalarBinding:
  | { readonly codecId: 'pg/uuid@1'; readonly many: true }
  | { readonly codecId: 'pg/uuid@1' };
declare const arrayMayBeSqlNull: boolean;
test('omitted-many binding unions and dynamic array nullability retain every possibility', () => {
  const mixed = raw.sql`SELECT NULL AS value`
    .returnsRow({
      value: { codecId: 'pg/uuid@1', codec: arrayOrImplicitScalarBinding },
    })
    .build();
  const nullable = raw.sql`SELECT NULL AS value`
    .returnsRow({
      value: {
        codecId: 'pg/uuid@1',
        nullable: arrayMayBeSqlNull,
        codec: { codecId: 'pg/uuid@1', many: true },
      },
    })
    .build();
  expectTypeOf<ResultType<typeof mixed>['value']>().toEqualTypeOf<
    string | readonly (string | null)[]
  >();
  expectTypeOf<ResultType<typeof nullable>['value']>().toEqualTypeOf<
    readonly (string | null)[] | null
  >();
});
