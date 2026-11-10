import type { ContractField } from '@internal/contract/types';
import { MongoFieldFilter } from '@internal/mongo-query-ast/execution';
import type { MongoValue } from '@internal/mongo-value';

/**
 * On a list, `{ field: null }` also matches an array holding a null item, and an upsert copies `{ field: element }` into the inserted document as a value that is not a list. So `null` on a list matches any value that is not an array, and one element matches a list item equal to it.
 */
export function whereEquality(
  path: string,
  field: ContractField | undefined,
  value: MongoValue,
): MongoFieldFilter {
  if (field?.many) {
    if (value === null) return notAnArray(path);
    if (!Array.isArray(value)) return holdsItem(path, value);
  }
  return MongoFieldFilter.eq(path, value);
}

function notAnArray(path: string): MongoFieldFilter {
  return MongoFieldFilter.of(path, '$not', { $type: 'array' });
}

function holdsItem(path: string, item: MongoValue): MongoFieldFilter {
  return MongoFieldFilter.of(path, '$elemMatch', { $eq: item });
}
