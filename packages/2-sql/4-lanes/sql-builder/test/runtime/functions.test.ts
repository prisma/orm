import { buildSqlAggregateDescriptorRegistry } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import {
  AggregateExpr,
  AndExpr,
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  IdentifierRef,
  ListExpression,
  NullCheckExpr,
  OperationExpr,
  OrExpr,
  ParamRef,
  SelectAst,
  SubqueryExpr,
} from '@internal/sql-relational-core/ast';
import { buildCodecDescriptorRegistry } from '@internal/sql-relational-core/codec-descriptor-registry';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AggregateFunctions, Functions } from '../../src/expression';
import { ExpressionImpl } from '../../src/runtime/expression-impl';
import { createFieldProxy } from '../../src/runtime/field-proxy';
import { createAggregateFunctions, createFunctions } from '../../src/runtime/functions';
import type { QueryContext, ScopeField } from '../../src/scope';
import { joinedScope, makeSubquery, usersScope } from './test-helpers';

const f = () => createFieldProxy(usersScope);
const jf = () => createFieldProxy(joinedScope);

const stubInferer = { inferCodec: () => 'pg/text@1' };

describe('createFunctions', () => {
  let fns: ReturnType<typeof createFunctions>;

  beforeEach(() => {
    fns = createFunctions({}, stubInferer);
  });

  describe('comparison operators', () => {
    it('eq produces BinaryExpr with op eq', () => {
      const result = fns.eq(f().id, 1);
      const ast = result.buildAst() as BinaryExpr;

      expect(ast).toBeInstanceOf(BinaryExpr);
      expect(ast.op).toBe('eq');
      expect(ast.left).toBeInstanceOf(IdentifierRef);
      expect((ast.left as IdentifierRef).name).toBe('id');
      expect(ast.right).toBeInstanceOf(ParamRef);
      expect((ast.right as ParamRef).value).toBe(1);
    });

    it('ne produces BinaryExpr with op neq', () => {
      const result = fns.ne(f().id, 1);
      expect((result.buildAst() as BinaryExpr).op).toBe('neq');
    });

    it('gt produces BinaryExpr with op gt', () => {
      const result = fns.gt(f().id, 5);
      expect((result.buildAst() as BinaryExpr).op).toBe('gt');
    });

    it('gte produces BinaryExpr with op gte', () => {
      const result = fns.gte(f().id, 5);
      expect((result.buildAst() as BinaryExpr).op).toBe('gte');
    });

    it('lt produces BinaryExpr with op lt', () => {
      const result = fns.lt(f().id, 5);
      expect((result.buildAst() as BinaryExpr).op).toBe('lt');
    });

    it('lte produces BinaryExpr with op lte', () => {
      const result = fns.lte(f().id, 5);
      expect((result.buildAst() as BinaryExpr).op).toBe('lte');
    });

    it('eq with two expressions produces BinaryExpr with both ColumnRefs', () => {
      const fields = jf();
      const result = fns.eq(fields.users.id, fields.posts.user_id);
      const ast = result.buildAst() as BinaryExpr;

      expect(ast.op).toBe('eq');
      expect(ast.left).toBeInstanceOf(ColumnRef);
      expect(ast.right).toBeInstanceOf(ColumnRef);
      expect((ast.left as ColumnRef).table).toBe('users');
      expect((ast.right as ColumnRef).table).toBe('posts');
    });

    it('eq with null produces NullCheckExpr (IS NULL)', () => {
      const result = fns.eq(f().id, null);
      const ast = result.buildAst() as NullCheckExpr;

      expect(ast).toBeInstanceOf(NullCheckExpr);
      expect(ast.isNull).toBe(true);
      expect(ast.expr).toBeInstanceOf(IdentifierRef);
    });

    it('ne with null produces NullCheckExpr (IS NOT NULL)', () => {
      const result = fns.ne(f().name, null);
      const ast = result.buildAst() as NullCheckExpr;

      expect(ast).toBeInstanceOf(NullCheckExpr);
      expect(ast.isNull).toBe(false);
      expect(ast.expr).toBeInstanceOf(IdentifierRef);
    });

    it('eq with null on left side produces NullCheckExpr', () => {
      const result = fns.eq(null, f().id);
      const ast = result.buildAst() as NullCheckExpr;

      expect(ast).toBeInstanceOf(NullCheckExpr);
      expect(ast.isNull).toBe(true);
      expect(ast.expr).toBeInstanceOf(IdentifierRef);
    });
  });

  describe('logical operators', () => {
    it('and produces AndExpr', () => {
      const fields = f();
      const eq1 = fns.eq(fields.id, 1);
      const eq2 = fns.eq(fields.name, 'alice');
      const result = fns.and(eq1, eq2);
      const ast = result.buildAst() as AndExpr;

      expect(ast).toBeInstanceOf(AndExpr);
      expect(ast.exprs).toHaveLength(2);
      expect(ast.exprs[0]).toBeInstanceOf(BinaryExpr);
      expect(ast.exprs[1]).toBeInstanceOf(BinaryExpr);
    });

    it('or produces OrExpr', () => {
      const fields = f();
      const eq1 = fns.eq(fields.id, 1);
      const eq2 = fns.eq(fields.id, 2);
      const result = fns.or(eq1, eq2);
      const ast = result.buildAst() as OrExpr;

      expect(ast).toBeInstanceOf(OrExpr);
      expect(ast.exprs).toHaveLength(2);
    });
  });

  describe('subquery predicates', () => {
    it('exists produces ExistsExpr', () => {
      const result = fns.exists(makeSubquery() as never);
      const ast = result.buildAst() as ExistsExpr;

      expect(ast).toBeInstanceOf(ExistsExpr);
      expect(ast.notExists).toBe(false);
      expect(ast.subquery).toBeInstanceOf(SelectAst);
    });

    it('notExists produces ExistsExpr with notExists=true', () => {
      const result = fns.notExists(makeSubquery() as never);
      const ast = result.buildAst() as ExistsExpr;

      expect(ast).toBeInstanceOf(ExistsExpr);
      expect(ast.notExists).toBe(true);
    });
  });

  describe('codec propagation', () => {
    it('eq(field, value) propagates codec from the column-bound left side onto the ParamRef', () => {
      const result = fns.eq(f().email, 'alice@example.com');
      const ast = result.buildAst() as BinaryExpr;
      const right = ast.right as ParamRef;

      expect(right).toBeInstanceOf(ParamRef);
      expect(right.codec).toBeDefined();
      expect(right.codec?.codecId).toBe('pg/text@1');
    });

    it('eq(value, field) propagates codec from the column-bound right side onto the ParamRef', () => {
      const result = fns.eq('alice@example.com', f().email);
      const ast = result.buildAst() as BinaryExpr;
      const left = ast.left as ParamRef;

      expect(left).toBeInstanceOf(ParamRef);
      expect(left.codec).toBeDefined();
      expect(left.codec?.codecId).toBe('pg/text@1');
    });

    it('comparison operators propagate codec onto value-side ParamRefs', () => {
      const result = fns.gt(f().id, 5);
      const ast = result.buildAst() as BinaryExpr;
      const right = ast.right as ParamRef;

      expect(right.codec).toBeDefined();
      expect(right.codec?.codecId).toBe('pg/int4@1');
    });

    it('in() propagates codec onto every value ParamRef in the list', () => {
      const result = fns.in(f().email, ['a@x', 'b@x', 'c@x']);
      const ast = result.buildAst() as BinaryExpr;
      const list = ast.right as ListExpression;

      for (const value of list.values) {
        expect(value).toBeInstanceOf(ParamRef);
        expect((value as ParamRef).codec).toBeDefined();
        expect((value as ParamRef).codec?.codecId).toBe('pg/text@1');
      }
    });
  });

  describe('in / notIn', () => {
    it('in with array produces BinaryExpr with ListExpression of ParamRefs', () => {
      const result = fns.in(f().id, [1, 2, 3]);
      const ast = result.buildAst() as BinaryExpr;

      expect(ast).toBeInstanceOf(BinaryExpr);
      expect(ast.op).toBe('in');
      expect(ast.left).toBeInstanceOf(IdentifierRef);
      expect(ast.right).toBeInstanceOf(ListExpression);
      const list = ast.right as ListExpression;
      expect(list.values).toHaveLength(3);
      expect(list.values.every((v) => v instanceof ParamRef)).toBe(true);
    });

    it('in with subquery produces BinaryExpr with SubqueryExpr', () => {
      const result = fns.in(f().id, makeSubquery() as never);
      const ast = result.buildAst() as BinaryExpr;

      expect(ast.op).toBe('in');
      expect(ast.right).toBeInstanceOf(SubqueryExpr);
    });

    it('notIn with array produces BinaryExpr with op notIn', () => {
      const result = fns.notIn(f().id, [1, 2]);
      const ast = result.buildAst() as BinaryExpr;

      expect(ast.op).toBe('notIn');
      expect(ast.right).toBeInstanceOf(ListExpression);
    });

    it('notIn with subquery produces BinaryExpr with SubqueryExpr', () => {
      const result = fns.notIn(f().id, makeSubquery() as never);
      const ast = result.buildAst() as BinaryExpr;

      expect(ast.op).toBe('notIn');
      expect(ast.right).toBeInstanceOf(SubqueryExpr);
    });
  });
});

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
        targetTypes: [],
        isParameterized: false,
        paramsSchema: undefined,
        factory: () => () => ({ id: 'pg/int4@1' }),
      },
      // A textual codec, so `sum` over it is the shape SQLite has twelve of:
      // the database computes something, and the target declines to type it.
      {
        codecId: 'lib/text@1',
        traits: ['textual', 'order', 'equality'],
        targetTypes: [],
        isParameterized: false,
        paramsSchema: undefined,
        factory: () => () => ({ id: 'lib/text@1' }),
      },
      {
        codecId: 'lib/int8@1',
        traits: ['numeric', 'order', 'equality'],
        targetTypes: [],
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

describe('extension functions', () => {
  it('produces OperationExpr from queryOperationTypes', () => {
    const vectorField: ScopeField = { codecId: 'pgvector/vector@1', nullable: false };
    const lowering = {
      targetFamily: 'sql' as const,
      template: '{{self}} <=> {{arg0}}',
    };
    const resultField: ScopeField = { codecId: 'pg/float8@1', nullable: false };

    const cosineDistanceImpl = (a: unknown, b: unknown) => {
      const selfAst = (a as ExpressionImpl).buildAst();
      const otherAst = (b as ExpressionImpl).buildAst();
      return new ExpressionImpl(
        new OperationExpr({
          method: 'cosineDistance',
          self: selfAst,
          args: [otherAst],
          returns: resultField,
          lowering,
        }),
        resultField,
      );
    };

    const operations = {
      cosineDistance: {
        self: { codecId: 'pgvector/vector@1' } as const,
        impl: cosineDistanceImpl,
      },
    };

    const fns = createFunctions(operations, stubInferer);

    const expr1 = new ExpressionImpl(ColumnRef.of('posts', 'embedding'), vectorField);
    const expr2 = new ExpressionImpl(ColumnRef.of('other', 'embedding'), vectorField);

    type TestQC = {
      readonly codecTypes: Record<string, { readonly input: unknown; readonly output: unknown }>;
      readonly capabilities: Record<string, Record<string, boolean>>;
      readonly queryOperationTypes: typeof operations;
      readonly resolvedColumnOutputTypes: Record<string, never>;
      readonly aggregateTypes: Record<string, never>;
    };
    const typedFns = fns as unknown as Functions<TestQC>;
    const result = (typedFns.cosineDistance as typeof cosineDistanceImpl)(expr1, expr2);

    expect(result).toBeInstanceOf(ExpressionImpl);
    const ast = (result as ExpressionImpl).buildAst() as OperationExpr;
    expect(ast).toBeInstanceOf(OperationExpr);
    expect(ast.method).toBe('cosineDistance');
    expect(ast.self).toBeInstanceOf(ColumnRef);
    expect((ast.self as ColumnRef).table).toBe('posts');
    expect(ast.args).toHaveLength(1);
    expect(ast.args[0]).toBeInstanceOf(ColumnRef);
    expect((result as ExpressionImpl).returnType).toEqual({
      codecId: 'pg/float8@1',
      nullable: false,
    });
  });
});

describe('parameter embedding', () => {
  it('inline literal values are embedded as ParamRef nodes', () => {
    const fns = createFunctions({}, stubInferer);
    const fields = f();

    const r1 = fns.eq(fields.id, 42);
    const r2 = fns.eq(fields.name, 'alice');

    const ast1 = r1.buildAst() as BinaryExpr;
    const ast2 = r2.buildAst() as BinaryExpr;
    expect((ast1.right as ParamRef).value).toBe(42);
    expect((ast2.right as ParamRef).value).toBe('alice');
  });

  it('expression-to-expression comparisons do not create ParamRefs', () => {
    const fns = createFunctions({}, stubInferer);
    const fields = jf();

    const result = fns.eq(fields.users.id, fields.posts.user_id);
    const ast = result.buildAst() as BinaryExpr;
    expect(ast.left).toBeInstanceOf(ColumnRef);
    expect(ast.right).toBeInstanceOf(ColumnRef);
  });
});
