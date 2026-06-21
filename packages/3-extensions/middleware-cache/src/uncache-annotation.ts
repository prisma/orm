import { defineAnnotation } from '@prisma-next/framework-components/runtime';

/**
 * A single cache invalidation action.
 *
 * - `keys` — explicit list of cache keys to delete. Each key is prefixed
 *   with `namespace:` when `namespace` is set.
 * - `models` — invalidates keys previously indexed for these model names.
 * - `tags` — invalidates all keys that have any of these tags.
 * - `namespace` — narrows invalidation to all keys that start with this
 *   prefix (when `keys` is omitted). When both are omitted, all keys in
 *   the store are invalidated.
 */
export interface UncacheAction {
  readonly namespace?: string;
  readonly keys?: readonly string[];
  readonly models?: readonly string[];
  readonly tags?: readonly string[];
}

/**
 * Payload accepted by `uncacheAnnotation` on write terminals.
 *
 * - `enabled` toggles mutation-triggered invalidation for this execution.
 * - `skip` is an explicit passthrough alias to disable invalidation.
 * - `namespace` narrows invalidation to a namespace prefix (single-action
 *   shorthand; ignored when `uncache` is provided).
 * - `uncache` — explicit list of invalidation actions. When provided,
 *   each action is executed in order. Takes precedence over `namespace`.
 */
export interface UncachePayload {
  readonly enabled?: boolean;
  readonly skip?: boolean;
  readonly namespace?: string;
  readonly uncache?: readonly UncacheAction[];
}

/**
 * Write-only annotation handle for mutation-triggered cache invalidation.
 */
export const uncacheAnnotation = defineAnnotation<UncachePayload>()({
  namespace: 'uncache',
  applicableTo: ['write'],
});
