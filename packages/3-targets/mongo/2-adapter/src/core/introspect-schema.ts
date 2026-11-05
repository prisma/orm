import type { MongoIndexKey, MongoIndexKeyDirection } from '@internal/mongo-contract';
import {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaIR,
  MongoSchemaValidator,
} from '@internal/mongo-schema-ir';
import type { CollationOptions } from '@internal/mongo-value/mongodb-types';
import { blindCast } from '@internal/utils/casts';
import type { Db, Document } from 'mongodb';

const PRISMA_MIGRATIONS_COLLECTION = '_prisma_migrations';

function parseIndexKeys(keySpec: Record<string, unknown>): MongoIndexKey[] {
  const keys: MongoIndexKey[] = [];
  for (const [field, direction] of Object.entries(keySpec)) {
    keys.push({ field, direction: direction as MongoIndexKeyDirection });
  }
  return keys;
}

/**
 * Exported for unit tests to exercise the defensive `!key` guard; not part of
 * the public API. Callers in this package use it via the `introspectSchema`
 * pipeline only.
 */
export function isDefaultIdIndex(doc: Document): boolean {
  const key = doc['key'] as Record<string, unknown> | undefined;
  if (!key) return false;
  const entries = Object.entries(key);
  return entries.length === 1 && entries[0]?.[0] === '_id' && entries[0]?.[1] === 1;
}

function parseIndex(doc: Document): MongoSchemaIndex {
  const keySpec = doc['key'] as Record<string, unknown>;
  return new MongoSchemaIndex({
    name: String(doc['name']),
    keys: parseIndexKeys(keySpec),
    unique: doc['unique'] as boolean | undefined,
    sparse: doc['sparse'] as boolean | undefined,
    expireAfterSeconds: doc['expireAfterSeconds'] as number | undefined,
    partialFilterExpression: doc['partialFilterExpression'] as Record<string, unknown> | undefined,
    wildcardProjection: doc['wildcardProjection'] as Record<string, 0 | 1> | undefined,
    collation: doc['collation']
      ? blindCast<CollationOptions, 'collation from mongodb listIndexes result has locale'>(
          doc['collation'],
        )
      : undefined,
    weights: doc['weights'] as Record<string, number> | undefined,
    default_language: doc['default_language'] as string | undefined,
    language_override: doc['language_override'] as string | undefined,
  });
}

function parseValidator(options: Document): MongoSchemaValidator | undefined {
  const validator = options['validator'] as Record<string, unknown> | undefined;
  if (!validator) return undefined;

  const jsonSchema = validator['$jsonSchema'] as Record<string, unknown> | undefined;
  if (!jsonSchema) return undefined;

  return new MongoSchemaValidator({
    jsonSchema,
    validationLevel: (options['validationLevel'] as 'strict' | 'moderate') ?? 'strict',
    validationAction: (options['validationAction'] as 'error' | 'warn') ?? 'error',
  });
}

function parseCollectionOptions(info: Document): MongoSchemaCollectionOptions | undefined {
  const options = info['options'] as Record<string, unknown> | undefined;
  if (!options) return undefined;

  const capped = options['capped'] as boolean | undefined;
  const size = options['size'] as number | undefined;
  const max = options['max'] as number | undefined;
  const timeseries = options['timeseries'] as
    | { timeField: string; metaField?: string; granularity?: 'seconds' | 'minutes' | 'hours' }
    | undefined;
  const collation = options['collation']
    ? blindCast<CollationOptions, 'collation from mongodb listCollections result has locale'>(
        options['collation'],
      )
    : undefined;
  const changeStreamPreAndPostImages = options['changeStreamPreAndPostImages'] as
    | { enabled: boolean }
    | undefined;
  const clusteredIndex = options['clusteredIndex'] as { name?: string } | undefined;

  const hasMeaningfulOptions =
    capped || timeseries || collation || changeStreamPreAndPostImages || clusteredIndex;
  if (!hasMeaningfulOptions) return undefined;

  return new MongoSchemaCollectionOptions({
    ...(capped ? { capped: { size: size ?? 0, ...(max != null ? { max } : {}) } } : {}),
    ...(timeseries ? { timeseries } : {}),
    ...(collation ? { collation } : {}),
    ...(changeStreamPreAndPostImages ? { changeStreamPreAndPostImages } : {}),
    ...(clusteredIndex ? { clusteredIndex } : {}),
  });
}

export async function introspectSchema(db: Db): Promise<MongoSchemaIR> {
  const collectionInfos = await db.listCollections().toArray();

  const collections: MongoSchemaCollection[] = [];

  for (const info of collectionInfos) {
    const name = info['name'] as string;
    const type = info['type'] as string | undefined;

    if (name === PRISMA_MIGRATIONS_COLLECTION) continue;
    if (name.startsWith('system.')) continue;
    if (type === 'view') continue;

    const indexDocs = await db.collection(name).listIndexes().toArray();
    const indexes = indexDocs.filter((doc) => !isDefaultIdIndex(doc)).map(parseIndex);

    const infoOptions = 'options' in info ? (info['options'] as Record<string, unknown>) : {};
    const validator = parseValidator(infoOptions);
    const options = parseCollectionOptions(info);

    collections.push(
      new MongoSchemaCollection({
        name,
        indexes,
        ...(validator ? { validator } : {}),
        ...(options ? { options } : {}),
      }),
    );
  }

  return new MongoSchemaIR(collections, { fromDatabase: true });
}
