---
from: 8.0.0-rc.11
to: 8.0.0-rc.12
# contract.d.ts now orders every collection the way contract.json does; a re-emit reorders, nothing else.
# Prepared include decoder specialization adds no consumer migration; retain existing entries below.
changes:
  - id: expression-codec-on-return-type
    summary: Move custom expression wrapper codec metadata to returnType.codec and remove the separate ExpressionImpl codec argument.
  - id: shared-preparable-envelope
    summary: Type ORM preparation descriptions with the shared compositional Preparable protocol and pass their contained plan to SQL runtime.
  - id: params-only-sql-facade-prepare
    summary: Replace injected SQL-builder preparation callbacks with params-only callbacks and lexical facade SQL access.
  - id: postgres-list-element-codecs-receive-raw-strings
    summary: |
      PostgreSQL list decoding now parses array frames in the target and passes raw string elements to the scalar element codec; custom PostgreSQL codecs used in lists must accept those raw element spellings.
  - id: preserve-prepared-reference-nullability
    summary: Preserve declaration nullability when constructing or cloning PreparedParamRef AST nodes.
  - id: preserve-orm-pagination-expressions
    summary: Preserve expression-valued limit and offset when consuming ORM CollectionState.
---

## `expression-codec-on-return-type`

For custom SQL `Expression` wrappers, move an existing top-level `codec` reference into `returnType.codec`, preserving the complete reference including `typeParams`. Read metadata through `codecOf(expression)` or `expression.returnType.codec`, not `expression.codec`. Keep the existing `returnType.codecId` and nullability; wrappers without an explicit reference continue to use the declared codec id fallback. Do not remove or relocate unrelated codec fields on AST nodes, storage declarations, runtime bindings or scope descriptors.

For direct `ExpressionImpl` construction, change `new ExpressionImpl(ast, returnType, codec, projectionAst)` to `new ExpressionImpl(ast, { ...returnType, codec }, projectionAst)`. When the removed codec argument was `undefined`, keep `returnType` unchanged and move any fourth projection argument to the third position. Preserve projection-only lowering separately from predicate and ordering ASTs.

## `shared-preparable-envelope`

Replace imports of SQL ORM client's `RowQuery` with `Preparable` from `@internal/sql-relational-core/plan`. Supply both type arguments as `Preparable<DbRow, Result>` and return `{ plan, consume }`, where `plan` is a `SqlQueryPlan<DbRow>` and `consume` returns the complete ORM result. Read AST, parameters and metadata through `description.plan`; pass `description.plan` rather than the description to SQL runtime preparation. Keep the consumer's mapping setup outside invocation-time code.

For integrations accepting both SQL and ORM callbacks, constrain the callback result with `Q extends SqlQueryPlan | Preparable<unknown, unknown>` and use SQL ORM client's `prepareQuery` and `PreparedFrom<Params, Q>`. Preserve the concrete `Q` so SQL row/statistics types and ORM all/first result types remain distinct. Do not add identity consumers to plain SQL plans.

## `preserve-orm-pagination-expressions`

Update extension code that reads or mirrors ORM `CollectionState.limit` and `offset`: these fields now contain relational-core `LimitOffsetValue | undefined` (`number | AnyExpression | undefined`), not just numbers. Forward them unchanged to the existing `SelectAst.withLimit` and `withOffset` methods. If processing numeric literals separately, narrow with `typeof value === 'number'`; preserve expression nodes rather than coercing, serializing or boxing them as literal parameters. Test presence against `undefined`, not truthiness, so zero limits and offsets survive. Keep grouped post-aggregation paging's separate numeric state unchanged.

## `preserve-prepared-reference-nullability`

Find code that constructs or clones `PreparedParamRef` from SQL relational-core's AST exports. When constructing a reference from a nullable declaration, pass its declared boolean nullability as the third argument to `PreparedParamRef.of(name, codec, nullable)` or `new PreparedParamRef(name, codec, nullable)`. When cloning an existing reference, preserve `ref.nullable`: `PreparedParamRef.of(ref.name, ref.codec, ref.nullable)`. Keep the name and complete codec reference unchanged, and keep constructing frozen class instances rather than spreading nodes into plain objects. Do not derive this flag from a column's nullability or an invocation's bound value.

## `params-only-sql-facade-prepare`

Find calls to `prepare(declaration, callback)` on clients created by the Postgres or SQLite facade (`@prisma/orm-postgres/runtime`, `@prisma/orm-sqlite/runtime`, or their `@internal/postgres/runtime` and `@internal/sqlite/runtime` counterparts). Resolve the receiver and callback rather than rewriting every method named `prepare`: native SQLite `database.prepare(sql)` and SQL runtime's existing params-only preparation are different APIs and must remain unchanged.

Change callbacks from `(sql, params) => ...` to `(params) => ...`. Replace references bound to the removed `sql` callback argument with the same facade receiver's lexical `.sql` property. Preserve the params argument's name, declaration, SQL chain, row selection, filters and invocation target/options. For extracted callbacks, capture the same client in the enclosing scope; do not capture an invocation target or evaluate the callback twice. Update explicit callback type annotations to accept only the placeholder-params argument.

```ts
// Before
const query = await db.prepare({ id: 'pg/int4@1' }, (sql, params) =>
  sql.public.users.select('id').where((f, fns) => fns.eq(f.id, params.id)).build(),
);

// After
const query = await db.prepare({ id: 'pg/int4@1' }, (params) =>
  db.sql.public.users.select('id').where((f, fns) => fns.eq(f.id, params.id)).build(),
);
```

Apply the same translation to SQLite's flat SQL facade (`sql.users` becomes `db.sql.users`), retaining its existing codec ids. Keep `.query(target, params, options?)` and SQL statistics `.execute(target, params, options?)` calls unchanged. Do not rewrite historical release notes, applied upgrade recipes, generated contracts or tests as part of this source translation.

## `postgres-list-element-codecs-receive-raw-strings`

Review PostgreSQL extension codecs whose descriptors can be used by `CodecRef.many` list columns. Inbound list framing is now target-owned: the target parses the Postgres array literal and invokes the scalar element codec for each non-null raw string element. Keep scalar direct-query compatibility as needed, but make the element `decode(wire, ctx)` accept the raw text spelling Postgres emits for that scalar value; the built-in numeric, boolean, integer, and float codecs accept both raw strings and native scalar wire values for this reason. Do not add a native-array fallback at the list-frame boundary, and do not add compatibility exports or codec-id aliases. `codecId`, `typeParams`, and emitted `CodecRef.many` shapes are unchanged.
