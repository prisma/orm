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
 * A codec-typed entry in `SqlStorage.types`, as `contract.json` stores it and the contract IR holds it. These are plain object literals with no runtime IR class; the JSON envelope round-trips through the slot unchanged. The `kind: 'codec-instance'` discriminator distinguishes them from any class-instance kinds a target pack contributes to the slot.
 */
export interface StorageTypeInstance extends StorageType {
  readonly kind: typeof CODEC_INSTANCE_KIND;
  readonly codecId: string;
  readonly dataType: string;
  readonly typeParams: Record<string, unknown>;
}

/**
 * A `storage.types` entry as authored, by a `type.*` helper or a PSL `types {}` alias: a {@link StorageTypeInstance} before the contract build adds the id of the data type its codec represents.
 */
export type AuthoredStorageType = Omit<StorageTypeInstance, 'dataType'>;

/**
 * A `storage.types` entry as `SqlStorage` and {@link toStorageTypeInstance} take it: a {@link StorageTypeInstance} whose `kind` and `typeParams` may be left out. {@link toStorageTypeInstance} stamps the `kind` and normalises a missing `typeParams` to `{}`.
 */
export type StorageTypeInstanceInput = Omit<StorageTypeInstance, 'kind' | 'typeParams'> & {
  readonly typeParams?: Record<string, unknown>;
};

/**
 * Stamp the codec-instance `kind` discriminator on a caller-supplied
 * codec triple. Idempotent: input that already carries the discriminator
 * passes through unchanged. Missing `typeParams` is normalised to `{}`.
 */
export function toStorageTypeInstance(input: StorageTypeInstanceInput): StorageTypeInstance {
  return {
    kind: CODEC_INSTANCE_KIND,
    codecId: input.codecId,
    dataType: input.dataType,
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
