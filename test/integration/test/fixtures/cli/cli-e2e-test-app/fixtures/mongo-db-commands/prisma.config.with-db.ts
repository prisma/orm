import mongoAdapter from '@internal/adapter-mongo/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import mongoDriver from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: ormConfig({
    family: mongoFamilyDescriptor,
    target: mongoTargetDescriptor,
    adapter: mongoAdapter,
    driver: mongoDriver,
    extensions: [],
    contract: {
      source: {
        load: async () => ({ ok: true, value: {} }),
      },
      output: 'output/contract.json',
    },
    db: {
      connection: '{{MONGO_URI}}',
    },
  }),
});
