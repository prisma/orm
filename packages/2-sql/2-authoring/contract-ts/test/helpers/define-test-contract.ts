import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { createTestSqlNamespace } from '../../../../1-core/contract/test/test-support';
import { type ContractInput, defineContract } from '../../src/contract-builder';

const bareFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

/** `defineContract` with a bare SQL family and a Postgres target, for tests about field authoring. */
export function defineTestContract<
  const Definition extends Omit<ContractInput, 'target' | 'family' | 'createNamespace'>,
>(definition: Definition) {
  return defineContract({
    family: bareFamilyPack,
    target: postgresTargetPack,
    createNamespace: createTestSqlNamespace,
    ...definition,
  });
}
