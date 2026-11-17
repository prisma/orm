import type {
  AffectedCount,
  CodecTypesBase,
  Expression,
} from '@internal/sql-relational-core/expression';
import { expectTypeOf, test } from 'vitest';
import type {
  BindSiteParams,
  Declaration,
  ParamsFromDeclaration,
  PrepareCallback,
  PreparedExecution,
  PreparedFor,
  PreparedStatement,
  Runtime,
} from '../src/exports';

// A minimal codec-types stand-in mirroring the shape produced by
// `ExtractCodecTypes<TContract>` for a real contract. The intersection
// with `CodecTypesBase` mirrors the facade-level pattern that satisfies
// the `CT extends CodecTypesBase` constraint while keeping precise
// per-id input types.
type FixtureCT = {
  readonly 'pg/int4@1': { readonly input: number; readonly output: number };
  readonly 'pg/text@1': { readonly input: string; readonly output: string };
} & CodecTypesBase;

test('Declaration entries accept short and long forms', () => {
  type Decl = {
    readonly userId: 'pg/int4@1';
    readonly email: { readonly codecId: 'pg/text@1'; readonly nullable: true };
  };
  expectTypeOf<Decl>().toExtend<Declaration<FixtureCT>>();
});

test('Declaration long form accepts typeParams', () => {
  type Decl = {
    readonly items: {
      readonly codecId: 'pg/int4@1';
      readonly typeParams: { readonly item: 'pg/int4@1' };
    };
  };
  expectTypeOf<Decl>().toExtend<Declaration<FixtureCT>>();
});

test('BindSiteParams maps each declared name to an Expression<{codecId, nullable}>', () => {
  type Decl = {
    readonly userId: 'pg/int4@1';
    readonly email: { readonly codecId: 'pg/text@1'; readonly nullable: true };
  };
  type Params = BindSiteParams<Decl>;
  expectTypeOf<Params['userId']>().toEqualTypeOf<
    Expression<{ codecId: 'pg/int4@1'; nullable: false }>
  >();
  expectTypeOf<Params['email']>().toEqualTypeOf<
    Expression<{ codecId: 'pg/text@1'; nullable: true }>
  >();
});

test('ParamsFromDeclaration threads codec input types through', () => {
  type Decl = {
    readonly userId: 'pg/int4@1';
    readonly email: { readonly codecId: 'pg/text@1'; readonly nullable: true };
  };
  type Params = ParamsFromDeclaration<Decl, FixtureCT>;
  expectTypeOf<Params>().toEqualTypeOf<{
    readonly userId: number;
    readonly email: string | null;
  }>();
});

test('statement.query(target, params, options?) is typed by the declaration', () => {
  type Decl = { readonly userId: 'pg/int4@1' };
  type Params = ParamsFromDeclaration<Decl, FixtureCT>;
  type Row = { readonly id: number };
  type PS = PreparedStatement<Params, Row>;

  const ps = {} as PS;
  const runtime = {} as Runtime;
  const options = { signal: new AbortController().signal };
  // Accepts the inferred params shape and explicit target/options.
  ps.query(runtime, { userId: 7 }, options);
  // Row stream is typed.
  expectTypeOf(ps.query(runtime, { userId: 7 }, options)).toExtend<AsyncIterable<Row>>();
});

test('statement.query rejects mismatched param shapes', () => {
  type Decl = { readonly userId: 'pg/int4@1' };
  type Params = ParamsFromDeclaration<Decl, FixtureCT>;
  type PS = PreparedStatement<Params, { id: number }>;
  const ps = {} as PS;
  const runtime = {} as Runtime;

  // @ts-expect-error — userId must be number, not string
  ps.query(runtime, { userId: 'not-a-number' });
  // @ts-expect-error — missing userId
  ps.query(runtime, {});
  // @ts-expect-error — unknown key
  ps.query(runtime, { userId: 1, extra: 2 });
});

test('PrepareCallback returns the plan whose Row drives the statement', () => {
  type Decl = { readonly userId: 'pg/int4@1' };
  type Cb = PrepareCallback<Decl, { id: number }>;
  // Callback receives the bind-site params and returns a plan with Row inferred.
  const fn = ((_params) => ({}) as never) as Cb;
  void fn;
});

// ── Which face a plan earns ──────────────────────────────────────────────────

test('a rows plan earns the statement face and an affected-count plan the execution face', () => {
  type Params = { readonly userId: number };

  expectTypeOf<PreparedFor<Params, { id: number }>>().toEqualTypeOf<
    PreparedStatement<Params, { id: number }>
  >();
  expectTypeOf<PreparedFor<Params, AffectedCount>>().toEqualTypeOf<PreparedExecution<Params>>();
});

test('a plan whose row type is never still earns the statement face', () => {
  type Params = { readonly userId: number };

  // A builder state that projects nothing types its rows as `never` — a
  // mutation before `.returning()`, for one. `never` satisfies every
  // `extends`, so without a guard it would select the execution face while
  // `prepare()` reads the AST's declared result and builds a statement.
  expectTypeOf<PreparedFor<Params, never>>().toEqualTypeOf<PreparedStatement<Params, never>>();
});
