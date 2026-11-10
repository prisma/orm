import { type ContractModel, domainModelsAtDefaultNamespace } from '@internal/contract/types';
import type {
  MongoContract,
  MongoModelStorage,
  MongoModelsMap,
  RootModelName,
} from '@internal/mongo-contract';
import { createFieldAccessor, type FieldAccessor, type LeafExpression } from './field-accessor';
import { ormError } from './orm-errors';
import type { ModelNestedShape } from './resolve-path';
import type { DocField, DocShape, ModelToDocShape } from './types';

/**
 * Resolved foreign-model name for a contract root. Looks `RootName` up
 * through `TContract['roots']` and extracts the referenced model name
 * so it can be used as a `ModelName` index into `models`. Resolves to
 * `never` when the root is not present (this surface should never be
 * reachable through normal use because `from()` constrains its `R`
 * parameter to `keyof TContract['roots']`).
 */
export type ModelOf<
  TContract extends MongoContract,
  RootName extends keyof TContract['roots'] & string,
> = RootModelName<TContract, RootName>;

/**
 * Object returned by the user from the `on(...)` callback. Each side is
 * a `LeafExpression` produced by property access on the corresponding
 * `FieldAccessor` (`local._id`, `foreign.customerId`, etc.). Carrying
 * `LeafExpression` rather than the broader `TypedAggExpr` is what makes
 * non-leaf returns (e.g. `fn.toUpper(local._id)`) a compile-time error
 * without per-field operator gating — `LeafExpression` carries `_path`,
 * `TypedAggExpr` does not (see field-accessor.ts L47–L82).
 */
export interface LookupOnResult {
  readonly local: LeafExpression<DocField>;
  readonly foreign: LeafExpression<DocField>;
}

/**
 * Marker brand on the captured spec returned by the `lookup(...)`
 * callback. The phantom `_brand` literal lets `PipelineChain.lookup`
 * accept the result of `from(...).on(...).as(...)` without exposing the
 * internal field shape to user code, and prevents accidental
 * construction of a malformed spec by hand.
 */
export type LookupResultBrand = 'mongo-query-builder/lookup-result@1';

/**
 * Captured output of the inner `from(name).on(cb).as(name)` chain. The
 * contract is consumed by `PipelineChain.lookup` to construct the
 * `MongoLookupStage` (collection name comes from `models[ModelName]
 * .storage.collection`) and to thread `ModelArrayField<ModelName>` into
 * the resulting `Shape` so the resolver yields `Array<ForeignRow>`.
 *
 * Type parameters carry the foreign-root literal `RootName`, the
 * resolved foreign model name `ModelName`, and the `As` literal so
 * `PipelineChain.lookup`'s return type can encode the result-row
 * promotion precisely.
 */
export interface LookupResult<
  RootName extends string,
  ModelName extends string,
  As extends string,
> {
  readonly _brand: LookupResultBrand;
  readonly _root: RootName;
  readonly _model: ModelName;
  readonly _localField: string;
  readonly _foreignField: string;
  readonly _as: As;
}

/**
 * Builder returned by `from(name).on(cb)`. Carries the foreign root /
 * model literals plus the captured local / foreign paths, and exposes
 * `.as(name)` to finalise the spec with the user-chosen field name.
 */
export interface LookupBuilderWithKey<RootName extends string, ModelName extends string> {
  as<As extends string>(name: As): LookupResult<RootName, ModelName, As>;
}

/**
 * Builder returned by `from(name)`. Carries the foreign root / model
 * literals and the local pipeline's `Shape` / nested shape so the
 * `on(...)` callback's `local` and `foreign` accessors are typed
 * narrowly.
 *
 * `on(cb)` runs the user's callback to capture the leaf paths and
 * returns a `LookupBuilderWithKey` that exposes `.as(name)`.
 */
export interface LookupBuilder<
  TContract extends MongoContract,
  Shape extends DocShape,
  Nested extends Record<string, DocField>,
  RootName extends string,
  ModelName extends string,
> {
  on(
    cb: (
      local: FieldAccessor<Shape, Nested>,
      foreign: ModelName extends keyof MongoModelsMap<TContract> & string
        ? FieldAccessor<
            ModelToDocShape<TContract, ModelName>,
            ModelNestedShape<TContract, ModelName>
          >
        : never,
    ) => LookupOnResult,
  ): LookupBuilderWithKey<RootName, ModelName>;
}

/**
 * Type of the `from` callable passed to `PipelineChain.lookup`'s outer
 * callback. The generic argument is inferred from a string-literal
 * argument (the same pattern as `mongoQuery({ context }).from('orders')`),
 * which grounds `RootName` into the returned `LookupBuilder` *before*
 * the inner `on(...)` callback is type-checked. This sequential
 * inference is what makes `foreign` resolve narrowly to the foreign
 * model's `FieldAccessor` (verified in the R1.5 spike — see spec § Open
 * Questions / Resolved decisions).
 */
export type LookupFrom<
  TContract extends MongoContract,
  Shape extends DocShape,
  Nested extends Record<string, DocField>,
> = <RootName extends keyof TContract['roots'] & string>(
  name: RootName,
) => LookupBuilder<TContract, Shape, Nested, RootName, ModelOf<TContract, RootName>>;

/**
 * Construct the `from` callable for `PipelineChain.lookup`. The contract
 * is captured so `from(name)` can resolve `roots[name]` to the foreign
 * model name at runtime, look up the foreign collection name from
 * `models[modelName].storage.collection`, and assemble a `LookupResult`
 * for the outer `lookup` to consume.
 *
 * The `Shape`/`Nested` generics are erased at runtime — they exist only
 * to type the local accessor inside the user's `on(...)` callback. The
 * contract value at runtime carries the real model lookup table.
 */
export function createLookupFrom<
  TContract extends MongoContract,
  Shape extends DocShape,
  Nested extends Record<string, DocField>,
>(contract: TContract): LookupFrom<TContract, Shape, Nested> {
  const callable = ((rootName) => {
    const modelName = contract.roots[rootName]?.model;
    if (!modelName) {
      const validRoots = Object.keys(contract.roots).join(', ');
      throw ormError(
        'ORM.MODEL_UNKNOWN',
        `lookup() unknown root: "${rootName}". Valid roots: ${validRoots}`,
      );
    }
    const model = domainModelsAtDefaultNamespace(contract.domain)[modelName] as
      | ContractModel<MongoModelStorage>
      | undefined;
    const foreignCollection = model?.storage?.collection ?? rootName;
    return createLookupBuilder({
      rootName,
      modelName,
      foreignCollection,
    });
    // The runtime callable accepts a single `string` and returns a
    // generic `LookupBuilder`; the literal `RootName` / `ModelName`
    // generics on `LookupFrom` are erased at runtime and re-asserted
    // here so the surface contract is what the consumer actually sees.
  }) as LookupFrom<TContract, Shape, Nested>;
  return callable;
}

interface LookupBuilderRuntimeState {
  readonly rootName: string;
  readonly modelName: string;
  readonly foreignCollection: string;
}

function createLookupBuilder<
  TContract extends MongoContract,
  Shape extends DocShape,
  Nested extends Record<string, DocField>,
  RootName extends string,
  ModelName extends string,
>(state: LookupBuilderRuntimeState): LookupBuilder<TContract, Shape, Nested, RootName, ModelName> {
  return {
    on(cb) {
      const localAccessor = createFieldAccessor<Shape, Nested>();
      // Foreign accessor is built unparameterised at runtime — the codec
      // metadata is type-only, and `_path` (the only thing we read off
      // either side) is filled by property access regardless of the
      // generic parameters. The narrow generic on the callback signature
      // is what gives the user the foreign model's keys at compile time.
      const foreignAccessor = createFieldAccessor<DocShape, Record<string, DocField>>();
      const result = cb(localAccessor, foreignAccessor as Parameters<typeof cb>[1]);
      assertLeafExpression(result.local, 'local');
      assertLeafExpression(result.foreign, 'foreign');
      return createLookupBuilderWithKey<RootName, ModelName>({
        ...state,
        localField: result.local._path,
        foreignField: result.foreign._path,
      });
    },
  };
}

interface LookupBuilderWithKeyRuntimeState extends LookupBuilderRuntimeState {
  readonly localField: string;
  readonly foreignField: string;
}

function createLookupBuilderWithKey<RootName extends string, ModelName extends string>(
  state: LookupBuilderWithKeyRuntimeState,
): LookupBuilderWithKey<RootName, ModelName> {
  return {
    as<As extends string>(name: As): LookupResult<RootName, ModelName, As> {
      return {
        _brand: 'mongo-query-builder/lookup-result@1',
        // The `RootName` / `ModelName` literal generics are erased at
        // runtime; the runtime state holds the same strings as plain
        // `string`. Re-brand so consumers (the lookup-stage builder)
        // can read the literals back without a downstream cast.
        _root: state.rootName as RootName,
        _model: state.modelName as ModelName,
        _localField: state.localField,
        _foreignField: state.foreignField,
        _as: name,
      };
    },
  };
}

/**
 * Defensive runtime guard catching the case where a user returns a
 * non-`LeafExpression` from the `on(...)` callback (e.g. by casting
 * around the type system, or threading a value in from outside the
 * callback). Compile-time gating via `LookupOnResult`'s `LeafExpression`
 * type already rejects `fn.<op>(…)` returns at the type level — this
 * guard is the runtime backstop matching the defensive style of
 * `deconstructFindAndModifyChain` in builder.ts.
 */
function assertLeafExpression(
  value: LeafExpression<DocField>,
  side: 'local' | 'foreign',
): asserts value is LeafExpression<DocField> {
  if (!value || typeof value._path !== 'string' || value._path.length === 0) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `lookup().on() ${side} side must return a leaf field reference (e.g. \`${side}.<field>\`). ` +
        'Aggregation expressions and computed values are not supported.',
    );
  }
}

/**
 * Extract the runtime metadata from a `LookupResult` for `PipelineChain
 * .lookup` to construct the `MongoLookupStage`. The internal fields are
 * intentionally underscore-prefixed and brand-checked here so user code
 * cannot synthesise a fake spec; this is the single ingress point.
 */
export function extractLookupResult(
  result: LookupResult<string, string, string>,
  contract: MongoContract,
): {
  readonly foreignCollection: string;
  readonly localField: string;
  readonly foreignField: string;
  readonly as: string;
  readonly modelName: string;
} {
  if (result?._brand !== 'mongo-query-builder/lookup-result@1') {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      'lookup() callback must return the result of `from(name).on(cb).as(name)`. ' +
        'Returning a hand-rolled options object is not supported.',
    );
  }
  const model = domainModelsAtDefaultNamespace(contract.domain)[result._model] as
    | ContractModel<MongoModelStorage>
    | undefined;
  const foreignCollection = model?.storage?.collection ?? result._root;
  return {
    foreignCollection,
    localField: result._localField,
    foreignField: result._foreignField,
    as: result._as,
    modelName: result._model,
  };
}
