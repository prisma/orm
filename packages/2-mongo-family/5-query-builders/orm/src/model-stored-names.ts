import {
  defaultMongoDomainNamespaceId,
  type MongoContract,
  mongoModelsOf,
  ownEmbedStoredNamesOf,
  ownStoredNamesOf,
  storedNamesOf,
} from '@internal/mongo-contract';
import type { StructuredError } from '@internal/utils/structured-error';
import { ormError } from './orm-errors';

/** A model's fields mapped to the names its documents store them under, and back, with the same for its embed relations. */
export interface ModelStoredNames {
  readonly modelName: string;
  /** Stored name of each field, keyed by field name. */
  readonly storedNames: Readonly<Record<string, string>>;
  /** Field name of each stored name, keyed by stored name. */
  readonly fieldNames: Readonly<Record<string, string>>;
  /** Stored name of each embed relation, keyed by relation name. */
  readonly embedStoredNames: Readonly<Record<string, string>>;
  /** The stored names of the model embed relation `relationName` embeds. */
  embedded(relationName: string): ModelStoredNames | undefined;
}

function invert(map: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [value, key]));
}

const cachedStoredNames = new WeakMap<MongoContract, Map<string, ModelStoredNames>>();

/**
 * The stored names of model `modelName`'s fields, its own and those it inherits, and, when `variantModelName` is given, the fields of that variant. Embedded models are looked up when asked for, so a model that embeds itself reuses the same map at every level.
 */
export function modelStoredNamesOf(
  contract: MongoContract,
  modelName: string,
  variantModelName?: string,
): ModelStoredNames {
  const cache = cachedStoredNames.get(contract) ?? new Map<string, ModelStoredNames>();
  cachedStoredNames.set(contract, cache);
  const key = JSON.stringify([modelName, variantModelName ?? null]);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const models = mongoModelsOf(contract.domain, defaultMongoDomainNamespaceId);
  const model = models[modelName];
  const variant = variantModelName === undefined ? undefined : models[variantModelName];
  const storedNames = {
    ...storedNamesOf(models, modelName),
    ...(variant === undefined ? {} : ownStoredNamesOf(variant)),
  };
  const embedStoredNames = model === undefined ? {} : ownEmbedStoredNamesOf(model);
  const storedNamesOfModel: ModelStoredNames = {
    modelName,
    storedNames,
    fieldNames: invert(storedNames),
    embedStoredNames,
    embedded(relationName) {
      if (!Object.hasOwn(embedStoredNames, relationName)) return undefined;
      const target = model?.relations[relationName]?.to.model;
      return target === undefined ? undefined : modelStoredNamesOf(contract, target);
    },
  };
  cache.set(key, storedNamesOfModel);
  return storedNamesOfModel;
}

/** The refusal of a name a caller passed that is not a field of the model. */
export function callerFieldUnknown(names: ModelStoredNames, fieldName: string): StructuredError {
  const unknown = `Model "${names.modelName}" has no field "${fieldName}"`;
  const fieldForStoredName = Object.hasOwn(names.fieldNames, fieldName)
    ? names.fieldNames[fieldName]
    : undefined;
  if (fieldForStoredName !== undefined) {
    return ormError(
      'ORM.FIELD_UNKNOWN',
      `${unknown}. "${fieldName}" is the stored name of field "${fieldForStoredName}"; pass the field name.`,
      { meta: { model: names.modelName, field: fieldName, fieldForStoredName } },
    );
  }
  return ormError('ORM.FIELD_UNKNOWN', unknown, {
    meta: { model: names.modelName, field: fieldName },
  });
}

/** The stored name of a field a caller named. A name that is not a field is refused with `ORM.FIELD_UNKNOWN`. */
export function storedNameOfCallerField(names: ModelStoredNames, fieldName: string): string {
  const storedName = Object.hasOwn(names.storedNames, fieldName)
    ? names.storedNames[fieldName]
    : undefined;
  if (storedName === undefined) throw callerFieldUnknown(names, fieldName);
  return storedName;
}

/**
 * The stored path of a dot path a caller named: its first segment is a field, or an embed relation, of the model; a value object stores the rest under their own names.
 */
export function storedPathOfCallerPath(names: ModelStoredNames, path: string): string {
  const [head = path, ...rest] = path.split('.');
  const embed = Object.hasOwn(names.embedStoredNames, head)
    ? names.embedStoredNames[head]
    : undefined;
  if (embed === undefined) return [storedNameOfCallerField(names, head), ...rest].join('.');
  const embeddedStorage = names.embedded(head);
  const [next, ...afterNext] = rest;
  if (embeddedStorage === undefined || next === undefined) return [embed, ...rest].join('.');
  if (/^\d+$/.test(next)) {
    return afterNext.length === 0
      ? [embed, next].join('.')
      : [embed, next, storedPathOfCallerPath(embeddedStorage, afterNext.join('.'))].join('.');
  }
  return [embed, storedPathOfCallerPath(embeddedStorage, rest.join('.'))].join('.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mapEach(
  value: unknown,
  map: (document: Record<string, unknown>) => unknown,
): unknown {
  if (Array.isArray(value))
    return value.map((element) => (isRecord(element) ? map(element) : element));
  return isRecord(value) ? map(value) : value;
}

/** A document of a model as a row of its fields: each stored name under the name of the field that stores it, embedded models likewise, and stored names no field stores left out. */
export function rowOfStoredDocument(
  document: Record<string, unknown>,
  names: ModelStoredNames,
  extra: Readonly<Record<string, (value: unknown) => unknown>> = {},
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  const relationOfEmbed = invert(names.embedStoredNames);
  for (const [storedName, value] of Object.entries(document)) {
    const extraKey = Object.hasOwn(extra, storedName) ? extra[storedName] : undefined;
    if (extraKey !== undefined) {
      row[storedName] = extraKey(value);
      continue;
    }
    const fieldName = Object.hasOwn(names.fieldNames, storedName)
      ? names.fieldNames[storedName]
      : undefined;
    if (fieldName !== undefined) {
      row[fieldName] = value;
      continue;
    }
    const relationName = Object.hasOwn(relationOfEmbed, storedName)
      ? relationOfEmbed[storedName]
      : undefined;
    if (relationName === undefined) continue;
    const embeddedStorage = names.embedded(relationName);
    row[relationName] =
      embeddedStorage === undefined
        ? value
        : mapEach(value, (embedded) => rowOfStoredDocument(embedded, embeddedStorage));
  }
  return row;
}

/** A row of a model's fields as the document that stores it, embedded models likewise. */
export function storedDocumentOfRow(
  row: Record<string, unknown>,
  names: ModelStoredNames,
): Record<string, unknown> {
  const document: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(row)) {
    const embed = Object.hasOwn(names.embedStoredNames, name)
      ? names.embedStoredNames[name]
      : undefined;
    if (embed === undefined) {
      document[storedNameOfCallerField(names, name)] = value;
      continue;
    }
    const embeddedStorage = names.embedded(name);
    document[embed] =
      embeddedStorage === undefined
        ? value
        : mapEach(value, (embedded) => storedDocumentOfRow(embedded, embeddedStorage));
  }
  return document;
}

/** The model each included relation reads, keyed by relation name. */
export type IncludedModels = Readonly<Record<string, string>>;

/**
 * Maps each document of model `modelName` to its row. A document of a model with variants is read with the fields of the variant its discriminator value names, unless `variantModelName` already names one; each included relation is read as rows of the model it reads.
 */
export function documentRowMapper(
  contract: MongoContract,
  modelName: string,
  variantModelName: string | undefined,
  includes: IncludedModels = {},
): (document: unknown) => unknown {
  const models = mongoModelsOf(contract.domain, defaultMongoDomainNamespaceId);
  const model = models[modelName];
  const base = modelStoredNamesOf(contract, modelName, variantModelName);
  const discriminator =
    variantModelName === undefined && model?.discriminator !== undefined
      ? base.storedNames[model.discriminator.field]
      : undefined;
  const namesOfVariant = (value: unknown): ModelStoredNames => {
    const variantModel = typeof value === 'string' ? model?.variants?.[value]?.model : undefined;
    return variantModel === undefined
      ? base
      : modelStoredNamesOf(contract, modelName, variantModel);
  };
  const extra = Object.fromEntries(
    Object.entries(includes).map(([relationName, target]) => {
      const targetRow = documentRowMapper(contract, target, undefined);
      return [relationName, (value: unknown) => mapEach(value, targetRow)];
    }),
  );
  return (document) => {
    if (!isRecord(document)) return document;
    const names = discriminator === undefined ? base : namesOfVariant(document[discriminator]);
    return rowOfStoredDocument(document, names, extra);
  };
}
