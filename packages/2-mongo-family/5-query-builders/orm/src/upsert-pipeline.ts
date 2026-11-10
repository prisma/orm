import {
  MongoAddFieldsStage,
  MongoAggArrayFilter,
  MongoAggCond,
  type MongoAggExpr,
  MongoAggFieldRef,
  MongoAggLiteral,
  MongoAggMap,
  MongoAggOperator,
  type MongoFilterExpr,
  type MongoUpdatePipelineStage,
} from '@internal/mongo-query-ast/execution';
import { MongoParamRef, type MongoValue } from '@internal/mongo-value';
import { ormError } from './orm-errors';

function fieldNamesIn(filter: MongoFilterExpr): string[] {
  switch (filter.kind) {
    case 'field':
    case 'exists':
      return [filter.field.split('.')[0] ?? filter.field];
    case 'and':
    case 'or':
      return filter.exprs.flatMap(fieldNamesIn);
    case 'not':
      return fieldNamesIn(filter.expr);
    case 'expr':
      return [];
  }
}

/**
 * True while the pipeline runs on the document an upsert is inserting. That document starts with only the equality fields the server copies from the filter, so every one of its keys is a field the filter names; a matched document always has an `_id` the filter does not name, or, when the filter names `_id`, fields besides the filter's.
 */
function isInsert(filter: MongoFilterExpr): MongoAggExpr {
  const keys = new MongoAggMap(
    MongoAggOperator.of('$objectToArray', MongoAggFieldRef.of('$ROOT')),
    MongoAggFieldRef.of('$this.k'),
    'this',
  );
  return MongoAggOperator.of('$setIsSubset', [
    keys,
    MongoAggLiteral.of([...new Set(fieldNamesIn(filter))]),
  ]);
}

function orEmptyList(field: string): MongoAggExpr {
  return MongoAggOperator.of('$ifNull', [MongoAggFieldRef.of(field), MongoAggLiteral.of([])]);
}

function whenList(field: string, expr: MongoAggExpr): MongoAggExpr {
  return MongoAggCond.of(
    MongoAggOperator.of('$isArray', MongoAggFieldRef.of(field)),
    expr,
    MongoAggFieldRef.of(field),
  );
}

function popped(field: string, end: unknown): MongoAggExpr {
  const size = MongoAggOperator.size(MongoAggFieldRef.of(field));
  const rest = MongoAggOperator.subtract(size, MongoAggLiteral.of(1));
  const kept = MongoAggOperator.of('$slice', [
    MongoAggFieldRef.of(field),
    MongoAggLiteral.of(end === -1 ? 1 : 0),
    rest,
  ]);
  return whenList(
    field,
    MongoAggCond.of(
      MongoAggOperator.of('$lte', [size, MongoAggLiteral.of(1)]),
      MongoAggLiteral.of([]),
      kept,
    ),
  );
}

function operatorExpression(operator: string, field: string, value: MongoValue): MongoAggExpr {
  switch (operator) {
    case '$set':
      return MongoAggLiteral.of(value);
    case '$unset':
      return MongoAggFieldRef.of('$REMOVE');
    case '$inc':
      return MongoAggOperator.add(
        MongoAggOperator.of('$ifNull', [MongoAggFieldRef.of(field), MongoAggLiteral.of(0)]),
        MongoAggLiteral.of(value),
      );
    case '$mul':
      return MongoAggOperator.multiply(
        MongoAggOperator.of('$ifNull', [MongoAggFieldRef.of(field), MongoAggLiteral.of(0)]),
        MongoAggLiteral.of(value),
      );
    case '$push':
      return MongoAggOperator.of('$concatArrays', [
        orEmptyList(field),
        MongoAggLiteral.of([value]),
      ]);
    case '$addToSet':
      return MongoAggCond.of(
        MongoAggOperator.of('$in', [MongoAggLiteral.of(value), orEmptyList(field)]),
        orEmptyList(field),
        MongoAggOperator.of('$concatArrays', [orEmptyList(field), MongoAggLiteral.of([value])]),
      );
    case '$pull':
      if (typeof value === 'object' && value !== null && !(value instanceof MongoParamRef)) {
        throw ormError(
          'ORM.OPERATION_UNSUPPORTED',
          `upsert() cannot pull by a match document from "${field}" when create sets a field that has an update default. Pull a single value, or leave that field out of create.`,
          { meta: { method: 'upsert', field } },
        );
      }
      return whenList(
        field,
        MongoAggArrayFilter.of(
          MongoAggFieldRef.of(field),
          MongoAggOperator.of('$ne', [MongoAggFieldRef.of('$this'), MongoAggLiteral.of(value)]),
          'this',
        ),
      );
    case '$pop':
      return popped(field, value instanceof MongoParamRef ? value.value : value);
    default:
      throw ormError(
        'ORM.OPERATION_UNSUPPORTED',
        `upsert() cannot apply ${operator} to "${field}" when create sets a field that has an update default.`,
        { meta: { method: 'upsert', field, operator } },
      );
  }
}

/**
 * The one-command form of an upsert whose `create` sets a field that also has an update default: an update pipeline that, on insert, writes every `create` value, including those fields, and on update applies the update and its defaults. Every value is a `$literal`, so a string such as `'$x'` is not read as a field path.
 */
export function upsertPipeline(input: {
  readonly filter: MongoFilterExpr;
  readonly update: Readonly<Record<string, Readonly<Record<string, MongoValue>>>>;
  readonly create: Readonly<Record<string, MongoValue>>;
  readonly createWins: ReadonlySet<string>;
}): ReadonlyArray<MongoUpdatePipelineStage> {
  const inserting = isInsert(input.filter);
  const fields: Record<string, MongoAggExpr> = {};
  for (const [operator, group] of Object.entries(input.update)) {
    for (const [field, value] of Object.entries(group)) {
      const onUpdate = operatorExpression(operator, field, value);
      const created = input.create[field];
      fields[field] =
        operator === '$set' && input.createWins.has(field) && created !== undefined
          ? MongoAggCond.of(inserting, MongoAggLiteral.of(created), onUpdate)
          : onUpdate;
    }
  }
  for (const [field, value] of Object.entries(input.create)) {
    if (!Object.hasOwn(fields, field)) {
      fields[field] = MongoAggCond.of(
        inserting,
        MongoAggLiteral.of(value),
        MongoAggFieldRef.of(field),
      );
    }
  }
  return [new MongoAddFieldsStage(fields)];
}
