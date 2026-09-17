import type { Contract, ContractModelBase, CrossReference } from '@internal/contract/types';
import type { SqlModelStorage, SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { postgresError } from '../errors';

/** One domain model paired with the storage table it is bridged to. */
export interface ModelEntry {
  readonly namespaceId: string;
  readonly name: string;
  readonly tableName: string;
  readonly storage: SqlModelStorage;
  readonly model: ContractModelBase;
  readonly table: StorageTable;
  /** Column name → field name, the inverse of `storage.fields`. */
  readonly fieldNamesByColumn: ReadonlyMap<string, string>;
}

export function modelCoordinate(namespaceId: string, modelName: string): string {
  return `${namespaceId}\u0000${modelName}`;
}

/** Every domain model of the contract, in declaration order, with its storage table. */
export function indexContractModels(contract: Contract<SqlStorage>): readonly ModelEntry[] {
  const entries: ModelEntry[] = [];
  for (const [namespaceId, domainNamespace] of Object.entries(contract.domain.namespaces)) {
    for (const [name, model] of Object.entries(domainNamespace.models)) {
      const storage = blindCast<SqlModelStorage, 'SQL contract model storage'>(model.storage);
      const table =
        contract.storage.namespaces[storage.namespaceId]?.entries.table?.[storage.table];
      if (table === undefined) {
        throw postgresError(
          'CONTRACT.MODEL_UNKNOWN',
          `contract convert: model "${namespaceId}.${name}" is bridged to table "${storage.namespaceId}"."${storage.table}", which the contract's storage does not declare.`,
          {
            why: "The printer reads each model's columns, keys and indexes off its storage table.",
            fix: 'Re-emit the contract from its source.',
            meta: { namespaceId, modelName: name, table: storage.table },
          },
        );
      }
      entries.push({
        namespaceId: storage.namespaceId,
        name,
        tableName: storage.table,
        storage,
        model,
        table,
        fieldNamesByColumn: new Map(
          Object.entries(storage.fields).map(([fieldName, field]) => [field.column, fieldName]),
        ),
      });
    }
  }
  return entries;
}

/** Models keyed by their `(namespace, model)` coordinate. */
export function modelsByCoordinate(
  entries: readonly ModelEntry[],
): ReadonlyMap<string, ModelEntry> {
  return new Map(entries.map((entry) => [modelCoordinate(entry.namespaceId, entry.name), entry]));
}

export function crossReferenceCoordinate(reference: CrossReference): string {
  return modelCoordinate(reference.namespace, reference.model);
}
