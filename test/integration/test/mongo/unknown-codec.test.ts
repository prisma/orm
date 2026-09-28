import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import mongoAdapter from '@internal/adapter-mongo/control';
import type { ContractSourceContext } from '@internal/cli/config-types';
import {
  type MongoControlExtensionDescriptor,
  mongoFamilyDescriptor,
} from '@internal/family-mongo/control';
import { createControlStack } from '@internal/framework-components/control';
import { mongoContract } from '@internal/mongo-contract-psl/provider';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const moneyExtension: MongoControlExtensionDescriptor = {
  kind: 'extension',
  id: 'money',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  authoring: {
    type: {
      Money: {
        kind: 'typeConstructor',
        output: { codecId: 'money/cents@1', nativeType: 'long' },
      },
    },
  },
  create: () => ({ familyId: 'mongo', targetId: 'mongo' }),
};

const mongoStack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
  extensions: [moneyExtension],
});

const sourceContext: ContractSourceContext = {
  composedExtensions: ['money'],
  composedExtensionContracts: new Map(),
  authoringContributions: mongoStack.authoringContributions,
  codecLookup: mongoStack.codecLookup,
  dataTypeLookup: mongoStack.dataTypeLookup,
  controlMutationDefaults: mongoStack.controlMutationDefaults,
  resolvedInputs: [],
  capabilities: mongoStack.capabilities,
};

describe('Mongo PSL field whose codec is not registered', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mongo-unknown-codec-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('fails the contract load and names the model, field and codec', async () => {
    const schemaPath = join(dir, 'contract.prisma');
    await writeFile(
      schemaPath,
      `// use prisma-8

model Order {
  id    ObjectId @id @map("_id")
  price Money
}
`,
    );

    const result = await mongoContract(schemaPath).source.load({
      ...sourceContext,
      resolvedInputs: [schemaPath],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_UNKNOWN_FIELD_CODEC',
        message:
          'Field "Order.price" type "Money" uses codec "money/cents@1", which is not registered by any composed component',
      }),
    ]);
  });
});
