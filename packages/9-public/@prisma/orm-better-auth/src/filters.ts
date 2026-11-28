import type { CleanedWhere } from '@better-auth/core/db/adapter';
import { BetterAuthError } from '@better-auth/core/error';
import { all, and, type Condition, or } from '@prisma/orm-family-sql/orm-client';
import { describeFieldType } from './models/field-type';
import type { FoundModel } from './models/model-lookup';
import {
  asCondition,
  callMethod,
  hasMethod,
  type ModelAccessor,
  property,
  type WhereTools,
} from './orm';
import { isTextColumn, type TargetSupport, type TextColumn } from './target-support';

function fieldTypeOf(model: FoundModel, field: string): string {
  const contractField = model.model.fields[field];
  return contractField === undefined ? 'unknown type' : describeFieldType(contractField);
}

export function unsupportedError(model: FoundModel, field: string, operator: string) {
  return new BetterAuthError(
    `Field "${model.name}.${field}" (${fieldTypeOf(model, field)}) does not support ${operator}.`,
  );
}

/** A field of the callback's model accessor; an unknown field raises the ORM client's own error. */
export function fieldOf(accessor: ModelAccessor, field: string): unknown {
  return property(accessor, field);
}

function call(
  field: unknown,
  method: string,
  model: FoundModel,
  name: string,
  operator: string,
  ...args: unknown[]
): Condition {
  if (!hasMethod(field, method)) throw unsupportedError(model, name, operator);
  return asCondition(callMethod(field, method, ...args));
}

function presentValues(value: CleanedWhere['value']): unknown[] {
  return (Array.isArray(value) ? [...value] : [value]).filter(
    (item) => item !== null && item !== undefined,
  );
}

function allStrings(values: readonly unknown[]): values is [string, ...string[]] {
  return values.length > 0 && values.every((item) => typeof item === 'string');
}

interface TextField {
  readonly column: TextColumn;
  readonly codecId: string;
}

/** The field when it holds text: a single scalar on which the ORM offers `like`, which it does only for a codec with the `textual` trait. */
function textFieldOf(field: unknown, model: FoundModel, name: string): TextField | undefined {
  const type = model.model.fields[name];
  if (type?.type.kind !== 'scalar' || type.many || !isTextColumn(field)) return undefined;
  return { column: field, codecId: type.type.codecId };
}

function clauseCondition(
  accessor: ModelAccessor,
  { fns }: WhereTools,
  model: FoundModel,
  support: TargetSupport,
  clause: CleanedWhere,
): Condition {
  const name = clause.field;
  const field = fieldOf(accessor, name);
  const operator = clause.operator ?? 'eq';
  const value = clause.value;
  const insensitive = clause.mode === 'insensitive';
  const textField = textFieldOf(field, model, name);
  const text = () => {
    if (textField === undefined) throw unsupportedError(model, name, operator);
    return { ...textField, fns, insensitive };
  };
  const method = (methodName: string, ...args: unknown[]) =>
    call(field, methodName, model, name, operator, ...args);

  switch (operator) {
    case 'eq':
    case 'ne':
      if (value === null) return method(operator === 'eq' ? 'isNull' : 'isNotNull');
      if (typeof value === 'string' && (insensitive || textField !== undefined)) {
        return support.compareText({ ...text(), operator, value });
      }
      return method(operator === 'eq' ? 'eq' : 'neq', value);
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      return method(operator, value);
    case 'in':
    case 'not_in': {
      const values = presentValues(value);
      if (values.length === 0) return operator === 'in' ? or() : and();
      if (allStrings(values) && (insensitive || textField !== undefined)) {
        return support.compareText({ ...text(), operator, values });
      }
      return method(operator === 'in' ? 'in' : 'notIn', values);
    }
    case 'starts_with':
    case 'ends_with':
    case 'contains': {
      const context = text();
      const pattern = String(value);
      if (pattern === '') return method('isNotNull');
      return support.compareText({ ...context, operator, value: pattern });
    }
    default:
      throw new BetterAuthError(
        `Better Auth filter operator "${String(operator)}" is not supported.`,
      );
  }
}

/** The `where` callback for Better Auth's flat list of clauses: AND clauses, then one OR group. */
export function whereFilter(
  model: FoundModel,
  support: TargetSupport,
  where: readonly CleanedWhere[] | undefined,
): (accessor: ModelAccessor, tools: WhereTools) => Condition {
  return (accessor, tools) => {
    if (where === undefined || where.length === 0) return all();
    const conditionOf = (clause: CleanedWhere) =>
      clauseCondition(accessor, tools, model, support, clause);
    const andClauses = where.filter((clause) => clause.connector !== 'OR').map(conditionOf);
    const orClauses = where.filter((clause) => clause.connector === 'OR').map(conditionOf);
    if (orClauses.length === 0) return and(...andClauses);
    if (andClauses.length === 0) return or(...orClauses);
    return and(...andClauses, or(...orClauses));
  };
}
