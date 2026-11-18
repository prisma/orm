/**
 * Capability matrix merge primitive shared by emit-time and runtime stack composition.
 *
 * The CLI's `enrichContract` and the SQL runtime's `createExecutionContext` both need
 * to fold a stack of component descriptors' `capabilities` declarations into a single
 * matrix keyed by namespace. Keeping the primitive here lets both call sites stay
 * byte-for-byte consistent without one depending on the other.
 */

import { compareCodeUnits } from '@internal/contract/hashing-utils';
import { blindCast } from '@internal/utils/casts';

export type CapabilityMatrix = Record<string, Record<string, boolean>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const entries = Object.entries(value).sort(([a], [b]) => compareCodeUnits(a, b));
  const next: Record<string, unknown> = {};
  for (const [key, child] of entries) {
    next[key] = sortDeep(child);
  }
  return next;
}

function extractCapabilityMatrix(value: unknown): CapabilityMatrix {
  if (!isPlainObject(value)) return {};

  const out: CapabilityMatrix = {};
  for (const [namespace, maybeCaps] of Object.entries(value)) {
    if (!isPlainObject(maybeCaps)) continue;
    const caps: Record<string, boolean> = {};
    for (const [key, flag] of Object.entries(maybeCaps)) {
      if (typeof flag === 'boolean') {
        caps[key] = flag;
      }
    }
    if (Object.keys(caps).length > 0) {
      out[namespace] = caps;
    }
  }

  return out;
}

/**
 * Merge an ordered list of contributor capability declarations into a base matrix.
 *
 * Behaviour:
 * - `base` and each contributor's `capabilities` are filtered through the same
 *   structural extraction: non-plain-object namespace blocks are dropped,
 *   non-boolean leaves inside a namespace block are dropped, and a namespace
 *   block that ends up with zero boolean leaves is omitted entirely (so a
 *   later contributor with a malformed namespace cannot erase a namespace
 *   already present in `base`).
 * - Non-plain-object `capabilities` on a contributor (including `undefined`,
 *   `null`, arrays, primitives) are skipped silently — the contributor
 *   contributes nothing.
 * - Later contributors win on `(namespace, key)` collisions.
 * - The returned object is fresh — neither `base` nor any contributor is mutated.
 * - Output keys are sorted lexicographically at every plain-object level.
 */
export function mergeCapabilityMatrices(
  base: Record<string, Record<string, boolean>>,
  contributors: ReadonlyArray<{ readonly capabilities?: unknown }>,
): Record<string, Record<string, boolean>> {
  const merged: CapabilityMatrix = extractCapabilityMatrix(base);

  for (const contributor of contributors) {
    const extracted = extractCapabilityMatrix(contributor.capabilities);
    for (const [namespace, capabilities] of Object.entries(extracted)) {
      merged[namespace] = {
        ...(merged[namespace] ?? {}),
        ...capabilities,
      };
    }
  }

  return blindCast<
    CapabilityMatrix,
    "sortDeep preserves the matrix shape but the recursive generic relationship can't be expressed to TS"
  >(sortDeep(merged));
}
