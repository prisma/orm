import type { Contract } from '@internal/contract/types';
import { SqlContractSerializerBase } from '@internal/family-sql/ir';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import type { Namespace } from '@internal/framework-components/ir';
import type { SqlNamespaceInput, SqlStorage } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import type { JsonObject } from '@internal/utils/json';
import { mysqlDataTypes } from './data-types';
import { mysqlCreateNamespace } from './mysql-database';

/** The MySQL target's contract serializer: the SQL family's, with each namespace built as a `MysqlDatabase`. */
export class MysqlContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
  constructor() {
    super(new Map(), [], createDataTypeLookup(mysqlDataTypes));
  }

  protected override hydrateSqlNamespaceEntry(
    nsId: string,
    raw: Record<string, unknown>,
  ): Namespace | SqlNamespaceInput {
    return mysqlCreateNamespace(
      blindCast<
        SqlNamespaceInput,
        'raw is always plain JSON, so super.hydrateSqlNamespaceEntry returns SqlNamespaceInput'
      >(super.hydrateSqlNamespaceEntry(nsId, raw)),
    );
  }

  override serializeContract(contract: Contract<SqlStorage>): JsonObject {
    const { storage, ...rest } = contract;
    const namespacesJson: Record<string, JsonObject> = {};
    for (const [nsId, ns] of Object.entries(storage.namespaces)) {
      namespacesJson[nsId] = { id: ns.id, entries: this.serializeNamespaceEntries(ns.entries) };
    }
    return blindCast<
      JsonObject,
      'rest and storage are serialized plain values; the spread keeps the contract envelope JSON-clean'
    >({
      ...rest,
      storage: {
        storageHash: String(storage.storageHash),
        namespaces: namespacesJson,
        ...(storage.types !== undefined ? { types: this.serializeJsonObject(storage.types) } : {}),
      },
    });
  }
}
