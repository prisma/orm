/**
 * Control-plane descriptor for the paradedb extension.
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
 * {@link import('@internal/framework-components/control').MigrationPackage}
 * shape for the framework's runner / verifier to consume. Readers in
 * `@internal/migration-tools` add `dirPath` when loading from disk
 * (`OnDiskMigrationPackage`); descriptor-bundled packages do not need
 * it because the framework reads them directly from the descriptor.
 *
 * Wired surfaces:
 *
 *   - `contractSpace.{contractJson,migrations,headRef}` — sourced from
 *     the on-disk artefacts emitted by `build:contract-space`.
 *   - `queryOperations` — BM25 full-text search operations registered
 *     via `paradedbQueryOperations()`.
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 *   (contract-space package layout convention).
 */

import type { Contract } from '@internal/contract/types';
import type { SqlControlExtensionDescriptor } from '@internal/family-sql/control';
import { contractSpaceFromJson } from '@internal/migration-tools/spaces';
import type { SqlStorage } from '@internal/sql-contract/types';
import baselineMetadata from '../../migrations/20260601T0000_install_pg_search_extension/migration.json' with {
  type: 'json',
};
import baselineOps from '../../migrations/20260601T0000_install_pg_search_extension/ops.json' with {
  type: 'json',
};
import installMetadata from '../../migrations/20261029T1342_create_pg_search_extension/migration.json' with {
  type: 'json',
};
import installOps from '../../migrations/20261029T1342_create_pg_search_extension/ops.json' with {
  type: 'json',
};
import upgradeMetadata from '../../migrations/20261029T1342_declare_pg_search_extension/migration.json' with {
  type: 'json',
};
import upgradeOps from '../../migrations/20261029T1342_declare_pg_search_extension/ops.json' with {
  type: 'json',
};
import headRef from '../../migrations/refs/head.json' with { type: 'json' };
import contractJson from '../contract.json' with { type: 'json' };
import {
  PARADEDB_BASELINE_MIGRATION_NAME,
  PARADEDB_INSTALL_MIGRATION_NAME,
  PARADEDB_SPACE_ID,
  PARADEDB_UPGRADE_MIGRATION_NAME,
} from '../core/constants';
import { paradedbPackMeta, paradedbQueryOperations } from '../core/descriptor-meta';

const paradedbContractSpace = contractSpaceFromJson<Contract<SqlStorage>>({
  contractJson,
  migrations: [
    { dirName: PARADEDB_BASELINE_MIGRATION_NAME, metadata: baselineMetadata, ops: baselineOps },
    { dirName: PARADEDB_UPGRADE_MIGRATION_NAME, metadata: upgradeMetadata, ops: upgradeOps },
    { dirName: PARADEDB_INSTALL_MIGRATION_NAME, metadata: installMetadata, ops: installOps },
  ],
  headRef,
});

const paradedbExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  ...paradedbPackMeta,
  id: PARADEDB_SPACE_ID,
  contractSpace: paradedbContractSpace,
  queryOperations: () => paradedbQueryOperations(),
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { paradedbExtensionDescriptor, paradedbPackMeta };
export default paradedbExtensionDescriptor;
