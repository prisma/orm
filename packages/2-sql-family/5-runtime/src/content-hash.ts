import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { canonicalStringify } from '@internal/utils/canonical-stringify';
import { hashContent } from '@internal/utils/hash-content';

/**
 * Computes a stable content hash for a lowered SQL execution plan.
 *
 * Internally builds an unambiguous canonical-stringified preimage from
 * three components:
 *
 * 1. `meta.storageHash` — discriminates by schema. A migration changes the
 *    storage hash, which invalidates cached entries automatically.
 * 2. `exec.sql` — the raw lowered SQL text. Two queries with different
 *    structure produce different keys. Note that we deliberately do **not**
 *    use `computeSqlFingerprint` here: that helper strips literals to group
 *    executions by statement shape (used by telemetry), which is the
 *    opposite of what a content hash needs — we want per-execution
 *    discrimination, not per-statement-shape grouping.
 * 3. `exec.params` — the bound parameters. `canonicalStringify` produces a
 *    deterministic serialization that is stable across object key
 *    insertion order and that distinguishes types JSON would otherwise
 *    conflate (e.g. `BigInt(1)` vs `1`).
 *
 * The components are wrapped in an object and canonicalized as a single
 * unit (rather than concatenated with a delimiter) so component
 * boundaries are unambiguous: any character appearing inside `sql` or
 * `storageHash` cannot bleed across components and produce a collision
 * with a different split of the same characters.
 *
 * The canonical string is then piped through `hashContent` to produce a
 * bounded, opaque digest. See `@internal/utils/hash-content` for the
 * rationale.
 *
 * @internal
 */
export function computeSqlContentHash(exec: SqlExecutionPlan): Promise<string> {
  return hashContent(
    canonicalStringify({
      storageHash: exec.meta.storageHash,
      sql: exec.sql,
      params: exec.params,
    }),
  );
}
