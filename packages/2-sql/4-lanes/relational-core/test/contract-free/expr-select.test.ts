import { describe, expect, it } from 'vitest';
import {
  AggregateExpr,
  type AndExpr,
  type BinaryExpr,
  type ColumnRef,
  type ExistsExpr,
  FunctionSource,
  IdentifierRef,
  LiteralExpr,
  NullCheckExpr,
  OperationExpr,
  ParamRef,
  type RawExpr,
  SelectAst,
  TableSource,
} from '../../src/exports/ast';
import { CfExpr, cfExpr, cfTable, exprSelect } from '../../src/exports/contract-free';

describe('FunctionSource', () => {
  it('creates a frozen function-source node with name and args', () => {
    const arg = ParamRef.of('test');
    const src = FunctionSource.of('pragma_table_info', [arg]);
    expect(src.kind).toBe('function-source');
    expect(src.fn).toBe('pragma_table_info');
    expect(src.args).toHaveLength(1);
    expect(src.args[0]).toBe(arg);
    expect(src.alias).toBeUndefined();
    expect(src.columnAliases).toBeUndefined();
    expect(src.ordinality).toBe(false);
    expect(Object.isFrozen(src)).toBe(true);
  });

  it('supports an optional alias', () => {
    const src = FunctionSource.of('pragma_table_info', [ParamRef.of('t')], { alias: 'pti' });
    expect(src.alias).toBe('pti');
  });

  it('configures column aliases and ordinality without mutating construction inputs', () => {
    const arg = ParamRef.of('input');
    const args = [arg];
    const columnAliases = ['element', 'ord'];
    const source = FunctionSource.of('unnest', args, {
      alias: 'u',
      columnAliases,
    }).withOrdinality();

    args.push(ParamRef.of('ignored'));
    columnAliases.push('ignored');

    expect(source.args).toEqual([arg]);
    expect(source.columnAliases).toEqual(['element', 'ord']);
    expect(source.ordinality).toBe(true);
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source.args)).toBe(true);
    expect(Object.isFrozen(source.columnAliases)).toBe(true);
  });

  it('rejects an empty column-alias list', () => {
    expect(() => FunctionSource.of('unnest', [], { alias: 'u', columnAliases: [] })).toThrow(
      'FunctionSource column aliases must not be empty',
    );
  });

  it('preserves configuration while rewriting arguments', () => {
    const originalArg = ParamRef.of('before');
    const replacementArg = ParamRef.of('after');
    const source = FunctionSource.of('unnest', [originalArg], {
      alias: 'u',
      columnAliases: ['element', 'ord'],
    }).withOrdinality();

    expect(source.rewrite({})).toBe(source);

    const rewritten = source.rewrite({
      paramRef: (ref) => (ref === originalArg ? replacementArg : ref),
    });

    expect(rewritten).toBeInstanceOf(FunctionSource);
    if (!(rewritten instanceof FunctionSource)) {
      throw new Error('Expected FunctionSource');
    }
    expect(rewritten.args).toEqual([replacementArg]);
    expect(rewritten.alias).toBe('u');
    expect(rewritten.columnAliases).toEqual(['element', 'ord']);
    expect(rewritten.ordinality).toBe(true);
    expect(Object.isFrozen(rewritten.columnAliases)).toBe(true);
  });

  it('toFromSource() returns itself', () => {
    const src = FunctionSource.of('f', []);
    expect(src.toFromSource()).toBe(src);
  });
});

describe('cfExpr.fn — catalog function-call helper', () => {
  it('assembles an OperationExpr with function strategy from template + self', () => {
    const expr = cfExpr.fn({
      method: 'to_regclass',
      template: 'to_regclass({{self}})',
      self: cfExpr.param('"public"."users"', 'pg/text@1'),
      returns: { codecId: 'pg/text@1', nullable: true },
    });

    const op = expr.ast as OperationExpr;
    expect(op.kind).toBe('operation');
    expect(op.method).toBe('to_regclass');
    expect(op.lowering).toEqual({
      targetFamily: 'sql',
      template: 'to_regclass({{self}})',
    });
    expect(op.returns).toEqual({ codecId: 'pg/text@1', nullable: true });
    const self = op.self as ParamRef;
    expect(self.kind).toBe('param-ref');
    expect(self.value).toBe('"public"."users"');
    expect(self.codec?.codecId).toBe('pg/text@1');
    expect(op.args).toEqual([]);
  });

  it('threads optional args as expressions', () => {
    const expr = cfExpr.fn({
      method: 'format_type',
      template: 'format_type({{self}}, {{arg0}})',
      self: cfExpr.identifierRef('atttypid'),
      args: [cfExpr.identifierRef('atttypmod')],
      returns: { codecId: 'pg/text@1', nullable: false },
    });
    const op = expr.ast as OperationExpr;
    expect(op.args).toHaveLength(1);
    expect((op.args[0] as IdentifierRef).name).toBe('atttypmod');
  });

  it('composes with CfExpr combinators (isNull)', () => {
    const expr = cfExpr
      .fn({
        method: 'to_regclass',
        template: 'to_regclass({{self}})',
        self: cfExpr.param('"users"', 'pg/text@1'),
        returns: { codecId: 'pg/text@1', nullable: true },
      })
      .isNull();
    const nullCheck = expr.ast as NullCheckExpr;
    expect(nullCheck.kind).toBe('null-check');
    expect(nullCheck.isNull).toBe(true);
    expect((nullCheck.expr as OperationExpr).kind).toBe('operation');
  });
});

describe('cfTable — aliased catalog table source', () => {
  it('creates a TableSource with an alias and no namespace coordinate', () => {
    const src = cfTable('pg_constraint', 'c');
    expect(src).toBeInstanceOf(TableSource);
    expect(src.name).toBe('pg_constraint');
    expect(src.alias).toBe('c');
    expect(src.namespaceId).toBeUndefined();
  });

  it('alias is optional', () => {
    expect(cfTable('pg_namespace').alias).toBeUndefined();
  });
});

describe('cfExpr.columnRef / eqExpr / allOf / raw', () => {
  it('columnRef builds an alias-qualified ColumnRef', () => {
    const ref = cfExpr.columnRef('c', 'conname').ast as ColumnRef;
    expect(ref.kind).toBe('column-ref');
    expect(ref.table).toBe('c');
    expect(ref.column).toBe('conname');
  });

  it('eqExpr compares two expressions', () => {
    const eq = cfExpr.columnRef('n', 'oid').eqExpr(cfExpr.columnRef('c', 'connamespace'))
      .ast as BinaryExpr;
    expect(eq.kind).toBe('binary');
    expect(eq.op).toBe('eq');
    expect((eq.left as ColumnRef).column).toBe('oid');
    expect((eq.right as ColumnRef).column).toBe('connamespace');
  });

  it('allOf builds a flat AndExpr', () => {
    const a = cfExpr.columnRef('c', 'conname').eqParam('user_pkey', 'pg/text@1');
    const b = cfExpr.columnRef('n', 'nspname').eqParam('public', 'pg/text@1');
    const c = cfExpr.columnRef('i', 'indisprimary');
    const all = cfExpr.allOf([a, b, c]).ast as AndExpr;
    expect(all.kind).toBe('and');
    expect(all.exprs).toHaveLength(3);
    expect(all.exprs[0]).toBe(a.ast);
    expect(all.exprs[2]).toBe(c.ast);
  });

  it('raw carries opaque SQL with a return spec', () => {
    const raw = cfExpr.raw('current_schema()', { codecId: 'pg/text@1', nullable: false })
      .ast as RawExpr;
    expect(raw.kind).toBe('raw-expr');
    expect(raw.parts).toEqual(['current_schema()']);
    expect(raw.returns).toEqual({ codecId: 'pg/text@1', nullable: false });
  });
});

describe('CfExprSelectQuery.join — inner join surface', () => {
  it('adds an INNER JOIN with an expression ON clause', () => {
    const on = cfExpr.columnRef('n', 'oid').eqExpr(cfExpr.columnRef('c', 'connamespace'));
    const ast = exprSelect()
      .from(cfTable('pg_constraint', 'c'))
      .join(cfTable('pg_namespace', 'n'), on)
      .project('one', cfExpr.lit(1))
      .build();

    expect(ast.joins).toHaveLength(1);
    const join = ast.joins?.[0];
    expect(join?.joinType).toBe('inner');
    expect(join?.lateral).toBe(false);
    expect((join!.source as TableSource).alias).toBe('n');
    expect(join?.on).toBe(on.ast);
  });

  it('chains multiple joins in order', () => {
    const ast = exprSelect()
      .from(cfTable('pg_index', 'i'))
      .join(
        cfTable('pg_class', 'c'),
        cfExpr.columnRef('c', 'oid').eqExpr(cfExpr.columnRef('i', 'indrelid')),
      )
      .join(
        cfTable('pg_namespace', 'n'),
        cfExpr.columnRef('n', 'oid').eqExpr(cfExpr.columnRef('c', 'relnamespace')),
      )
      .project('one', cfExpr.lit(1))
      .build();
    expect(ast.joins).toHaveLength(2);
    expect((ast.joins![0]!.source as TableSource).name).toBe('pg_class');
    expect((ast.joins![1]!.source as TableSource).name).toBe('pg_namespace');
  });

  it('leftJoin adds a LEFT JOIN with an expression ON clause', () => {
    const on = cfExpr.columnRef('c2', 'oid').eqExpr(cfExpr.columnRef('i', 'indexrelid'));
    const ast = exprSelect()
      .from(cfTable('pg_index', 'i'))
      .leftJoin(cfTable('pg_class', 'c2'), on)
      .project('one', cfExpr.lit(1))
      .build();

    expect(ast.joins).toHaveLength(1);
    const join = ast.joins?.[0];
    expect(join?.joinType).toBe('left');
    expect(join?.lateral).toBe(false);
    expect((join!.source as TableSource).alias).toBe('c2');
    expect(join?.on).toBe(on.ast);
  });

  it('inner and left joins interleave in call order', () => {
    const ast = exprSelect()
      .from(cfTable('pg_index', 'i'))
      .join(
        cfTable('pg_class', 'c'),
        cfExpr.columnRef('c', 'oid').eqExpr(cfExpr.columnRef('i', 'indrelid')),
      )
      .leftJoin(
        cfTable('pg_class', 'c2'),
        cfExpr.columnRef('c2', 'oid').eqExpr(cfExpr.columnRef('i', 'indexrelid')),
      )
      .project('one', cfExpr.lit(1))
      .build();
    expect(ast.joins?.map((join) => join.joinType)).toEqual(['inner', 'left']);
  });
});

describe('CfExprSelectQuery.limit', () => {
  it('sets a numeric LIMIT on the built SelectAst', () => {
    const ast = exprSelect().from(cfTable('user')).project('one', cfExpr.lit(1)).limit(1).build();
    expect(ast.limit).toBe(1);
  });

  it('omits LIMIT when not called', () => {
    const ast = exprSelect().from(cfTable('user')).project('one', cfExpr.lit(1)).build();
    expect(ast.limit).toBeUndefined();
  });
});

describe('cfExpr.exists / notExists — EXISTS projection (OQ4)', () => {
  it('accepts a buildable CfExprSelectQuery and builds it internally', () => {
    const inner = exprSelect()
      .from(cfTable('pg_constraint', 'c'))
      .project('one', cfExpr.lit(1))
      .where(cfExpr.columnRef('c', 'conname').eqParam('user_pkey', 'pg/text@1'));

    const exists = cfExpr.exists(inner).ast as ExistsExpr;
    expect(exists.kind).toBe('exists');
    expect(exists.notExists).toBe(false);
    expect(exists.subquery).toBeInstanceOf(SelectAst);
    expect((exists.subquery.from as TableSource).name).toBe('pg_constraint');
    expect(exists.subquery.where?.kind).toBe('binary');
  });

  it('notExists sets the notExists flag on the same node kind', () => {
    const inner = exprSelect().from(cfTable('pg_constraint', 'c')).project('one', cfExpr.lit(1));
    const notExists = cfExpr.notExists(inner).ast as ExistsExpr;
    expect(notExists.kind).toBe('exists');
    expect(notExists.notExists).toBe(true);
  });

  it('composes with project() and collects subquery params', () => {
    const inner = exprSelect()
      .from(cfTable('pg_constraint', 'c'))
      .project('one', cfExpr.lit(1))
      .where(cfExpr.columnRef('c', 'conname').eqParam('user_pkey', 'pg/text@1'));
    const ast = exprSelect().project('result', cfExpr.exists(inner)).build();
    const refs = ast.collectParamRefs();
    expect(refs).toHaveLength(1);
    expect((refs[0] as ParamRef).value).toBe('user_pkey');
  });
});

describe('SelectAst — optional FROM', () => {
  it('SelectAst.noFrom() builds a FROM-less SelectAst', () => {
    const ast = SelectAst.noFrom();
    expect(ast.from).toBeUndefined();
    expect(ast.kind).toBe('select');
    expect(Object.isFrozen(ast)).toBe(true);
  });

  it('collects param refs from projection when FROM is absent', () => {
    const p = ParamRef.of('val');
    const ast = SelectAst.noFrom().withProjection([
      { kind: 'projection-item', alias: 'x', expr: p, codec: undefined } as never,
    ]);
    const refs = ast.collectParamRefs();
    expect(refs).toHaveLength(1);
    expect(refs[0]).toBe(p);
  });

  it('rewrite() returns a new SelectAst with no from when original has none', () => {
    const ast = SelectAst.noFrom();
    const rewritten = ast.rewrite({});
    expect(rewritten.from).toBeUndefined();
  });
});

describe('CfExpr — additional expression helpers', () => {
  it('isNull() wraps with NullCheckExpr.isNull', () => {
    const inner = new OperationExpr({
      method: 'toRegclass',
      self: LiteralExpr.of('x'),
      args: undefined,
      returns: { nullable: true },
      lowering: { targetFamily: 'sql', template: 'to_regclass({{self}})' },
    });
    const expr = new CfExpr(inner).isNull();
    expect(expr.ast).toBeInstanceOf(NullCheckExpr);
    const nullCheck = expr.ast as NullCheckExpr;
    expect(nullCheck.isNull).toBe(true);
    expect(nullCheck.expr).toBe(inner);
  });

  it('isNotNull() wraps with NullCheckExpr.isNotNull', () => {
    const inner = LiteralExpr.of('x');
    const expr = new CfExpr(inner).isNotNull();
    const nullCheck = expr.ast as NullCheckExpr;
    expect(nullCheck.isNull).toBe(false);
  });

  it('eqLit(value) wraps with BinaryExpr.eq against a LiteralExpr', () => {
    const inner = AggregateExpr.count();
    const expr = new CfExpr(inner).eqLit(0);
    const binary = expr.ast as BinaryExpr;
    expect(binary.op).toBe('eq');
    expect(binary.left).toBe(inner);
    const right = binary.right as LiteralExpr;
    expect(right.value).toBe(0);
  });

  it('gtLit(value) wraps with BinaryExpr.gt against a LiteralExpr', () => {
    const inner = AggregateExpr.count();
    const expr = new CfExpr(inner).gtLit(0);
    const binary = expr.ast as BinaryExpr;
    expect(binary.op).toBe('gt');
  });
});

describe('cfExpr helpers', () => {
  it('cfExpr.countStar() wraps AggregateExpr.count()', () => {
    const e = cfExpr.countStar();
    expect(e.ast).toBeInstanceOf(AggregateExpr);
    expect((e.ast as AggregateExpr).fn).toBe('count');
    expect((e.ast as AggregateExpr).expr).toBeUndefined();
  });

  it('cfExpr.lit(value) wraps LiteralExpr.of', () => {
    const e = cfExpr.lit(42);
    expect(e.ast).toBeInstanceOf(LiteralExpr);
    expect((e.ast as LiteralExpr).value).toBe(42);
  });

  it('cfExpr.identifierRef(name) wraps IdentifierRef.of', () => {
    const e = cfExpr.identifierRef('name');
    expect(e.ast).toBeInstanceOf(IdentifierRef);
    expect((e.ast as IdentifierRef).name).toBe('name');
  });

  it('cfExpr.param(value, codecId) wraps ParamRef with codec', () => {
    const e = cfExpr.param('test-val', 'pg/text@1');
    expect(e.ast).toBeInstanceOf(ParamRef);
    const p = e.ast as ParamRef;
    expect(p.value).toBe('test-val');
    expect(p.codec?.codecId).toBe('pg/text@1');
  });
});

describe('exprSelect()', () => {
  it('builds a FROM-less SELECT with a computed projection', () => {
    const countEqZero = cfExpr.countStar().eqLit(0);
    const ast = exprSelect().project('result', countEqZero).build();
    expect(ast.kind).toBe('select');
    expect(ast.from).toBeUndefined();
    expect(ast.projection).toHaveLength(1);
    expect(ast.projection[0]?.alias).toBe('result');
    expect(ast.projection[0]?.codec).toBeUndefined();
  });

  it('builds a SELECT with FROM FunctionSource, projection, and WHERE', () => {
    const tableNameParam = cfExpr.param('my_table', 'sqlite/text@1');
    const source = FunctionSource.of('pragma_table_info', [tableNameParam.ast]);
    const countEqZero = cfExpr.countStar().eqLit(0);
    const whereExpr = cfExpr.identifierRef('name').eqParam('my_col', 'sqlite/text@1');

    const ast = exprSelect().from(source).project('result', countEqZero).where(whereExpr).build();

    expect(ast.from).toBe(source);
    expect(ast.where).toBeDefined();
    const where = ast.where as BinaryExpr;
    expect(where.op).toBe('eq');
    const right = where.right as ParamRef;
    expect(right.value).toBe('my_col');
    expect(right.codec?.codecId).toBe('sqlite/text@1');
  });

  it('chaining is immutable — each call returns a new instance', () => {
    const base = exprSelect();
    const withProj = base.project('x', cfExpr.countStar());
    expect(base).not.toBe(withProj);
    expect(base.build().projection).toHaveLength(0);
    expect(withProj.build().projection).toHaveLength(1);
  });

  it('from() replaces the source', () => {
    const s1 = FunctionSource.of('f1', []);
    const s2 = TableSource.named('t1');
    const ast = exprSelect().from(s1).from(s2).build();
    expect(ast.from).toBe(s2);
  });

  it('build() throws when a join is added without a FROM', () => {
    const on = cfExpr.columnRef('n', 'oid').eqExpr(cfExpr.columnRef('c', 'connamespace'));
    expect(() =>
      exprSelect()
        .join(TableSource.named('pg_namespace', 'n'), on)
        .project('one', cfExpr.lit(1))
        .build(),
    ).toThrow('cannot add a JOIN without a FROM');
  });

  it('build() succeeds with no FROM and no joins (FROM-less expression select)', () => {
    const ast = exprSelect().project('result', cfExpr.countStar().eqLit(0)).build();
    expect(ast.from).toBeUndefined();
    expect(ast.joins).toBeUndefined();
  });
});
