import type {
  CheckExpressionCandidate,
  CheckExpressionInput,
  ResolvedColumnValueObject,
  ResolvedValueObject,
  ResolvedValueObjectField,
  ResolvedValueObjectFieldType,
} from '@internal/sql-contract/check-expressions';
import { invariant } from '@internal/utils/assertions';
import { escapeLiteral, quoteIdentifier } from './sql-utils';

/**
 * Renders the checks a Postgres column needs, as opaque predicate text.
 *
 * A domain enum has no type-level enforcement, so membership is a
 * predicate: `IN` for a scalar, and `<@` containment for an array — an array
 * column cannot use `IN` at all (`operator does not exist: text[] = text`).
 * Array membership strips NULL elements first, leaving element nullability to
 * the separate element-non-null check emitted for semantically strict lists.
 *
 * Both forms compare members in the column's own type: the `IN` list and
 * the `<@` array literal are untyped, so Postgres reads each member as the
 * column (or element) type. A cast to `text` would compare the type's text
 * output instead, which for `inet` always carries the prefix length.
 */
export function postgresRenderCheckExpressions(
  input: CheckExpressionInput,
): readonly CheckExpressionCandidate[] {
  const candidates: CheckExpressionCandidate[] = [];
  const column = quoteIdentifier(input.columnName);
  const isMany = input.many !== false;
  const elementNullable = input.many !== false && input.many.elementNullable;

  if (input.memberValues !== undefined) {
    invariant(
      input.memberValues.length > 0,
      `check for "${input.tableName}"."${input.columnName}": empty member set; both authoring surfaces reject a member-less enum before rendering`,
    );
    for (const value of input.memberValues) {
      invariant(
        typeof value === 'string' || Number.isFinite(value),
        `check for "${input.tableName}"."${input.columnName}": non-finite numeric member`,
      );
    }
    candidates.push({
      kind: 'membership',
      columnName: input.columnName,
      expression: isMany
        ? `array_remove(${column}, NULL) <@ '${escapeLiteral(arrayLiteral(input.memberValues))}'`
        : `${column} IN (${input.memberValues.map(sqlLiteral).join(', ')})`,
    });
  }

  if (isMany && !elementNullable) {
    candidates.push({
      kind: 'elementNotNull',
      columnName: input.columnName,
      expression: `array_position(${column}, NULL) IS NULL`,
    });
  }

  if (input.valueObject !== undefined) {
    candidates.push({
      kind: 'shape',
      columnName: input.columnName,
      expression: valueObjectCheck(column, input.valueObject),
    });
  }

  return candidates;
}

/**
 * One strict `jsonpath` predicate over the whole column value. Strict mode keeps a comparison from unwrapping an array, and `IS TRUE` makes a predicate that evaluates to unknown fail the check, as a CHECK would otherwise pass on NULL. Member values are read through `keyvalue()`, so an absent member is never an error.
 */
function valueObjectCheck(column: string, columnValueObject: ResolvedColumnValueObject): string {
  const field: ResolvedValueObjectField = {
    nullable: columnValueObject.nullable,
    many: columnValueObject.many,
    type: { kind: 'valueObject', valueObject: columnValueObject.valueObject },
  };
  const predicate = fieldPredicate(field, '$');
  invariant(predicate !== undefined, 'a column that holds a value object always has a predicate');
  const match = (path: string) =>
    `jsonb_path_match(${column}, '${escapeLiteral(`strict ${path}`)}') IS TRUE`;
  return field.nullable
    ? `${column} IS NULL OR ${match(`$.type() == "null" || (${predicate})`)}`
    : match(predicate);
}

/** What the value at `path` must satisfy, or `undefined` when any value is accepted. */
function fieldPredicate(field: ResolvedValueObjectField, path: string): string | undefined {
  if (field.many === false) return valuePredicate(field.type, path);
  const element = valuePredicate(field.type, '@');
  const { elementNullable } = field.many;
  const invalidElement =
    element === undefined
      ? elementNullable
        ? undefined
        : '@.type() == "null"'
      : elementNullable
        ? `!(@.type() == "null" || (${element}))`
        : `!((${element}))`;
  const isArray = `${path}.type() == "array"`;
  return invalidElement === undefined
    ? isArray
    : `${isArray} && !exists(${path}[*] ? (${invalidElement}))`;
}

/** A member of any JSON type accepts every value, JSON `null` included; a member of any other JSON type is of that type, so never JSON `null`. */
function valuePredicate(type: ResolvedValueObjectFieldType, path: string): string | undefined {
  switch (type.kind) {
    case 'valueObject':
      return objectPredicate(type.valueObject, path);
    case 'anyObject':
      return `${path}.type() == "object"`;
    case 'scalar':
      if (type.values !== undefined) return valueSetPredicate(type.values, path);
      return type.jsonType === 'any' ? undefined : `${path}.type() == "${type.jsonType}"`;
  }
}

function valueSetPredicate(values: readonly (string | number)[], path: string): string {
  const alternatives = (jsonType: 'string' | 'number', members: readonly (string | number)[]) =>
    `${path}.type() == "${jsonType}" && (${members.map((value) => `${path} == ${jsonPathLiteral(value)}`).join(' || ')})`;
  const strings = values.filter((value) => typeof value === 'string');
  const numbers = values.filter((value) => typeof value === 'number');
  invariant(values.length > 0, 'a value set restricting a value object member has no values');
  if (numbers.length === 0) return alternatives('string', strings);
  if (strings.length === 0) return alternatives('number', numbers);
  return `(${alternatives('string', strings)}) || (${alternatives('number', numbers)})`;
}

function objectPredicate(valueObject: ResolvedValueObject, path: string): string {
  const names = Object.keys(valueObject.fields).sort();
  const members = names.flatMap((name) => {
    const field = valueObject.fields[name];
    invariant(field !== undefined, `value object member "${name}" is missing`);
    const isMember = `@.key == ${jsonPathLiteral(name)}`;
    const predicate = fieldPredicate(field, '@.value');
    if (!field.nullable) {
      return [
        predicate === undefined
          ? `exists(${path}.keyvalue() ? (${isMember}))`
          : `exists(${path}.keyvalue() ? (${isMember} && (${predicate})))`,
      ];
    }
    return predicate === undefined
      ? []
      : [
          `!exists(${path}.keyvalue() ? (${isMember} && !(@.value.type() == "null" || (${predicate}))))`,
        ];
  });
  const otherKey =
    names.length === 0
      ? `!exists(${path}.keyvalue())`
      : `!exists(${path}.keyvalue() ? (${names.map((name) => `@.key != ${jsonPathLiteral(name)}`).join(' && ')}))`;
  return [`${path}.type() == "object"`, ...members, otherKey].join(' && ');
}

function jsonPathLiteral(value: string | number): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function sqlLiteral(value: string | number): string {
  return typeof value === 'string' ? `'${escapeLiteral(value)}'` : String(value);
}

function arrayLiteral(values: readonly (string | number)[]): string {
  const elements = values.map((value) =>
    typeof value === 'string' ? `"${value.replace(/["\\]/g, '\\$&')}"` : String(value),
  );
  return `{${elements.join(',')}}`;
}
