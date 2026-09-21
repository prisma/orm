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
