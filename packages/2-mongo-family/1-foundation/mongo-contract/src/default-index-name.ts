import type { MongoIndexKey } from './contract-types';

/** The name MongoDB gives an index created without one: each key's field and direction, joined by `_`, such as `email_1` or `title_text`. */
export function defaultMongoIndexName(keys: ReadonlyArray<MongoIndexKey>): string {
  return keys.map((k) => `${k.field}_${k.direction}`).join('_');
}
