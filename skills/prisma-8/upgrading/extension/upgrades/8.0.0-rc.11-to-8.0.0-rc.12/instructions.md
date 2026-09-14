---
from: 8.0.0-rc.11
to: 8.0.0-rc.12
changes:
  - id: nominal-sql-expression-wrappers
    summary: Mark custom scalar Expression wrappers with the shared expressionMarker and recognize wrappers with isExpression.
  - id: shared-preparable-envelope
    summary: Return the shared Preparable SQL envelope directly from custom ORM preparation descriptions rather than nesting it under plan.
  - id: params-only-sql-facade-prepare
    summary: Replace injected SQL-builder preparation callbacks with params-only callbacks and lexical facade SQL access.
  - id: preserve-prepared-reference-nullability
    summary: Preserve declaration nullability when constructing or cloning PreparedParamRef AST nodes.
  - id: preserve-orm-pagination-expressions
    summary: Preserve expression-valued limit and offset when consuming ORM CollectionState.
---

## `nominal-sql-expression-wrappers`

Find custom scalar wrappers implementing `Expression<ScopeField>` from `@internal/sql-relational-core/expression`. Import `expressionMarker` from that entrypoint and add `readonly [expressionMarker] = true` on implementing classes, or `[expressionMarker]: true` on contextually typed expression object literals (`true as const` when inference would widen it). Keep the existing `returnType`, `codec` and `buildAst()` behavior unchanged. `buildOperation()` and raw scalar `.returns()` already supply the marker. Use the exported `isExpression(value)` guard instead of testing for a callable `buildAst` before converting unknown codec inputs. Import the shared marker rather than allocating a local symbol; its global identity supports separately bundled producers.

Do not mark AST nodes, table/query builders, raw-row builders or arbitrary codec input objects merely because they have a `buildAst` method. A codec input with such a method remains a bound value, and its method must not be invoked by operand conversion.

## `shared-preparable-envelope`

For custom ORM row descriptions, replace `{ plan, consume }` with `{ ...plan, consume }`; read `description.ast`, `description.params` and `description.meta` instead of `description.plan.*`. Preserve the required consumer's full return type. The common `Preparable<Row, Result>` lives in relational-core's plan entrypoint; plain `SqlQueryPlan` producers do not need a consumer. Integrations composing SQL and ORM can use SQL ORM client's `prepareQuery` and `PreparedFrom<Params, Q>` with a concrete callback-return `Q extends Preparable`, retaining normal SQL `PreparedFor` row/statistics semantics when no required consumer exists.

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
