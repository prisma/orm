/**
 * Control-plane descriptor for the pgvector extension.
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
import baselineMetadata from '../../migrations/20260601T0000_install_vector_extension/migration.json' with {
  type: 'json',
};
import baselineOps from '../../migrations/20260601T0000_install_vector_extension/ops.json' with {
  type: 'json',
};
import headRef from '../../migrations/refs/head.json' with { type: 'json' };
import contractJson from '../contract.json' with { type: 'json' };
import { PGVECTOR_SPACE_ID } from '../core/contract-space-constants';
import { pgvectorPackMeta, pgvectorQueryOperations } from '../core/descriptor-meta';

const PGVECTOR_CODEC_ID = 'pg/vector@1' as const;
const BASELINE_DIR_NAME = '20260601T0000_install_vector_extension';

function buildVectorIdentityValue(typeParams: Record<string, unknown> | undefined): string | null {
  const length = typeParams?.['length'];
  if (typeof length !== 'number' || !Number.isInteger(length) || length <= 0) {
    return null;
  }

  const zeroVector = `[${new Array(length).fill('0').join(',')}]`;
  return `'${zeroVector}'::vector`;
}

const vectorControlPlaneHooks: CodecControlHooks = {
  resolveIdentityValue: ({ typeParams }) => buildVectorIdentityValue(typeParams),
};

const pgvectorContractSpace = contractSpaceFromJson<Contract<SqlStorage>>({
  contractJson,
  migrations: [
    {
      dirName: BASELINE_DIR_NAME,
      metadata: baselineMetadata,
      ops: baselineOps,
    },
  ],
  headRef,
});

const pgvectorExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  ...pgvectorPackMeta,
  id: PGVECTOR_SPACE_ID,
  contractSpace: pgvectorContractSpace,
  types: {
    ...pgvectorPackMeta.types,
    codecTypes: {
      ...pgvectorPackMeta.types.codecTypes,
      controlPlaneHooks: {
        [PGVECTOR_CODEC_ID]: vectorControlPlaneHooks,
      },
    },
  },
  queryOperations: () => pgvectorQueryOperations(),
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { pgvectorExtensionDescriptor };
export default pgvectorExtensionDescriptor;
