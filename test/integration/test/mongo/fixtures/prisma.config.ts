import mongoAdapter from '@internal/adapter-mongo/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import type { Contract } from '@internal/contract/types';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { ok } from '@internal/utils/result';
import { definePrismaConfig } from '@prisma/cli-engine';
import { contract } from './contract';

export default definePrismaConfig({
  orm: ormConfig({
    family: mongoFamilyDescriptor,
    target: mongoTargetDescriptor,
    adapter: mongoAdapter,
    contract: {
      source: {
        load: async () => ok(contract as Contract),
      },
      output: 'generated/contract.json',
    },
  }),
});
