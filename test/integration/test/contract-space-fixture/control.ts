/**
 * Control-plane descriptor for the synthetic test extension.
 *
 * Exposes a `contractSpace` so the framework's per-space planner / runner /
 * verifier (project: extension-contract-spaces, M1) can be exercised
 * end-to-end against a fixture — without taking on the baggage (vendored
 * bundle SQL, codec hooks, native extension installs) that real consumers
 * like cipherstash or pgvector carry.
 *
 * Hosted as a fixture under the integration-tests workspace rather than as
 * a top-level `@internal/extension-*` package: the package shape is
 * incidental, not load-bearing for the test surface, and the
 * `extension-` prefix is reserved for production extensions (see project
 * review F1).
 */

import type { Contract } from '@internal/contract/types';
import type { SqlControlExtensionDescriptor } from '@internal/family-sql/control';
import type { ContractSpace } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import postgresTargetDescriptor from '@internal/target-postgres/control';
import { blindCast } from '@internal/utils/casts';
import { TEST_SPACE_ID } from './constants';
import { testContractSpaceContract } from './contract';
import { testContractSpaceBaselineMigration, testContractSpaceHeadRef } from './migrations';

const testContractSpace: ContractSpace<Contract<SqlStorage>> = {
  contractJson: blindCast<
    Contract<SqlStorage>,
    'an extension descriptor carries its stored contract.json'
  >(postgresTargetDescriptor.contractSerializer.serializeContract(testContractSpaceContract)),
  migrations: [testContractSpaceBaselineMigration],
  headRef: testContractSpaceHeadRef,
};

const testContractSpaceExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: TEST_SPACE_ID,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  version: '0.0.1',
  contractSpace: testContractSpace,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { testContractSpaceExtensionDescriptor };
export default testContractSpaceExtensionDescriptor;
