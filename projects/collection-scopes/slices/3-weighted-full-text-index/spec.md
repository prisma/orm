# Slice 3: the weighted full-text index is data in the contract

**Project:** [spec](../../spec.md), [plan](../../plan.md). **Design:** [ADR 260](../../../../docs/architecture%20docs/adrs/ADR%20260%20-%20Packages%20offer%20collection%20scopes%20for%20their%20kinds%20of%20index.md), section "1. The author declares the index" and "3. What a scope does to the query".

## At a glance

```prisma
model Post {
  id       Int     @id
  title    String
  subtitle String?
  body     String?

  @@fullTextIndex([[title, subtitle], body], name: "post_search")
}
```

```ts
model('Post', { fields: { id, title, subtitle, body } }).sql(({ cols }) => ({
  indexes: [fullTextIndex([[cols.title, cols.subtitle], cols.body], { name: 'post_search' })],
}));
```

```json
{
  "columns": ["title", "subtitle", "body"],
  "name": "post_search_033e8055",
  "options": { "fields": [["title", "subtitle"], ["body"]], "language": "english" },
  "prefix": "post_search",
  "type": "fullText",
  "unique": false
}
```

```ts
db.sql.public.post
  .where((f, fns) => fns.fullTextMatches([[f.title, f.subtitle], [f.body]], q))
  .orderBy((f, fns) => fns.fullTextRank([[f.title, f.subtitle], [f.body]], q), { direction: 'desc' });
```

```sql
CREATE INDEX "post_search_033e8055" ON "post" USING gin ((
  setweight(to_tsvector('english', coalesce("title", '')), 'A') || setweight(to_tsvector('english', coalesce("subtitle", '')), 'A')
  || setweight(to_tsvector('english', coalesce("body", '')), 'B')
));
```

## Chosen design

- **Authoring.** `@@fullTextIndex` and the TypeScript `fullTextIndex` helper take one field, a flat list, or a list whose items are fields or lists of fields. Each top-level item is a weight group; earlier groups weigh more, `A` to `D`, so at most four groups. A single field stays valid and has no weight.
- **Contract.** The index has the type `fullText`, which the Postgres target registers in its index type registry; in the database it is a `gin` index. It is stored in the `columns` form: `columns` lists the covered columns flat, in order, and must equal `options.fields` read flat; `options` holds `fields` (the weight groups, as storage column names) and `language`, and nothing else. No SQL string is stored. `fullText` declares that it cannot back a foreign key, and cannot be unique.
- **One renderer.** A single function in the Postgres target renders the search document from `{ fields, language }` and a way to reference each column. The index DDL, the contract-to-schema-node conversion, and the query operations all call it. `setweight` appears only when there is more than one weight group; in a document of more than one column every column is wrapped in `coalesce`, whether or not it is nullable, so nullability is not an input; fields are joined with `||`. A single field renders `to_tsvector(language, column)`, the expression the existing column operations use.
- **Schema node.** `contract-to-postgres-database-schema-node.ts` produces the expression-form `SqlIndexIR` for such an index, with the rendered expression, and `dependsOn` naming exactly the covered columns rather than every column of the table.
- **Query operations.** `fullTextMatches` and `fullTextRank` gain a form on the SQL builder's `fns` that takes weight groups of column expressions and the `tsquery`, with the same options as the column form. The column-method forms are unchanged. `fullTextHeadline` stays per column.
- **Existing single-field indexes** change representation in the contract and keep their DDL. Their generated name changes; `migration plan` from the previous contract renames them, and `db update` against a live database rebuilds them.
- **Foreign-key backing.** Because the index now lists its columns, the rule for which indexes back a foreign key is decided per index type. That rule ships first, on its own (TML-3430), and this slice is stacked on it.

## Coherence rationale

One representation change with its three consumers: authoring, DDL and schema node, query operations. The renderer ties them, and one reviewer can check that every producer of the expression goes through it.

## Scope

In: `packages/3-targets/3-targets/postgres` (authoring spec, index type options, renderer, DDL, schema-node conversion, query operations, operation types); `packages/3-extensions/postgres/src/contract/full-text-index.ts`; fixtures and examples that declare a full-text index; upgrade instructions; ADR 260's contract example (it gains `columns`); the skill reference for full-text search.

Out: anything in `sql-orm-client` (slices 1, 2 and 4); scope helpers; generated `tsvector` columns; `contract infer` producing the structured form from an existing database (an inferred index stays an opaque expression); MySQL, SQLite, MongoDB.

## Pre-investigated edge cases

- `serialized-index.ts` in the SQL family requires exactly one of `columns` and `expression`. The structured index uses `columns`, so the family needs no change. Check every consumer of an index's `columns` (foreign-key index coverage, relation backing, verification, the planner's index diffing) and make sure none treats a full-text index as a plain index over those columns.
- Verification compares the contract-derived schema node with the introspected one. Postgres prints the expression in its own normal form. The single-field index already passes this comparison; the weighted expression must too. Compare with what a real database returns, do not only read the code.
- `examples/prisma-8-demo` has a migration history with a single-field full-text index. The representation change alters the storage hash. Follow the repository's rules for example migrations (`pnpm fixtures:check`; the PSL copy in each example migration package exists so the package can be regenerated).
- A `where` predicate on the index (partial index) keeps working.

## Slice-specific done conditions

- An integration test against a real Postgres shows `EXPLAIN` using the index for `fullTextMatches` over weight groups, with sequential scans disabled, and not using it when the query's groups, order or language differ (negative controls).
- A test shows a title match ranks above a body match with `fullTextRank` over weight groups.
- A test shows the DDL, the schema node expression and the query expression are the same string for the same `{ fields, language }`.
- `EXPLAIN` shows `fullTextMatches` on a column using an index declared over that one field in the new representation.
- Authoring diagnostics: more than four groups, a non-text field, an unknown field, a duplicate field, an empty group.
- `pnpm fixtures:check` passes; the demo runs its migrations and its full-text example.

## Open questions

None.
