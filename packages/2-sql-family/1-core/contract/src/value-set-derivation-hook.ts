import type { StorageValueSetInput } from './ir/storage-value-set';

/**
 * SQL-family extension to the framework entity-type authoring registry: a pack's entity-type
 * `factory` output (framework `AuthoringEntityTypeFactoryOutput`) may derive a value-set from an
 * entity it built (e.g. Postgres's `native_enum` deriving its ordered member values). The generic
 * extension-block lowering pass (`contract-psl`'s interpreter) probes each entity-type descriptor's
 * output for this hook after building the entity, and folds a non-undefined result into the same
 * namespace's `valueSet` slot, keyed by the entity's block name.
 *
 * SQL-family concept — the returned shape ({@link StorageValueSetInput}) is SQL-specific, so this
 * hook lives here instead of on the framework `AuthoringEntityTypeFactoryOutput` itself.
 */
export interface SqlValueSetDerivingEntityTypeOutput {
  /**
   * TypeScript treats method-syntax declarations bivariantly, so a pack's concretely-typed
   * `deriveValueSet(entity: PostgresNativeEnum) => …` is structurally compatible with this
   * interface's `unknown` parameter — no `never`-parameter contravariance bridge needed.
   */
  deriveValueSet(entity: unknown): StorageValueSetInput | undefined;
}

/** Structural check for {@link SqlValueSetDerivingEntityTypeOutput}: no casts. */
export function providesValueSetDerivation(
  output: unknown,
): output is SqlValueSetDerivingEntityTypeOutput {
  if (typeof output !== 'object' || output === null || !('deriveValueSet' in output)) {
    return false;
  }
  const { deriveValueSet } = output;
  return typeof deriveValueSet === 'function';
}

/**
 * If `output` (an entity-type descriptor's factory output) provides
 * {@link SqlValueSetDerivingEntityTypeOutput.deriveValueSet}, invoke it on `entity` and return the
 * derived value-set; otherwise return `undefined`. `contract-psl`'s generic extension-block
 * lowering pass calls this after building each entity so a value-set-carrying pack entity can
 * contribute its value-set without the pass naming any target discriminator.
 */
export function deriveValueSetFromEntity(
  output: unknown,
  entity: unknown,
): StorageValueSetInput | undefined {
  if (!providesValueSetDerivation(output)) return undefined;
  return output.deriveValueSet(entity);
}
