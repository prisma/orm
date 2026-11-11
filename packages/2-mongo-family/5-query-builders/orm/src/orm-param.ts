import { isPlainRecord } from '@internal/contract/is-plain-record';
import {
  isMongoPreparedParamRef,
  MongoParamRef,
  type MongoParamRefOptions,
  type MongoPreparedParamRef,
} from '@internal/mongo-value';
import { ormError } from './orm-errors';

function findPlaceholder(value: unknown): MongoPreparedParamRef | undefined {
  if (isMongoPreparedParamRef(value)) return value;
  if (value instanceof MongoParamRef) return findPlaceholder(value.value);
  const children = Array.isArray(value) ? value : isPlainRecord(value) ? Object.values(value) : [];
  for (const child of children) {
    const found = findPlaceholder(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Refuses a prepared placeholder anywhere in a value with `ORM.ARGUMENT_INVALID`. A placeholder stands for one scalar value in a read: a scalar field in a `where`, a `limit` or an `offset`. ORM writes run at once, and value-object values are built with the query, so neither can take one.
 */
export function rejectPlaceholder(value: unknown, path: string): void {
  const placeholder = findPlaceholder(value);
  if (placeholder === undefined) return;
  throw ormError(
    'ORM.ARGUMENT_INVALID',
    `The prepared parameter '${placeholder.name}' cannot be used for '${path}'. A prepared parameter stands for one scalar value in a read: a scalar field in a where, a limit or an offset. ORM writes run at once, and value objects are built with the query, so neither can take one.`,
    { meta: { name: placeholder.name, field: path } },
  );
}

/** Wraps a value the ORM sends as a parameter. Every ORM value goes through it, so a prepared placeholder in it is refused. */
export function ormParam(
  value: unknown,
  path: string,
  options?: MongoParamRefOptions,
): MongoParamRef {
  rejectPlaceholder(value, path);
  return new MongoParamRef(value, options);
}
