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

The operations themselves take an options object as their second argument — `language` for all three, plus `normalization` and `coverDensity` on `fullTextRank` and the `ts_headline` options (`startSel`, `stopSel`, `maxWords`, `minWords`, `highlightAll`) on `fullTextHeadline`:

```ts
await db.orm.public.Message.select('id', 'text')
  .where((m) => m.text.fullTextMatches(query))
  .orderBy((m) => m.text.fullTextRank(query, { normalization: 32 }).desc())
  .all();
```

Postgres only uses a full-text index whose expression is the same `to_tsvector` over the same configuration literal and the same column as the query, so prefer these over writing `@@index(expression: "to_tsvector(…)", type: "gin", …)` by hand. Pass the same `language` to the index and to the operation: a mismatch is silent, and the query falls back to a sequential scan.
