import {
  domainModelsAtDefaultNamespace,
  domainValueObjectsAtDefaultNamespace,
  type PlanMeta,
} from '@internal/contract/types';
import type {
  AnyMongoTypeMaps,
  ExtractMongoCodecTypes,
  MongoContract,
  MongoContractWithTypeMaps,
  MongoModelDefinition,
} from '@internal/mongo-contract';
import type {
  MongoAggAccumulator,
  MongoAggExpr,
  MongoDensifyRange,
  MongoFillOutput,
  MongoFilterExpr,
  MongoPipelineStage,
  MongoProjectionValue,
  MongoQueryPlan,
  MongoResultShape,
  MongoUpdatePipelineStage,
  MongoWindowField,
  UpdateResult,
} from '@internal/mongo-query-ast/execution';
import {
  AggregateCommand,
  FindOneAndDeleteCommand,
  FindOneAndUpdateCommand,
  MongoAddFieldsStage,
  MongoAndExpr,
  MongoBucketAutoStage,
  MongoBucketStage,
  MongoCountStage,
  MongoDensifyStage,
  MongoFacetStage,
  MongoFillStage,
  MongoGeoNearStage,
  MongoGraphLookupStage,
  MongoGroupStage,
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  MongoMergeStage,
  MongoOutStage,
  MongoProjectStage,
  MongoRedactStage,
  MongoReplaceRootStage,
  MongoSampleStage,
  MongoSearchMetaStage,
  MongoSearchStage,
  MongoSetWindowFieldsStage,
  MongoSkipStage,
  MongoSortByCountStage,
  MongoSortStage,
  MongoUnionWithStage,
  MongoUnwindStage,
  MongoVectorSearchStage,
  UpdateManyCommand,
  UpdateOneCommand,
} from '@internal/mongo-query-ast/execution';
import { castAs } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { createFieldAccessor, type Expression, type FieldAccessor } from './field-accessor';
import {
  createLookupFrom,
  extractLookupResult,
  type LookupFrom,
  type LookupResult,
} from './lookup-builder';
import type { FindAndModifyEnabled, LeadingMatch, UpdateEnabled } from './markers';
import { ormError } from './orm-errors';
import { computePipelineResultShape } from './pipeline-result-shape';
import type { ModelArrayField, NestedDocShape } from './resolve-path';
import { contractModelToMongoResultShape } from './result-shape';
import type {
  DocField,
  DocShape,
  ExtractDocShape,
  GroupedDocShape,
  GroupSpec,
  ProjectedShape,
  ResolveRow,
  SortSpec,
  TypedAggExpr,
  UnwoundShape,
} from './types';
import { resolveUpdaterResult, type UpdaterResult } from './update-ops';

interface PipelineChainState {
  readonly collection: string;
  readonly stages: ReadonlyArray<MongoPipelineStage>;
  readonly storageHash: string;
  readonly modelName?: string;
}

/**
 * The pipeline state in the query-builder state machine.
 *
 * Reached from `CollectionHandle` or `FilteredCollection` after the first
 * pipeline-stage method call (or directly via `aggregate()` shortcuts). Holds
 * the accumulated `MongoPipelineStage[]` and exposes pipeline-stage methods,
 * the `merge`/`out` write terminals, and the `build`/`aggregate` read
 * terminals.
 *
 * Two phantom type parameters gate the conditional terminals:
 *
 *  - `U extends UpdateEnabled` — when `'update-ok'`, the no-arg `updateMany()` /
 *    `updateOne()` form is available (consume the chain as an
 *    update-with-pipeline spec). Cleared by stages that produce content the
 *    `update` AST cannot represent (e.g. `$group`, `$lookup`, `$limit`).
 *  - `F extends FindAndModifyEnabled` — when `'fam-ok'`, the
 *    `findOneAndUpdate(...)` / `findOneAndDelete(...)` terminals are
 *    available. Cleared by stages incompatible with their wire-command slots
 *    (`$limit`, `$group`, mutating stages, …).
 *
 * The marker semantics are encoded in the per-method return types — see the
 * marker table (and rationale per row) in
 * `docs/architecture docs/adrs/ADR 201 - State-machine pattern for typed DSL builders.md`.
 */
export class PipelineChain<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  Shape extends DocShape,
  U extends UpdateEnabled = 'update-ok',
  F extends FindAndModifyEnabled = 'fam-ok',
  L extends LeadingMatch = 'leading',
  N extends NestedDocShape = Record<string, never>,
> {
  declare readonly __updateCompat: U;
  declare readonly __findAndModifyCompat: F;
  declare readonly __leadingMatch: L;

  readonly #contract: TContract;
  readonly #state: PipelineChainState;

  constructor(contract: TContract, state: PipelineChainState) {
    this.#contract = contract;
    this.#state = state;
  }

  /**
   * Internal helper that appends a pipeline stage and branches into a new
   * state-type. The fifth type parameter `NewN` carries the nested-path
   * shape forward. It defaults to `Record<string, never>` so stages that
   * fundamentally rewrite the document (`$group`, `$project`,
   * `$replaceRoot`, …) automatically disable the callable form of
   * `FieldAccessor` downstream. Additive stages (`match`, `addFields`,
   * `sort`, `lookup`, …) explicitly re-thread the current `N`.
   */
  #withStage<
    NewShape extends DocShape,
    NewU extends UpdateEnabled,
    NewF extends FindAndModifyEnabled,
    NewL extends LeadingMatch = 'past-leading',
    NewN extends NestedDocShape = Record<string, never>,
  >(stage: MongoPipelineStage): PipelineChain<TContract, NewShape, NewU, NewF, NewL, NewN> {
    return new PipelineChain<TContract, NewShape, NewU, NewF, NewL, NewN>(this.#contract, {
      ...this.#state,
      stages: [...this.#state.stages, stage],
    });
  }

  #writeMeta(): PlanMeta {
    return {
      target: 'mongo',
      storageHash: this.#state.storageHash,
      lane: 'mongo-query',
    };
  }

  // --- Identity stages ---

  /**
   * `$match`. `FindAndModifyEnabled` is always preserved. `UpdateEnabled` is
   * preserved only while the chain is still in the leading-`$match` prefix
   * (`L = 'leading'`); a `$match` that follows any non-`$match` stage
   * transitions to `L = 'past-leading'` and clears `UpdateEnabled`, since
   * `deconstructUpdateChain` can only peel leading `$match` stages into the
   * wire-command filter.
   */
  match(
    filter: MongoFilterExpr,
  ): PipelineChain<TContract, Shape, L extends 'leading' ? U : 'update-cleared', F, L, N>;
  match(
    fn: (fields: FieldAccessor<Shape, N>) => MongoFilterExpr,
  ): PipelineChain<TContract, Shape, L extends 'leading' ? U : 'update-cleared', F, L, N>;
  match(
    filterOrFn: MongoFilterExpr | ((fields: FieldAccessor<Shape, N>) => MongoFilterExpr),
  ): PipelineChain<TContract, Shape, L extends 'leading' ? U : 'update-cleared', F, L, N> {
    const filter =
      typeof filterOrFn === 'function' ? filterOrFn(createFieldAccessor<Shape, N>()) : filterOrFn;
    return this.#withStage<Shape, L extends 'leading' ? U : 'update-cleared', F, L, N>(
      new MongoMatchStage(filter),
    );
  }

  /**
   * `$sort`. Clears `UpdateEnabled` (`update` has no per-document sort) but
   * preserves `FindAndModifyEnabled` (`findAndModify` has a `sort` slot).
   */
  sort(
    spec: SortSpec<Shape>,
  ): PipelineChain<TContract, Shape, 'update-cleared', F, 'past-leading', N> {
    return this.#withStage<Shape, 'update-cleared', F, 'past-leading', N>(
      new MongoSortStage(spec as Record<string, 1 | -1>),
    );
  }

  /**
   * `$limit`. Clears both markers — `limit` is incompatible with the `update`
   * wire command, and `findAndModify` already implies single-document
   * semantics (so `.limit(...)` adds no meaning, only ambiguity).
   */
  limit(
    n: number,
  ): PipelineChain<TContract, Shape, 'update-cleared', 'fam-cleared', 'past-leading', N> {
    return this.#withStage<Shape, 'update-cleared', 'fam-cleared', 'past-leading', N>(
      new MongoLimitStage(n),
    );
  }

  /**
   * `$skip`. Clears both markers — MongoDB's `findAndModify` wire command
   * has no `skip` slot, so `deconstructFindAndModifyChain` rejects any
   * `$skip` at runtime; keeping the marker `fam-cleared` makes the type
   * system reflect the same constraint (see ADR 201 marker table).
   */
  skip(
    n: number,
  ): PipelineChain<TContract, Shape, 'update-cleared', 'fam-cleared', 'past-leading', N> {
    return this.#withStage<Shape, 'update-cleared', 'fam-cleared', 'past-leading', N>(
      new MongoSkipStage(n),
    );
  }

  sample(
    n: number,
  ): PipelineChain<TContract, Shape, 'update-cleared', 'fam-cleared', 'past-leading', N> {
    return this.#withStage<Shape, 'update-cleared', 'fam-cleared', 'past-leading', N>(
      new MongoSampleStage(n),
    );
  }

  // --- Additive stages ---

  /**
   * `$addFields`. Preserves `UpdateEnabled` (representable as
   * update-with-pipeline `$set`); clears `FindAndModifyEnabled` (no analogue
   * in the find-and-modify wire commands). The nested-path shape `N` is
   * preserved — newly added flat fields are reachable via property access
   * (`f.newField`) but do not themselves carry nested structure.
   */
  addFields<NewFields extends Record<string, TypedAggExpr<DocField>>>(
    fn: (fields: FieldAccessor<Shape, N>) => NewFields,
  ): PipelineChain<
    TContract,
    Shape & ExtractDocShape<NewFields>,
    U,
    'fam-cleared',
    'past-leading',
    N
  > {
    const accessor = createFieldAccessor<Shape, N>();
    const newFields = fn(accessor);
    const exprRecord: Record<string, MongoAggExpr> = {};
    for (const [key, typed] of Object.entries(newFields)) {
      exprRecord[key] = typed.node;
    }
    return this.#withStage<Shape & ExtractDocShape<NewFields>, U, 'fam-cleared', 'past-leading', N>(
      new MongoAddFieldsStage(exprRecord),
    );
  }

  /**
   * `$lookup`. Clears both markers — joins are not representable in either
   * the `update` or `findAndModify` wire commands. The original document's
   * nested-path shape `N` is preserved (the lookup adds a sidecar array
   * field; existing keys are untouched).
   *
   * The single callback receives a `from` callable that grounds the
   * foreign-root literal sequentially before the inner `on(...)`
   * callback is type-checked — see `lookup-builder.ts`. The resulting
   * `Shape` gains the `As` key as a `ModelArrayField<ModelName>` so
   * `ResolveRow` produces `Array<ForeignRow>` (with concrete leaf
   * types) instead of the legacy `unknown[]`.
   */
  lookup<RootName extends string, ModelName extends string, As extends string>(
    fn: (from: LookupFrom<TContract, Shape, N>) => LookupResult<RootName, ModelName, As>,
  ): PipelineChain<
    TContract,
    Shape & Record<As, ModelArrayField<ModelName>>,
    'update-cleared',
    'fam-cleared',
    'past-leading',
    N
  > {
    const fromCallable = createLookupFrom<TContract, Shape, N>(this.#contract);
    const result = fn(fromCallable);
    const extracted = extractLookupResult(result, this.#contract);
    return this.#withStage<
      Shape & Record<As, ModelArrayField<ModelName>>,
      'update-cleared',
      'fam-cleared',
      'past-leading',
      N
    >(
      new MongoLookupStage({
        from: extracted.foreignCollection,
        localField: extracted.localField,
        foreignField: extracted.foreignField,
        as: extracted.as,
      }),
    );
  }

  // --- Narrowing stages ---

  /**
   * `$project`. Preserves `UpdateEnabled` (representable as update-with-pipeline
   * `$project` / `$unset`); clears `FindAndModifyEnabled` (use `.project()` on
   * the result of `.build()` if both projection and find-and-modify are
   * needed — see spec).
   *
   * Resets the nested-path shape to `Record<string, never>` — projection
   * fundamentally rewrites the document, so dot-paths into the *source*
   * document are no longer meaningful downstream.
   */
  project<K extends keyof Shape & string>(
    ...keys: K[]
  ): PipelineChain<
    TContract,
    Pick<Shape, K | ('_id' extends keyof Shape ? '_id' : never)>,
    U,
    'fam-cleared',
    'past-leading'
  >;
  project<Spec extends Record<string, 1 | TypedAggExpr<DocField>>>(
    fn: (fields: FieldAccessor<Shape, N>) => Spec,
  ): PipelineChain<TContract, ProjectedShape<Shape, Spec>, U, 'fam-cleared', 'past-leading'>;
  project(
    ...args: unknown[]
  ): PipelineChain<TContract, DocShape, U, 'fam-cleared', 'past-leading'> {
    if (args.length === 1 && typeof args[0] === 'function') {
      const fn = args[0] as (
        fields: FieldAccessor<Shape, N>,
      ) => Record<string, 1 | TypedAggExpr<DocField>>;
      const accessor = createFieldAccessor<Shape, N>();
      const spec = fn(accessor);
      const projection: Record<string, MongoProjectionValue> = {};
      for (const [key, val] of Object.entries(spec)) {
        projection[key] = val === 1 ? 1 : (val as TypedAggExpr<DocField>).node;
      }
      return this.#withStage(new MongoProjectStage(projection));
    }
    const keys = args as string[];
    const projection: Record<string, 1> = {};
    for (const key of keys) {
      projection[key] = 1;
    }
    return this.#withStage(new MongoProjectStage(projection));
  }

  /**
   * `$unwind`. Clears both markers — array unrolling produces multiple output
   * documents per input, incompatible with both single-document update and
   * find-and-modify wire commands. The original `N` is preserved: unwind
   * replaces the unwound array slot with its element but leaves the rest
   * of the document structurally intact.
   */
  unwind<K extends keyof Shape & string>(
    field: K,
    options?: { preserveNullAndEmptyArrays?: boolean },
  ): PipelineChain<
    TContract,
    UnwoundShape<Shape, K>,
    'update-cleared',
    'fam-cleared',
    'past-leading',
    N
  > {
    return this.#withStage<
      UnwoundShape<Shape, K>,
      'update-cleared',
      'fam-cleared',
      'past-leading',
      N
    >(new MongoUnwindStage(`$${field}`, options?.preserveNullAndEmptyArrays ?? false));
  }

  // --- Replacement stages ---

  /**
   * `$group`. Clears both markers — group output bears no relation to source
   * documents; neither `update` nor `findAndModify` can consume it. Nested
   * path shape is reset (the source document's path tree is gone).
   */
  group<Spec extends GroupSpec>(
    fn: (fields: FieldAccessor<Shape, N>) => Spec,
  ): PipelineChain<
    TContract,
    GroupedDocShape<Spec>,
    'update-cleared',
    'fam-cleared',
    'past-leading'
  > {
    const accessor = createFieldAccessor<Shape, N>();
    const spec = fn(accessor);
    const { _id: groupIdExpr, ...rest } = spec;
    const groupId = groupIdExpr === null ? null : groupIdExpr.node;
    const accumulators: Record<string, MongoAggAccumulator> = {};
    for (const [key, typed] of Object.entries(rest)) {
      if (typed === null) {
        throw ormError(
          'ORM.ARGUMENT_INVALID',
          `group() field "${key}" must not be null. Only _id can be null.`,
        );
      }
      if (typed.node.kind !== 'accumulator') {
        throw ormError(
          'ORM.ARGUMENT_INVALID',
          `group() field "${key}" must use an accumulator (e.g. acc.sum(), acc.count()). Got "${typed.node.kind}" expression.`,
        );
      }
      accumulators[key] = typed.node as MongoAggAccumulator;
    }
    return this.#withStage<GroupedDocShape<Spec>, 'update-cleared', 'fam-cleared'>(
      new MongoGroupStage(groupId, accumulators),
    );
  }

  /**
   * `$replaceRoot`. Preserves `UpdateEnabled` (representable as
   * update-with-pipeline `$replaceRoot`); clears `FindAndModifyEnabled`.
   * Nested path shape is reset — the replaced root has no relation to
   * the original document structure.
   */
  replaceRoot<NewShape extends DocShape>(
    fn: (fields: FieldAccessor<Shape, N>) => Expression<DocField> | TypedAggExpr<DocField>,
  ): PipelineChain<TContract, NewShape, U, 'fam-cleared', 'past-leading'> {
    const accessor = createFieldAccessor<Shape, N>();
    const expr = fn(accessor);
    return this.#withStage<NewShape, U, 'fam-cleared'>(new MongoReplaceRootStage(expr.node));
  }

  count<Field extends string>(
    field: Field,
  ): PipelineChain<
    TContract,
    Record<Field, { readonly codecId: 'mongo/double@1'; readonly nullable: false }>,
    'update-cleared',
    'fam-cleared',
    'past-leading'
  > {
    return this.#withStage(new MongoCountStage(field));
  }

  sortByCount<F2 extends DocField>(
    fn: (fields: FieldAccessor<Shape, N>) => Expression<F2> | TypedAggExpr<F2>,
  ): PipelineChain<
    TContract,
    {
      _id: F2;
      count: { readonly codecId: 'mongo/double@1'; readonly nullable: false };
    },
    'update-cleared',
    'fam-cleared',
    'past-leading'
  > {
    const accessor = createFieldAccessor<Shape, N>();
    const expr = fn(accessor);
    return this.#withStage(new MongoSortByCountStage(expr.node));
  }

  // --- Filter stages ---

  /**
   * `$redact`. Preserves `UpdateEnabled`; clears `FindAndModifyEnabled`.
   * Shape- and nested-path-preserving (the document tree is unchanged).
   */
  redact(
    fn: (fields: FieldAccessor<Shape, N>) => Expression<DocField> | TypedAggExpr<DocField>,
  ): PipelineChain<TContract, Shape, U, 'fam-cleared', 'past-leading', N> {
    const accessor = createFieldAccessor<Shape, N>();
    const expr = fn(accessor);
    return this.#withStage<Shape, U, 'fam-cleared', 'past-leading', N>(
      new MongoRedactStage(expr.node),
    );
  }

  // --- Write terminals (output stages) ---

  /**
   * `$out` write terminal. Materialises the pipeline output into
   * `collection` (optionally in `db`), replacing any prior contents. Unlike
   * the other pipeline-stage methods, this **terminates** the chain — it
   * returns a `MongoQueryPlan` rather than another `PipelineChain`, since
   * `$out` must be the final stage and there is nothing further to chain.
   *
   * Lane is `mongo-query` (matching all other terminals in this package) so
   * middleware can dispatch on intent without inspecting the command.
   *
   * The result row stream is empty (`unknown` row type) — the data lives
   * in the destination collection, not the response.
   */
  out(collection: string, db?: string): MongoQueryPlan<unknown, AggregateCommand> {
    return this.#writeTerminal(new MongoOutStage(collection, db));
  }

  /**
   * `$merge` write terminal. Streams the pipeline output into the target
   * collection per the supplied merge semantics (`whenMatched` /
   * `whenNotMatched`). Like `out()`, terminates the chain — `$merge` must
   * be the final stage.
   */
  merge(options: {
    into: string | { db: string; coll: string };
    on?: string | ReadonlyArray<string>;
    whenMatched?: string | ReadonlyArray<MongoUpdatePipelineStage>;
    whenNotMatched?: string;
  }): MongoQueryPlan<unknown, AggregateCommand> {
    return this.#writeTerminal(new MongoMergeStage(options));
  }

  #writeTerminal(stage: MongoPipelineStage): MongoQueryPlan<unknown, AggregateCommand> {
    const pipeline = [...this.#state.stages, stage];
    const command = new AggregateCommand(this.#state.collection, pipeline);
    const meta: PlanMeta = {
      target: 'mongo',
      storageHash: this.#state.storageHash,
      lane: 'mongo-query',
    };
    return { collection: this.#state.collection, command, meta };
  }

  // --- Union stages ---

  unionWith(
    collection: string,
    pipeline?: ReadonlyArray<MongoPipelineStage>,
  ): PipelineChain<TContract, Shape, 'update-cleared', 'fam-cleared', 'past-leading', N> {
    return this.#withStage<Shape, 'update-cleared', 'fam-cleared', 'past-leading', N>(
      new MongoUnionWithStage(collection, pipeline),
    );
  }

  // --- Bucketing stages ---

  bucket(options: {
    groupBy: MongoAggExpr;
    boundaries: ReadonlyArray<unknown>;
    default_?: unknown;
    output?: Record<string, MongoAggAccumulator>;
  }): PipelineChain<TContract, DocShape, 'update-cleared', 'fam-cleared', 'past-leading'> {
    return this.#withStage<DocShape, 'update-cleared', 'fam-cleared'>(
      new MongoBucketStage(options),
    );
  }

  bucketAuto(options: {
    groupBy: MongoAggExpr;
    buckets: number;
    output?: Record<string, MongoAggAccumulator>;
    granularity?: string;
  }): PipelineChain<TContract, DocShape, 'update-cleared', 'fam-cleared', 'past-leading'> {
    return this.#withStage<DocShape, 'update-cleared', 'fam-cleared'>(
      new MongoBucketAutoStage(options),
    );
  }

  // --- Geo stages ---

  geoNear(options: {
    near: unknown;
    distanceField: string;
    spherical?: boolean;
    maxDistance?: number;
    minDistance?: number;
    query?: MongoFilterExpr;
    key?: string;
    distanceMultiplier?: number;
    includeLocs?: string;
  }): PipelineChain<TContract, DocShape, 'update-cleared', 'fam-cleared', 'past-leading'> {
    return this.#withStage<DocShape, 'update-cleared', 'fam-cleared'>(
      new MongoGeoNearStage(options),
    );
  }

  // --- Multi-facet stages ---

  facet(
    facets: Record<string, ReadonlyArray<MongoPipelineStage>>,
  ): PipelineChain<TContract, DocShape, 'update-cleared', 'fam-cleared', 'past-leading'> {
    return this.#withStage<DocShape, 'update-cleared', 'fam-cleared'>(new MongoFacetStage(facets));
  }

  // --- Graph stages ---

  graphLookup(options: {
    from: string;
    startWith: MongoAggExpr;
    connectFromField: string;
    connectToField: string;
    as: string;
    maxDepth?: number;
    depthField?: string;
    restrictSearchWithMatch?: MongoFilterExpr;
  }): PipelineChain<TContract, DocShape, 'update-cleared', 'fam-cleared', 'past-leading'> {
    return this.#withStage<DocShape, 'update-cleared', 'fam-cleared'>(
      new MongoGraphLookupStage(options),
    );
  }

  // --- Window stages ---

  setWindowFields(options: {
    partitionBy?: MongoAggExpr;
    sortBy?: Record<string, 1 | -1>;
    output: Record<string, MongoWindowField>;
  }): PipelineChain<TContract, DocShape, 'update-cleared', 'fam-cleared', 'past-leading'> {
    return this.#withStage<DocShape, 'update-cleared', 'fam-cleared'>(
      new MongoSetWindowFieldsStage(options),
    );
  }

  densify(options: {
    field: string;
    partitionByFields?: ReadonlyArray<string>;
    range: MongoDensifyRange;
  }): PipelineChain<TContract, Shape, 'update-cleared', 'fam-cleared', 'past-leading', N> {
    return this.#withStage<Shape, 'update-cleared', 'fam-cleared', 'past-leading', N>(
      new MongoDensifyStage(options),
    );
  }

  fill(options: {
    partitionBy?: MongoAggExpr;
    partitionByFields?: ReadonlyArray<string>;
    sortBy?: Record<string, 1 | -1>;
    output: Record<string, MongoFillOutput>;
  }): PipelineChain<TContract, Shape, 'update-cleared', 'fam-cleared', 'past-leading', N> {
    return this.#withStage<Shape, 'update-cleared', 'fam-cleared', 'past-leading', N>(
      new MongoFillStage(options),
    );
  }

  // --- Search stages ---

  search(
    config: Record<string, unknown>,
    index?: string,
  ): PipelineChain<TContract, Shape, 'update-cleared', 'fam-cleared', 'past-leading', N> {
    return this.#withStage<Shape, 'update-cleared', 'fam-cleared', 'past-leading', N>(
      new MongoSearchStage(config, index),
    );
  }

  searchMeta(
    config: Record<string, unknown>,
    index?: string,
  ): PipelineChain<TContract, DocShape, 'update-cleared', 'fam-cleared', 'past-leading'> {
    return this.#withStage<DocShape, 'update-cleared', 'fam-cleared'>(
      new MongoSearchMetaStage(config, index),
    );
  }

  vectorSearch(options: {
    index: string;
    path: string;
    queryVector: ReadonlyArray<number>;
    numCandidates: number;
    limit: number;
    filter?: Record<string, unknown>;
  }): PipelineChain<TContract, Shape, 'update-cleared', 'fam-cleared', 'past-leading', N> {
    return this.#withStage<Shape, 'update-cleared', 'fam-cleared', 'past-leading', N>(
      new MongoVectorSearchStage(options),
    );
  }

  // --- Escape hatch ---

  pipe(
    stage: MongoPipelineStage,
  ): PipelineChain<TContract, Shape, 'update-cleared', 'fam-cleared', 'past-leading'>;
  pipe<NewShape extends DocShape>(
    stage: MongoPipelineStage,
  ): PipelineChain<TContract, NewShape, 'update-cleared', 'fam-cleared', 'past-leading'>;
  pipe<NewShape extends DocShape = Shape>(
    stage: MongoPipelineStage,
  ): PipelineChain<TContract, NewShape, 'update-cleared', 'fam-cleared', 'past-leading'> {
    return this.#withStage<NewShape, 'update-cleared', 'fam-cleared'>(stage);
  }

  // --- Pipeline-style write terminals (UpdateEnabled-gated) ---

  /**
   * No-arg `updateMany()`: deconstruct the chain into leading `$match`
   * stages (folded into the filter) and remaining stages (which must all
   * be valid pipeline-update stages). Available only when `U = 'update-ok'`.
   *
   * The optional callback parameter exists for subclass-override
   * compatibility with `FilteredCollection.updateMany(updaterFn)` — TS's
   * strict override check requires the parent's parameter to accept at
   * least what the child's signature does. A runtime guard throws if a
   * callback is actually passed on a bare `PipelineChain`. Note that
   * because nothing in the public surface transitions `U` from
   * `'update-cleared'` (the initial state on `CollectionHandle` /
   * `FilteredCollection`) back to `'update-ok'`, the no-arg form is
   * reachable only via explicit type casts in internal tests — the
   * callback-form "type hole" is therefore not reachable from user
   * code. See `docs/architecture docs/adrs/ADR 201 - State-machine
   * pattern for typed DSL builders.md` for the marker-transition table.
   */
  updateMany(
    this: PipelineChain<TContract, Shape, 'update-ok', F, L, N>,
    updaterFn?: (fields: FieldAccessor<Shape, N>) => UpdaterResult,
  ): MongoQueryPlan<UpdateResult, UpdateManyCommand> {
    if (updaterFn !== undefined) {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        'updateMany() on a PipelineChain expects no arguments — the chain itself is the update pipeline. ' +
          'To update with an operator callback, call .updateMany(fn) on a FilteredCollection (i.e. after .match()).',
      );
    }
    const { filter, updatePipeline } = deconstructUpdateChain(this.#state.stages);
    const command = new UpdateManyCommand(this.#state.collection, filter, updatePipeline);
    return { collection: this.#state.collection, command, meta: this.#writeMeta() };
  }

  /**
   * No-arg `updateOne()`: same as `updateMany()` but maps to a single-doc
   * update. Carries the same optional-callback/subclass-compat caveat
   * documented above — the callback form is reachable only via forced
   * casts in internal tests.
   */
  updateOne(
    this: PipelineChain<TContract, Shape, 'update-ok', F, L, N>,
    updaterFn?: (fields: FieldAccessor<Shape, N>) => UpdaterResult,
  ): MongoQueryPlan<UpdateResult, UpdateOneCommand> {
    if (updaterFn !== undefined) {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        'updateOne() on a PipelineChain expects no arguments — the chain itself is the update pipeline. ' +
          'To update with an operator callback, call .updateOne(fn) on a FilteredCollection (i.e. after .match()).',
      );
    }
    const { filter, updatePipeline } = deconstructUpdateChain(this.#state.stages);
    const command = new UpdateOneCommand(this.#state.collection, filter, updatePipeline);
    return { collection: this.#state.collection, command, meta: this.#writeMeta() };
  }

  // --- Find-and-modify terminals (marker-gated) ---

  /**
   * Find a single document matching the accumulated pipeline (which must
   * consist solely of leading `$match` stages followed by at most one
   * `$sort`) and apply `updaterFn`. Available only when
   * `FindAndModifyEnabled` is `'fam-ok'` — stages that clear the marker
   * (including `$skip`, which MongoDB's `findAndModify` has no slot for)
   * make this method invisible at the type level.
   *
   * The pipeline stages are deconstructed into the wire command's `filter`
   * and `sort` slots. If any non-deconstructable stage is present, a
   * runtime error is thrown as a defensive check (the type system should
   * prevent this).
   */
  findOneAndUpdate(
    this: PipelineChain<TContract, Shape, U, 'fam-ok', L, N>,
    updaterFn: (fields: FieldAccessor<Shape, N>) => UpdaterResult,
    opts: { readonly upsert?: boolean; readonly returnDocument?: 'before' | 'after' } = {},
  ): MongoQueryPlan<
    ResolveRow<Shape, ExtractMongoCodecTypes<TContract>, TContract> | null,
    FindOneAndUpdateCommand
  > {
    const { filter, sort } = deconstructFindAndModifyChain(this.#state.stages);
    const accessor = createFieldAccessor<Shape, N>();
    const items = updaterFn(accessor);
    const update = resolveUpdaterResult(items);
    const command = new FindOneAndUpdateCommand(
      this.#state.collection,
      filter,
      update,
      opts.upsert ?? false,
      sort,
      opts.returnDocument ?? 'after',
    );
    const meta: PlanMeta = {
      target: 'mongo',
      storageHash: this.#state.storageHash,
      lane: 'mongo-query',
    };
    return { collection: this.#state.collection, command, meta };
  }

  /**
   * Find a single document matching the accumulated pipeline and delete it.
   * Same marker gating and deconstruction as `findOneAndUpdate`.
   */
  findOneAndDelete(
    this: PipelineChain<TContract, Shape, U, 'fam-ok', L, N>,
  ): MongoQueryPlan<
    ResolveRow<Shape, ExtractMongoCodecTypes<TContract>, TContract> | null,
    FindOneAndDeleteCommand
  > {
    const { filter, sort } = deconstructFindAndModifyChain(this.#state.stages);
    const command = new FindOneAndDeleteCommand(this.#state.collection, filter, sort);
    const meta: PlanMeta = {
      target: 'mongo',
      storageHash: this.#state.storageHash,
      lane: 'mongo-query',
    };
    return { collection: this.#state.collection, command, meta };
  }

  // --- Read terminals ---

  /**
   * Materialise the chain as a `MongoQueryPlan` wrapping an `AggregateCommand`.
   */
  build(): MongoQueryPlan<
    ResolveRow<Shape, ExtractMongoCodecTypes<TContract>, TContract>,
    AggregateCommand
  > {
    const command = new AggregateCommand(this.#state.collection, this.#state.stages);
    const meta: PlanMeta = {
      target: 'mongo',
      storageHash: this.#state.storageHash,
      lane: 'mongo-query',
    };
    const modelName = this.#state.modelName;
    const contractNarrow = this.#contract as MongoContract;
    let resultShape: MongoResultShape | undefined;
    if (modelName !== undefined) {
      const model = castAs<MongoModelDefinition | undefined>(
        domainModelsAtDefaultNamespace(contractNarrow.domain)[modelName],
      );
      resultShape = model
        ? computePipelineResultShape(
            this.#state.stages,
            contractModelToMongoResultShape(model, {
              valueObjects: domainValueObjectsAtDefaultNamespace(contractNarrow.domain) ?? {},
            }),
          )
        : { kind: 'unknown' as const };
    }
    return {
      collection: this.#state.collection,
      command,
      meta,
      ...ifDefined('resultShape', resultShape),
    };
  }

  /**
   * Alias for `build()` — surfaces the read intent at the call site.
   */
  aggregate(): MongoQueryPlan<
    ResolveRow<Shape, ExtractMongoCodecTypes<TContract>, TContract>,
    AggregateCommand
  > {
    return this.build();
  }
}

interface DeconstructedFindAndModify {
  filter: MongoFilterExpr;
  sort: Record<string, 1 | -1> | undefined;
}

/**
 * Walk the accumulated pipeline stages and extract the `filter` and `sort`
 * slots for a `findOneAndUpdate` / `findOneAndDelete` wire command.
 *
 * The helper accepts exactly the canonical shape `match+ -> sort?` and
 * nothing else:
 *
 *  - one or more `$match` stages (AND-folded into a single filter),
 *  - optionally followed by a single `$sort` stage.
 *
 * Anything else — a `$sort` before `$match`, multiple `$sort` stages, a
 * `$skip` stage, or any non-`$match`/`$sort` stage — is rejected with a
 * clear error. The type system already prevents most of these at compile
 * time via the `FindAndModifyEnabled` marker, but the runtime check
 * guards the escape hatches (e.g. `.pipe(...)`) and future marker gaps.
 *
 * `$skip` is rejected outright because MongoDB's `findAndModify` command
 * has no skip slot; a silently-dropped skip is a latent correctness bug
 * waiting to happen. (A02 removed skip from the typed AST for the same
 * reason.)
 */
function deconstructFindAndModifyChain(
  stages: ReadonlyArray<MongoPipelineStage>,
): DeconstructedFindAndModify {
  const matchFilters: MongoFilterExpr[] = [];
  let sort: Record<string, 1 | -1> | undefined;
  let seenNonMatch = false;

  for (const stage of stages) {
    if (stage instanceof MongoMatchStage) {
      if (seenNonMatch) {
        throw ormError(
          'ORM.ARGUMENT_INVALID',
          'findOneAndUpdate/findOneAndDelete requires the canonical $match+ -> $sort? shape, ' +
            'but a $match stage was found after a $sort. Re-order the chain so every .match() ' +
            'call precedes the .sort() call.',
        );
      }
      matchFilters.push(stage.filter);
    } else if (stage instanceof MongoSortStage) {
      if (sort !== undefined) {
        throw ormError(
          'ORM.ARGUMENT_INVALID',
          'findOneAndUpdate/findOneAndDelete accepts at most one $sort stage; drop the extra ' +
            '.sort() call or combine the keys into a single sort spec.',
        );
      }
      sort = { ...stage.sort };
      seenNonMatch = true;
    } else if (stage instanceof MongoSkipStage) {
      throw ormError(
        'ORM.OPERATION_UNSUPPORTED',
        'findOneAndUpdate/findOneAndDelete does not support .skip() — MongoDB findAndModify ' +
          'has no skip slot. Remove the .skip() call, or use .aggregate()/.build() if the ' +
          'chain needs skip semantics.',
      );
    } else {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        'findOneAndUpdate/findOneAndDelete requires the canonical $match+ -> $sort? shape, ' +
          `but encountered a '${stage.constructor.name}' stage. ` +
          'This is likely a bug — the type system should have prevented this chain.',
      );
    }
  }

  if (matchFilters.length === 0) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      'findOneAndUpdate/findOneAndDelete requires at least one .match() call.',
    );
  }
  const first = matchFilters[0];
  if (first === undefined) {
    throw new InternalError('Unreachable: matchFilters.length > 0 but first is undefined');
  }
  const filter: MongoFilterExpr = matchFilters.length === 1 ? first : MongoAndExpr.of(matchFilters);

  return { filter, sort };
}

interface DeconstructedUpdate {
  filter: MongoFilterExpr;
  updatePipeline: ReadonlyArray<MongoUpdatePipelineStage>;
}

/**
 * Walk the accumulated pipeline stages: leading `$match` stages become the
 * filter, remaining stages must all be valid `MongoUpdatePipelineStage`
 * members (currently `$addFields`, `$project`, `$replaceRoot`).
 */
function deconstructUpdateChain(stages: ReadonlyArray<MongoPipelineStage>): DeconstructedUpdate {
  const matchFilters: MongoFilterExpr[] = [];
  let boundary = 0;

  for (const stage of stages) {
    if (!(stage instanceof MongoMatchStage)) break;
    matchFilters.push(stage.filter);
    boundary++;
  }

  if (matchFilters.length === 0) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      'No-arg updateMany/updateOne requires at least one .match() call.',
    );
  }

  const remaining = stages.slice(boundary);
  if (remaining.length === 0) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      'No-arg updateMany/updateOne requires at least one pipeline-update stage ' +
        '(e.g. .addFields(), .project(), .replaceRoot()) after the .match() stages.',
    );
  }

  const updatePipeline: MongoUpdatePipelineStage[] = [];
  for (const stage of remaining) {
    if (
      stage instanceof MongoAddFieldsStage ||
      stage instanceof MongoProjectStage ||
      stage instanceof MongoReplaceRootStage
    ) {
      updatePipeline.push(stage);
    } else {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        `No-arg updateMany/updateOne: encountered non-update stage '${stage.constructor.name}' ` +
          'after the leading $match stages. Only $addFields/$set, $project/$unset, ' +
          'and $replaceRoot/$replaceWith stages are valid in an update pipeline.',
      );
    }
  }

  const first = matchFilters[0];
  if (first === undefined) {
    throw new InternalError('Unreachable: matchFilters.length > 0 but first is undefined');
  }
  const filter: MongoFilterExpr = matchFilters.length === 1 ? first : MongoAndExpr.of(matchFilters);

  return { filter, updatePipeline };
}
