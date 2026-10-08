/**
 * Control-plane descriptor for the postgis extension.
 *
 * **Contract-space package layout.** The extension's contract
 * + migrations are emitted by the same pipeline application authors use:
 *
 *   `prisma contract emit` → `<package>/src/contract.{json,d.ts}`
 *   `prisma migration plan` → `<package>/migrations/<dir>/...`
 *
 * The descriptor wires those JSON artefacts via JSON-import declarations
 * so they flow through the consuming application's module resolver
 * without filesystem assumptions, and synthesises the canonical
 * `MigrationPackage` shape for the framework's runner / verifier to
 * consume.
 *
 * Wired surfaces:
 *
 *   - `contractSpace.{contractJson,migrations,headRef}` — sourced from
 *     the on-disk artefacts emitted by `build:contract-space`.
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 *   (contract-space package layout convention).
 */

import type { Contract } from '@internal/contract/types';
import type {
  CodecControlHooks,
  SqlControlExtensionDescriptor,
} from '@internal/family-sql/control';
import { contractSpaceFromJson } from '@internal/migration-tools/spaces';
import type { SqlStorage } from '@internal/sql-contract/types';
import baselineMetadata from '../../migrations/20260601T0000_install_postgis_extension/migration.json' with {
  type: 'json',
};
import baselineOps from '../../migrations/20260601T0000_install_postgis_extension/ops.json' with {
  type: 'json',
};
import headRef from '../../migrations/refs/head.json' with { type: 'json' };
import contractJson from '../contract.json' with { type: 'json' };
import { POSTGIS_GEOMETRY_CODEC_ID } from '../core/constants';
import {
  POSTGIS_BASELINE_MIGRATION_NAME,
  POSTGIS_SPACE_ID,
} from '../core/contract-space-constants';
import { postgisPackMeta, postgisQueryOperations } from '../core/descriptor-meta';

const geometryControlPlaneHooks: CodecControlHooks = {
  // PostGIS has no canonical "identity" geometry; backfilling a
  // non-null column requires the user to supply a valid value, so we
  // don't synthesise one here.
  resolveIdentityValue: () => null,
};

const postgisContractSpace = contractSpaceFromJson<Contract<SqlStorage>>({
  contractJson,
  migrations: [
    {
      dirName: POSTGIS_BASELINE_MIGRATION_NAME,
      metadata: baselineMetadata,
      ops: baselineOps,
    },
  ],
  headRef,
});

const postgisExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  ...postgisPackMeta,
  id: POSTGIS_SPACE_ID,
  contractSpace: postgisContractSpace,
  types: {
    ...postgisPackMeta.types,
    codecTypes: {
      ...postgisPackMeta.types.codecTypes,
      controlPlaneHooks: {
        [POSTGIS_GEOMETRY_CODEC_ID]: geometryControlPlaneHooks,
      },
    },
  },
  queryOperations: () => postgisQueryOperations(),
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { postgisExtensionDescriptor };
export default postgisExtensionDescriptor;
