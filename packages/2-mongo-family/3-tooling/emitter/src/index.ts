import type {
  Contract,
  ContractModel,
  ContractModelBase,
  JsonValue,
} from '@internal/contract/types';
import { serializeObjectKey, serializeValue } from '@internal/emitter/domain-type-generation';
import type {
  ImportSpecifierResolver,
  ValidationContext,
} from '@internal/framework-components/emission';
import type { Namespace } from '@internal/framework-components/ir';
import type { MongoCollection, MongoStorage } from '@internal/mongo-contract';
import { blindCast } from '@internal/utils/casts';
import type { StructuredError } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

function validationError(message: string, model?: string): StructuredError {
  return structuredError(
    'CONTRACT.VALIDATION_FAILED',
    message,
    model === undefined ? undefined : { meta: { model } },
  );
}

const MONGO_NAMESPACE_KIND_FALLBACK = 'mongo-namespace' as const;

function mongoNamespaceSerializedKind(ns: Namespace): string {
  const kind = (ns as { kind?: unknown }).kind;
  if (typeof kind === 'string') {
    return `readonly kind: ${serializeValue(kind)}`;
  }
  return `readonly kind: "${MONGO_NAMESPACE_KIND_FALLBACK}"`;
}

function assertUniqueMongoCollectionNames(storage: MongoStorage): void {
  const seen = new Map<string, string>();
  for (const [namespaceId, ns] of Object.entries(storage.namespaces)) {
    for (const coll of Object.keys(ns.entries.collection ?? {})) {
      const existing = seen.get(coll);
      if (existing !== undefined && existing !== namespaceId) {
        throw structuredError(
          'CONTRACT.NAME_DUPLICATE',
          `Duplicate collection name "${coll}" in namespaces "${existing}" and "${namespaceId}"`,
        );
      }
      seen.set(coll, namespaceId);
    }
  }
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
    const collectionsType = generateMongoNamespaceCollectionsType(ns.entries.collection ?? {});
    parts.push(
      `readonly ${serializeObjectKey(name)}: { readonly id: ${serializeValue(ns.id)}; ${mongoNamespaceSerializedKind(ns)}; readonly entries: { readonly collection: ${collectionsType} } }`,
    );
  }
  return `{ ${parts.join('; ')} }`;
}

export const mongoEmission = {
  id: 'mongo',

  validateTypes(contract: Contract, _ctx: ValidationContext): void {
    const typeIdRegex = /^([^/]+)\/([^@]+)@(\d+)$/;

    for (const [namespaceId, domainNs] of Object.entries(contract.domain.namespaces)) {
      const models = domainNs.models as Record<string, ContractModel>;
      for (const [modelName, model] of Object.entries(models)) {
        const qualifiedName = `${namespaceId}:${modelName}`;
        for (const [fieldName, field] of Object.entries(model.fields)) {
          const fieldType = (
            field as {
              type?: {
                kind: string;
                codecId?: string;
                members?: ReadonlyArray<{ kind: string; codecId?: string }>;
              };
            }
          ).type;
          if (!fieldType) continue;

          const scalarTypes: Array<{ codecId?: string }> =
            fieldType.kind === 'scalar'
              ? [fieldType]
              : fieldType.kind === 'union' && fieldType.members
                ? fieldType.members.filter((m) => m.kind === 'scalar')
                : [];

          for (const scalarType of scalarTypes) {
            const { codecId } = scalarType;
            if (!codecId) {
              throw validationError(
                `Field "${fieldName}" on model "${qualifiedName}" is missing codecId`,
                qualifiedName,
              );
            }
            const match = codecId.match(typeIdRegex);
            if (!match?.[1]) {
              throw validationError(
                `Field "${fieldName}" on model "${qualifiedName}" has invalid codec ID format "${codecId}". Expected format: ns/name@version`,
                qualifiedName,
              );
            }
          }
        }
      }
    }
  },

  validateStructure(contract: Contract): void {
    if (contract.targetFamily !== 'mongo') {
      throw validationError(`Expected targetFamily "mongo", got "${contract.targetFamily}"`);
    }

    const storage = contract.storage as MongoStorage | undefined;
    if (!storage?.namespaces || typeof storage.namespaces !== 'object') {
      throw validationError('Mongo contract must have storage.namespaces');
    }

    assertUniqueMongoCollectionNames(storage);

    const collectionNames = new Set<string>();
    for (const ns of Object.values(storage.namespaces)) {
      for (const c of Object.keys(ns.entries.collection ?? {})) {
        collectionNames.add(c);
      }
    }

    for (const [namespaceId, domainNs] of Object.entries(contract.domain.namespaces)) {
      const models = domainNs.models as Record<string, ContractModel>;
      if (Object.keys(models).length === 0) continue;

      for (const [modelName, model] of Object.entries(models)) {
        const qualifiedName = `${namespaceId}:${modelName}`;
        if (!model.fields || typeof model.fields !== 'object') {
          throw validationError(
            `Model "${qualifiedName}" is missing required field "fields"`,
            qualifiedName,
          );
        }
        if (!model.relations || typeof model.relations !== 'object') {
          throw validationError(
            `Model "${qualifiedName}" is missing required field "relations" (must be an object)`,
            qualifiedName,
          );
        }
        if (!model.storage || typeof model.storage !== 'object') {
          throw validationError(
            `Model "${qualifiedName}" is missing required field "storage" (must be an object)`,
            qualifiedName,
          );
        }

        const collectionValue = model.storage['collection'];
        const collection = typeof collectionValue === 'string' ? collectionValue : undefined;

        if (model.owner) {
          if (collection) {
            throw validationError(
              `Owned model "${qualifiedName}" must not have storage.collection (embedded models are stored within their owner)`,
              qualifiedName,
            );
          }
          if (!models[model.owner]) {
            throw validationError(
              `Model "${qualifiedName}" declares owner "${model.owner}" which does not exist in models`,
              qualifiedName,
            );
          }
        } else if (collection) {
          if (!collectionNames.has(collection)) {
            throw validationError(
              `Model "${qualifiedName}" references collection "${collection}" which is not in storage.namespaces[..].entries.collection`,
              qualifiedName,
            );
          }
        }

        if (model.base) {
          const baseModel = models[model.base.model];
          if (!baseModel) {
            throw validationError(
              `Model "${qualifiedName}" declares base "${model.base.namespace}:${model.base.model}" which does not exist in models`,
              qualifiedName,
            );
          }
          const variantCollection = collection;
          const baseCollection = baseModel.storage['collection'] as string | undefined;
          if (variantCollection !== baseCollection) {
            throw validationError(
              `Variant "${qualifiedName}" must share its base's collection ("${baseCollection ?? '(none)'}"), but has "${variantCollection ?? '(none)'}"`,
              qualifiedName,
            );
          }
        }

        const storageRelations = model.storage['relations'] as Record<string, unknown> | undefined;
        if (storageRelations) {
          for (const relName of Object.keys(storageRelations)) {
            if (!model.relations[relName]) {
              throw validationError(
                `Model "${qualifiedName}" has storage.relations.${relName} but no matching domain-level relation`,
                qualifiedName,
              );
            }
          }
        }

        for (const [relName, rel] of Object.entries(model.relations)) {
          const relObj = rel as Record<string, unknown>;
          const targetRef = relObj['to'] as { readonly model?: string } | undefined;
          const targetModelName = targetRef?.model;
          if (targetModelName) {
            const targetModel = models[targetModelName];
            if (targetModel?.owner === modelName && !storageRelations?.[relName]) {
              throw validationError(
                `Model "${qualifiedName}" has embed relation "${relName}" to owned model "${targetModelName}" but no matching storage.relations entry`,
                qualifiedName,
              );
            }
          }
        }
      }
    }
  },

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

    return parts.length > 0 ? `{ ${parts.join('; ')} }` : 'Record<string, never>';
  },

  resolveFieldValueSet(
    _modelName: string,
    fieldName: string,
    model: ContractModelBase,
    contract: Contract,
  ): { readonly encodedValues: readonly JsonValue[]; readonly codecId: string } | undefined {
    const field = model.fields[fieldName];
    if (field === undefined || field.type.kind !== 'scalar') return undefined;
    const ref = field.valueSet;
    if (ref === undefined) return undefined;
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
