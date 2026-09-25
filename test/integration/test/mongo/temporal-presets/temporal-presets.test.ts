import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoAdapter from '@internal/adapter-mongo/control';
import type { ContractSourceContext } from '@internal/cli/config-types';
import { enrichContract } from '@internal/cli/control-api';
import type { SerializeContract } from '@internal/contract/hashing';
import type { Contract as FrameworkContract } from '@internal/contract/types';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { createControlStack } from '@internal/framework-components/control';
import { mongoContractCanonicalizationHooks } from '@internal/mongo-contract/canonicalization-hooks';
import { mongoContract } from '@internal/mongo-contract-psl/provider';
import { type MongoTargetContract, mongoTargetDescriptor } from '@internal/target-mongo/control';
import { timeouts } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { emit } from '../../../utils/emit';
import type { Contract } from './_fixture/generated/contract';
import emittedContractJson from './_fixture/generated/contract.json' with { type: 'json' };

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '_fixture');

const mongoStack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
});

const sourceContext: ContractSourceContext = {
  composedExtensions: [],
  composedExtensionContracts: new Map(),
  authoringContributions: mongoStack.authoringContributions,
  codecLookup: mongoStack.codecLookup,
  dataTypeLookup: mongoStack.dataTypeLookup,
  controlMutationDefaults: mongoStack.controlMutationDefaults,
  resolvedInputs: [],
  capabilities: mongoStack.capabilities,
};

const serializeContract: SerializeContract = (contract) =>
  mongoTargetDescriptor.contractSerializer.serializeContract(contract as MongoTargetContract);

async function emitNormalized(contract: FrameworkContract): Promise<Record<string, unknown>> {
  const familyInstance = mongoFamilyDescriptor.create(mongoStack);
  const normalized = familyInstance.deserializeContract(
    enrichContract(contract, [mongoTargetDescriptor, mongoAdapter]),
  );
  const emitted = await emit(normalized, mongoStack, mongoFamilyDescriptor.emission, {
    serializeContract,
    ...mongoContractCanonicalizationHooks,
  });
  return JSON.parse(emitted.contractJson) as Record<string, unknown>;
}

/**
 * PSL and TS authoring hash different storage projections and derive validators differently (a gap
 * that predates execution defaults), so the comparison leaves out `storage.storageHash` and each
 * collection's `validator`. Everything else, `execution` and its hash included, must match.
 */
function withoutKnownStorageGap(contractJson: Record<string, unknown>): Record<string, unknown> {
  const storage = contractJson['storage'] as Record<string, unknown>;
  const namespaces = storage['namespaces'] as Record<string, Record<string, unknown>>;
  const strippedNamespaces = Object.fromEntries(
    Object.entries(namespaces).map(([id, namespace]) => {
      const entries = namespace['entries'] as {
        collection: Record<string, Record<string, unknown>>;
      };
      const collection = Object.fromEntries(
        Object.entries(entries.collection).map(([name, { validator: _, ...rest }]) => [name, rest]),
      );
      return [id, { ...namespace, entries: { ...entries, collection } }];
    }),
  );
  const { storageHash: _, ...restStorage } = storage;
  return { ...contractJson, storage: { ...restStorage, namespaces: strippedNamespaces } };
}

describe('Mongo temporal presets from PSL and TS', () => {
  it(
    'emit the same contract, execution section and hash included',
    async () => {
      const pslPath = join(fixtureDir, 'contract.prisma');
      const pslResult = await mongoContract(pslPath).source.load({
        ...sourceContext,
        resolvedInputs: [pslPath],
      });
      if (!pslResult.ok) throw new Error(JSON.stringify(pslResult.failure));
      const { contract: tsContract } = (await import(
        pathToFileURL(join(fixtureDir, 'contract.ts')).href
      )) as { readonly contract: FrameworkContract };

      const fromPsl = await emitNormalized(pslResult.value);
      const fromTs = await emitNormalized(tsContract);

      expect(fromPsl['execution']).toEqual(emittedContractJson.execution);
      expect(fromTs['execution']).toEqual(fromPsl['execution']);
      expect(withoutKnownStorageGap(fromTs)).toEqual(withoutKnownStorageGap(fromPsl));
    },
    timeouts.typeScriptCompilation,
  );

  it('types the emitted execution refs with the collection and stored field names', () => {
    type Refs = Contract['execution']['mutations']['defaults'][number]['ref'];
    expectTypeOf<Refs['entry']>().toEqualTypeOf<'events' | 'posts'>();
    expectTypeOf<Refs['field']>().toEqualTypeOf<'createdAt' | 'touchedAt' | 'updated_at'>();
    expectTypeOf<Refs['namespace']>().toEqualTypeOf<'__unbound__'>();
  });
});
