import { MongoContractSerializerBase } from '@internal/family-mongo/ir';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  type MongoCollectionInput,
  type MongoContract,
  MongoStorage,
  type MongoValueSetInput,
} from '@internal/mongo-contract';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import type { JsonObject } from '@internal/utils/json';
import type { MongoTargetContract } from './mongo-target-contract';
import { MongoTargetDatabase, MongoTargetUnboundDatabase } from './mongo-target-database';

export class MongoTargetContractSerializer extends MongoContractSerializerBase<MongoTargetContract> {
  protected constructTargetContract(validated: MongoContract): MongoTargetContract {
    const { storage, ...rest } = validated;
    const namespaces = Object.fromEntries(
      Object.entries(storage.namespaces).map(([nsId, nsData]) => {
        const collectionCount = Object.keys(nsData.entries.collection ?? {}).length;
        const valueSetCount = Object.keys(nsData.entries['valueSet'] ?? {}).length;
        if (nsId === UNBOUND_NAMESPACE_ID && collectionCount === 0 && valueSetCount === 0) {
          return [nsId, MongoTargetUnboundDatabase.instance];
        }
        const dbInput: {
          id: string;
          entries?: Readonly<Record<string, Readonly<Record<string, unknown>>>> & {
            readonly collection?: Readonly<Record<string, MongoCollectionInput>>;
            readonly valueSet?: Readonly<Record<string, MongoValueSetInput>>;
          };
        } = { id: nsData.id };
        if (
          nsData.entries['collection'] !== undefined ||
          nsData.entries['valueSet'] !== undefined
        ) {
          dbInput.entries = {
            collection: blindCast<
              Readonly<Record<string, MongoCollectionInput>>,
              'collection entries validated by the mongo storage schema before hydration'
            >(nsData.entries['collection'] ?? {}),
            ...ifDefined(
              'valueSet',
              blindCast<
                Readonly<Record<string, MongoValueSetInput>> | undefined,
                'valueSet entries validated by the mongo storage schema before hydration'
              >(nsData.entries['valueSet']),
            ),
          };
        }
        return [nsId, new MongoTargetDatabase(dbInput)];
      }),
    );
    const targetStorage = new MongoStorage({
      storageHash: storage.storageHash,
      namespaces,
    });
    return { ...rest, storage: targetStorage };
  }

  override serializeContract(contract: MongoTargetContract): JsonObject {
    const { storage, ...rest } = contract;
    const namespacesJson: Record<string, JsonObject> = {};
    for (const [nsId, ns] of Object.entries(storage.namespaces)) {
      const collectionsOut: Record<string, JsonObject> = {};
      for (const [collName, coll] of Object.entries(ns.entries.collection ?? {})) {
        collectionsOut[collName] = blindCast<
          JsonObject,
          'a collection IR node serializes to a JSON-safe collection object'
        >(JSON.parse(JSON.stringify(coll)));
      }
      const valueSetOut: Record<string, JsonObject> = {};
      for (const [vsName, vs] of Object.entries(ns.entries.valueSet ?? {})) {
        valueSetOut[vsName] = blindCast<
          JsonObject,
          'a value-set IR node serializes to a JSON-safe { kind, values } object'
        >(JSON.parse(JSON.stringify(vs)));
      }
      namespacesJson[nsId] = {
        id: ns.id,
        kind: 'mongo-database',
        entries: {
          collection: collectionsOut,
          ...ifDefined('valueSet', Object.keys(valueSetOut).length > 0 ? valueSetOut : undefined),
        },
      };
    }
    return blindCast<
      JsonObject,
      'rest carries plain domain/capabilities JSON fields; storage has been serialized to JSON-safe form'
    >({
      ...rest,
      storage: {
        storageHash: String(storage.storageHash),
        namespaces: namespacesJson,
      },
    });
  }
}
