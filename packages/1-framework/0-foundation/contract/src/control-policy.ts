/**
 * Governance posture for a storage-plane node or for the contract as a whole.
 *
 * - `managed`  — Prisma 8 owns the full lifecycle (DDL, migrations, verification).
 * - `tolerated` — node was found in the database but is not schema-managed; Prisma 8
 *   leaves it untouched while tracking its existence.
 * - `external` — node is owned by an external system; Prisma 8 never emits DDL for it.
 * - `observed` — read-only access; Prisma 8 does not write to or migrate the node.
 */
export type ControlPolicy = 'managed' | 'tolerated' | 'external' | 'observed';

/**
 * Resolves the effective control policy for a storage-plane node.
 *
 * Precedence: node-level value → contract default → `'managed'`.
 *
 * Both parameters are optional raw values so this function stays node-type-agnostic
 * and can be called by any consumer (verifier, planner, etc.) without importing IR classes.
 */
export function effectiveControlPolicy(
  nodeControl: ControlPolicy | undefined,
  defaultControlPolicy: ControlPolicy | undefined,
): ControlPolicy {
  return nodeControl ?? defaultControlPolicy ?? 'managed';
}

/**
 * The control policy that governs one storage object: what a planner may change in it and, in MongoDB, whether its contract describes a validator and how the verifier grades it. An `external` contract default is a floor that no object's own policy can raise ([ADR 224](../../../../../docs/architecture%20docs/adrs/ADR%20224%20-%20Control%20Policy%20%E2%80%94%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md)); otherwise this is {@link effectiveControlPolicy}.
 */
export function governingControlPolicy(
  subject: { readonly explicitNodeControlPolicy?: ControlPolicy | undefined } | undefined,
  defaultControlPolicy: ControlPolicy | undefined,
): ControlPolicy {
  if (defaultControlPolicy === 'external') {
    return 'external';
  }
  return effectiveControlPolicy(subject?.explicitNodeControlPolicy, defaultControlPolicy);
}
