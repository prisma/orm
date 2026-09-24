import { fileURLToPath } from 'node:url';
import mongoAdapter from '@internal/adapter-mongo/control';
import type { ContractSourceContext } from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import mongoDriver from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { createControlStack } from '@internal/framework-components/control';
import { type MongoTargetContract, mongoTargetDescriptor } from '@internal/target-mongo/control';
import { prisma6MongoBinding } from '@internal/target-mongo/prisma6-binding';
import { dirname, join, relative } from 'pathe';
import { prisma6Contract } from '../src/provider';

export const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export const mongoStack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
  driver: mongoDriver,
});

/** The same composition `prisma contract emit` builds for a Mongo config. */
export function mongoSourceContext(resolvedInputs: readonly string[]): ContractSourceContext {
  return {
    composedExtensions: mongoStack.extensions.map((extension) => extension.id),
    composedExtensionContracts: mongoStack.extensionContracts,
    authoringContributions: mongoStack.authoringContributions,
    codecLookup: mongoStack.codecLookup,
    dataTypeLookup: mongoStack.dataTypeLookup,
    controlMutationDefaults: mongoStack.controlMutationDefaults,
    resolvedInputs,
    capabilities: mongoStack.capabilities,
  };
}

/**
 * Loads a Prisma 6 schema file or directory through the provider, as `contract emit` does. Diagnostics name the schema by its path relative to the fixtures folder, so expected files hold no machine path.
 */
export function loadPrisma6Schema(absolutePath: string) {
  return prisma6Contract(relative(fixturesDir, absolutePath), {
    binding: prisma6MongoBinding,
  }).source.load(mongoSourceContext([absolutePath]));
}

/** The contract as `contract.json` holds it, after the target serializer checks it as `contract emit` does. */
export function serializeMongoContract(contract: Contract): unknown {
  const serializer = mongoTargetDescriptor.contractSerializer;
  const serialized: unknown = JSON.parse(
    JSON.stringify(serializer.serializeContract(contract as MongoTargetContract)),
  );
  serializer.deserializeContract(serialized);
  return serialized;
}
