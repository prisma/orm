import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  type Expression,
  isExpression,
  type RawCodecInferer,
  type RawSqlBuilder,
  type RawSqlInterpolation,
  type ScopeField,
} from '@internal/sql-relational-core/expression';
import { createFunctions } from '@internal/sql-relational-core/functions';
import type { IndexReference } from '@internal/sql-relational-core/index-reference';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { blindCast } from '@internal/utils/casts';
import { codecTraits } from './column-codec';
import { checkedOrderByItem } from './order-by-guards';
import { ormError } from './orm-errors';
import type { ModelCallbackTools, ModelIndexReferences, OrderOptions, OrmFunctions } from './types';

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

/**
 * The expression with `asc()` and `desc()` added. Its own properties read as they are, which a frozen expression requires; an inherited method is bound to the expression, so it keeps working.
 */
function orderable(expression: Expression<ScopeField>): unknown {
  const order = {
    asc: (options?: OrderOptions) => checkedOrderByItem('asc', expression.buildAst(), options),
    desc: (options?: OrderOptions) => checkedOrderByItem('desc', expression.buildAst(), options),
  };
  return new Proxy(expression, {
    has: (target, prop) => prop === 'asc' || prop === 'desc' || Reflect.has(target, prop),
    get(target, prop) {
      if (prop === 'asc' || prop === 'desc') return order[prop];
      const member: unknown = Reflect.get(target, prop, target);
      return typeof member === 'function' && !Object.hasOwn(target, prop)
        ? member.bind(target)
        : member;
    },
  });
}

function orderableValue(context: ExecutionContext, result: unknown): unknown {
  if (!isExpression(result)) return result;
  if (codecTraits(context, result.returnType.codecId).includes('boolean')) return result;
  return orderable(result);
}

function orderableRaw(
  raw: (strings: TemplateStringsArray, ...values: RawSqlInterpolation[]) => RawSqlBuilder,
) {
  return (strings: TemplateStringsArray, ...values: RawSqlInterpolation[]) => {
    const builder = raw(strings, ...values);
    return {
      returns: (spec: Parameters<RawSqlBuilder['returns']>[0]) => orderable(builder.returns(spec)),
    };
  };
}

function createOrmFunctions<TContract extends Contract<SqlStorage>>(
  context: ExecutionContext<TContract>,
  rawCodecInferer: RawCodecInferer | undefined,
): OrmFunctions<TContract> {
  const operations = context.queryOperations.entries();
  const fns = createFunctions(operations, rawCodecInferer ?? rawCodecInfererUnavailable);
  const raw = orderableRaw(fns.raw);
  return new Proxy(
    blindCast<OrmFunctions<TContract>, 'the handler answers every function name'>({}),
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop === 'raw') return raw;
        const fn: unknown = Reflect.get(fns, prop);
        if (typeof fn !== 'function' || !Object.hasOwn(operations, prop)) return fn;
        return (...args: unknown[]) => orderableValue(context, Reflect.apply(fn, undefined, args));
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
