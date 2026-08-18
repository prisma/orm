import type { ContractValueObjectDefinitions } from '@internal/contract/types';
import type { MongoContract, MongoModelsMap } from '@internal/mongo-contract';
import type { DocField } from './types';

/**
 * Marker `DocField` variant representing a non-leaf (value-object) path in
 * a [NestedDocShape]. Extends `DocField` with a `fields` property carrying
 * the sub-shape so the pipeline builder can recurse into it.
 *
 * `codecId` is the reserved literal `'prisma/object@1'`; the accessor's
 * runtime implementation does not serialize it — the codec id is a purely
 * type-level sentinel used by `Expression<F>` to select the reduced
 * operator surface for non-leaf paths.
 *
 * `nullable` tracks whether the value object itself may be absent/null on
 * the parent document. The callable form currently does not propagate the
 * parent's `nullable` flag onto leaves beneath it (path traversal under a
 * nullable parent resolves to the leaf's own `nullable` — matching how
 * MongoDB treats missing intermediate documents).
 */
export interface ObjectField<N extends NestedDocShape> extends DocField {
  readonly codecId: 'prisma/object@1';
  readonly nullable: boolean;
  readonly fields: N;
}

/**
 * Marker `DocField` variant representing "an array of foreign-model rows"
 * — the result of a `$lookup` whose foreign side was selected via the
 * typed `col` accessor. `ModelName` is the literal foreign model name
 * (e.g. `'User'`), preserved in the type so `ResolveRow` can resolve the
 * field to `ResolveRow<ModelToDocShape<TC, ModelName>, …>[]` rather than
 * the opaque `unknown[]` produced by the legacy `mongo/array@1` sentinel.
 *
 * Like `ObjectField`, the codec id is a purely type-level sentinel —
 * there is no runtime codec entry for `'prisma/modelArray@1'`. The
 * surrounding pipeline emits the standard `MongoLookupStage` whose
 * runtime shape is unchanged; the marker exists solely to thread the
 * foreign element type through the result-row resolver.
 */
export interface ModelArrayField<ModelName extends string> extends DocField {
  readonly codecId: 'prisma/modelArray@1';
  readonly nullable: false;
  readonly model: ModelName;
}

/**
 * Phantom-symbol brand placed on `ModelToDocShape`'s output (and inherited
 * through shape-extending stages like `addFields`, `match`, `lookup`) so
 * `ResolveRow` can route value-object resolution through `InferModelRow`
 * — which walks the contract's `valueObjects` registry and resolves
 * nested types — instead of falling through the codec-lookup branch to
 * `unknown`.
 *
 * The brand is keyed on a `unique symbol` rather than a string so it is
 * invisible to every `keyof Shape & string` walk in the package
 * (`SortSpec`, `ProjectedShape`, `GroupedDocShape`, the field accessor's
 * `Object.keys` iteration, etc.). Field accessors do not surface a
 * `__modelOrigin` autocomplete entry; sorts cannot key on it; projections
 * cannot reference it.
 *
 * Shape-extending stages preserve the brand because intersection types
 * (`Shape & NewFields`) carry through symbol-keyed properties. Shape-
 * replacing stages (`replaceRoot`, `group`, `project`) construct fresh
 * `DocShape`s from scratch, naturally dropping the brand — which is the
 * intended behaviour, since those stages legitimately leave model
 * territory.
 */
export declare const ModelOriginBrand: unique symbol;
export type ModelOriginBrand = typeof ModelOriginBrand;

/**
 * Brand carrier — a Shape whose row type should be resolved via
 * `InferModelRow<TContract, ModelName>` rather than the per-field codec
 * walk. Use as `ModelToDocShape<TC, ModelName> & ModelOriginBranded<ModelName>`.
 */
export type ModelOriginBranded<ModelName extends string> = {
  readonly [ModelOriginBrand]?: ModelName;
};

/**
 * Document shape that carries nested value-object sub-shapes.
 *
 * Structurally identical to a flat `DocShape` (`Record<string, DocField>`),
 * but individual values may be `ObjectField<SubShape>` carrying a nested
 * `NestedDocShape` sub-tree. The pipeline builder threads a
 * `NestedDocShape` alongside the flat `DocShape` so the callable
 * `f('a.b.c')` form can validate dot-paths at the type level.
 *
 * When a stage transforms the root shape in a way that invalidates nested
 * paths (e.g. `$group`, `$project`, `$replaceRoot`), the thread is reset
 * to the empty shape `Record<string, never>` — which makes `ValidPaths`
 * resolve to `never` and so disables the callable form downstream.
 */
export type NestedDocShape = Record<string, DocField>;

// ── Contract → NestedDocShape translation ────────────────────────────────

type FieldToLeaf<F> = F extends {
  readonly type: { readonly kind: 'scalar'; readonly codecId: infer C extends string };
  readonly nullable: infer N extends boolean;
}
  ? { readonly codecId: C; readonly nullable: N }
  : F extends {
        readonly many: { readonly elementNullable: boolean };
        readonly nullable: infer N extends boolean;
      }
    ? { readonly codecId: 'mongo/array@1'; readonly nullable: N }
    : DocField;

/**
 * Translate a single contract field to its nested-shape form. Scalars
 * become `DocField` leaves; value-object fields become
 * `ObjectField<Sub>`; list fields stop at a leaf; anything else falls
 * through to the opaque `DocField` base.
 *
 * Kept as a per-field helper (rather than a `Fields → NestedShape` helper
 * that maps over keys internally) so the parent mapped type stays
 * homomorphic over the model/value-object `fields` record. Homomorphic
 * mapped types preserve the literal keys of their source object through
 * TypeScript's intersection-collapsing machinery, which keeps
 * `ModelNestedShape` hover output and `keyof`/indexed-access resolution
 * concrete instead of collapsing to `{ [x: string]: … }`.
 */
type TranslateField<TContract extends MongoContract, F> = F extends {
  readonly many: { readonly elementNullable: boolean };
}
  ? FieldToLeaf<F>
  : F extends {
        readonly type: {
          readonly kind: 'valueObject';
          readonly name: infer VOName extends string;
        };
        readonly nullable: infer Null extends boolean;
      }
    ? ObjectField<VONestedShape<TContract, VOName>> & { readonly nullable: Null }
    : F extends {
          readonly type: { readonly kind: 'scalar'; readonly codecId: string };
        }
      ? FieldToLeaf<F>
      : DocField;

/**
 * Resolve a named value object from the contract into its own
 * `NestedDocShape`. The mapped iteration is inlined here (not delegated
 * to a generic helper) so that the homomorphism over
 * `VOs[VOName]['fields']` is preserved and the hover / indexed-access
 * surface stays concrete at instantiation time.
 */
type VONestedShape<TContract extends MongoContract, VOName extends string> = [
  ContractValueObjectDefinitions<TContract>,
] extends [infer VOs extends Record<string, { readonly fields: Record<string, unknown> }>]
  ? VOName extends keyof VOs & string
    ? {
        readonly [K in keyof VOs[VOName]['fields'] & string]: TranslateField<
          TContract,
          VOs[VOName]['fields'][K]
        >;
      }
    : never
  : never;

/**
 * Build the `NestedDocShape` for a model. Scalar leaves resolve to their
 * concrete codec id; value-object fields recurse into the referenced
 * `valueObjects[VOName].fields` table, producing a tree that
 * `ResolvePath` / `ValidPaths` can walk.
 *
 * The mapped iteration is inlined (not hidden behind a helper type that
 * takes `Fields` as a generic) so TypeScript recognises the mapped type
 * as homomorphic over `MongoModelsMap<TContract>[ModelName]['fields']`. That
 * preserves the literal field-name keys at instantiation — without this,
 * the intersection of `Record<string, ContractField>` and the specific
 * literal field record collapses `keyof` to `string` and the result hover
 * degrades to `{ readonly [x: string]: any }`.
 */
export type ModelNestedShape<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = {
  readonly [K in keyof MongoModelsMap<TContract>[ModelName]['fields'] & string]: TranslateField<
    TContract,
    MongoModelsMap<TContract>[ModelName]['fields'][K]
  >;
};

// ── Path walking ─────────────────────────────────────────────────────────

/**
 * Resolve a dot-path against a `NestedDocShape`. Returns:
 *  - the leaf `DocField` when `Path` terminates on a scalar/array leaf,
 *  - the `ObjectField<Sub>` when `Path` terminates on a value object (so
 *    the caller can operate on the whole sub-document),
 *  - `never` when the path is invalid (unknown segment, or a scalar
 *    segment followed by further traversal).
 *
 * Paired with the constrained callable `<P extends ValidPaths<N>>(path: P)
 * => Expression<ResolvePath<N, P>>` so the IDE offers completions and
 * rejects bad paths with a clear error instead of silently resolving to
 * `never`.
 */
export type ResolvePath<
  N extends NestedDocShape,
  Path extends string,
> = Path extends `${infer Head}.${infer Rest}`
  ? Head extends keyof N & string
    ? N[Head] extends ObjectField<infer Sub>
      ? ResolvePath<Sub, Rest>
      : never
    : never
  : Path extends keyof N & string
    ? N[Path]
    : never;

/**
 * Union of every valid dot-path within a `NestedDocShape`. Includes
 * top-level keys (scalar leaves *and* value-object roots) and every
 * recursive descent through `ObjectField` sub-shapes.
 *
 * Non-leaf paths are intentionally included — `f('address')` yields an
 * `Expression<ObjectField<…>>` whose reduced operator surface (`set`,
 * `unset`, `exists`, `eq(null)`, `ne(null)`) lets callers operate on the
 * whole value object. Leaf paths like `f('address.city')` get the full
 * leaf operator surface.
 *
 * The `string extends keyof N` guard short-circuits to `never` for
 * open-ended index-signature shapes (e.g. the default
 * `Record<string, never>` used to represent "no nested information" —
 * notably downstream of replacement stages in the pipeline builder). An
 * open-ended `keyof` cannot resolve a specific literal path, so the
 * callable form must be disabled at the type level.
 */
export type ValidPaths<N extends NestedDocShape> = string extends keyof N
  ? never
  : {
      [K in keyof N & string]: N[K] extends ObjectField<infer Sub>
        ? K | `${K}.${ValidPaths<Sub>}`
        : K;
    }[keyof N & string];

/**
 * IDE-oriented alias for `ValidPaths`. Kept as a separate export so future
 * refinements (e.g. ArkType-style lazy expansion for very deep shapes) can
 * diverge from the strict `ValidPaths` constraint without breaking
 * downstream consumers. For now the two are intentionally equivalent.
 */
export type PathCompletions<N extends NestedDocShape> = ValidPaths<N>;
