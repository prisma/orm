import { describe, expect, it } from 'vitest';
import {
  createCollection,
  createIndex,
  fillField,
  setValidation,
} from '../src/core/migrations/migration-factories';
import { deserializeMongoOp } from '../src/core/migrations/mongo-ops-serializer';

const operations = {
  createIndex: createIndex('users', [{ field: 'email', direction: 1 }], {
    unique: true,
    collation: { locale: 'en', strength: 2 },
  }),
  createCollection: createCollection('events', {
    timeseries: { timeField: 'at', granularity: 'hours' },
    changeStreamPreAndPostImages: { enabled: true },
    clusteredIndex: { key: { _id: 1 }, unique: true, name: 'by_id' },
  }),
  setValidation: setValidation('users', { bsonType: 'object' }, { checkDocuments: true }),
  fillField: fillField({ collection: 'users', field: 'status', value: 'active' }),
};

/** Values Prisma hands to MongoDB as they are: documents in MongoDB's own vocabulary. */
const mongoDocumentKeys = new Set([
  'validator',
  'partialFilterExpression',
  'wildcardProjection',
  'weights',
  'key',
  'document',
  'documents',
  'update',
  'value',
  'sort',
  'projection',
  'fields',
  'annotations',
  'let_',
]);

function isRawCommand(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string' &&
    (value as { kind: string }).kind.startsWith('raw')
  );
}

/** A query plan's `meta` stays open: no reader acts on entries beyond the ones it declares. */
function isQueryPlan(value: object): boolean {
  return 'command' in value && 'collection' in value;
}

function objectPaths(
  value: unknown,
  path: readonly (string | number)[] = [],
): (string | number)[][] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, i) => objectPaths(entry, [...path, i]));
  }
  if (typeof value !== 'object' || value === null) return [];
  return [
    [...path],
    ...Object.entries(value).flatMap(([key, entry]) =>
      mongoDocumentKeys.has(key) ||
      ((key === 'filter' || key === 'pipeline') && isRawCommand(value)) ||
      (key === 'meta' && isQueryPlan(value))
        ? []
        : objectPaths(entry, [...path, key]),
    ),
  ];
}

function withUnknownKeyAt(json: unknown, path: readonly (string | number)[]): unknown {
  const copy = structuredClone(json);
  let place: unknown = copy;
  for (const step of path) {
    place = (place as Record<string | number, unknown>)[step];
  }
  (place as Record<string, unknown>)['unexpected'] = true;
  return copy;
}

const cases = Object.entries(operations).flatMap(([name, op]) => {
  const json = JSON.parse(JSON.stringify(op));
  return objectPaths(json).map((path) => ({
    name,
    place: path.join('.') || '(operation)',
    json,
    path,
  }));
});

describe('a Mongo operation with a key its format does not define', () => {
  it.each(Object.entries(operations))('%s is read without the key', (_, op) => {
    expect(() => deserializeMongoOp(JSON.parse(JSON.stringify(op)))).not.toThrow();
  });

  it('covers every kind of object these operations hold', () => {
    expect(cases.length).toBeGreaterThan(20);
  });

  it.each(cases)('$name is refused at $place', ({ json, path }) => {
    expect(() => deserializeMongoOp(withUnknownKeyAt(json, path))).toThrow(
      /unexpected must be removed/,
    );
  });

  it('keeps the invariant id of a data operation', () => {
    const op = { ...JSON.parse(JSON.stringify(operations.fillField)), invariantId: 'fill-status' };
    expect(deserializeMongoOp(op)).toMatchObject({ invariantId: 'fill-status' });
  });
});
