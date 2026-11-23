import type { CleanedWhere } from '@better-auth/core/db/adapter';
import { BetterAuthError } from '@better-auth/core/error';
import { all, and, or } from '@prisma/orm-family-sql/orm-client';
import { codecKind } from './models/codec-kinds';
import { describeFieldType } from './models/field-type';
import type { FoundModel } from './models/model-lookup';
import {
  asCondition,
  type Condition,
  callMethod,
  hasMethod,
  type ModelAccessor,
  property,
  type WhereFunctions,
  type WhereTools,
} from './orm';

/** The codec id a raw expression over the field returns. A field that is not a single scalar, or whose codec is known not to hold text, supports no pattern or case-insensitive comparison; a codec the table does not know is tried. */
function scalarCodecIdOf(model: FoundModel, field: string, operator: string): string {
  const type = model.model.fields[field];
  if (type?.type.kind !== 'scalar' || type.many) throw unsupportedError(model, field, operator);
  const kind = codecKind(type.type.codecId);
  if (kind !== undefined && kind !== 'string' && kind !== 'enum') {
    throw unsupportedError(model, field, operator);
  }
  return type.type.codecId;
}

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

function allStrings(values: readonly unknown[]): values is string[] {
  return values.length > 0 && values.every((item) => typeof item === 'string');
}

interface PatternContext {
  readonly fns: WhereFunctions;
  readonly field: unknown;
  readonly codecId: string;
}

function sensitivePattern(
  { fns, field, codecId }: PatternContext,
  operator: string,
  value: string,
): Condition {
  const expected = fns.raw`${value}`.returns(codecId);
  switch (operator) {
    case 'starts_with':
      return asCondition(
        fns.eq(fns.raw`substr(${field}, 1, length(${value}))`.returns(codecId), expected),
      );
    case 'ends_with':
      return asCondition(
        fns.eq(
          fns.raw`substr(${field}, length(${field}) - length(${value}) + 1)`.returns(codecId),
          expected,
        ),
      );
    default:
      return asCondition(
        fns.ne(
          fns.raw`replace(${field}, ${value}, '')`.returns(codecId),
          fns.raw`${field}`.returns(codecId),
        ),
      );
  }
}

function insensitivePattern(
  { fns, field, codecId }: PatternContext,
  operator: string,
  value: string,
): Condition {
  const expected = fns.raw`lower(${value})`.returns(codecId);
  switch (operator) {
    case 'eq':
      return asCondition(fns.eq(fns.raw`lower(${field})`.returns(codecId), expected));
    case 'ne':
      return asCondition(fns.ne(fns.raw`lower(${field})`.returns(codecId), expected));
    case 'starts_with':
      return asCondition(
        fns.eq(
          fns.raw`substr(lower(${field}), 1, length(lower(${value})))`.returns(codecId),
          expected,
        ),
      );
    case 'ends_with':
      return asCondition(
        fns.eq(
          fns.raw`substr(lower(${field}), length(lower(${field})) - length(lower(${value})) + 1)`.returns(
            codecId,
          ),
          expected,
        ),
      );
    default:
      return asCondition(
        fns.ne(
          fns.raw`replace(lower(${field}), lower(${value}), '')`.returns(codecId),
          fns.raw`lower(${field})`.returns(codecId),
        ),
      );
  }
}

function clauseCondition(
  accessor: ModelAccessor,
  { fns }: WhereTools,
  model: FoundModel,
  clause: CleanedWhere,
): Condition {
  const name = clause.field;
  const field = fieldOf(accessor, name);
  const operator = clause.operator ?? 'eq';
  const value = clause.value;
  const insensitive = clause.mode === 'insensitive';
  const pattern = (): PatternContext => ({
    fns,
    field,
    codecId: scalarCodecIdOf(model, name, operator),
  });
  const method = (methodName: string, ...args: unknown[]) =>
    call(field, methodName, model, name, operator, ...args);

  switch (operator) {
    case 'eq':
    case 'ne':
      if (value === null) return method(operator === 'eq' ? 'isNull' : 'isNotNull');
      if (insensitive && typeof value === 'string') {
        return insensitivePattern(pattern(), operator, value);
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
      const isIn = operator === 'in';
      if (values.length === 0) return isIn ? or() : and();
      if (insensitive && allStrings(values)) {
        const each = values.map((item) => insensitivePattern(pattern(), isIn ? 'eq' : 'ne', item));
        return isIn ? or(...each) : and(...each);
      }
      return method(isIn ? 'in' : 'notIn', values);
    }
    case 'starts_with':
    case 'ends_with':
    case 'contains': {
      const context = pattern();
      const text = String(value);
      if (text === '') return method('isNotNull');
      return insensitive
        ? insensitivePattern(context, operator, text)
        : sensitivePattern(context, operator, text);
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
  where: readonly CleanedWhere[] | undefined,
): (accessor: ModelAccessor, tools: WhereTools) => Condition {
  return (accessor, tools) => {
    if (where === undefined || where.length === 0) return all();
    const conditionOf = (clause: CleanedWhere) => clauseCondition(accessor, tools, model, clause);
    const andClauses = where.filter((clause) => clause.connector !== 'OR').map(conditionOf);
    const orClauses = where.filter((clause) => clause.connector === 'OR').map(conditionOf);
    if (orClauses.length === 0) return and(...andClauses);
    if (andClauses.length === 0) return or(...orClauses);
    return and(...andClauses, or(...orClauses));
  };
}
