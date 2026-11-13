import { isPlainRecord } from '@internal/contract/is-plain-record';
import type { ContractField } from '@internal/contract/types';
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

/**
 * Keeps a placeholder compared with a scalar field in a `where`, after checking it fits the field: its codec must be the field's codec, and it may be nullable only on a nullable field that is not a list. On a list field it stands for one item.
 */
export function wherePlaceholder(
  placeholder: MongoPreparedParamRef,
  field: ContractField,
  fieldCodecId: string,
  path: string,
): MongoPreparedParamRef {
  const { name, codecId, nullable } = placeholder;
  if (codecId !== fieldCodecId) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `The prepared parameter '${name}' has codec '${codecId}', but the field '${path}' has codec '${fieldCodecId}'.`,
      { meta: { name, field: path, codecId, fieldCodecId } },
    );
  }
  const list = Boolean(field.many);
  if (nullable && (list || !field.nullable)) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      list
        ? `The prepared parameter '${name}' is nullable, but the field '${path}' is a list, where a parameter stands for one item, which is never null.`
        : `The prepared parameter '${name}' is nullable, but the field '${path}' is not.`,
      { meta: { name, field: path, nullable: true, list } },
    );
  }
  return placeholder;
}
