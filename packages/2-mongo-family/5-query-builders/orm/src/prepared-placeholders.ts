import { isPlainRecord } from '@internal/contract/is-plain-record';
import {
  isMongoPreparedParamRef,
  MongoParamRef,
  type MongoPreparedParamRef,
} from '@internal/mongo-value';
import { ormError } from './orm-errors';

const ALLOWED_POSITIONS =
  'A prepared parameter stands for one value in a read: a value compared with a scalar field in a where (an equality, a comparison, or an item of $in or $nin), a limit or an offset. ORM writes run at once, and value objects are built with the query, so neither can take one.';

export function findPlaceholder(value: unknown): MongoPreparedParamRef | undefined {
  if (isMongoPreparedParamRef(value)) return value;
  if (value instanceof MongoParamRef) return findPlaceholder(value.value);
  const children = Array.isArray(value) ? value : isPlainRecord(value) ? Object.values(value) : [];
  for (const child of children) {
    const found = findPlaceholder(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Refuses a prepared placeholder anywhere in a value for a field with `ORM.ARGUMENT_INVALID`. */
export function rejectPlaceholder(value: unknown, path: string): void {
  const placeholder = findPlaceholder(value);
  if (placeholder === undefined) return;
  throw ormError(
    'ORM.ARGUMENT_INVALID',
    `The prepared parameter '${placeholder.name}' cannot be used for '${path}'. ${ALLOWED_POSITIONS}`,
    { meta: { name: placeholder.name, field: path } },
  );
}

/** Refuses a list that holds a prepared placeholder as an item with `ORM.ARGUMENT_INVALID`: a declaration has no list form. */
export function rejectPlaceholderList(value: readonly unknown[], path: string): void {
  const placeholder = value.find(isMongoPreparedParamRef);
  if (placeholder === undefined) return;
  throw ormError(
    'ORM.ARGUMENT_INVALID',
    `The prepared parameter '${placeholder.name}' cannot be an item of a list for '${path}'. A declaration has no list form, so a list of prepared parameters is not possible; on a list field, one prepared parameter matches one item.`,
    { meta: { name: placeholder.name, field: path } },
  );
}

/** Refuses a write on a collection whose `where` holds a prepared placeholder with `ORM.ARGUMENT_INVALID`. */
export function rejectPreparedWrite(method: string, placeholder: MongoPreparedParamRef): never {
  throw ormError(
    'ORM.ARGUMENT_INVALID',
    `${method}() cannot run because the collection's where holds the prepared parameter '${placeholder.name}'. ORM writes run at once and cannot be prepared; use a prepared parameter only with .prepared.all(), .prepared.first() or .prepared.firstOrThrow().`,
    { meta: { name: placeholder.name, method } },
  );
}

/** Refuses a prepared placeholder in an `$expr` literal with `ORM.ARGUMENT_INVALID`. */
export function rejectExprPlaceholder(value: unknown): void {
  const placeholder = findPlaceholder(value);
  if (placeholder === undefined) return;
  throw ormError(
    'ORM.ARGUMENT_INVALID',
    `The prepared parameter '${placeholder.name}' cannot be used inside $expr. ${ALLOWED_POSITIONS}`,
    { meta: { name: placeholder.name, operator: '$expr' } },
  );
}

/** The scalar field a `where` compares a placeholder with: its codec, whether it may be null, and whether it is a list, in which case the placeholder stands for one item. */
export interface WherePlaceholderField {
  readonly codecId: string;
  readonly nullable: boolean;
  readonly list: boolean;
}

/**
 * Keeps a placeholder compared with a scalar field in a `where`, after checking it fits: its codec must be the field's codec, and it may be nullable only when the field may be null and is not a list.
 */
export function wherePlaceholder(
  placeholder: MongoPreparedParamRef,
  field: WherePlaceholderField,
  path: string,
): MongoPreparedParamRef {
  const { name, codecId, nullable } = placeholder;
  if (codecId !== field.codecId) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `The prepared parameter '${name}' has codec '${codecId}', but the field '${path}' has codec '${field.codecId}'.`,
      { meta: { name, field: path, codecId, fieldCodecId: field.codecId } },
    );
  }
  const { list } = field;
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
