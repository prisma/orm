import type { Contract, ContractModelBase, CrossReference } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { UNBOUND_PSL_NAMESPACE_NAME } from '@internal/framework-components/psl-ast';
import { canonicalizeJson } from '@internal/framework-components/utils';
import type {
  ForeignKey,
  SqlModelStorage,
  SqlStorage,
  StorageTable,
} from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { postgresError } from '../errors';

/** One domain model paired with the storage table it is bridged to. */
export interface ModelWithTable {
  readonly namespaceId: string;
  readonly name: string;
  readonly tableName: string;
  readonly storage: SqlModelStorage;
  readonly model: ContractModelBase;
  readonly table: StorageTable;
  /** Column name → field name, the inverse of `storage.fields`. */
  readonly fieldNamesByColumn: ReadonlyMap<string, string>;
  /** The columns this model's own fields occupy. */
  readonly ownColumns: ReadonlySet<string>;
}

/** How a model relates to a polymorphic base, when it is a variant of one. */
export interface VariantInfo {
  readonly base: ModelWithTable;
  readonly value: string;
  /** The variant shares the base's table (single-table inheritance). */
  readonly singleTable: boolean;
}

/** The name a contract namespace is written under in PSL. */
export function pslNamespaceName(namespaceId: string): string {
  return namespaceId === UNBOUND_NAMESPACE_ID ? UNBOUND_PSL_NAMESPACE_NAME : namespaceId;
}

export function modelCoordinate(namespaceId: string, modelName: string): string {
  return JSON.stringify([namespaceId, modelName]);
}

/**
 * Every domain model of the contract, in declaration order, with its storage table. A model whose
 * domain namespace is not the namespace of its table is refused before this runs.
 */
export function indexContractModels(contract: Contract<SqlStorage>): readonly ModelWithTable[] {
  const entries: ModelWithTable[] = [];
  for (const [namespaceId, domainNamespace] of Object.entries(contract.domain.namespaces)) {
    for (const [name, model] of Object.entries(domainNamespace.models)) {
      const storage = blindCast<SqlModelStorage, 'SQL contract model storage'>(model.storage);
      const table =
        contract.storage.namespaces[storage.namespaceId]?.entries.table?.[storage.table];
      if (table === undefined) {
        throw postgresError(
          'CONTRACT.MODEL_UNKNOWN',
          `contract print: model "${namespaceId}.${name}" is stored in table "${storage.namespaceId}"."${storage.table}", which the contract's storage does not declare.`,
          {
            why: "The printer reads each model's columns, keys and indexes off its storage table.",
            fix: 'The contract source produced a model without its table. Fix the model if the source is a TypeScript contract; otherwise report the bug to the source that produced it.',
            meta: { namespaceId, modelName: name, table: storage.table },
          },
        );
      }
      const fields = Object.entries(storage.fields);
      entries.push({
        namespaceId: storage.namespaceId,
        name,
        tableName: storage.table,
        storage,
        model,
        table,
        fieldNamesByColumn: new Map(fields.map(([fieldName, field]) => [field.column, fieldName])),
        ownColumns: new Set(fields.map(([, field]) => field.column)),
      });
    }
  }
  return entries;
}

/** Models keyed by their `(namespace, model)` coordinate. */
export function modelsByCoordinate(
  entries: readonly ModelWithTable[],
): ReadonlyMap<string, ModelWithTable> {
  return new Map(entries.map((entry) => [modelCoordinate(entry.namespaceId, entry.name), entry]));
}

/** A cross reference's coordinate; one into another contract space never matches a model of this contract. */
export function crossReferenceCoordinate(reference: CrossReference): string {
  return reference.space === undefined
    ? modelCoordinate(reference.namespace, reference.model)
    : JSON.stringify([reference.space, reference.namespace, reference.model]);
}

/** The base a variant model extends, with the discriminator value it is stored under. */
export function variantInfo(
  entry: ModelWithTable,
  byCoordinate: ReadonlyMap<string, ModelWithTable>,
): VariantInfo | undefined {
  if (entry.model.base === undefined) return undefined;
  const base = byCoordinate.get(crossReferenceCoordinate(entry.model.base));
  const value = base?.model.variants?.[entry.name]?.value;
  if (base === undefined || value === undefined) {
    throw postgresError(
      'CONTRACT.MODEL_UNKNOWN',
      `contract print: model "${entry.namespaceId}.${entry.name}" extends base "${entry.model.base.namespace}.${entry.model.base.model}", which the contract does not declare, or which does not list it as a variant.`,
      {
        why: 'A variant is written as `@@base(Base, "value")`, and the value comes from the base model.',
        fix: 'The contract source produced a variant its base does not list. Fix the variant or its base if the source is a TypeScript contract; otherwise report the bug to the source that produced it.',
        meta: { namespaceId: entry.namespaceId, modelName: entry.name },
      },
    );
  }
  return {
    base,
    value,
    singleTable: base.namespaceId === entry.namespaceId && base.tableName === entry.tableName,
  };
}

/** The columns the PSL source adds to a multi-table variant's table: its base's primary key. */
export function variantLinkColumns(
  entry: ModelWithTable,
  variant: VariantInfo | undefined,
): readonly string[] {
  if (variant === undefined || variant.singleTable) return [];
  return (variant.base.table.primaryKey?.columns ?? []).filter(
    (column) => !entry.ownColumns.has(column),
  );
}

/**
 * The foreign key the PSL source synthesizes from a multi-table variant to its base: unnamed, over
 * the base's primary key columns, cascading on delete.
 */
export function isVariantLinkForeignKey(fk: ForeignKey, variant: VariantInfo | undefined): boolean {
  if (variant === undefined || variant.singleTable) return false;
  const baseKey = canonicalizeJson(variant.base.table.primaryKey?.columns ?? []);
  return (
    fk.target.namespaceId === variant.base.namespaceId &&
    fk.target.tableName === variant.base.tableName &&
    fk.target.spaceId === undefined &&
    canonicalizeJson(fk.source.columns) === baseKey &&
    canonicalizeJson(fk.target.columns) === baseKey &&
    fk.name === undefined &&
    fk.onDelete === 'cascade' &&
    fk.onUpdate === undefined
  );
}
