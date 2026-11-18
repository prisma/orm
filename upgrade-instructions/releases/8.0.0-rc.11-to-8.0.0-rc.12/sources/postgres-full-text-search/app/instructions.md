---
changes:
  - id: re-emit-the-contract-for-the-moved-query-operation-types
    summary: |
      Emitted Postgres `contract.d.ts` files import `QueryOperationTypes` from the target package
      instead of the adapter. Run `prisma contract emit` once; an un-emitted contract names a
      subpath that no longer exists and stops type-checking. Application source that imported that
      subpath directly changes the same way.
    detection:
      # Covers the emitted `contract.d.ts` and hand-written source alike: both
      # name the subpath, and both stop compiling until they are changed.
      glob: "**/*.{ts,tsx,mts}"
      contains:
        - "/adapter/operation-types"
---

## `re-emit-the-contract-for-the-moved-query-operation-types`

The built-in Postgres query operations (`ilike`, and the new `fullTextMatches`, `fullTextRank` and `fullTextHeadline`) are contributed by the Postgres target rather than the Postgres adapter. Emitted contract types follow: the generated line

```ts
import type { QueryOperationTypes as PgAdapterQueryOps } from '@prisma/orm-postgres/adapter/operation-types';
```

becomes

```ts
import type { QueryOperationTypes as PgTargetQueryOps } from '@prisma/orm-postgres/target/operation-types';
```

Run `prisma contract emit` and commit the regenerated `contract.d.ts`. Nothing else in the file changes, `contract.json` does not change, and no contract hash moves. Do not hand-edit the generated file.

Application code that imported `@prisma/orm-postgres/adapter/operation-types` directly imports `@prisma/orm-postgres/target/operation-types` instead. That subpath no longer exists; there is no compatibility re-export.

To use the new operations, index the column with `@@fullTextIndex`, which renders the `to_tsvector` expression the predicate needs:

```prisma
model Message {
  id   Int    @id
  text String

  @@fullTextIndex([text], name: "message_text_search")
}
```

In a TypeScript contract, use the matching helper inside the model's `sql({ indexes: [...] })`:

```ts
import { fullTextIndex } from '@prisma/orm-postgres/contract-builder';

model('Message', { fields: { id, text } }).sql(({ cols }) => ({
  indexes: [
    fullTextIndex(cols.text, { name: 'message_text_search' }),
    fullTextIndex(cols.text, { where: 'archived_at IS NULL', name: 'message_text_search_live' }),
  ],
}));
```

The first argument of each operation is a `tsquery`, built with a helper from `@prisma/orm-postgres/target/full-text`. A bare string is a type error. Use `websearchToTsquery(query)` for search-box text; `plaintoTsquery` requires every word and `phrasetoTsquery` the words in order. In the SQL builder these four parsers are also `fns` members. For user input inside `tsquery` operator syntax, such as a typeahead prefix match, use the `tsquery` tag: `` tsquery`${term}:*` `` quotes each interpolated value as one term, so user input cannot add operators or break the syntax, and Postgres then lowercases and stems the words. A value with several words becomes a phrase: `` tsquery`${'new y'}:*` `` gives `'new':* <-> 'y':*`, so the words must be adjacent and in order, and `:*` applies to each word. Do not put quotes around the interpolation yourself: `` tsquery`'${term}':*` `` is a syntax error for every input. `toTsquery` takes operator syntax the application writes in full; never pass user input to it.

The operations also take an options object as their second argument — `language` for all three, plus `normalization` and `coverDensity` on `fullTextRank` and the `ts_headline` options (`startSel`, `stopSel`, `maxWords`, `minWords`, `highlightAll`) on `fullTextHeadline`:

```ts
import { tsquery, websearchToTsquery } from '@prisma/orm-postgres/target/full-text';

const q = websearchToTsquery(query);
await db.orm.public.Message.select('id', 'text')
  .where((m) => m.text.fullTextMatches(q))
  .orderBy((m) => m.text.fullTextRank(q, { normalization: 32 }).desc())
  .all();

const suggestions = await db.orm.public.Message.select('id', 'text')
  .where((m) => m.text.fullTextMatches(tsquery`${term}:*`))
  .all();
```

The operation's `language` configures only the searched column. The parser or tag takes its own `language` for the query; pass the same value to both.

Postgres only uses a full-text index whose expression is the same `to_tsvector` over the same configuration literal and the same column as the query, so prefer these over writing `@@index(expression: "to_tsvector(…)", type: "gin", …)` by hand. Pass the same `language` to the index and to the operation: a mismatch is silent, and the query falls back to a sequential scan.
