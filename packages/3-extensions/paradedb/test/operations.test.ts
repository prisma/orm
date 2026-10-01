import { createSqlOperationRegistry } from '@internal/sql-operations';
import { OperationExpr, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { ParadeDbProximityChain } from '../src/core/proximity-chain';
import paradedbDescriptor from '../src/exports/runtime';

function getProximityChain(start: unknown): ParadeDbProximityChain {
  const operations = paradedbDescriptor.queryOperations?.() ?? {};
  const op = operations['paradeDbProximity'];
  if (!op) throw new Error('paradeDbProximity not found');
  const result = op.impl(start as never) as unknown;
  if (!(result instanceof ParadeDbProximityChain)) {
    throw new Error('paradeDbProximity did not return a ParadeDbProximityChain');
  }
  return result;
}

function buildOpAst(
  op: { impl: (...args: never[]) => unknown } | undefined,
  ...args: unknown[]
): OperationExpr {
  if (!op) throw new Error('operation not found');
  const expr = op.impl(...(args as never[])) as unknown as { buildAst(): OperationExpr };
  return expr.buildAst();
}

describe('paradedb operations', () => {
  it('descriptor has correct metadata', () => {
    expect(paradedbDescriptor.kind).toBe('extension');
    expect(paradedbDescriptor.id).toBe('paradedb');
    expect(paradedbDescriptor.familyId).toBe('sql');
    expect(paradedbDescriptor.targetId).toBe('postgres');
    expect(paradedbDescriptor.version).toBe('0.0.1');
  });

  it('descriptor provides query operations whose impls build AST with lowering', () => {
    const operations = paradedbDescriptor.queryOperations?.() ?? {};
    expect(Object.keys(operations)).toHaveLength(11);

    const matchOps: ReadonlyArray<readonly [string, string]> = [
      ['paradeDbMatch', '@@@'],
      ['paradeDbMatchAny', '|||'],
      ['paradeDbMatchAll', '&&&'],
      ['paradeDbTerm', '==='],
      ['paradeDbPhrase', '###'],
    ];
    for (const [method, op] of matchOps) {
      const ast = buildOpAst(
        operations[method],
        ParamRef.of('hello', { codec: { codecId: 'pg/text@1' } }),
        'world',
      );
      expect(ast).toBeInstanceOf(OperationExpr);
      expect(ast.lowering).toEqual({
        targetFamily: 'sql',
        template: `{{self}} ${op} {{arg0}}`,
      });
    }

    const scoreAst = buildOpAst(
      operations['paradeDbScore'],
      ParamRef.of(1, { codec: { codecId: 'pg/int4@1' } }),
    );
    expect(scoreAst.lowering).toEqual({
      targetFamily: 'sql',
      template: 'pdb.score({{self}})',
    });

    const typmodOps: ReadonlyArray<readonly [string, string, number]> = [
      ['paradeDbFuzzy', 'fuzzy', 2],
      ['paradeDbBoost', 'boost', 3],
      ['paradeDbConst', 'const', 1],
      ['paradeDbSlop', 'slop', 2],
    ];
    for (const [method, pdbType, n] of typmodOps) {
      const ast = buildOpAst(
        operations[method],
        ParamRef.of('q', { codec: { codecId: 'pg/text@1' } }),
        n,
      );
      expect(ast.lowering).toEqual({
        targetFamily: 'sql',
        template: `{{self}}::pdb.${pdbType}({{arg0}})`,
      });
      // typmod cast args must be inline literals (PG rejects parameterized typmods).
      expect(ast.args?.[0]?.kind).toBe('literal');
    }

    // paradeDbProximity returns a builder; one .within(...) step produces the
    // single-edge `(start ## N ## term)` AST.
    const proximityAst = getProximityChain(
      ParamRef.of('sleek', { codec: { codecId: 'pg/text@1' } }),
    )
      .within(1, 'shoes')
      .buildAst() as OperationExpr;
    expect(proximityAst).toBeInstanceOf(OperationExpr);
    expect(proximityAst.lowering).toEqual({
      targetFamily: 'sql',
      template: '({{self}} ## {{arg0}} ## {{arg1}})',
    });
    expect(proximityAst.args?.[0]?.kind).toBe('literal'); // distance literal
  });

  it('paradeDbProximity chains multiple .within(...) steps with mixed direction', () => {
    const ast = getProximityChain(ParamRef.of('sleek', { codec: { codecId: 'pg/text@1' } }))
      .within(1, 'running')
      .within(2, 'shoes', { ordered: true })
      .buildAst() as OperationExpr;

    expect(ast.lowering).toEqual({
      targetFamily: 'sql',
      template: '({{self}} ## {{arg0}} ## {{arg1}} ##> {{arg2}} ##> {{arg3}})',
    });
    // arg0 = distance literal (##), arg2 = distance literal (##>).
    expect(ast.args?.[0]?.kind).toBe('literal');
    expect(ast.args?.[2]?.kind).toBe('literal');
  });

  it('paradeDbProximity throws on empty chain or invalid distance', () => {
    const chain = getProximityChain(ParamRef.of('sleek', { codec: { codecId: 'pg/text@1' } }));

    expect(() => chain.buildAst()).toThrow('chain must have at least one .within');
    expect(() => chain.within(-1, 'x')).toThrow('non-negative integer');
    expect(() => chain.within(1.5, 'x')).toThrow('non-negative integer');
  });

  it('typmod-cast ops reject out-of-range / non-integer values', () => {
    const operations = paradedbDescriptor.queryOperations?.() ?? {};
    const find = (method: string) => {
      const op = operations[method];
      if (!op) throw new Error(`${method} not found`);
      return op;
    };
    const term = ParamRef.of('term', { codec: { codecId: 'pg/text@1' } });

    expect(() => find('paradeDbFuzzy').impl(term as never, 3 as never)).toThrow(
      'distance must be an integer in [0, 2]',
    );
    expect(() => find('paradeDbFuzzy').impl(term as never, 1.5 as never)).toThrow(
      'distance must be an integer in [0, 2]',
    );

    expect(() => find('paradeDbBoost').impl(term as never, 3000 as never)).toThrow(
      'boost must be an integer in [-2048, 2048]',
    );
    expect(() => find('paradeDbBoost').impl(term as never, 1.5 as never)).toThrow(
      'boost must be an integer in [-2048, 2048]',
    );

    expect(() => find('paradeDbConst').impl(term as never, 1.5 as never)).toThrow(
      'value must be an integer',
    );

    expect(() => find('paradeDbSlop').impl(term as never, -1 as never)).toThrow(
      'slop must be a non-negative integer',
    );
    expect(() => find('paradeDbSlop').impl(term as never, 1.5 as never)).toThrow(
      'slop must be a non-negative integer',
    );
  });

  it('operations carry self codec dispatch hints', () => {
    const operations = paradedbDescriptor.queryOperations?.() ?? {};

    const textOps = [
      'paradeDbMatch',
      'paradeDbMatchAny',
      'paradeDbMatchAll',
      'paradeDbTerm',
      'paradeDbPhrase',
      'paradeDbFuzzy',
      'paradeDbBoost',
      'paradeDbConst',
      'paradeDbSlop',
      'paradeDbProximity',
    ];
    for (const method of textOps) {
      expect(operations[method]?.self).toEqual({ codecId: 'pg/text@1' });
    }
    expect(operations['paradeDbScore']?.self).toEqual({ codecId: 'pg/int4@1' });
  });

  it('operations can be registered in registry', () => {
    const operations = paradedbDescriptor.queryOperations?.() ?? {};

    const registry = createSqlOperationRegistry();
    for (const [name, op] of Object.entries(operations)) {
      registry.register(name, op);
    }

    const entries = registry.entries();
    for (const method of [
      'paradeDbMatch',
      'paradeDbMatchAny',
      'paradeDbMatchAll',
      'paradeDbTerm',
      'paradeDbPhrase',
      'paradeDbFuzzy',
      'paradeDbBoost',
      'paradeDbConst',
      'paradeDbSlop',
      'paradeDbProximity',
      'paradeDbScore',
    ]) {
      expect(entries[method]).toBeDefined();
    }
  });

  it('descriptor exposes empty codec registry', () => {
    expect(paradedbDescriptor.codecs()).toEqual([]);
  });

  it('instance is minimal (identity only)', () => {
    const instance = paradedbDescriptor.create();
    expect(instance.familyId).toBe('sql');
    expect(instance.targetId).toBe('postgres');
  });
});
