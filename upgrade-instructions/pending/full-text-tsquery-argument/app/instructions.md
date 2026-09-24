---
changes:
  - id: full-text-operations-take-a-tsquery
    summary: |
      The query argument of `fullTextMatches`, `fullTextRank` and `fullTextHeadline` is now a
      `tsquery`, not search-box text. A string is bound as a `tsquery` parameter and read by
      Postgres as `tsquery` syntax. Wrap a search-box string in `websearchToTsquery` (from
      `@prisma/orm-postgres/target/full-text`, or `fns.websearchToTsquery` in the SQL builder) to
      keep today's behavior.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs}"
      contains:
        - ".fullTextMatches("
        - ".fullTextRank("
        - ".fullTextHeadline("
---

## `full-text-operations-take-a-tsquery`

The three full-text operations no longer run the query through `websearch_to_tsquery` themselves. Their first argument is a `tsquery`: an expression from one of the four Postgres parsers, or a raw string in Postgres `tsquery` syntax. A raw string that used to mean "search-box text" now means `tsquery` syntax, and Postgres applies no language configuration to it: it is neither lowercased nor stemmed, and is compared against the stems in the vector exactly as written. `fullTextMatches('alice')` no longer matches "alice wrote the report", because the vector holds the stem `alic`, and `fullTextMatches('alice -bob')` fails at execution with a Postgres syntax error. An unmigrated search-box call therefore silently returns nothing for most inputs rather than erroring, which is why every call site must be wrapped.

Wrap every search-box string in `websearchToTsquery`. Through the ORM:

```ts
// before
db.orm.public.Message.where((m) => m.text.fullTextMatches(query))
  .orderBy((m) => m.text.fullTextRank(query).desc());

// after
import { websearchToTsquery } from '@prisma/orm-postgres/target/full-text';

db.orm.public.Message.where((m) => m.text.fullTextMatches(websearchToTsquery(query)))
  .orderBy((m) => m.text.fullTextRank(websearchToTsquery(query)).desc());
```

Through the SQL builder, the parsers are `fns` members:

```ts
// before
db.sql.public.message.where((f, fns) => fns.fullTextMatches(f.text, query));

// after
db.sql.public.message.where((f, fns) => fns.fullTextMatches(f.text, fns.websearchToTsquery(query)));
```

The `language` option on the operations stays, and still selects the configuration of the column-side `to_tsvector` the index covers. The parser takes its own `language` for the query side; pass the same value to both when you use one.

The other parsers are `toTsquery` (operator syntax such as `'zebra' & !'graze'` or `zeb:*`, errors on malformed input), `plaintoTsquery` (every word must match) and `phrasetoTsquery` (the words must match in order). Passing a raw string is deliberate: `` fullTextMatches(`${term}:*`) `` gives a prefix match for typeahead without a parser, and an in-app query DSL can hand over the `tsquery` text it built. Because a raw string is not normalized, the caller lowercases it and passes the beginning of the stemmed word: `rep:*` finds "report" and "reports", while `Rep:*` and `reports` find nothing. `toTsquery` is the parser to use for operator syntax with stemming. Malformed raw input is not validated or rewritten; it fails at execution with the Postgres error.
