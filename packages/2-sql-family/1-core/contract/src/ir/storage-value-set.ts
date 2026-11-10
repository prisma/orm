import type { JsonValue } from '@internal/contract/types';
import { freezeNode } from '@internal/framework-components/ir';
import { SqlNode } from './sql-node';

/**
 * Hydration / construction input shape for {@link StorageValueSet}.
 * Mirrors the on-disk storage JSON envelope so the serializer hydration
 * walker can hand a validated literal straight to `new`.
 */
export interface StorageValueSetInput {
  readonly kind: 'valueSet';
  /** Ordered permitted values, codec-encoded. Declaration order is preserved. */
  readonly values: readonly JsonValue[];
}

/**
 * SQL Contract IR node for a value-set entry in a namespace's `valueSet`
 * map (`SqlNamespace.entries.valueSet`).
 *
 * A value-set records the ordered set of permitted codec-encoded values for
 * an enum-like column restriction. It does not carry a `codecId` — the
 * column that references it already holds the codec; the value-set holds
 * only the permitted values.
 *
 * The node's `kind` is enumerable (`'valueSet'`) so the JSON envelope
 * carries the discriminator and the serializer hydration walker can
 * dispatch on it. This follows the per-leaf enumerable-kind convention
 * established in the SQL-node comment (future polymorphic dispatch on
 * namespace entries needs the discriminator in JSON).
 *
 * The entry's name is not on the class — value-sets are keyed by name in
 * the parent namespace's `valueSet: Record<string, StorageValueSet>` map.
 */
export class StorageValueSet extends SqlNode {
  override readonly kind = 'valueSet' as const;
  readonly values: readonly JsonValue[];

  constructor(input: StorageValueSetInput) {
    super();
    this.values = Object.freeze([...input.values]);
    freezeNode(this);
  }
}

export function isStorageValueSet(value: unknown): value is StorageValueSet {
  if (typeof value !== 'object' || value === null) return false;
  return 'kind' in value && value.kind === 'valueSet' && 'values' in value;
}
