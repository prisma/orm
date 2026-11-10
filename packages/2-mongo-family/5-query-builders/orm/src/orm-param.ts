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
 * Wraps a value the ORM sends as a parameter. Every ORM value goes through it, so a prepared placeholder anywhere in the value is refused with `ORM.ARGUMENT_INVALID`: ORM writes run at once, and value-object literals are built with the query, so neither can take one.
 */
export function ormParam(
  value: unknown,
  path: string,
  options?: MongoParamRefOptions,
): MongoParamRef {
  const placeholder = findPlaceholder(value);
  if (placeholder !== undefined) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `The prepared parameter '${placeholder.name}' cannot be used for '${path}'. ORM writes run at once, and value-object literals are built with the query, so neither can take a prepared parameter.`,
      { meta: { name: placeholder.name, field: path } },
    );
  }
  return new MongoParamRef(value, options);
}
