import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { isWhereExpr, type WhereArg } from '@internal/sql-relational-core/ast';
import {
  type Expression,
  isExpression,
  type RawCodecInferer,
  type ScopeField,
} from '@internal/sql-relational-core/expression';
import { createFunctions } from '@internal/sql-relational-core/functions';
import type { IndexReference } from '@internal/sql-relational-core/index-reference';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { blindCast } from '@internal/utils/casts';
import { codecTraits } from './column-codec';
import { checkedOrderByItem } from './order-by-guards';
import { ormError } from './orm-errors';
import type {
  ModelCallbackTools,
  ModelIndexReferences,
  OrderOptions,
  OrmFunctions,
  WhereCallbackResult,
} from './types';

const NO_INDEXES: Readonly<Record<string, IndexReference>> = Object.freeze({});

/**
 * Refuses a bare value in `fns.raw` for an ORM client built without the adapter's raw codec inferer.
 */
const rawCodecInfererUnavailable: RawCodecInferer = {
  inferCodec(value) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      'fns.raw cannot infer the codec of an interpolated value: this ORM client was built without a raw codec inferer.',
      {
        why: 'A value interpolated into fns.raw is bound as a parameter, and its codec comes from the adapter.',
        fix: 'Wrap the value with param(value, { codecId }), or build the client through the database facade.',
        meta: { argument: typeof value },
      },
    );
  },
};

function orderableValue(context: ExecutionContext, result: unknown): unknown {
  if (!isExpression(result)) return result;
  if (codecTraits(context, result.returnType.codecId).includes('boolean')) return result;
  const value: Expression<ScopeField> = result;
  return Object.freeze({
    returnType: value.returnType,
    buildAst: () => value.buildAst(),
    asc: (options?: OrderOptions) => checkedOrderByItem('asc', value.buildAst(), options),
    desc: (options?: OrderOptions) => checkedOrderByItem('desc', value.buildAst(), options),
  });
}

function createOrmFunctions<TContract extends Contract<SqlStorage>>(
  context: ExecutionContext<TContract>,
  rawCodecInferer: RawCodecInferer | undefined,
): OrmFunctions<TContract> {
  const operations = context.queryOperations.entries();
  const fns: Readonly<Record<string, unknown>> = createFunctions(
    operations,
    rawCodecInferer ?? rawCodecInfererUnavailable,
  );
  return new Proxy(
    blindCast<OrmFunctions<TContract>, 'the handler answers every function name'>({}),
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        const fn = fns[prop];
        if (typeof fn !== 'function' || !Object.hasOwn(operations, prop)) return fn;
        return (...args: unknown[]) => orderableValue(context, fn(...args));
      },
    },
  );
}

/**
 * The second argument of a `where` or `orderBy` callback. `indexes` is read lazily, once.
 */
export function createCallbackTools<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string,
>(
  context: ExecutionContext<TContract>,
  rawCodecInferer: RawCodecInferer | undefined,
  indexes: () => Readonly<Record<string, IndexReference>>,
): ModelCallbackTools<TContract, ModelName, NsId> {
  let resolved: Readonly<Record<string, IndexReference>> | undefined;
  return Object.freeze({
    fns: createOrmFunctions(context, rawCodecInferer),
    get indexes() {
      resolved ??= indexes();
      return blindCast<
        ModelIndexReferences<TContract, ModelName, NsId>,
        "the storage table states each index's name, columns, type and options at runtime; the declared type is the contract's own statement about the same indexes"
      >(resolved);
    },
  });
}

/** The callback tools of a body that does not know its model: every function, and no index. */
export function createModellessCallbackTools<TContract extends Contract<SqlStorage>>(
  context: ExecutionContext<TContract>,
  rawCodecInferer: RawCodecInferer | undefined,
) {
  return createCallbackTools<TContract, string, string>(context, rawCodecInferer, () => NO_INDEXES);
}

/** A `where` callback's result as a filter: a condition from `fns` is an expression, and becomes its AST. */
export function whereArgOf(result: WhereCallbackResult): WhereArg {
  if (isWhereExpr(result) || 'toWhereExpr' in result) return result;
  return result.buildAst();
}
