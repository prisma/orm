import { defineConfig as ormConfig } from '@internal/cli/config-types';
import type { ControlFamilyInstance } from '@internal/framework-components/control';
import { typescriptContract } from '@internal/sql-contract-ts/config-types';
import { definePrismaConfig } from '@prisma/cli-engine';
import { contract } from './invalid-contract-document';

// Create a config with document family (which doesn't exist, but we'll test the error)
const mockHook = {
  id: 'document',
  validateTypes: () => {},
  validateStructure: () => {},
  generateContractTypes: () => '',
};

export default definePrismaConfig({
  orm: ormConfig({
    family: {
      kind: 'family',
      id: 'document',
      familyId: 'document',
      manifest: { id: 'document', version: '0.0.1' },
      emission: mockHook,
      // Test fixture - mock family instance for testing
      create: () => ({}) as unknown as ControlFamilyInstance<string>,
    },
    target: {
      kind: 'target',
      id: 'mongodb',
      familyId: 'document',
      targetId: 'mongodb',
      manifest: { id: 'mongodb', version: '0.0.1' },
      create: () => ({ familyId: 'document', targetId: 'mongodb' }),
    },
    adapter: {
      kind: 'adapter',
      id: 'mongodb',
      familyId: 'document',
      targetId: 'mongodb',
      manifest: { id: 'mongodb', version: '0.0.1' },
      create: () => ({ familyId: 'document', targetId: 'mongodb' }),
    },
    driver: {
      kind: 'driver',
      id: 'mongodb',
      familyId: 'document',
      targetId: 'mongodb',
      manifest: { id: 'mongodb', version: '0.0.1' },
      create: async () => ({
        targetId: 'mongodb',
        query: async () => ({ rows: [] }),
        close: async () => {},
      }),
    },
    extensions: [],
    contract: typescriptContract(contract, 'output/contract.json'),
  }),
});
