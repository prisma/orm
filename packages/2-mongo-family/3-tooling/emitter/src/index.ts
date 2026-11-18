import type { Contract, ContractModelBase, JsonValue } from '@internal/contract/types';
import {
  generateValueObjectsDescriptorType,
  serializeObjectKey,
  serializeValue,
} from '@internal/emitter/domain-type-generation';
import type { ImportSpecifierResolver } from '@internal/framework-components/emission';
import type { Namespace } from '@internal/framework-components/ir';
import type { MongoCollection, MongoModelStorage, MongoStorage } from '@internal/mongo-contract';
import { blindCast } from '@internal/utils/casts';

const MONGO_NAMESPACE_KIND_FALLBACK = 'mongo-namespace' as const;

function mongoNamespaceSerializedKind(ns: Namespace): string {
  const kind = (ns as { kind?: unknown }).kind;
  if (typeof kind === 'string') {
    return `readonly kind: ${serializeValue(kind)}`;
  }
  return `readonly kind: "${MONGO_NAMESPACE_KIND_FALLBACK}"`;
}

function generateMongoCollectionEntryType(coll: MongoCollection): string {
  const entries = Object.entries(coll).filter(([key, v]) => v !== undefined && key !== 'kind');
  if (entries.length === 0) {
    return 'MongoCollection';
  }
  return serializeValue(coll);
}

function generateMongoNamespaceCollectionsType(
  collections: Readonly<Record<string, MongoCollection>>,
): string {
  const entries: string[] = [];
  for (const [collName, coll] of Object.entries(collections).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    entries.push(
      `readonly ${serializeObjectKey(collName)}: ${generateMongoCollectionEntryType(coll)}`,
    );
  }
  if (entries.length === 0) {
    return 'Record<string, never>';
  }
  return `{ ${entries.join('; ')} }`;
}

function generateMongoNamespacesType(namespaces: MongoStorage['namespaces']): string {
  const sorted = Object.entries(namespaces ?? {}).sort(([a], [b]) => a.localeCompare(b));
  if (sorted.length === 0) {
    return 'Record<string, never>';
  }
  const parts: string[] = [];
  for (const [name, ns] of sorted) {
    const entriesParts = [
      `readonly collection: ${generateMongoNamespaceCollectionsType(ns.entries.collection ?? {})}`,
    ];
    const valueObjects = ns.entries.valueObject;
    if (valueObjects !== undefined && Object.keys(valueObjects).length > 0) {
      entriesParts.push(
        `readonly valueObject: ${generateValueObjectsDescriptorType(valueObjects)}`,
      );
    }
    parts.push(
      `readonly ${serializeObjectKey(name)}: { readonly id: ${serializeValue(ns.id)}; ${mongoNamespaceSerializedKind(ns)}; readonly entries: { ${entriesParts.join('; ')} } }`,
    );
  }
  return `{ ${parts.join('; ')} }`;
}

export const mongoEmission = {
  id: 'mongo',

  generateStorageType(contract: Contract, storageHashTypeName: string): string {
    const storage = contract.storage as MongoStorage;
    const namespacesType = generateMongoNamespacesType(storage.namespaces);
    return `{ readonly namespaces: ${namespacesType}; readonly storageHash: ${storageHashTypeName} }`;
  },

  generateModelStorageType(_modelName: string, model: ContractModelBase): string {
    const parts: string[] = [];
    const collection = model.storage['collection'] as string | undefined;
    if (collection) {
      parts.push(`readonly collection: ${serializeValue(collection)}`);
    }

    const storageFields = blindCast<
      MongoModelStorage['fields'],
      'a validated MongoDB contract records the stored name of every field'
    >(model.storage['fields']);
    const fieldEntries = Object.entries(storageFields).map(
      ([fieldName, { field }]) =>
        `readonly ${serializeObjectKey(fieldName)}: { readonly field: ${serializeValue(field)} }`,
    );
    parts.push(
      `readonly fields: ${fieldEntries.length > 0 ? `{ ${fieldEntries.join('; ')} }` : 'Record<string, never>'}`,
    );

    const storageRelations = model.storage['relations'] as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (storageRelations && Object.keys(storageRelations).length > 0) {
      const relEntries: string[] = [];
      for (const [relName, relVal] of Object.entries(storageRelations)) {
        relEntries.push(`readonly ${serializeObjectKey(relName)}: ${serializeValue(relVal)}`);
      }
      parts.push(`readonly relations: { ${relEntries.join('; ')} }`);
    }

    return `{ ${parts.join('; ')} }`;
  },

  resolveStorageValueSet(
    _modelName: string,
    fieldName: string,
    model: ContractModelBase,
    contract: Contract,
  ): { readonly encodedValues: readonly JsonValue[]; readonly codecId: string } | undefined {
    const field = model.fields[fieldName];
    if (field === undefined || field.type.kind !== 'scalar') return undefined;
    const ref = field.valueSet;
    if (ref?.plane !== 'storage') return undefined;
    const storage = blindCast<
      MongoStorage,
      'contract.storage is MongoStorage for the mongo family'
    >(contract.storage);
    const valueSet = storage.namespaces[ref.namespaceId]?.entries.valueSet?.[ref.entityName];
    if (valueSet === undefined) return undefined;
    return {
      encodedValues: valueSet.values,
      codecId: field.type.codecId,
    };
  },

  getFamilyImports(resolveImportSpecifier: ImportSpecifierResolver): string[] {
    return [
      'import type {',
      '  MongoCollection,',
      '  MongoContractWithTypeMaps,',
      '  MongoTypeMaps,',
      '  RelationKeys,',
      `} from '${resolveImportSpecifier('@internal/mongo-contract')}';`,
    ];
  },

  getFamilyTypeAliases(): string {
    return '';
  },

  getTypeMapsExpression(): string {
    return 'MongoTypeMaps<CodecTypes, FieldOutputTypes, FieldInputTypes>';
  },

  getContractWrapper(contractBaseName: string, typeMapsName: string): string {
    return `export type Contract = MongoContractWithTypeMaps<${contractBaseName}, ${typeMapsName}>;`;
  },
};
