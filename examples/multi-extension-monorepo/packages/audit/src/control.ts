/**
 * Control-plane descriptor for the internal `audit` contract-space
 * package.
 *
 * The package's contract + migrations are emitted by the same pipeline
 * application authors use:
 *
 *   `prisma contract emit` → `<package>/src/contract.{json,d.ts}`
 *   `prisma migration plan` → `<package>/migrations/<dir>/...`
 *
 * The descriptor wires those JSON artefacts via JSON-import declarations
 * so they flow through the consuming application's module resolver, and
 * synthesises the canonical
 * {@link import('@prisma/orm-postgres/components/control').MigrationPackage}
 * shape for the framework's runner / verifier to consume.
 *
 * @see docs/architecture docs/adrs/ADR 212 - Contract spaces.md
 *   (contract-space package layout convention).
 */

import type {
  ContractSpace,
  MigrationMetadata,
  MigrationPackage,
  MigrationPlanOperation,
} from '@prisma/orm-postgres/components/control';
import type { Contract } from '@prisma/orm-postgres/contract/types';
import type { SqlControlExtensionDescriptor } from '@prisma/orm-postgres/family/control';
import type { SqlStorage } from '@prisma/orm-postgres/family-contract/types';
import baselineMetadata from '../migrations/20260601T0000_create_audit_event/migration.json' with {
  type: 'json',
};
import baselineOps from '../migrations/20260601T0000_create_audit_event/ops.json' with {
  type: 'json',
};
import headRef from '../migrations/refs/head.json' with { type: 'json' };
import { AUDIT_BASELINE_MIGRATION_NAME, AUDIT_SPACE_ID } from './constants';
import contractJson from './contract.json' with { type: 'json' };

// JSON-imported values lose the workspace's branded types, so we cast
// through `unknown` here. The values are the same canonical artefacts
// the application's contract / migration runners produce and re-validate
// at runtime — this descriptor is just a pass-through wiring layer.
const baselinePackage: MigrationPackage = {
  dirName: AUDIT_BASELINE_MIGRATION_NAME,
  metadata: baselineMetadata as unknown as MigrationMetadata,
  ops: baselineOps as unknown as readonly MigrationPlanOperation[],
};

const auditContractSpace: ContractSpace<Contract<SqlStorage>> = {
  contractJson: contractJson as unknown as Contract<SqlStorage>,
  migrations: [baselinePackage],
  headRef,
};

const auditExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: AUDIT_SPACE_ID,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  version: '0.0.1',
  contractSpace: auditContractSpace,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { auditExtensionDescriptor };
export default auditExtensionDescriptor;
