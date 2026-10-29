import {
  AggregateExpr,
  AndExpr,
  type AnyQueryAst,
  BinaryExpr,
  CaseExpr,
  CastExpr,
  CodecJsonValueProjection,
  ColumnRef,
  DeleteAst,
  DerivedTableSource,
  EqColJoinOn,
  ExistsExpr,
  FunctionCallExpr,
  FunctionSource,
  IdentifierRef,
  InsertAst,
  JoinAst,
  JsonArrayAggExpr,
  JsonDocumentProjection,
  JsonObjectExpr,
  ListExpression,
  LiteralExpr,
  LockingClause,
  NativeJsonValueProjection,
  NotExpr,
  NullCheckExpr,
  OperationExpr,
  OrderByItem,
  OrExpr,
  ParamRef,
  PreparedParamRef,
  ProjectionItem,
  RawExpr,
  RawQueryAst,
  SelectAst,
  SubqueryExpr,
  TableSource,
  UpdateAst,
  WindowFuncExpr,
} from '@internal/sql-relational-core/ast';
import { createMysqlBuiltinCodecLookup } from '@internal/target-mysql/codecs';
import { describe, expect, it } from 'vitest';
import { renderMysqlSql } from '../src/core/sql-renderer';

const codecs = createMysqlBuiltinCodecLookup();
const lower = (ast: AnyQueryAst) => renderMysqlSql(ast, undefined, codecs);
const sqlOf = (ast: AnyQueryAst) => lower(ast).sql;

const id = ColumnRef.of('user', 'id');
const email = ColumnRef.of('user', 'email');
const fromUser = SelectAst.from(TableSource.named('user'));
const selectId = fromUser.withProjection([ProjectionItem.of('id', id)]);
const whereOf = (where: Parameters<SelectAst['withWhere']>[0]) => sqlOf(selectId.withWhere(where));
const projectionOf = (expr: Parameters<typeof ProjectionItem.of>[1]) =>
  sqlOf(SelectAst.noFrom().withProjection([ProjectionItem.of('v', expr)]));

describe('MySQL lowering of a select', () => {
  it('quotes identifiers with backticks and writes params as numbered placeholders', () => {
    expect(lower(selectId.withWhere(BinaryExpr.eq(email, ParamRef.of('a@b.c'))))).toEqual({
      sql: 'SELECT `user`.`id` AS `id` FROM `user` WHERE `user`.`email` = ?1',
      params: [{ kind: 'literal', value: 'a@b.c' }],
    });
  });

  it('binds a prepared param by name', () => {
    expect(
      lower(
        selectId.withWhere(
          BinaryExpr.eq(email, PreparedParamRef.of('email', { codecId: 'mysql/text@1' })),
        ),
      ).params,
    ).toEqual([{ kind: 'bind', name: 'email' }]);
  });

  it('writes an integer param as a bare placeholder, which the driver sends as a BIGINT', () => {
    const big = ColumnRef.of('t', 'big');
    const bigParam = (value: bigint) =>
      ParamRef.of(value, { codec: { codecId: 'mysql/bigint@1' } });
    const intParam = (value: number) => ParamRef.of(value, { codec: { codecId: 'mysql/int@1' } });
    expect([
      sqlOf(selectId.withWhere(BinaryExpr.eq(big, bigParam(9007199254740993n)))),
      sqlOf(selectId.withWhere(BinaryExpr.in(big, ListExpression.of([bigParam(1n)])))),
      sqlOf(
        selectId.withWhere(
          BinaryExpr.eq(big, PreparedParamRef.of('b', { codecId: 'mysql/bigint@1' })),
        ),
      ),
      sqlOf(selectId.withWhere(BinaryExpr.lt(intParam(10), intParam(9)))),
      sqlOf(selectId.withLimit(intParam(5)).withOffset(intParam(2))),
      sqlOf(
        selectId.withWhere(
          BinaryExpr.eq(email, ParamRef.of('x', { codec: { codecId: 'mysql/text@1' } })),
        ),
      ),
    ]).toEqual([
      'SELECT `user`.`id` AS `id` FROM `user` WHERE `t`.`big` = ?1',
      'SELECT `user`.`id` AS `id` FROM `user` WHERE `t`.`big` IN (?1)',
      'SELECT `user`.`id` AS `id` FROM `user` WHERE `t`.`big` = ?1',
      'SELECT `user`.`id` AS `id` FROM `user` WHERE ?1 < ?2',
      'SELECT `user`.`id` AS `id` FROM `user` LIMIT ?1 OFFSET ?2',
      'SELECT `user`.`id` AS `id` FROM `user` WHERE `user`.`email` = ?1',
    ]);
  });

  it('refuses a param whose codec the registry lacks', () => {
    expect(() =>
      sqlOf(
        selectId.withWhere(BinaryExpr.eq(id, ParamRef.of(1, { codec: { codecId: 'pg/x@1' } }))),
      ),
    ).toThrow(expect.objectContaining({ code: 'RUNTIME.PARAM_REF_MISSING_CODEC' }));
  });

  it('numbers params in the order the runtime encodes them', () => {
    const ast = fromUser
      .withProjection([ProjectionItem.of('p', ParamRef.of('first'))])
      .withWhere(BinaryExpr.eq(email, ParamRef.of('second')))
      .withLimit(ParamRef.of(3));
    expect(lower(ast)).toEqual({
      sql: 'SELECT ?1 AS `p` FROM `user` WHERE `user`.`email` = ?2 LIMIT ?3',
      params: [
        { kind: 'literal', value: 'first' },
        { kind: 'literal', value: 'second' },
        { kind: 'literal', value: 3 },
      ],
    });
  });

  it('renders DISTINCT, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT and OFFSET in order', () => {
    const ast = fromUser
      .withProjection([
        ProjectionItem.of('email', email),
        ProjectionItem.of('n', AggregateExpr.count()),
      ])
      .withDistinct()
      .withWhere(BinaryExpr.gt(id, LiteralExpr.of(0)))
      .withGroupBy([email])
      .withHaving(BinaryExpr.gt(AggregateExpr.count(id), LiteralExpr.of(1)))
      .withOrderBy([OrderByItem.desc(email)])
      .withLimit(10)
      .withOffset(5);
    expect(sqlOf(ast)).toBe(
      'SELECT DISTINCT `user`.`email` AS `email`, COUNT(*) AS `n` FROM `user` WHERE `user`.`id` > 0 GROUP BY `user`.`email` HAVING COUNT(`user`.`id`) > 1 ORDER BY `user`.`email` DESC LIMIT 10 OFFSET 5',
    );
  });

  describe('binds each param to its own numbered placeholder', () => {
    const lit = (value: unknown) => ({ kind: 'literal', value });

    it('when a join condition and a WHERE both carry one', () => {
      const ast = selectId
        .withJoins([
          JoinAst.inner(
            TableSource.named('post'),
            AndExpr.of([
              BinaryExpr.eq(ColumnRef.of('post', 'authorId'), id),
              BinaryExpr.eq(ColumnRef.of('post', 'title'), ParamRef.of('on')),
            ]),
          ),
        ])
        .withWhere(BinaryExpr.eq(email, ParamRef.of('where')));
      expect(lower(ast)).toEqual({
        sql: 'SELECT `user`.`id` AS `id` FROM `user` INNER JOIN `post` ON (`post`.`authorId` = `user`.`id` AND `post`.`title` = ?2) WHERE `user`.`email` = ?1',
        params: [lit('where'), lit('on')],
      });
    });

    it('when GROUP BY and HAVING both carry one', () => {
      const ast = fromUser
        .withProjection([ProjectionItem.of('n', AggregateExpr.count())])
        .withGroupBy([BinaryExpr.eq(email, ParamRef.of('group'))])
        .withHaving(BinaryExpr.gt(AggregateExpr.count(), ParamRef.of('having')));
      expect(lower(ast)).toEqual({
        sql: 'SELECT COUNT(*) AS `n` FROM `user` GROUP BY `user`.`email` = ?2 HAVING COUNT(*) > ?1',
        params: [lit('having'), lit('group')],
      });
    });

    it('when the projection and a derived FROM both carry one', () => {
      const derived = selectId.withWhere(BinaryExpr.eq(email, ParamRef.of('from')));
      const ast = SelectAst.from(DerivedTableSource.as('u', derived)).withProjection([
        ProjectionItem.of('p', ParamRef.of('projection')),
      ]);
      expect(lower(ast)).toEqual({
        sql: 'SELECT ?2 AS `p` FROM (SELECT `user`.`id` AS `id` FROM `user` WHERE `user`.`email` = ?1) AS `u`',
        params: [lit('from'), lit('projection')],
      });
    });

    it('when an operation template writes its argument before itself', () => {
      const op = new OperationExpr({
        method: 'locate',
        self: BinaryExpr.eq(email, ParamRef.of('self')),
        args: [ParamRef.of('arg')],
        returns: { codecId: 'mysql/int@1', nullable: false },
        lowering: { targetFamily: 'sql', template: 'LOCATE({{arg0}}, {{self}})' },
      });
      expect(lower(SelectAst.noFrom().withProjection([ProjectionItem.of('v', op)]))).toEqual({
        sql: 'SELECT LOCATE(?2, `user`.`email` = ?1) AS `v`',
        params: [lit('self'), lit('arg')],
      });
    });
  });

  it('writes an OFFSET with no LIMIT with the largest row count MySQL takes', () => {
    expect(sqlOf(selectId.withOffset(5))).toBe(
      'SELECT `user`.`id` AS `id` FROM `user` LIMIT 18446744073709551615 OFFSET 5',
    );
  });

  it('selects from a derived table', () => {
    const ast = SelectAst.from(DerivedTableSource.as('u', selectId)).withProjection([
      ProjectionItem.of('id', ColumnRef.of('u', 'id')),
    ]);
    expect(sqlOf(ast)).toBe(
      'SELECT `u`.`id` AS `id` FROM (SELECT `user`.`id` AS `id` FROM `user`) AS `u`',
    );
  });

  it('aliases a table', () => {
    expect(
      sqlOf(
        SelectAst.from(TableSource.named('user', 'u')).withProjection([
          ProjectionItem.of('id', ColumnRef.of('u', 'id')),
        ]),
      ),
    ).toBe('SELECT `u`.`id` AS `id` FROM `user` AS `u`');
  });

  it('renders inner, left and right joins', () => {
    const on = EqColJoinOn.of(ColumnRef.of('post', 'authorId'), id);
    const ast = selectId.withJoins([
      JoinAst.inner(TableSource.named('post'), on),
      JoinAst.left(TableSource.named('post'), BinaryExpr.eq(id, LiteralExpr.of(1))),
      JoinAst.right(TableSource.named('post'), on),
    ]);
    expect(sqlOf(ast)).toBe(
      'SELECT `user`.`id` AS `id` FROM `user` INNER JOIN `post` ON `post`.`authorId` = `user`.`id` LEFT JOIN `post` ON `user`.`id` = 1 RIGHT JOIN `post` ON `post`.`authorId` = `user`.`id`',
    );
  });
});

describe('MySQL lowering of expressions', () => {
  it.each([
    ['eq', '`user`.`id` = ?1'],
    ['neq', '`user`.`id` <> ?1'],
    ['gt', '`user`.`id` > ?1'],
    ['lt', '`user`.`id` < ?1'],
    ['gte', '`user`.`id` >= ?1'],
    ['lte', '`user`.`id` <= ?1'],
    ['like', '`user`.`id` LIKE ?1'],
    ['isNotDistinctFrom', '`user`.`id` <=> ?1'],
    ['isDistinctFrom', 'NOT (`user`.`id` <=> ?1)'],
  ] as const)('renders the %s operator', (op, where) => {
    expect(whereOf(new BinaryExpr(op, id, ParamRef.of(1)))).toBe(
      `SELECT \`user\`.\`id\` AS \`id\` FROM \`user\` WHERE ${where}`,
    );
  });

  it('renders IN and NOT IN lists, and an empty list as a constant', () => {
    expect([
      whereOf(BinaryExpr.in(id, ListExpression.of([ParamRef.of(1), ParamRef.of(2)]))),
      whereOf(BinaryExpr.notIn(id, ListExpression.of([LiteralExpr.of(3)]))),
      whereOf(BinaryExpr.in(id, ListExpression.of([]))),
      whereOf(BinaryExpr.notIn(id, ListExpression.of([]))),
    ]).toEqual([
      'SELECT `user`.`id` AS `id` FROM `user` WHERE `user`.`id` IN (?1, ?2)',
      'SELECT `user`.`id` AS `id` FROM `user` WHERE `user`.`id` NOT IN (3)',
      'SELECT `user`.`id` AS `id` FROM `user` WHERE FALSE',
      'SELECT `user`.`id` AS `id` FROM `user` WHERE TRUE',
    ]);
  });

  it('renders AND, OR, NOT, null checks and EXISTS, and empty AND and OR as constants', () => {
    expect([
      whereOf(
        AndExpr.of([
          OrExpr.of([NullCheckExpr.isNull(email), NullCheckExpr.isNotNull(id)]),
          new NotExpr(ExistsExpr.exists(selectId)),
          ExistsExpr.notExists(selectId),
        ]),
      ),
      whereOf(AndExpr.of([])),
      whereOf(OrExpr.of([])),
    ]).toEqual([
      'SELECT `user`.`id` AS `id` FROM `user` WHERE ((`user`.`email` IS NULL OR `user`.`id` IS NOT NULL) AND NOT (EXISTS (SELECT `user`.`id` AS `id` FROM `user`)) AND NOT EXISTS (SELECT `user`.`id` AS `id` FROM `user`))',
      'SELECT `user`.`id` AS `id` FROM `user` WHERE TRUE',
      'SELECT `user`.`id` AS `id` FROM `user` WHERE FALSE',
    ]);
  });

  it.each([
    [42, '42'],
    [true, 'TRUE'],
    [false, 'FALSE'],
    [9007199254740993n, '9007199254740993'],
    [null, 'NULL'],
  ])('renders the literal %s', (value, rendered) => {
    expect(projectionOf(LiteralExpr.of(value))).toBe(`SELECT ${rendered} AS \`v\``);
  });

  it.each([["it's \\ here"], [new Date('2024-01-02T03:04:05.678Z')], [{ a: "b'c" }], [[1, 'x']]])(
    'refuses the literal %s, which only a caller value could supply',
    (value) => {
      expect(() => projectionOf(LiteralExpr.of(value))).toThrow(
        expect.objectContaining({ code: 'RUNTIME.AST_UNSUPPORTED' }),
      );
    },
  );

  it('refuses a number MySQL has no literal for', () => {
    expect(() => projectionOf(LiteralExpr.of(Number.POSITIVE_INFINITY))).toThrow(
      expect.objectContaining({ code: 'RUNTIME.AST_UNSUPPORTED' }),
    );
  });

  it('renders an identifier, a function call, a cast, a CASE and a scalar subquery', () => {
    expect([
      projectionOf(IdentifierRef.of('total')),
      projectionOf(FunctionCallExpr.of('LOWER', [email])),
      projectionOf(CastExpr.as(id, 'CHAR')),
      projectionOf(
        CaseExpr.of(
          [{ condition: BinaryExpr.eq(id, LiteralExpr.of(1)), value: LiteralExpr.of(10) }],
          LiteralExpr.of(20),
        ),
      ),
      projectionOf(CaseExpr.of([{ condition: NullCheckExpr.isNull(id), value: id }])),
      projectionOf(SubqueryExpr.of(selectId)),
    ]).toEqual([
      'SELECT `total` AS `v`',
      'SELECT LOWER(`user`.`email`) AS `v`',
      'SELECT CAST(`user`.`id` AS CHAR) AS `v`',
      'SELECT CASE WHEN `user`.`id` = 1 THEN 10 ELSE 20 END AS `v`',
      'SELECT CASE WHEN `user`.`id` IS NULL THEN `user`.`id` END AS `v`',
      'SELECT (SELECT `user`.`id` AS `id` FROM `user`) AS `v`',
    ]);
  });

  it('renders aggregates and a window function', () => {
    expect([
      projectionOf(AggregateExpr.sum(id)),
      projectionOf(AggregateExpr.max(id)),
      projectionOf(
        WindowFuncExpr.rowNumber({ partitionBy: [email], orderBy: [OrderByItem.asc(id)] }),
      ),
    ]).toEqual([
      'SELECT SUM(`user`.`id`) AS `v`',
      'SELECT MAX(`user`.`id`) AS `v`',
      'SELECT ROW_NUMBER() OVER (PARTITION BY `user`.`email` ORDER BY `user`.`id` ASC) AS `v`',
    ]);
  });

  it('renders an operation from its template, grouping it inside a comparison and a null check', () => {
    const lowerEmail = new OperationExpr({
      method: 'lower',
      self: email,
      args: [ParamRef.of('x')],
      returns: { codecId: 'mysql/text@1', nullable: false },
      lowering: { targetFamily: 'sql', template: 'CONCAT(LOWER({{self}}), {{arg0}})' },
    });
    expect([
      whereOf(BinaryExpr.eq(lowerEmail, LiteralExpr.of(1))),
      whereOf(NullCheckExpr.isNull(lowerEmail)),
    ]).toEqual([
      'SELECT `user`.`id` AS `id` FROM `user` WHERE (CONCAT(LOWER(`user`.`email`), ?1)) = 1',
      'SELECT `user`.`id` AS `id` FROM `user` WHERE (CONCAT(LOWER(`user`.`email`), ?1)) IS NULL',
    ]);
  });

  it('renders raw SQL fragments and raw queries', () => {
    const raw = new RawExpr({
      parts: ['`user`.`id` > ', ParamRef.of(1)],
      returns: { codecId: 'mysql/int@1', nullable: false },
    });
    expect([
      whereOf(raw),
      sqlOf(RawQueryAst.affectedCount(['SELECT ', ParamRef.of(1), ' + 1'])),
    ]).toEqual(['SELECT `user`.`id` AS `id` FROM `user` WHERE `user`.`id` > ?1', 'SELECT ?1 + 1']);
  });
});

describe('MySQL placeholder check', () => {
  it('refuses raw SQL text that writes its own ?, which no param would bind to', () => {
    expect(() => sqlOf(RawQueryAst.affectedCount(['SELECT ? + ', ParamRef.of(1)]))).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.PARAM_PLACEHOLDER_MISMATCH',
        meta: { placeholders: ['?', '?1'], params: 1 },
      }),
    );
  });

  it('refuses raw SQL text that puts a digit right after an interpolated value, which would read as a larger placeholder', () => {
    expect(() => sqlOf(RawQueryAst.affectedCount(['SELECT ', ParamRef.of('a'), '0 AS x']))).toThrow(
      expect.objectContaining({
        code: 'RUNTIME.PARAM_PLACEHOLDER_MISMATCH',
        message: expect.stringContaining('digit right after an interpolated value'),
      }),
    );
  });

  it('writes a raw integer value as a bare placeholder wherever it appears', () => {
    const int = (value: number) => ParamRef.of(value, { codec: { codecId: 'mysql/int@1' } });
    const raw = (...parts: (string | ReturnType<typeof int>)[]) =>
      sqlOf(RawQueryAst.affectedCount(parts));
    expect([
      raw('SELECT id FROM t LIMIT ', int(2), ' OFFSET ', int(1)),
      raw('SELECT ', int(10), ' < ', int(9), ' FROM t'),
      raw("SELECT 'why?' = ", int(1), ' FROM t'),
    ]).toEqual([
      'SELECT id FROM t LIMIT ?1 OFFSET ?2',
      'SELECT ?1 < ?2 FROM t',
      "SELECT 'why?' = ?1 FROM t",
    ]);
  });

  it('ignores a ? inside quoted text, a backtick identifier or a comment', () => {
    expect(
      lower(
        RawQueryAst.affectedCount([
          'SELECT \'why?\', "b?", `c?` /* d? */ # e?\n-- f?\n, ',
          ParamRef.of(1),
        ]),
      ).sql,
    ).toBe('SELECT \'why?\', "b?", `c?` /* d? */ # e?\n-- f?\n, ?1');
  });
});

describe('MySQL lowering of JSON for includes', () => {
  const rows = (column: string) => ColumnRef.of('rows', column);
  const object = JsonObjectExpr.fromEntries([
    JsonObjectExpr.entry(
      'id',
      new CodecJsonValueProjection(rows('id'), { codecId: 'mysql/int@1' }),
    ),
    JsonObjectExpr.entry(
      'big',
      new CodecJsonValueProjection(rows('big'), { codecId: 'mysql/bigint@1' }),
    ),
    JsonObjectExpr.entry(
      'at',
      new CodecJsonValueProjection(rows('at'), {
        codecId: 'mysql/datetime@1',
        typeParams: { precision: 3 },
      }),
    ),
    JsonObjectExpr.entry('raw', new NativeJsonValueProjection(rows('raw'))),
    JsonObjectExpr.entry('posts', new JsonDocumentProjection(rows('posts'))),
  ]);
  const objectSql =
    "JSON_OBJECT('id', `rows`.`id`, 'big', CAST(`rows`.`big` AS CHAR), 'at', `rows`.`at`, 'raw', `rows`.`raw`, 'posts', `rows`.`posts`)";

  it('builds an object with JSON_OBJECT, each value projected by its codec', () => {
    expect(projectionOf(object)).toBe(`SELECT ${objectSql} AS \`v\``);
  });

  it('keeps a to-many include in order with GROUP_CONCAT, cast to JSON, raising the length limit for the statement, an empty include as an empty JSON array, and an array larger than a packet as an error', () => {
    const aggregate = JsonArrayAggExpr.of(new JsonDocumentProjection(object), 'emptyArray', [
      OrderByItem.desc(rows('order_0')),
    ]);
    expect(projectionOf(aggregate)).toBe(
      `SELECT /*+ SET_VAR(group_concat_max_len = 4294967295) */ CASE WHEN COUNT(*) = 0 THEN JSON_ARRAY() ELSE CAST(COALESCE(CONCAT('[', GROUP_CONCAT(${objectSql} ORDER BY \`rows\`.\`order_0\` DESC SEPARATOR ','), ']'), CONCAT('array larger than max_allowed_packet: ', COUNT(*), ' rows')) AS JSON) END AS \`v\``,
    );
  });

  it('writes a scalar element of an ordered array as JSON text', () => {
    expect(
      projectionOf(
        JsonArrayAggExpr.of(new NativeJsonValueProjection(rows('title')), 'null', [
          OrderByItem.asc(rows('title')),
        ]),
      ),
    ).toBe(
      "SELECT /*+ SET_VAR(group_concat_max_len = 4294967295) */ CASE WHEN COUNT(*) = 0 THEN NULL ELSE CAST(COALESCE(CONCAT('[', GROUP_CONCAT(JSON_EXTRACT(JSON_ARRAY(`rows`.`title`), '$[0]') ORDER BY `rows`.`title` ASC SEPARATOR ','), ']'), CONCAT('array larger than max_allowed_packet: ', COUNT(*), ' rows')) AS JSON) END AS `v`",
    );
  });

  it('refuses an ordered array in a statement whose outermost SELECT cannot carry the length hint', () => {
    const ordered = JsonArrayAggExpr.of(new NativeJsonValueProjection(rows('title')), 'null', [
      OrderByItem.asc(rows('title')),
    ]);
    expect(() => sqlOf(RawQueryAst.affectedCount(['DO ', ordered]))).toThrow(
      expect.objectContaining({ code: 'RUNTIME.AST_UNSUPPORTED' }),
    );
  });

  it('aggregates an unordered array with JSON_ARRAYAGG', () => {
    expect(projectionOf(JsonArrayAggExpr.of(new JsonDocumentProjection(object)))).toBe(
      `SELECT JSON_ARRAYAGG(${objectSql}) AS \`v\``,
    );
  });

  it('refuses a column whose codec the registry lacks', () => {
    expect(() =>
      projectionOf(
        JsonObjectExpr.fromEntries([
          JsonObjectExpr.entry('x', new CodecJsonValueProjection(rows('x'), { codecId: 'pg/x@1' })),
        ]),
      ),
    ).toThrow(expect.objectContaining({ code: 'RUNTIME.PARAM_REF_MISSING_CODEC' }));
  });
});

describe('MySQL lowering of NULLS FIRST and NULLS LAST', () => {
  it('leads with an IS NULL sort key, since MySQL has no NULLS clause', () => {
    const ast = selectId.withOrderBy([
      OrderByItem.asc(email, { nulls: 'last' }),
      OrderByItem.desc(id, { nulls: 'first' }),
    ]);
    expect(sqlOf(ast)).toBe(
      'SELECT `user`.`id` AS `id` FROM `user` ORDER BY `user`.`email` IS NULL ASC, `user`.`email` ASC, `user`.`id` IS NULL DESC, `user`.`id` DESC',
    );
  });

  it('binds a param the sort key writes twice once', () => {
    const ast = selectId.withOrderBy([
      OrderByItem.asc(BinaryExpr.eq(id, ParamRef.of(1)), { nulls: 'last' }),
    ]);
    expect(lower(ast)).toEqual({
      sql: 'SELECT `user`.`id` AS `id` FROM `user` ORDER BY `user`.`id` = ?1 IS NULL ASC, `user`.`id` = ?1 ASC',
      params: [{ kind: 'literal', value: 1 }],
    });
  });
});

describe('MySQL lowering refusals', () => {
  it.each([
    ['a FULL JOIN', selectId.withJoins([JoinAst.full(TableSource.named('post'), id)])],
    [
      'a LATERAL join',
      selectId.withJoins([
        JoinAst.left(DerivedTableSource.as('p', selectId), BinaryExpr.eq(id, id), true),
      ]),
    ],
    [
      'a function source',
      SelectAst.from(FunctionSource.of('json_table', [])).withProjection([
        ProjectionItem.of('v', LiteralExpr.of(1)),
      ]),
    ],
    ['a locking clause', selectId.withLocking([LockingClause.of('forUpdate')])],
    ['DISTINCT ON', selectId.withDistinctOn([email])],
    ['an insert', InsertAst.into(TableSource.named('user')).withRows([{ id: ParamRef.of(1) }])],
    ['an update', UpdateAst.table(TableSource.named('user')).withSet({ email: ParamRef.of('x') })],
    ['a delete', DeleteAst.from(TableSource.named('user'))],
  ])('refuses %s with RUNTIME.AST_UNSUPPORTED', (_name, ast) => {
    expect(() => sqlOf(ast)).toThrow(expect.objectContaining({ code: 'RUNTIME.AST_UNSUPPORTED' }));
  });
});
