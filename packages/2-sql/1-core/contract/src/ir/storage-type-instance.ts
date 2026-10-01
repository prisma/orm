import type { StorageType } from '@internal/framework-components/ir';

/**
 * Sentinel kind for the legacy codec-triple shape persisted under
 * `SqlStorage.types`. Plain JSON-clean object literals carry this
 * discriminator so the polymorphic slot dispatch can route them down
 * the codec path while target-specific IR class instances (e.g. the
 * Postgres enum class) keep their own narrower `kind` literal.
 */
export const CODEC_INSTANCE_KIND = 'codec-instance' as const;

/**
 * Structural sub-interface of {@link StorageType} for codec-typed entries
 * in `SqlStorage.types`. These are plain object literals — there is no
 * runtime IR class, the JSON envelope round-trips through the slot
 * unchanged. The `kind: 'codec-instance'` discriminator is the dispatch
 * key that distinguishes codec-typed entries from any class-instance
 * kinds a target pack contributes to the polymorphic slot.
 */
export interface StorageTypeInstance extends StorageType {
  readonly kind: typeof CODEC_INSTANCE_KIND;
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams: Record<string, unknown>;
}

/**
 * Construction-time input for a codec-triple entry. Symmetric with the
 * structural runtime shape minus the `kind` discriminator — callers may
 * omit `kind`; the helper {@link toStorageTypeInstance} stamps it on.
 * `typeParams` may be omitted on input; the constructor normalises a
 * missing value to `{}` so the in-memory shape is always present.
 */
export interface StorageTypeInstanceInput {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams?: Record<string, unknown>;
}

/**
 * Stamp the codec-instance `kind` discriminator on a caller-supplied
 * codec triple. Idempotent: input that already carries the discriminator
 * passes through unchanged. Missing `typeParams` is normalised to `{}`.
 */
export function toStorageTypeInstance(input: StorageTypeInstanceInput): StorageTypeInstance {
  return {
    kind: CODEC_INSTANCE_KIND,
    codecId: input.codecId,
    nativeType: input.nativeType,
    typeParams: input.typeParams ?? {},
  };
}

/**
 * The type parameters of a type written with its own parameters or by the name of a named type: its own, or else the named type's. Empty parameters read as none, as a codec reads them; {@link toStorageTypeInstance} stores `{}` for a codec without parameters.
 */
export function resolvedTypeParams(
  type: {
    readonly typeParams?: Record<string, unknown> | undefined;
    readonly typeRef?: string | undefined;
  },
  namedTypes: Readonly<Record<string, Pick<StorageTypeInstanceInput, 'typeParams'>>> | undefined,
): Record<string, unknown> | undefined {
  const typeParams =
    type.typeParams ??
    (type.typeRef === undefined ? undefined : namedTypes?.[type.typeRef]?.typeParams);
  return typeParams !== undefined && Object.keys(typeParams).length > 0 ? typeParams : undefined;
}

/**
 * Type-guard for codec-typed entries on the polymorphic
 * `SqlStorage.types` slot. Distinguishes `StorageTypeInstance` from
 * any class-instance kinds a target pack contributes.
 */
export function isStorageTypeInstance(value: unknown): value is StorageTypeInstance {
  if (typeof value !== 'object' || value === null) return false;
  return (value as { kind?: unknown }).kind === CODEC_INSTANCE_KIND;
}
