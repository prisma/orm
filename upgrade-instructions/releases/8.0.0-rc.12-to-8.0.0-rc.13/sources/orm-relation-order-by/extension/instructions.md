---
changes:
  - id: cursor-rejects-expression-orders
    summary: "cursor() now throws ORM.ARGUMENT_INVALID when an active orderBy item is not a plain column (extension-operation orders such as vector distance were previously dropped from the keyset silently)"
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.cursor\('
  - id: order-by-item-nulls
    summary: "OrderByItem from @internal/sql-relational-core/ast carries a nulls placement: its constructor takes a required third argument, withExpr rebuilds an item around a new expression, and every renderer must emit nulls wherever it emits dir"
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'new OrderByItem\('
        - '\.dir\.toUpperCase\('
---

## `cursor-rejects-expression-orders`

A SQL ORM `cursor()` builds its keyset from plain model columns. It throws `ORM.ARGUMENT_INVALID`, naming the 1-based `orderBy` position, when an active order is any of these:

- an extension-operation result, such as `(p) => p.embedding.cosineDistance(v).asc()` or `(m) => m.text.fullTextRank(q).desc()`;
- a relation field, such as `(p) => p.author.name.asc()`;
- a relation count, such as `(u) => u.posts.count().desc()`;
- an order with null placement, such as `(p) => p.title.asc({ nulls: 'last' })`.

The check runs when `cursor()` is called and again when the query is planned, so an order added after `cursor()` is refused too. Before this change an extension-operation order was left out of the keyset without an error, which returned wrong pages.

For each `.cursor(` call in a chain that also calls `.orderBy(`, look at every `orderBy` lambda in the chain. If any of them is one of the orders above, do one of these:

- Paginate with `.limit(n).offset(n)` and remove `.cursor(...)`.
- Keep the cursor and order by plain columns only, for example `(p) => p.createdAt.desc()` and `(p) => p.id.desc()`.

`distinctOn()` throws the same error when one of the first N orders, where N is the number of `distinctOn` columns, is not a plain column: Postgres needs those leading orders to match the `DISTINCT ON` columns, so such a query already failed in the database; it now fails earlier, with `ORM.ARGUMENT_INVALID`. Put the `distinctOn` columns first; a relation order, a count or an operation result may follow them. For example, `.orderBy([(post) => post.title.asc(), (post) => post.author.name.asc()]).distinctOn('title')` is accepted.

## `order-by-item-nulls`

`OrderByItem` has a `nulls` field of type `'first' | 'last' | undefined`, and `undefined` means the database default. The constructor refuses any other value, and any direction other than `'asc'` / `'desc'`, with `RUNTIME.AST_INVALID`.

Constructing an item:

- `new OrderByItem(expr, dir)` no longer compiles. Pass the placement as the third argument, `new OrderByItem(expr, dir, undefined)`, or use `OrderByItem.asc(expr, { nulls })` / `OrderByItem.desc(expr, { nulls })`.
- To reorder by a different expression while keeping an existing item's direction and placement, write `item.withExpr(expr)` instead of `new OrderByItem(expr, item.dir)`. The hand-written form drops `nulls`.

Rendering an item: an adapter or renderer that writes `ORDER BY` itself must write the placement after the direction, `NULLS FIRST` for `'first'` and `NULLS LAST` for `'last'`, in every position it renders an `OrderByItem` (query, window and aggregate `ORDER BY`). A renderer that ignores `nulls` compiles and returns rows in the wrong order. Map `dir` and `nulls` through a fixed table rather than interpolating the string. A dialect without `NULLS FIRST` / `NULLS LAST` must emulate the placement, for example with a leading `expr IS NULL` key, and must not drop it.

