/**
 * Control-plane extension descriptor for arktype-json.
 *
 * Composes pack metadata and the control-plane hooks into the migration-
 * plane shape the framework's control stack consumes. Lives at the
 * control-plane entrypoint so `src/core/**` stays free of migration-plane
 * imports (per `.cursor/rules/multi-plane-entrypoints.mdc`).
 */

import type { SqlControlExtensionDescriptor } from '@internal/family-sql/control';
import { arktypeJsonPackMeta } from '../core/pack-meta';

export const arktypeJsonExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  ...arktypeJsonPackMeta,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export default arktypeJsonExtensionDescriptor;
