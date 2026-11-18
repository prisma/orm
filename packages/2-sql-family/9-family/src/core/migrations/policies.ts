import type { MigrationOperationPolicy } from '@internal/framework-components/control';

/**
 * Policy used by `db init`: additive-only operations, no widening/destructive steps.
 */
export const INIT_ADDITIVE_POLICY: MigrationOperationPolicy = Object.freeze({
  allowedOperationClasses: Object.freeze(['additive'] as const),
});
