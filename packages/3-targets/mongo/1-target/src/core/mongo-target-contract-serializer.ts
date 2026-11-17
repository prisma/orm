import { MongoContractSerializerBase } from '@internal/family-mongo/ir';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  type MongoCollectionInput,
  type MongoContract,
  MongoStorage,
} from '@internal/mongo-contract';
import { blindCast } from '@internal/utils/casts';
import type { JsonObject } from '@internal/utils/json';
import type { MongoTargetContract } from './mongo-target-contract';
import { MongoTargetDatabase, MongoTargetUnboundDatabase } from './mongo-target-database';

export class MongoTargetContractSerializer extends MongoContractSerializerBase<MongoTargetContract> {
  protected constructTargetContract(validated: MongoContract): MongoTargetContract {
    const { storage, ...rest } = validated;
    const namespaces = Object.fromEntries(
      Object.entries(storage.namespaces).map(([nsId, nsData]) => {
        const hasEntities = Object.values(nsData.entries).some(
          (slot) => Object.keys(slot).length > 0,
        );
        if (nsId === UNBOUND_NAMESPACE_ID && !hasEntities) {
          return [nsId, MongoTargetUnboundDatabase.instance];
        }
        return [
          nsId,
          new MongoTargetDatabase({
            id: nsData.id,
            entries: {
              ...nsData.entries,
              collection: blindCast<
                Readonly<Record<string, MongoCollectionInput>>,
                'collection entries validated by the mongo storage schema before hydration'
              >(nsData.entries['collection'] ?? {}),
            },
          }),
        ];
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
      const entries: Record<string, JsonObject> = {
        collection: blindCast<
          JsonObject,
          'collection IR nodes serialize to JSON-safe collection objects'
        >(JSON.parse(JSON.stringify(ns.entries.collection ?? {}))),
      };
      for (const [kind, slot] of Object.entries(ns.entries)) {
        if (kind === 'collection' || Object.keys(slot).length === 0) continue;
        entries[kind] = blindCast<JsonObject, 'entries IR nodes serialize to JSON-safe objects'>(
          JSON.parse(JSON.stringify(slot)),
        );
      }
      namespacesJson[nsId] = { id: ns.id, kind: 'mongo-database', entries };
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
