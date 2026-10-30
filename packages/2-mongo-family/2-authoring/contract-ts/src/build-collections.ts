import {
  applyPolymorphicScopeToMongoIndex,
  indexLookupKey,
  type MongoCollectionInput,
  MongoCollectionOptions,
  type MongoCollectionOptionsAuthoringInput,
  type MongoCollectionOptionsInput,
  MongoIndex,
  type MongoIndexInput,
} from '@internal/mongo-contract';
import { canonicalStringify } from '@internal/utils/canonical-stringify';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { storedFieldNameIn } from './build-models';
import type { BuildRefusal, IndexKey, IndexShapeRule } from './build-refusals';
import type { FieldNode, IndexNode, ModelNode } from './contract-definition';

function storedIndexKey(fields: readonly FieldNode[], key: string): string {
  const wildcardMatch = key.match(/^(.+)\.\$\*\*$/);
  const scope = wildcardMatch?.[1];
  if (scope !== undefined) return `${storedFieldNameIn(fields, scope)}.$**`;
  return key === '$**' ? key : storedFieldNameIn(fields, key);
}

function toStorageIndex(index: IndexNode, fields: readonly FieldNode[]): MongoIndex {
  const keys = Object.entries(index.fields).map(([field, direction]) => ({
    field: storedIndexKey(fields, field),
    direction,
  }));
  const input: Record<string, unknown> = { keys };
  if (index.options) {
    for (const [key, value] of Object.entries(index.options)) {
      if (value !== undefined) {
        input[key] = value;
      }
    }
  }
  return new MongoIndex(
    blindCast<MongoIndexInput, 'the keys and options above are the MongoIndex input fields'>(input),
  );
}

function toStorageCollectionOptions(
  opts: MongoCollectionOptionsAuthoringInput,
): MongoCollectionOptions {
  const input: MongoCollectionOptionsInput = {
    ...(opts.capped
      ? { capped: { size: opts.size ?? 0, ...(opts.max != null && { max: opts.max }) } }
      : {}),
    ...ifDefined('storageEngine', opts.storageEngine),
    ...ifDefined('indexOptionDefaults', opts.indexOptionDefaults),
    ...ifDefined('collation', opts.collation),
    ...ifDefined('timeseries', opts.timeseries),
    ...(opts.clusteredIndex !== undefined && {
      clusteredIndex:
        opts.clusteredIndex.name !== undefined ? { name: opts.clusteredIndex.name } : {},
    }),
    ...ifDefined('expireAfterSeconds', opts.expireAfterSeconds),
    ...ifDefined('changeStreamPreAndPostImages', opts.changeStreamPreAndPostImages),
  };
  return new MongoCollectionOptions(input);
}

function findMissingIndexField(index: IndexNode, fields: readonly FieldNode[]): string | undefined {
  for (const fieldName of Object.keys(index.fields)) {
    const wildcardMatch = fieldName.match(/^(.+)\.\$\*\*$/);
    const lookupName = wildcardMatch ? wildcardMatch[1] : fieldName;
    if (lookupName === undefined || lookupName.length === 0) continue;
    if (lookupName === '$**') continue;
    if (!fields.some((field) => field.fieldName === lookupName)) {
      return lookupName;
    }
  }
  return undefined;
}

function isWildcardKey(key: string): boolean {
  return key === '$**' || key.endsWith('.$**');
}

function isTextIndex(index: IndexNode): boolean {
  return Object.values(index.fields).includes('text');
}

/** The first shape rule an index breaks, of those MongoDB enforces when it creates the index. */
function indexShapeProblem(index: IndexNode): IndexShapeRule | undefined {
  const keys = Object.entries(index.fields);
  const hasWildcard = keys.some(([key]) => isWildcardKey(key));
  const directions = keys.map(([, direction]) => direction);
  const options = index.options ?? {};
  if (hasWildcard && options.unique) return 'unique-wildcard';
  if (
    hasWildcard &&
    directions.some((direction) => ['hashed', '2d', '2dsphere'].includes(String(direction)))
  ) {
    return 'wildcard-with-type';
  }
  if (directions.includes('hashed') && keys.length > 1) return 'hashed-several-fields';
  if (hasWildcard && options.expireAfterSeconds !== undefined) return 'ttl-with-wildcard';
  if (!hasWildcard && options.wildcardProjection !== undefined) {
    return 'projection-without-wildcard';
  }
  if (options.collation !== undefined && !options.collation.locale)
    return 'collation-without-locale';
  return undefined;
}

function resolveVariantScope(
  model: ModelNode,
  modelsByName: ReadonlyMap<string, ModelNode>,
  variantValues: ReadonlyMap<string, string>,
): { discriminatorField: string; discriminatorValue: string } | undefined {
  if (!model.base) return undefined;
  const base = modelsByName.get(model.base.model);
  const discriminatorField = base?.discriminator?.field;
  const discriminatorValue = variantValues.get(model.modelName);
  if (base === undefined || !discriminatorField || discriminatorValue === undefined) {
    return undefined;
  }
  return {
    discriminatorField: storedFieldNameIn(base.fields, discriminatorField),
    discriminatorValue,
  };
}

function checkNoCollectionSettings(model: ModelNode, refusals: BuildRefusal[]): void {
  const key = { kind: 'collectionSettings', model: model.modelName } as const;
  if (model.indexes && model.indexes.length > 0) {
    refusals.push({ kind: 'collectionSettingWithoutCollection', key, setting: 'indexes' });
  }
  if (model.collectionOptions) {
    refusals.push({
      kind: 'collectionSettingWithoutCollection',
      key,
      setting: 'collectionOptions',
    });
  }
  if (model.controlPolicy) {
    refusals.push({ kind: 'collectionSettingWithoutCollection', key, setting: 'controlPolicy' });
  }
}

/** Each collection the models are stored in, with its indexes, options and control policy. Validators are added later. */
export function buildCollections(input: {
  readonly models: readonly ModelNode[];
  readonly variantValues: ReadonlyMap<string, string>;
  readonly refusals: BuildRefusal[];
}): Record<string, MongoCollectionInput> {
  const { models, variantValues, refusals } = input;
  const intermediate: Record<string, MongoCollectionInput> = {};
  const indexesByCollection = new Map<string, MongoIndex[]>();
  const textIndexCollections = new Set<string>();
  const modelsByName = new Map(models.map((model) => [model.modelName, model]));

  for (const model of models) {
    const { modelName, collection } = model;
    if (!collection) {
      checkNoCollectionSettings(model, refusals);
      continue;
    }
    const collectionKey = { kind: 'collectionSettings', model: modelName } as const;
    const existingCollection: MongoCollectionInput = intermediate[collection] ?? {};
    const collectionIndexes = indexesByCollection.get(collection) ?? [];
    indexesByCollection.set(collection, collectionIndexes);

    if (existingCollection.options && model.collectionOptions) {
      refusals.push({
        kind: 'collectionSettingTwice',
        key: collectionKey,
        setting: 'collectionOptions',
        collection,
      });
    }
    if (existingCollection.control !== undefined && model.controlPolicy) {
      refusals.push({
        kind: 'collectionSettingTwice',
        key: collectionKey,
        setting: 'controlPolicy',
        collection,
      });
    }

    const polymorphicScope = resolveVariantScope(model, modelsByName, variantValues);
    let indexesChanged = false;
    (model.indexes ?? []).forEach((written, position) => {
      const key: IndexKey = { kind: 'index', model: modelName, position };
      const signature = canonicalStringify(written);
      const missingField = findMissingIndexField(written, model.fields);
      if (missingField !== undefined) {
        refusals.push({ kind: 'indexFieldUnknown', key, fieldName: missingField, signature });
        return;
      }
      const shapeProblem = indexShapeProblem(written);
      if (shapeProblem !== undefined) {
        refusals.push({ kind: 'indexShape', key, rule: shapeProblem, signature });
        return;
      }
      const storageIndex = toStorageIndex(written, model.fields);
      const scoped =
        polymorphicScope === undefined
          ? { kind: 'ok' as const, index: storageIndex }
          : applyPolymorphicScopeToMongoIndex(storageIndex, polymorphicScope);
      if (scoped.kind === 'conflict') {
        refusals.push({ kind: 'indexScopeConflict', key, reason: scoped.reason, signature });
        return;
      }
      const lookupKey = indexLookupKey({ ...scoped.index, unique: undefined });
      const matchingAt = collectionIndexes.findIndex(
        (held) => indexLookupKey({ ...held, unique: undefined }) === lookupKey,
      );
      const held = collectionIndexes[matchingAt];
      if (held !== undefined) {
        if (held.unique === true || scoped.index.unique !== true) return;
        collectionIndexes.splice(matchingAt, 1);
      } else if (isTextIndex(written)) {
        if (textIndexCollections.has(collection)) {
          refusals.push({ kind: 'indexShape', key, rule: 'second-text-index', signature });
          return;
        }
        textIndexCollections.add(collection);
      }
      collectionIndexes.push(scoped.index);
      indexesChanged = true;
    });

    const storageOptions = model.collectionOptions
      ? toStorageCollectionOptions(model.collectionOptions)
      : undefined;
    const controlPatch = model.controlPolicy !== undefined ? { control: model.controlPolicy } : {};

    intermediate[collection] = indexesChanged
      ? {
          ...existingCollection,
          indexes: [...collectionIndexes],
          ...(storageOptions ? { options: storageOptions } : {}),
          ...controlPatch,
        }
      : storageOptions
        ? { ...existingCollection, options: storageOptions, ...controlPatch }
        : Object.keys(controlPatch).length > 0
          ? { ...existingCollection, ...controlPatch }
          : existingCollection;
  }

  return intermediate;
}
