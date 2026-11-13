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
 * Refuses a prepared placeholder anywhere in a value with `ORM.ARGUMENT_INVALID`. A placeholder stands for one value in a read: a value compared with a scalar field in a `where`, a `limit` or an `offset`. ORM writes run at once, and value-object values are built with the query, so neither can take one.
 */
export function rejectPlaceholder(value: unknown, path: string): void {
  const placeholder = findPlaceholder(value);
  if (placeholder === undefined) return;
  throw ormError(
    'ORM.ARGUMENT_INVALID',
    `The prepared parameter '${placeholder.name}' cannot be used for '${path}'. A prepared parameter stands for one value in a read: a value compared with a scalar field in a where (an equality, a comparison, or an item of $in or $nin), a limit or an offset. ORM writes run at once, and value objects are built with the query, so neither can take one.`,
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

/** The scalar a `where` compares a placeholder with: its codec, whether it may be null, and whether it is a list, in which case the placeholder stands for one item. */
export interface WherePlaceholderTarget {
  readonly codecId: string;
  readonly nullable: boolean;
  readonly list: boolean;
}

/**
 * Keeps a placeholder compared with a scalar in a `where`, after checking it fits: its codec must be the scalar's codec, and it may be nullable only when the scalar may be null and is not a list.
 */
export function wherePlaceholder(
  placeholder: MongoPreparedParamRef,
  target: WherePlaceholderTarget,
  path: string,
): MongoPreparedParamRef {
  const { name, codecId, nullable } = placeholder;
  if (codecId !== target.codecId) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `The prepared parameter '${name}' has codec '${codecId}', but the field '${path}' has codec '${target.codecId}'.`,
      { meta: { name, field: path, codecId, fieldCodecId: target.codecId } },
    );
  }
  const { list } = target;
  if (nullable && (list || !target.nullable)) {
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
