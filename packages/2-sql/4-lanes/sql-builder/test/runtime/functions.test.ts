import { buildSqlAggregateDescriptorRegistry } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import {
  AggregateExpr,
  BinaryExpr,
  ColumnRef,
  IdentifierRef,
} from '@internal/sql-relational-core/ast';
import { buildCodecDescriptorRegistry } from '@internal/sql-relational-core/codec-descriptor-registry';
import { ExpressionImpl } from '@internal/sql-relational-core/expression';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AggregateFunctions } from '../../src/expression';
import { createFieldProxy } from '../../src/runtime/field-proxy';
import { createAggregateFunctions } from '../../src/runtime/functions';
import type { QueryContext } from '../../src/scope';
import { usersScope } from './test-helpers';

const f = () => createFieldProxy(usersScope);

const stubInferer = { inferCodec: () => 'pg/text@1' };

/**
 * The aggregate overloads these cases resolve against: a count into `lib/int8@1`
 * whatever it counts, and a sum that widens its input to the same. Declared
 * directly rather than synthesized from codecs, which drops traits.
 */
function testAggregateRegistry() {
  return buildSqlAggregateDescriptorRegistry(
    [
      {
        operation: 'count',
        input: { kind: 'any' },
        output: { kind: 'codec', codecId: 'lib/int8@1' },
        nullable: false,
        emptyResultJson: '0',
      },
      {
        operation: 'sum',
        input: { kind: 'trait', trait: 'numeric' },
        output: { kind: 'codec', codecId: 'lib/int8@1' },
        nullable: true,
      },
      {
        operation: 'avg',
        input: { kind: 'trait', trait: 'numeric' },
        output: { kind: 'codec', codecId: 'lib/int8@1' },
        nullable: true,
      },
      {
        operation: 'min',
        input: { kind: 'trait', trait: 'numeric' },
        output: { kind: 'self' },
        nullable: true,
      },
      {
        operation: 'max',
        input: { kind: 'trait', trait: 'numeric' },
        output: { kind: 'self' },
        nullable: true,
      },
    ],
    buildCodecDescriptorRegistry([
      {
        codecId: 'pg/int4@1',
        traits: ['numeric', 'order', 'equality'],
        isParameterized: false,
        paramsSchema: undefined,
        factory: () => () => ({ id: 'pg/int4@1' }),
      },
      // A textual codec, so `sum` over it is the shape SQLite has twelve of:
      // the database computes something, and the target declines to type it.
      {
        codecId: 'lib/text@1',
        traits: ['textual', 'order', 'equality'],
        isParameterized: false,
        paramsSchema: undefined,
        factory: () => () => ({ id: 'lib/text@1' }),
      },
      {
        codecId: 'lib/int8@1',
        traits: ['numeric', 'order', 'equality'],
        isParameterized: false,
        paramsSchema: undefined,
        factory: () => () => ({ id: 'lib/int8@1' }),
      },
    ] as never),
  );
}

/**
 * The static face these AST-shape cases run under. The scope proxy here is
 * broadly typed, so every operation carries an `anyInput` row; the precise
 * admit/reject proofs live in `test/types/aggregate-count.types.test-d.ts`.
 */
type TestAggregateQC = Omit<QueryContext, 'aggregateTypes'> & {
  aggregateTypes: {
    count: {
      byCodec: Record<never, never>;
      withoutInput: { output: 'lib/int8@1'; nullable: false };
      anyInput: { output: 'lib/int8@1'; nullable: false };
    };
    sum: { byCodec: Record<never, never>; anyInput: { output: 'lib/int8@1'; nullable: true } };
    avg: { byCodec: Record<never, never>; anyInput: { output: 'lib/int8@1'; nullable: true } };
    min: { byCodec: Record<never, never>; anyInput: { output: 'lib/int8@1'; nullable: true } };
    max: { byCodec: Record<never, never>; anyInput: { output: 'lib/int8@1'; nullable: true } };
  };
};
describe('createAggregateFunctions', () => {
  let fns: AggregateFunctions<TestAggregateQC>;

  beforeEach(() => {
    fns = createAggregateFunctions<TestAggregateQC>({}, stubInferer, testAggregateRegistry());
  });

  it('count() produces AggregateExpr with fn count and no expr', () => {
    const result = fns.count();
    const ast = result.buildAst() as AggregateExpr;

    expect(ast).toBeInstanceOf(AggregateExpr);
    expect(ast.fn).toBe('count');
    expect(ast.expr).toBeUndefined();
    // The count carries the codec the registry resolved for it, in the slot the
    // projection reads, rather than a codec id the lane names itself.
    expect((result as ExpressionImpl).returnType).toEqual({
      codecId: 'lib/int8@1',
      nullable: false,
      codec: { codecId: 'lib/int8@1' },
    });
  });

  it('count(expr) produces AggregateExpr with fn count and the given expr', () => {
    const result = fns.count(f().id);
    const ast = result.buildAst() as AggregateExpr;

    expect(ast.fn).toBe('count');
    expect(ast.expr).toBeInstanceOf(IdentifierRef);
  });

  // SQLite computes `sum` over a text column — reading leading numbers where
  // there are any and 0 where there are not — and its target declines to type
  // the result, because the storage class depends on the rows. The lane
  // refuses the pair outright: no declaration means no result identity to
  // type or decode, and executing anyway would hand back exactly the
  // driver-native value the declared-codec path exists to replace.
  it('rejects an aggregate the target declares no overload for', () => {
    const textField = new ExpressionImpl(ColumnRef.of('users', 'name'), {
      codecId: 'lib/text@1',
      nullable: false,
      codec: { codecId: 'lib/text@1' },
    });

    // The pair is unsayable on the typed surface; the cast reproduces a dynamic invocation.
    expect(() => fns.sum(textField as never)).toThrow(
      /The composed target declares no 'sum' aggregate over codec 'lib\/text@1'/,
    );
  });

  it('sum produces AggregateExpr with fn sum', () => {
    const result = fns.sum(f().id);
    const ast = result.buildAst() as AggregateExpr;

    expect(ast).toBeInstanceOf(AggregateExpr);
    expect(ast.fn).toBe('sum');
    expect(ast.expr).toBeInstanceOf(IdentifierRef);
    // A sum over an int4 widens; the lane states what the registry answered,
    // not the input it was given.
    expect((result as ExpressionImpl).returnType).toEqual({
      codecId: 'lib/int8@1',
      nullable: true,
      codec: { codecId: 'lib/int8@1' },
    });
  });

  it('avg produces AggregateExpr with fn avg', () => {
    const result = fns.avg(f().id);
    expect((result.buildAst() as AggregateExpr).fn).toBe('avg');
    expect((result as ExpressionImpl).returnType.nullable).toBe(true);
  });

  it('min produces AggregateExpr with fn min', () => {
    const result = fns.min(f().id);
    expect((result.buildAst() as AggregateExpr).fn).toBe('min');
  });

  it('max produces AggregateExpr with fn max', () => {
    const result = fns.max(f().id);
    expect((result.buildAst() as AggregateExpr).fn).toBe('max');
  });

  it('inherits comparison operators from Functions', () => {
    const result = fns.eq(f().id, 1);
    const ast = result.buildAst() as BinaryExpr;

    expect(ast).toBeInstanceOf(BinaryExpr);
    expect(ast.op).toBe('eq');
  });

  // The map of contributed operations inherits from Object.prototype, so a
  // lookup that reads it without checking own-ness answers `toString` with
  // that prototype's member instead of falling through to the base functions.
  it('resolves no aggregate for a name only Object.prototype carries', () => {
    const dynamic = fns as unknown as Record<string, unknown>;

    expect(dynamic['toString']).toBeUndefined();
    expect(dynamic['hasOwnProperty']).toBeUndefined();
  });
});
