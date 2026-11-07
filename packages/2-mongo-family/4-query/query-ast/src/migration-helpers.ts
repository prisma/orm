import type { MongoIndexKey, MongoIndexKeyDirection } from '@internal/mongo-contract';

export function buildIndexOpId(verb: 'create' | 'drop', collection: string, name: string): string {
  return `index.${collection}.${verb}(${name})`;
}

export function keysToKeySpec(
  keys: ReadonlyArray<MongoIndexKey>,
): Record<string, MongoIndexKeyDirection> {
  const spec: Record<string, MongoIndexKeyDirection> = {};
  for (const k of keys) {
    spec[k.field] = k.direction;
  }
  return spec;
}
