import type {
  MongoAggExpr,
  MongoFilterExpr,
  MongoUpdatePipelineStage,
} from '@internal/mongo-query-ast/execution';
import {
  MongoAddFieldsStage,
  MongoAggFieldRef,
  MongoExistsExpr,
  MongoExprFilter,
  MongoFieldFilter,
  MongoProjectStage,
  MongoReplaceRootStage,
} from '@internal/mongo-query-ast/execution';
import type { MongoValue } from '@internal/mongo-value';
import type { NestedDocShape, ObjectField, ResolvePath, ValidPaths } from './resolve-path';
import type { DocField, DocShape, TypedAggExpr } from './types';
import type { TypedUpdateOp } from './update-ops';
import {
  addToSetOp,
  currentDateOp,
  incOp,
  maxOp,
  minOp,
  mulOp,
  popOp,
  pullAllOp,
  pullOp,
  pushOp,
  renameOp,
  setOnInsertOp,
  setOp,
  unsetOp,
} from './update-ops';

/**
 * Operator surface for leaf (scalar) paths — today's full set: filter,
 * update, and aggregation operators. Returned by `Expression<F>` for any
 * `F extends DocField` that is not an `ObjectField<…>` sub-tree.
 *
 * Operator surfaces are intentionally not trait-gated by codec in this
 * revision — tracked on Linear as TML-2259 (scope extended to cover the
 * query-builder's `Expression<F>`). Calling, e.g. `.inc(1)` on a
 * string-typed expression compiles; the runtime relies on Mongo to
 * surface the error. Trait-gating can be tightened in a follow-up
 * without changing the accessor's public shape.
 */
export interface LeafExpression<F extends DocField> extends TypedAggExpr<F> {
  readonly _path: string;

  // Filter operators
  eq(value: MongoValue): MongoFilterExpr;
  ne(value: MongoValue): MongoFilterExpr;
  gt(value: MongoValue): MongoFilterExpr;
  gte(value: MongoValue): MongoFilterExpr;
  lt(value: MongoValue): MongoFilterExpr;
  lte(value: MongoValue): MongoFilterExpr;
  in(values: ReadonlyArray<MongoValue>): MongoFilterExpr;
  nin(values: ReadonlyArray<MongoValue>): MongoFilterExpr;
  exists(flag?: boolean): MongoFilterExpr;

  /**
   * `$type` filter: `{ field: { $type: bsonType } }`. Rides
   * `MongoFieldFilter`'s generic `op` string — no dedicated AST node. The
   * BSON type is expressed as Mongo's alias string (e.g. `'string'`) or
   * numeric type code; an array selects any of several types.
   */
  type(bsonType: MongoValue): MongoFilterExpr;

  // Update operators ($set family)
  set(value: MongoValue): TypedUpdateOp;
  unset(): TypedUpdateOp;
  rename(newName: string): TypedUpdateOp;

  // Numeric update operators
  inc(amount: number): TypedUpdateOp;
  mul(factor: number): TypedUpdateOp;
  min(value: MongoValue): TypedUpdateOp;
  max(value: MongoValue): TypedUpdateOp;

  // Array update operators
  push(value: MongoValue): TypedUpdateOp;
  addToSet(value: MongoValue): TypedUpdateOp;
  pop(direction?: 1 | -1): TypedUpdateOp;
  pull(value: MongoValue): TypedUpdateOp;
  pullAll(values: ReadonlyArray<MongoValue>): TypedUpdateOp;

  // Date / upsert helpers
  currentDate(): TypedUpdateOp;
  setOnInsert(value: MongoValue): TypedUpdateOp;
}

/**
 * Operator surface for non-leaf (value-object) paths — `f('address')`
 * when `address` is a `ContractValueObject`. Intentionally minimal: the
 * whole-value ops that make sense on a structured sub-document
 * (`set`/`unset`/`exists`, null presence via `eq(null)`/`ne(null)`). Field-
 * level ops belong on the constituent leaves (`f('address.city')`).
 *
 * The aggregation `node` is still present (`TypedAggExpr<ObjectField<N>>`)
 * so the value object can be piped through `$addFields` /
 * `$replaceRoot` / etc. as-is.
 */
export interface ObjectExpression<N extends NestedDocShape> extends TypedAggExpr<ObjectField<N>> {
  readonly _path: string;

  exists(flag?: boolean): MongoFilterExpr;
  eq(value: null): MongoFilterExpr;
  ne(value: null): MongoFilterExpr;

  set(value: MongoValue): TypedUpdateOp;
  unset(): TypedUpdateOp;
}

/**
 * The unified field accessor expression returned by `FieldAccessor` (per
 * [ADR 180](../../../../docs/architecture%20docs/adrs/ADR%20180%20-%20Dot-path%20field%20accessor.md)).
 *
 * Resolves to `ObjectExpression<Sub>` when `F` is an `ObjectField<Sub>`
 * (non-leaf path), otherwise to `LeafExpression<F>` (the full operator
 * surface). The conditional is driven off the `fields` marker that
 * `ObjectField` adds to `DocField`, so existing code that uses plain
 * `DocField` shapes continues to resolve to `LeafExpression`.
 */
export type Expression<F extends DocField> =
  F extends ObjectField<infer N> ? ObjectExpression<N> : LeafExpression<F>;

/**
 * Emitters for MongoDB update-pipeline stages (`$addFields`/`$set`,
 * `$project`/`$unset`, `$replaceRoot`/`$replaceWith`). These return
 * `MongoUpdatePipelineStage` nodes and let an updater callback express
 * the pipeline-form update as an alternative to the typed-operator form.
 *
 * The two forms are mutually exclusive per updater call: `resolveUpdaterResult`
 * rejects arrays that mix `TypedUpdateOp` and `MongoUpdatePipelineStage`
 * entries with a clear error — an updater callback must return either all
 * typed ops or all pipeline stages. Pick the form that matches the update
 * you want and commit to it for that call site.
 *
 * Accessible via `f.stage` on the `FieldAccessor`.
 */
export interface StageEmitters {
  set(fields: Record<string, MongoAggExpr>): MongoUpdatePipelineStage;
  unset(...paths: ReadonlyArray<string>): MongoUpdatePipelineStage;
  replaceRoot(newRoot: MongoAggExpr): MongoUpdatePipelineStage;
  replaceWith(newRoot: MongoAggExpr): MongoUpdatePipelineStage;
}

function buildStageEmitters(): StageEmitters {
  return {
    set: (fields) => new MongoAddFieldsStage(fields),
    unset: (...paths) => {
      const spec: Record<string, 0> = {};
      for (const p of paths) {
        spec[p] = 0;
      }
      return new MongoProjectStage(spec);
    },
    replaceRoot: (newRoot) => new MongoReplaceRootStage(newRoot),
    replaceWith: (newRoot) => new MongoReplaceRootStage(newRoot),
  };
}

/**
 * The unified `FieldAccessor` per ADR 180.
 *
 * - Property access (`f.status`) returns an `Expression<F>` whose codec
 *   comes from the current pipeline shape `S`.
 * - Callable form (`f('address.city')`) returns an `Expression<ResolvePath<N, P>>`
 *   where `N` is the nested shape carrying value-object sub-shapes.
 *   Paths that don't exist in `N` are rejected with a compile-time error
 *   (via `P extends ValidPaths<N>`). Non-leaf paths like `f('address')`
 *   resolve to an `ObjectExpression` whose reduced surface covers the
 *   whole-value operations (`set`, `unset`, `exists`, `eq(null)`,
 *   `ne(null)`).
 * - `f.rawPath('path')` is a deliberate escape hatch that skips path
 *   validation and returns a `LeafExpression<F>` for the given string.
 *   Intended for migration authoring where the target field is not yet
 *   part of the typed contract (e.g. a backfill writing a newly-added
 *   column before the contract hash rolls forward). The method name is
 *   deliberately `rawPath` rather than `raw` so it does not shadow a
 *   legitimate top-level `raw` field on a user model.
 * - `f.stage` exposes pipeline-style update emitters (`$set`, `$unset`,
 *   `$replaceRoot`, `$replaceWith`).
 *
 * When `N` is `Record<string, never>` (the default — e.g. after a
 * replacement stage like `$group` / `$project` / `$replaceRoot`),
 * `ValidPaths<N>` is `never` and the callable form is effectively
 * disabled at the type level. This keeps the builder sound downstream of
 * stages that invalidate the original document's nested-path tree.
 * `f.rawPath(...)` remains available in that state for callers that need
 * an explicit unvalidated path.
 */
export type FieldAccessor<S extends DocShape, N extends NestedDocShape = Record<string, never>> = {
  readonly [K in keyof S & string]: Expression<S[K]>;
} & (<P extends ValidPaths<N>>(path: P) => Expression<ResolvePath<N, P>>) & {
    readonly stage: StageEmitters;
    /**
     * Escape hatch: build a `LeafExpression<F>` for an unvalidated string
     * path. Use only when the path is intentionally outside the typed
     * model surface — data-migration authoring is the canonical case
     * (e.g. backfilling a field that is not yet in the contract). Default
     * `F` is the opaque `DocField`; callers can narrow via the explicit
     * generic: `f.rawPath<StringField>("status").set("active")`.
     *
     * The method is named `rawPath` (not `raw`) so a user model with a
     * top-level `raw` field still resolves `f.raw` to the field-expression
     * property, not to this escape hatch. Does not participate in
     * `ValidPaths<N>` / `ResolvePath<N, P>` — the path is passed through
     * verbatim and no IDE autocomplete is offered.
     */
    rawPath<F extends DocField = DocField>(path: string): LeafExpression<F>;
  };

/**
 * Wrap a boolean aggregation expression as an `$expr` filter
 * (`MongoExprFilter`). Lets a `$match` express an aggregation-expression
 * predicate — e.g. comparing two field references via `fn.eq(a, b)` — in
 * the typed AST rather than via a raw escape hatch. Pairs with `.type()`
 * to express filters like `{ _id: { $type: 'string' }, $expr: { $eq: ['$_id', '$space'] } }`.
 */
export function expr(predicate: TypedAggExpr<DocField>): MongoFilterExpr {
  return MongoExprFilter.of(predicate.node);
}

function buildExpression<F extends DocField>(path: string): Expression<F> {
  // The runtime object carries the full operator surface unconditionally;
  // `ObjectExpression` is a strict subset of `LeafExpression`, so a single
  // implementation satisfies both type-level shapes. Compile-time gating
  // prevents misuse of leaf-only operators on object paths.
  return {
    _field: undefined as never,
    _path: path,
    node: MongoAggFieldRef.of(path),

    eq: (value: MongoValue) => MongoFieldFilter.eq(path, value),
    ne: (value: MongoValue) => MongoFieldFilter.neq(path, value),
    gt: (value: MongoValue) => MongoFieldFilter.gt(path, value),
    gte: (value: MongoValue) => MongoFieldFilter.gte(path, value),
    lt: (value: MongoValue) => MongoFieldFilter.lt(path, value),
    lte: (value: MongoValue) => MongoFieldFilter.lte(path, value),
    in: (values: ReadonlyArray<MongoValue>) => MongoFieldFilter.in(path, values),
    nin: (values: ReadonlyArray<MongoValue>) => MongoFieldFilter.nin(path, values),
    exists: (flag?: boolean) =>
      flag === false ? MongoExistsExpr.notExists(path) : MongoExistsExpr.exists(path),
    type: (bsonType: MongoValue) => MongoFieldFilter.of(path, '$type', bsonType),

    set: (value: MongoValue) => setOp(path, value),
    unset: () => unsetOp(path),
    rename: (newName: string) => renameOp(path, newName),

    inc: (amount: number) => incOp(path, amount),
    mul: (factor: number) => mulOp(path, factor),
    min: (value: MongoValue) => minOp(path, value),
    max: (value: MongoValue) => maxOp(path, value),

    push: (value: MongoValue) => pushOp(path, value),
    addToSet: (value: MongoValue) => addToSetOp(path, value),
    pop: (direction: 1 | -1 = 1) => popOp(path, direction),
    pull: (value: MongoValue) => pullOp(path, value),
    pullAll: (values: ReadonlyArray<MongoValue>) => pullAllOp(path, values),

    currentDate: () => currentDateOp(path),
    setOnInsert: (value: MongoValue) => setOnInsertOp(path, value),
  } as unknown as Expression<F>;
}

/**
 * Construct a unified `FieldAccessor<S, N>` proxy. Property access creates
 * an `Expression` using the property name as the field path; callable
 * form accepts a dot-path string validated against `N` at compile time.
 *
 * The proxy target is a function so the resulting object is both callable
 * and indexable. Symbol-keyed accesses (e.g. `Symbol.toPrimitive`) return
 * `undefined` to keep accidental coercion behaviour unsurprising —
 * matching the previous `FieldProxy` / `FilterProxy` semantics.
 */
export function createFieldAccessor<
  S extends DocShape,
  N extends NestedDocShape = Record<string, never>,
>(): FieldAccessor<S, N> {
  const stageInstance = buildStageEmitters();
  const callable = ((path: string) => buildExpression<DocField>(path)) as unknown as FieldAccessor<
    S,
    N
  >;
  return new Proxy(callable, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop, receiver);
      }
      if (prop === 'stage') {
        return stageInstance;
      }
      if (prop === 'rawPath') {
        return (path: string) => buildExpression<DocField>(path);
      }
      return buildExpression(prop);
    },
  });
}
