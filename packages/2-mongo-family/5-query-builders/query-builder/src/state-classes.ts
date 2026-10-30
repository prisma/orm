import {
  type ContractModel,
  domainModelsAtDefaultNamespace,
  type PlanMeta,
} from '@internal/contract/types';
import type {
  AnyMongoTypeMaps,
  ExtractMongoCodecTypes,
  MongoContract,
  MongoContractWithTypeMaps,
  MongoModelStorage,
  MongoModelsMap,
  RootModelName,
} from '@internal/mongo-contract';
import type {
  DeleteResult,
  InsertManyResult,
  InsertOneResult,
  MongoFilterExpr,
  MongoQueryPlan,
  MongoUpdateSpec,
  UpdateResult,
} from '@internal/mongo-query-ast/execution';
import {
  DeleteManyCommand,
  DeleteOneCommand,
  FindOneAndDeleteCommand,
  FindOneAndUpdateCommand,
  InsertManyCommand,
  InsertOneCommand,
  MongoAndExpr,
  MongoExistsExpr,
  MongoMatchStage,
  UpdateManyCommand,
  UpdateOneCommand,
} from '@internal/mongo-query-ast/execution';
import type { MongoValue } from '@internal/mongo-value';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { PipelineChain } from './builder';
import { contractError } from './contract-errors';
import { createFieldAccessor, type FieldAccessor } from './field-accessor';
import { type FieldCodecs, modelFieldCodecs } from './field-codecs';
import { ormError } from './orm-errors';
import type { ModelNestedShape, NestedDocShape } from './resolve-path';
import type { ModelToDocShape, ResolveRow } from './types';
import { resolveUpdaterResult, type UpdaterResult } from './update-ops';

/**
 * "Match-all" filter used by the unqualified-write terminals
 * (`updateAll`/`deleteAll`). The canonical representation is still
 * undecided — `MongoAndExpr` with an empty conjunction and a dedicated
 * `MongoMatchAllExpr` node are both candidates. For now we use
 * `_id $exists: true`, which is trivially true on every document and
 * avoids introducing a new AST node before the wider question is
 * resolved. Centralised so the eventual switch is a one-line change.
 */
function matchAllFilter(): MongoFilterExpr {
  return MongoExistsExpr.exists('_id');
}

/**
 * Resolve an updater callback into a `MongoUpdateSpec` (either the folded
 * operator object or a pipeline-stage array). Centralised so all write
 * terminals share the same fold / dispatch semantics.
 */
function resolveUpdaterCallback<
  Shape extends ModelToDocShape<MongoContract, string>,
  Nested extends NestedDocShape,
>(updaterFn: (fields: FieldAccessor<Shape, Nested>) => UpdaterResult): MongoUpdateSpec {
  const accessor = createFieldAccessor<Shape, Nested>();
  const items = updaterFn(accessor);
  return resolveUpdaterResult(items);
}

/**
 * Build the `PlanMeta` envelope shared by every write terminal in this
 * package. Lane is `mongo-query` (single lane for all query-builder terminals)
 * so middleware can dispatch on intent without inspecting the command.
 */
function writeMeta(storageHash: string): PlanMeta {
  return {
    target: 'mongo',
    storageHash,
    lane: 'mongo-query',
  };
}

/**
 * Root state of the query-builder state machine. Returned from
 * `mongoQuery(...).from(name)` and bound to a single collection.
 *
 * Inherits the entire pipeline-stage surface from `PipelineChain` (since an
 * empty `CollectionHandle` is observably an empty pipeline). Adds:
 *
 *  - `match(...)` — overridden to transition to `FilteredCollection`, which
 *    accumulates filters for eventual splatting into write/find-and-modify
 *    wire commands.
 *  - **Insert / unqualified-write methods** (M2): `insertOne`, `insertMany`,
 *    `updateAll`, `deleteAll`. These live *only* here — the corresponding
 *    methods are absent from `FilteredCollection`, so a caller cannot
 *    accidentally produce an unqualified write by forgetting to `.match(...)`
 *    later in the chain. Bodies land in M2.
 */
export class CollectionHandle<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends keyof MongoModelsMap<TContract> & string,
> extends PipelineChain<
  TContract,
  ModelToDocShape<TContract, ModelName>,
  'update-cleared',
  'fam-cleared',
  'leading',
  ModelNestedShape<TContract, ModelName>
> {
  readonly #ctx: BindingContext<TContract>;
  readonly #modelName: ModelName;
  readonly #fieldCodecs: FieldCodecs | undefined;

  constructor(ctx: BindingContext<TContract>, modelName: ModelName) {
    const fieldCodecs = fieldCodecsOf(ctx, modelName);
    super(ctx.contract, {
      collection: ctx.collection,
      stages: [],
      storageHash: ctx.storageHash,
      modelName: modelName as string,
      ...ifDefined('fieldCodecs', fieldCodecs),
    });
    this.#ctx = ctx;
    this.#modelName = modelName;
    this.#fieldCodecs = fieldCodecs;
  }

  /**
   * Bound model name. Exposed so type tests can assert the binding without
   * flipping into a pipeline. Not part of the public-API contract.
   */
  get _modelName(): ModelName {
    return this.#modelName;
  }

  /**
   * Begin accumulating a filter. Transitions to `FilteredCollection`.
   *
   * Overrides `PipelineChain.match` (which appends another `$match` stage
   * and stays in the chain). The two implementations are semantically
   * equivalent for the read terminal — multiple `$match` stages AND-fold in
   * Mongo — but `FilteredCollection` makes the accumulated filter
   * addressable for the write/find-and-modify terminals landing in M2/M3.
   */
  override match(filter: MongoFilterExpr): FilteredCollection<TContract, ModelName>;
  override match(
    fn: (
      fields: FieldAccessor<
        ModelToDocShape<TContract, ModelName>,
        ModelNestedShape<TContract, ModelName>
      >,
    ) => MongoFilterExpr,
  ): FilteredCollection<TContract, ModelName>;
  override match(
    filterOrFn:
      | MongoFilterExpr
      | ((
          fields: FieldAccessor<
            ModelToDocShape<TContract, ModelName>,
            ModelNestedShape<TContract, ModelName>
          >,
        ) => MongoFilterExpr),
  ): FilteredCollection<TContract, ModelName> {
    const resolved =
      typeof filterOrFn === 'function'
        ? filterOrFn(
            createFieldAccessor<
              ModelToDocShape<TContract, ModelName>,
              ModelNestedShape<TContract, ModelName>
            >(this.#fieldCodecs),
          )
        : filterOrFn;
    return new FilteredCollection<TContract, ModelName>(this.#ctx, this.#modelName, [resolved]);
  }

  // --- Inserts ---

  /**
   * Insert a single document. Document fields are passed straight through to
   * the wire `InsertOneCommand` — codec normalisation happens at the
   * adapter/driver boundary, identically to the SQL builder (see Open Item
   * #14 confirmation in the design conversation).
   *
   * Returns a `MongoQueryPlan<InsertOneResult>` whose row stream yields a
   * single result document with the server-assigned `insertedId`.
   */
  insertOne(
    document: Record<string, MongoValue>,
  ): MongoQueryPlan<InsertOneResult, InsertOneCommand> {
    const command = new InsertOneCommand(this.#ctx.collection, document);
    return {
      collection: this.#ctx.collection,
      command,
      meta: writeMeta(this.#ctx.storageHash),
    };
  }

  /**
   * Insert a batch of documents. Order is preserved in the returned
   * `insertedIds` array.
   */
  insertMany(
    documents: ReadonlyArray<Record<string, MongoValue>>,
  ): MongoQueryPlan<InsertManyResult, InsertManyCommand> {
    if (documents.length === 0) {
      throw ormError('ORM.MUTATION_DATA_MISSING', 'insertMany() requires at least one document.');
    }
    const command = new InsertManyCommand(this.#ctx.collection, documents);
    return {
      collection: this.#ctx.collection,
      command,
      meta: writeMeta(this.#ctx.storageHash),
    };
  }

  // --- Unqualified writes ---

  /**
   * Update *every* document in the collection. Lives only on
   * `CollectionHandle` — the corresponding method is intentionally absent
   * from `FilteredCollection` so a caller cannot accidentally produce an
   * unqualified write by forgetting to `.match(...)` first. Pair with
   * `.match(...).updateMany(...)` for the filtered case.
   */
  updateAll(
    updaterFn: (
      fields: FieldAccessor<
        ModelToDocShape<TContract, ModelName>,
        ModelNestedShape<TContract, ModelName>
      >,
    ) => UpdaterResult,
  ): MongoQueryPlan<UpdateResult, UpdateManyCommand> {
    const update = resolveUpdaterCallback<
      ModelToDocShape<TContract, ModelName>,
      ModelNestedShape<TContract, ModelName>
    >(updaterFn);
    const command = new UpdateManyCommand(this.#ctx.collection, matchAllFilter(), update);
    return {
      collection: this.#ctx.collection,
      command,
      meta: writeMeta(this.#ctx.storageHash),
    };
  }

  /**
   * Delete *every* document in the collection. See `updateAll` for the
   * rationale around the unqualified-write surface being limited to this
   * state class.
   */
  deleteAll(): MongoQueryPlan<DeleteResult, DeleteManyCommand> {
    const command = new DeleteManyCommand(this.#ctx.collection, matchAllFilter());
    return {
      collection: this.#ctx.collection,
      command,
      meta: writeMeta(this.#ctx.storageHash),
    };
  }

  // --- Upserts ---

  /**
   * Insert-or-update the document matching `filterFn`. The filter is
   * mandatory (vs. `updateAll`'s tautological match) because an upsert
   * without a discriminating predicate would either match every existing
   * document or insert an indistinguishable new one.
   *
   * Maps to `UpdateOneCommand` with `upsert: true`. The driver inserts a
   * new document derived from the filter equality fields plus the update
   * spec when no match is found; otherwise updates the matched document.
   */
  upsertOne(
    filterFn: (
      fields: FieldAccessor<
        ModelToDocShape<TContract, ModelName>,
        ModelNestedShape<TContract, ModelName>
      >,
    ) => MongoFilterExpr,
    updaterFn: (
      fields: FieldAccessor<
        ModelToDocShape<TContract, ModelName>,
        ModelNestedShape<TContract, ModelName>
      >,
    ) => UpdaterResult,
  ): MongoQueryPlan<UpdateResult, UpdateOneCommand> {
    const accessor = createFieldAccessor<
      ModelToDocShape<TContract, ModelName>,
      ModelNestedShape<TContract, ModelName>
    >(this.#fieldCodecs);
    const filter = filterFn(accessor);
    const update = resolveUpdaterCallback<
      ModelToDocShape<TContract, ModelName>,
      ModelNestedShape<TContract, ModelName>
    >(updaterFn);
    const command = new UpdateOneCommand(this.#ctx.collection, filter, update, true);
    return {
      collection: this.#ctx.collection,
      command,
      meta: writeMeta(this.#ctx.storageHash),
    };
  }
}

/**
 * State reached after one or more `.match(...)` calls on `CollectionHandle`.
 *
 * Inherits the pipeline-stage surface from `PipelineChain`, with the
 * accumulated filters baked in as a leading `$match` stage on the underlying
 * pipeline state. This means read-terminal output (`.aggregate()` /
 * `.build()`) and any subsequent pipeline-stage chain see the filtered
 * collection as input — the read story works through pure inheritance.
 *
 * Adds:
 *
 *  - `match(...)` — pushes another `$match` stage *and* records the filter in
 *    the accumulator, so the eventual write/find-and-modify terminal can
 *    splat the AND-folded filter into the wire command's `filter` slot.
 *  - **Filtered writes** (M2): `updateMany`, `updateOne`, `deleteMany`,
 *    `deleteOne`, `upsertOne`. Stubbed in M1. (Upsert-many is an open
 *    question in the spec — see TML-2267 — and is intentionally absent.)
 *  - **Find-and-modify** (M3): `findOneAndUpdate`, `findOneAndDelete`.
 *    Stubbed in M1.
 *
 * Notably *does not* expose `insertOne`/`insertMany`/`updateAll`/`deleteAll`
 * — those are insert or unqualified-write operations that are nonsense
 * after a filter has been applied.
 */
export class FilteredCollection<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends keyof MongoModelsMap<TContract> & string,
> extends PipelineChain<
  TContract,
  ModelToDocShape<TContract, ModelName>,
  'update-cleared',
  'fam-cleared',
  'leading',
  ModelNestedShape<TContract, ModelName>
> {
  readonly #ctx: BindingContext<TContract>;
  readonly #modelName: ModelName;
  readonly #filters: ReadonlyArray<MongoFilterExpr>;
  readonly #fieldCodecs: FieldCodecs | undefined;

  constructor(
    ctx: BindingContext<TContract>,
    modelName: ModelName,
    filters: ReadonlyArray<MongoFilterExpr>,
  ) {
    if (filters.length === 0) {
      throw new InternalError('FilteredCollection requires at least one accumulated filter');
    }
    const first = filters[0];
    if (first === undefined) {
      throw new InternalError('FilteredCollection: unreachable empty-filters branch');
    }
    const leading = filters.length === 1 ? first : foldAnd(filters);
    const fieldCodecs = fieldCodecsOf(ctx, modelName);
    super(ctx.contract, {
      collection: ctx.collection,
      stages: [new MongoMatchStage(leading)],
      storageHash: ctx.storageHash,
      modelName: modelName as string,
      ...ifDefined('fieldCodecs', fieldCodecs),
    });
    this.#ctx = ctx;
    this.#modelName = modelName;
    this.#filters = filters;
    this.#fieldCodecs = fieldCodecs;
  }

  get _modelName(): ModelName {
    return this.#modelName;
  }

  /**
   * Accumulated filter list. Exposed for the M2/M3 write/find-and-modify
   * terminals to splat into wire-command `filter` slots; not part of the
   * public-API contract.
   */
  get _filters(): ReadonlyArray<MongoFilterExpr> {
    return this.#filters;
  }

  /**
   * Append another filter to the accumulator. Returns a new
   * `FilteredCollection` whose underlying pipeline rebuilds the leading
   * `$match` from the AND-folded accumulator (rather than appending a
   * second `$match` stage), so the write/find-and-modify terminals see a
   * single authoritative filter expression.
   */
  override match(filter: MongoFilterExpr): FilteredCollection<TContract, ModelName>;
  override match(
    fn: (
      fields: FieldAccessor<
        ModelToDocShape<TContract, ModelName>,
        ModelNestedShape<TContract, ModelName>
      >,
    ) => MongoFilterExpr,
  ): FilteredCollection<TContract, ModelName>;
  override match(
    filterOrFn:
      | MongoFilterExpr
      | ((
          fields: FieldAccessor<
            ModelToDocShape<TContract, ModelName>,
            ModelNestedShape<TContract, ModelName>
          >,
        ) => MongoFilterExpr),
  ): FilteredCollection<TContract, ModelName> {
    const resolved =
      typeof filterOrFn === 'function'
        ? filterOrFn(
            createFieldAccessor<
              ModelToDocShape<TContract, ModelName>,
              ModelNestedShape<TContract, ModelName>
            >(this.#fieldCodecs),
          )
        : filterOrFn;
    return new FilteredCollection<TContract, ModelName>(this.#ctx, this.#modelName, [
      ...this.#filters,
      resolved,
    ]);
  }

  // --- Filtered writes ---

  /**
   * AND-fold the accumulated filters into a single `MongoFilterExpr` for
   * splatting into a write/find-and-modify wire command's `filter` slot.
   * Length-1 short-circuits to avoid a redundant `$and` wrapper.
   */
  #foldedFilter(): MongoFilterExpr {
    const first = this.#filters[0];
    if (first === undefined) {
      throw new InternalError('FilteredCollection: invariant violated — empty filter accumulator');
    }
    return this.#filters.length === 1 ? first : foldAnd(this.#filters);
  }

  /**
   * Update every matching document. `updaterFn` receives a `FieldAccessor`
   * and returns an array of `TypedUpdateOp` (e.g. `[f.amount.inc(1),
   * f.status.set('done')]`). Operators are folded into the wire-format
   * update spec by `foldUpdateOps`, which throws on operator+path
   * collisions.
   */
  override updateMany(
    updaterFn: (
      fields: FieldAccessor<
        ModelToDocShape<TContract, ModelName>,
        ModelNestedShape<TContract, ModelName>
      >,
    ) => UpdaterResult,
  ): MongoQueryPlan<UpdateResult, UpdateManyCommand> {
    const update = resolveUpdaterCallback<
      ModelToDocShape<TContract, ModelName>,
      ModelNestedShape<TContract, ModelName>
    >(updaterFn);
    const command = new UpdateManyCommand(this.#ctx.collection, this.#foldedFilter(), update);
    return {
      collection: this.#ctx.collection,
      command,
      meta: writeMeta(this.#ctx.storageHash),
    };
  }

  /**
   * Update at most one matching document. The driver picks the document
   * (typically the first one matched by the underlying scan); no ordering
   * guarantee is implied — chain `.sort(...)` and use the M3
   * `.findOneAndUpdate(...)` terminal when ordering matters.
   */
  override updateOne(
    updaterFn: (
      fields: FieldAccessor<
        ModelToDocShape<TContract, ModelName>,
        ModelNestedShape<TContract, ModelName>
      >,
    ) => UpdaterResult,
  ): MongoQueryPlan<UpdateResult, UpdateOneCommand> {
    const update = resolveUpdaterCallback<
      ModelToDocShape<TContract, ModelName>,
      ModelNestedShape<TContract, ModelName>
    >(updaterFn);
    const command = new UpdateOneCommand(this.#ctx.collection, this.#foldedFilter(), update);
    return {
      collection: this.#ctx.collection,
      command,
      meta: writeMeta(this.#ctx.storageHash),
    };
  }

  /**
   * Delete every matching document.
   */
  deleteMany(): MongoQueryPlan<DeleteResult, DeleteManyCommand> {
    const command = new DeleteManyCommand(this.#ctx.collection, this.#foldedFilter());
    return {
      collection: this.#ctx.collection,
      command,
      meta: writeMeta(this.#ctx.storageHash),
    };
  }

  /**
   * Delete at most one matching document. See the `updateOne` note about
   * driver-chosen victim selection.
   */
  deleteOne(): MongoQueryPlan<DeleteResult, DeleteOneCommand> {
    const command = new DeleteOneCommand(this.#ctx.collection, this.#foldedFilter());
    return {
      collection: this.#ctx.collection,
      command,
      meta: writeMeta(this.#ctx.storageHash),
    };
  }

  // --- Upserts ---

  /**
   * Insert-or-update against the accumulated filter. Maps to
   * `UpdateOneCommand` with `upsert: true`. Equivalent to
   * `CollectionHandle.upsertOne(f => filter, updaterFn)` but reuses the
   * already-accumulated `.match(...)` filter chain.
   */
  upsertOne(
    updaterFn: (
      fields: FieldAccessor<
        ModelToDocShape<TContract, ModelName>,
        ModelNestedShape<TContract, ModelName>
      >,
    ) => UpdaterResult,
  ): MongoQueryPlan<UpdateResult, UpdateOneCommand> {
    const update = resolveUpdaterCallback<
      ModelToDocShape<TContract, ModelName>,
      ModelNestedShape<TContract, ModelName>
    >(updaterFn);
    const command = new UpdateOneCommand(this.#ctx.collection, this.#foldedFilter(), update, true);
    return {
      collection: this.#ctx.collection,
      command,
      meta: writeMeta(this.#ctx.storageHash),
    };
  }

  // --- Find-and-modify ---

  /**
   * Find a single matching document and apply `updaterFn` to it.
   *
   * `opts.upsert` (default `false`) toggles insert-on-miss behaviour.
   * `opts.returnDocument` (default `'after'`) controls whether the row
   * stream yields the document as it was before or after the update.
   */
  override findOneAndUpdate(
    updaterFn: (
      fields: FieldAccessor<
        ModelToDocShape<TContract, ModelName>,
        ModelNestedShape<TContract, ModelName>
      >,
    ) => UpdaterResult,
    opts: { readonly upsert?: boolean; readonly returnDocument?: 'before' | 'after' } = {},
  ): MongoQueryPlan<
    ResolveRow<
      ModelToDocShape<TContract, ModelName>,
      ExtractMongoCodecTypes<TContract>,
      TContract
    > | null,
    FindOneAndUpdateCommand
  > {
    const update = resolveUpdaterCallback<
      ModelToDocShape<TContract, ModelName>,
      ModelNestedShape<TContract, ModelName>
    >(updaterFn);
    const command = new FindOneAndUpdateCommand(
      this.#ctx.collection,
      this.#foldedFilter(),
      update,
      opts.upsert ?? false,
      undefined,
      opts.returnDocument ?? 'after',
    );
    return {
      collection: this.#ctx.collection,
      command,
      meta: writeMeta(this.#ctx.storageHash),
    };
  }

  /**
   * Find a single matching document and delete it. Returns the deleted
   * document via the row stream.
   */
  override findOneAndDelete(): MongoQueryPlan<
    ResolveRow<
      ModelToDocShape<TContract, ModelName>,
      ExtractMongoCodecTypes<TContract>,
      TContract
    > | null,
    FindOneAndDeleteCommand
  > {
    const command = new FindOneAndDeleteCommand(this.#ctx.collection, this.#foldedFilter());
    return {
      collection: this.#ctx.collection,
      command,
      meta: writeMeta(this.#ctx.storageHash),
    };
  }
}

function foldAnd(filters: ReadonlyArray<MongoFilterExpr>): MongoFilterExpr {
  return MongoAndExpr.of(filters);
}

/**
 * Narrow a `MongoContractWithTypeMaps`-shaped value down to its underlying
 * `MongoContract` view. `MongoContractWithTypeMaps<C, ...>` is defined as
 * `C & { readonly [phantom]?: TTypeMaps }`, so every contract we accept is
 * structurally a `MongoContract` — the phantom is type-only. This helper
 * centralises that narrowing so callers don't reach for `as unknown as
 * MongoContract` double-casts.
 */
export function asMongoContract(
  contract: MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
): MongoContract {
  return contract;
}

/**
 * Bound execution context shared across the three state classes.
 */
function fieldCodecsOf<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(ctx: BindingContext<TContract>, modelName: string): FieldCodecs | undefined {
  return modelFieldCodecs(ctx.contract, modelName, ctx.collection);
}

export interface BindingContext<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
> {
  readonly contract: TContract;
  readonly collection: string;
  readonly storageHash: string;
}

/**
 * Construct a `CollectionHandle` from a validated contract + root name.
 * Used by `mongoQuery(...).from(name)` to enter the state machine.
 */
export function createCollectionHandle<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  RootName extends keyof TContract['roots'] & string,
>(
  contract: TContract,
  rootName: RootName,
): CollectionHandle<TContract, RootModelName<TContract, RootName>> {
  const c = asMongoContract(contract);
  const modelName = c.roots[rootName]?.model;
  if (!modelName) {
    const validRoots = Object.keys(c.roots).join(', ');
    throw ormError('ORM.MODEL_UNKNOWN', `Unknown root: "${rootName}". Valid roots: ${validRoots}`);
  }
  const model = domainModelsAtDefaultNamespace(c.domain)[modelName] as
    | ContractModel<MongoModelStorage>
    | undefined;
  if (!model) {
    throw contractError(
      'CONTRACT.MODEL_UNKNOWN',
      `Unknown model: "${modelName}" referenced by root "${rootName}".`,
    );
  }
  const collectionName = model.storage.collection ?? rootName;
  if (!c.storage?.storageHash) {
    throw contractError(
      'CONTRACT.VALIDATION_FAILED',
      'Contract is missing storage.storageHash. Pass a validated contract to mongoQuery().',
    );
  }
  return new CollectionHandle(
    {
      contract,
      collection: collectionName,
      storageHash: String(c.storage.storageHash),
    },
    modelName as RootModelName<TContract, RootName>,
  );
}
