/**
 * SQL-family extension to the pack authoring contributions: a pack whose
 * `entityTypes` registers entity kinds may implement a batch lowering hook
 * that turns author-declared pack-entity handles (the generic `entities`
 * list on the TS contract input) into `entries` rows.
 *
 * The generic contract build (`contract-ts`) owns the kind-agnostic walk: it
 * groups handles by the pack that registered each `entityKind`, resolves
 * each handle's declared model refs to storage table coordinates using the
 * same model→table maps the relation lowering uses, and calls the owning
 * pack's hook once with all of its claimed handles — batch, so the hook's
 * diagnostics can see sibling handles. Neither the walk nor these types name
 * any specific entity kind.
 *
 * SQL-family concept — the resolved-ref shape is a table coordinate, so the
 * hook lives here beside {@link ../value-set-derivation-hook} instead of on
 * the framework contributions type.
 */

/**
 * An authored pack-entity handle: branded by the `entityKind` its owning
 * pack registered, optionally declaring model refs under `refs` (actual
 * model-handle objects, resolved by the generic walk before lowering).
 */
export interface PackEntityHandle {
  readonly entityKind: string;
  readonly refs?: Readonly<Record<string, unknown>>;
}

/**
 * A declared model ref after the generic walk resolved it: a storage table
 * coordinate for a model of this contract, the coordinate plus `spaceId` for
 * a cross-space (extensionModel) handle, or `unresolved` when the handle
 * does not correspond to any model in the contract. `modelName` is carried
 * for diagnostics where the handle declares one.
 */
export type ResolvedEntityHandleRef =
  | {
      readonly kind: 'resolved';
      readonly namespaceId: string;
      readonly tableName: string;
      readonly modelName?: string;
    }
  | {
      readonly kind: 'cross-space';
      readonly spaceId: string;
      readonly namespaceId: string;
      readonly tableName: string;
      readonly modelName?: string;
    }
  | {
      readonly kind: 'unresolved';
      readonly modelName?: string;
    };

/** One claimed handle paired with its resolved declared refs. */
export interface ResolvedPackEntityHandle {
  readonly handle: PackEntityHandle;
  readonly refs: Readonly<Record<string, ResolvedEntityHandleRef>>;
}

export interface EntityHandleLoweringInput {
  /** Every handle in the `entities` list whose `entityKind` this pack registered, in authored order. */
  readonly handles: readonly ResolvedPackEntityHandle[];
  readonly defaultNamespaceId: string;
}

/** One lowered entity row: filed into `storage.namespaces[namespaceId].entries[entityKind][key]`. */
export interface LoweredPackEntity {
  readonly namespaceId: string;
  readonly entityKind: string;
  readonly key: string;
  readonly entity: unknown;
}

export interface SqlEntityHandleLoweringContribution {
  /**
   * Method syntax keeps the declaration bivariant, so a pack's concretely
   * typed implementation stays structurally compatible (the same convention
   * as `SqlValueSetDerivingEntityTypeOutput.deriveValueSet`).
   */
  lowerEntityHandles(input: EntityHandleLoweringInput): readonly LoweredPackEntity[];
}

/** Structural check for {@link SqlEntityHandleLoweringContribution}: no casts. */
export function providesEntityHandleLowering(
  authoring: unknown,
): authoring is SqlEntityHandleLoweringContribution {
  if (typeof authoring !== 'object' || authoring === null || !('lowerEntityHandles' in authoring)) {
    return false;
  }
  const { lowerEntityHandles } = authoring;
  return typeof lowerEntityHandles === 'function';
}

/**
 * PSL-side twin of {@link ResolvedEntityHandleRef}: the family interpreter
 * projects an extension block's already-selected model references onto
 * storage coordinates and annotates the block with this map (keyed by
 * parameter name) before invoking the entity factory. The projection reads
 * the selected declaration's identity — never a second name lookup — so a
 * factory consumes the exact namespace/table the reference resolved to.
 */
export type ResolvedPslModelRefs = Readonly<
  Record<string, { readonly namespaceId: string; readonly tableName: string }>
>;

/**
 * SQL-family extension to a pack's entity-type factory output: the PSL
 * extension-block walk may ask the output where to file the built entity's
 * {@link LoweredPackEntity} row. Outputs without the hook keep the block's
 * lexical owner namespace. The hook picks only the destination namespace —
 * `entityKind` and `key` stay fixed by the walk — and is trusted pack
 * authoring code, like {@link SqlValueSetDerivingEntityTypeOutput}: it never
 * interprets expressions or validates source.
 */
export interface SqlPslEntityPlacementOutput {
  /**
   * Method syntax keeps the declaration bivariant, so a pack's concretely
   * typed implementation stays structurally compatible (the same convention
   * as `SqlValueSetDerivingEntityTypeOutput.deriveValueSet`).
   */
  pslPlacement(entity: unknown): Pick<LoweredPackEntity, 'namespaceId'>;
}

/** Structural check for {@link SqlPslEntityPlacementOutput}: no casts. */
export function providesPslEntityPlacement(output: unknown): output is SqlPslEntityPlacementOutput {
  if (typeof output !== 'object' || output === null || !('pslPlacement' in output)) {
    return false;
  }
  const { pslPlacement } = output;
  return typeof pslPlacement === 'function';
}
