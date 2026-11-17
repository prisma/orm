import { runtimeError } from '@internal/framework-components/runtime';
import { canonicalStringify } from '@internal/utils/canonical-stringify';
import { hashContent } from '@internal/utils/hash-content';
import type { MongoExecutionPlan } from './mongo-execution-plan';

/** @internal */
export const RUNTIME_CONTENT_HASH_REQUIRES_RESOLVED_COMMAND =
  'RUNTIME.CONTENT_HASH_REQUIRES_RESOLVED_COMMAND' as const;

/**
 * Resolved wire commands are frozen class instances (`InsertOneWireCommand`, …);
 * pre-resolve `beforeEncode` plans hold a plain-object `MongoLoweredDraft` in the
 * command slot. O(1) prototype check — no tree walk on the hot path.
 */
function isResolvedMongoWireCommand(command: unknown): boolean {
  if (command === null || typeof command !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(command);
  return proto !== null && proto !== Object.prototype;
}

function assertContentHashOnResolvedCommand(command: unknown): void {
  if (isResolvedMongoWireCommand(command)) {
    return;
  }
  throw runtimeError(
    RUNTIME_CONTENT_HASH_REQUIRES_RESOLVED_COMMAND,
    'contentHash and computeMongoContentHash are only valid on a resolved wire command after parameter resolution. During a before hook, plan.command holds an unresolved MongoLoweredDraft — use params.entries() and the param mutator instead of contentHash or structural reads of plan.command.',
    { phase: 'beforeEncode' },
  );
}

/**
 * Computes a stable content hash for a lowered Mongo execution plan.
 *
 * Internally builds an unambiguous canonical-stringified preimage from
 * two components:
 *
 * 1. `meta.storageHash` — discriminates by schema. A migration changes the
 *    storage hash, which invalidates cached entries automatically (no
 *    per-app invalidation logic needed for schema changes).
 * 2. `exec.command` — the wire command. `canonicalStringify` produces a
 *    deterministic serialization that is stable across object key
 *    insertion order and that distinguishes types JSON would otherwise
 *    conflate (e.g. `BigInt(1)` vs `1`, `Date` vs ISO string, `Buffer`
 *    vs number array). The spread converts the frozen wire-command
 *    class instance (`InsertOneWireCommand`, `AggregateWireCommand`, …)
 *    into a plain object exposing its own enumerable properties
 *    (`kind`, `collection`, plus the payload-specific fields like
 *    `document`/`filter`/`update`/`pipeline`/…), which is what
 *    `canonicalStringify` accepts; class instances are rejected
 *    outright to prevent silent collisions.
 *
 * Unlike SQL, there is no separate "rendered statement" component because
 * a Mongo `MongoExecutionPlan.command` is the wire command itself —
 * canonicalizing it captures both structure and parameters in one pass.
 *
 * The components are wrapped in an object and canonicalized as a single
 * unit (rather than concatenated with a delimiter) so component
 * boundaries are unambiguous and cannot collide with a different split
 * of the same characters.
 *
 * The canonical string is then piped through `hashContent` to produce a
 * bounded, opaque digest. See `@internal/utils/hash-content` for the
 * rationale.
 *
 * @throws {RuntimeErrorEnvelope} {@link RUNTIME_CONTENT_HASH_REQUIRES_RESOLVED_COMMAND}
 * when `exec.command` is still a pre-resolve draft (plain object), e.g. when
 * `contentHash` is called from `beforeEncode`.
 *
 * @internal
 */
export function computeMongoContentHash(exec: MongoExecutionPlan): Promise<string> {
  assertContentHashOnResolvedCommand(exec.command);
  return hashContent(
    canonicalStringify({
      storageHash: exec.meta.storageHash,
      command: { ...exec.command },
    }),
  );
}
