import { fileURLToPath } from 'node:url';
import { computeStorageHash } from '@internal/contract/hashing';
import { mongoContractCanonicalizationHooks } from '@internal/mongo-contract/canonicalization-hooks';
import { mongoContract } from '@internal/mongo-contract-psl/provider';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { loadPrisma6Schema, mongoSourceContext, serializeMongoContract } from './support';

const parityDir = join(dirname(fileURLToPath(import.meta.url)), 'parity');

type SerializedContract = {
  readonly storage: {
    readonly storageHash: string;
    readonly namespaces: Record<
      string,
      {
        readonly id: string;
        readonly entries: { readonly collection: Record<string, Record<string, unknown>> };
      }
    >;
  };
} & Record<string, unknown>;

/** The contract without its collection validators, which the Prisma 6 reader never emits, and without the storage hash they feed. */
function withoutValidators(contract: SerializedContract) {
  const namespaces = Object.fromEntries(
    Object.entries(contract.storage.namespaces).map(([id, namespace]) => [
      id,
      {
        ...namespace,
        entries: {
          ...namespace.entries,
          collection: Object.fromEntries(
            Object.entries(namespace.entries.collection).map(
              ([name, { validator: _, ...rest }]) => [name, rest],
            ),
          ),
        },
      },
    ]),
  );
  const { storageHash: _, ...storage } = contract.storage;
  return { ...contract, storage: { ...storage, namespaces } };
}

describe('Prisma 6 reader parity with Prisma 8 Mongo PSL', () => {
  it('gives the at-a-glance model the contract Prisma 8 PSL gives its equivalent, validators apart', async () => {
    const prisma6Path = join(parityDir, 'prisma6.prisma');
    const prisma8Path = join(parityDir, 'prisma8.prisma');
    const fromPrisma6 = await loadPrisma6Schema(prisma6Path);
    const fromPrisma8 = await mongoContract(prisma8Path).source.load(
      mongoSourceContext([prisma8Path]),
    );
    if (!fromPrisma6.ok) throw new Error(JSON.stringify(fromPrisma6.failure.diagnostics));
    if (!fromPrisma8.ok) throw new Error(JSON.stringify(fromPrisma8.failure.diagnostics));
    const prisma6 = serializeMongoContract(fromPrisma6.value) as SerializedContract;
    const prisma8 = serializeMongoContract(fromPrisma8.value) as SerializedContract;

    expect(prisma6['execution']).toBeDefined();
    expect(withoutValidators(prisma6)).toEqual(withoutValidators(prisma8));

    const prisma8WithoutValidators = withoutValidators(prisma8).storage;
    expect(prisma6.storage.storageHash).not.toBe(prisma8.storage.storageHash);
    expect(prisma6.storage.storageHash).toBe(
      computeStorageHash({
        target: 'mongo',
        targetFamily: 'mongo',
        storage: prisma8WithoutValidators,
        ...mongoContractCanonicalizationHooks,
      }),
    );
  });
});
