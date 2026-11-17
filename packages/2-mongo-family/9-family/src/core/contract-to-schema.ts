import type {
  MongoCollection,
  MongoCollectionOptions,
  MongoContract,
  MongoIndex,
  MongoValidator,
} from '@internal/mongo-contract';
import {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaIR,
  MongoSchemaValidator,
} from '@internal/mongo-schema-ir';
import { ifDefined } from '@internal/utils/defined';

function convertIndex(index: MongoIndex): MongoSchemaIndex {
  return new MongoSchemaIndex({
    name: index.name,
    keys: index.keys,
    unique: index.unique,
    sparse: index.sparse,
    expireAfterSeconds: index.expireAfterSeconds,
    partialFilterExpression: index.partialFilterExpression,
    wildcardProjection: index.wildcardProjection,
    collation: index.collation,
    weights: index.weights,
    default_language: index.default_language,
    language_override: index.language_override,
  });
}

function convertValidator(v: MongoValidator): MongoSchemaValidator {
  return new MongoSchemaValidator({
    jsonSchema: v.jsonSchema,
    validationLevel: v.validationLevel,
    validationAction: v.validationAction,
  });
}

function convertOptions(o: MongoCollectionOptions): MongoSchemaCollectionOptions {
  return new MongoSchemaCollectionOptions({
    ...ifDefined(
      'capped',
      o.capped !== undefined
        ? { size: o.capped.size, ...ifDefined('max', o.capped.max) }
        : undefined,
    ),
    ...(o.timeseries !== undefined
      ? {
          timeseries: {
            timeField: o.timeseries.timeField,
            ...ifDefined('metaField', o.timeseries.metaField),
            ...ifDefined('granularity', o.timeseries.granularity),
          },
        }
      : {}),
    ...(o.collation !== undefined
      ? {
          collation: {
            locale: o.collation.locale,
            ...ifDefined('caseLevel', o.collation.caseLevel),
            ...ifDefined('caseFirst', o.collation.caseFirst),
            ...ifDefined('strength', o.collation.strength),
            ...ifDefined('numericOrdering', o.collation.numericOrdering),
            ...ifDefined('alternate', o.collation.alternate),
            ...ifDefined('maxVariable', o.collation.maxVariable),
            ...ifDefined('backwards', o.collation.backwards),
            ...ifDefined('normalization', o.collation.normalization),
          },
        }
      : {}),
    ...ifDefined(
      'changeStreamPreAndPostImages',
      o.changeStreamPreAndPostImages !== undefined
        ? { enabled: o.changeStreamPreAndPostImages.enabled }
        : undefined,
    ),
    ...ifDefined('clusteredIndex', o.clusteredIndex),
  });
}

function convertCollection(name: string, def: MongoCollection): MongoSchemaCollection {
  const indexes = (def.indexes ?? []).map(convertIndex);
  return new MongoSchemaCollection({
    name,
    indexes,
    ...ifDefined('validator', def.validator != null ? convertValidator(def.validator) : undefined),
    ...ifDefined('options', def.options != null ? convertOptions(def.options) : undefined),
  });
}

export function contractToMongoSchemaIR(contract: MongoContract | null): MongoSchemaIR {
  if (!contract) {
    return new MongoSchemaIR([], { fromDatabase: false });
  }

  const collections: MongoSchemaCollection[] = [];
  for (const ns of Object.values(contract.storage.namespaces)) {
    for (const [name, def] of Object.entries(ns.entries.collection ?? {})) {
      collections.push(convertCollection(name, def));
    }
  }

  return new MongoSchemaIR(collections, { fromDatabase: false });
}
