---
changes:
  - id: supabase-one-binding-input
    summary: |
      `supabase()` now checks its database input the way `postgres()` does, when it is called (see the change `postgres-checks-database-input` for the checks both share). Passing both `url` and `pg` rejects with `RUNTIME.BINDING_INVALID`, where `pg` used to win silently; pass only one. An empty `url` used to make `pg` connect with the `PG*` environment variables or to localhost; it now rejects with `RUNTIME.BINDING_INVALID`, so check that the variable you pass as `url` is set. A `url` that cannot be parsed or is not `postgres://` / `postgresql://` also rejects with `RUNTIME.BINDING_INVALID`, instead of failing on the first query. `pg: null` and a `pg` value that is neither a `pg.Pool` nor a `pg.Client` now reject with `RUNTIME.BINDING_INVALID` instead of `SUPABASE.CONFIG_INVALID`. A `pg.Client` still rejects with `SUPABASE.CONFIG_INVALID`, and its message is now "Supabase takes a pg.Pool or a url, not a pg.Client". The `RUNTIME.BINDING_INVALID` errors of `supabase()` list only the inputs it takes (`url`, a `pg.Pool`, `binding: { kind: 'url', url }` or `{ kind: 'pgPool', pool }`) and carry `meta.extension: 'supabase'`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\w$.])supabase(?:<[^>]*>)?\(\s*[{A-Za-z_$]'
        - 'The pg option takes a pg\.Pool'
        - 'import\s*\{[^}]*(?<![\w$])supabase\s+as\s+[A-Za-z_$][^}]*\}\s*from\s*[''"]@(?:prisma/orm-|internal/)extension-supabase(?:/[^''"]*)?[''"]'
  - id: postgres-checks-database-input
    summary: |
      `postgres()` and `supabase()` check their database input when they are called and reject a wrong one with `RUNTIME.BINDING_INVALID`, with a message that names the option, a `why` and a `fix`; `meta.receivedType` gives the value's type, never the value. `null` or a value of the wrong type as `pg`, `url` or `binding` (a `pg` or `binding` that is not an object, a `url` that is not a string) rejects; `postgres()` used to throw a `TypeError` with no error code. The check runs before the inputs are counted, so `{ url: null, pg: pool }` fails on `url`, not with "Provide one binding input"; match on the new code, and pass the option only when it has a value. A `binding` object whose `kind` is not `'url'`, `'pgPool'` or `'pgClient'` (for example `{}`, an array or a misspelt kind) rejects; `postgres()` used to accept it and throw a `TypeError` on the first query. A `binding` of kind `'url'` whose `url` is not a string, is empty, cannot be parsed or is not `postgres://` / `postgresql://` rejects; `postgres()` used to pass it to `pg`, and an empty one connected with the `PG*` environment variables or to localhost. A `binding` whose `pool` or `client` is not an object rejects; `postgres()` used to fail on the first query.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\w$.])(?:pg|url|binding)\s*:\s*(?:null\b|[^,}\n]*(?:\?|\|\||:)\s*null\b)'
        - '(?<![\w$.])(?:postgres|supabase)(?:<[^>]*>)?\(\s*\{(?:[^()]|\((?:[^()]|\([^()]*\))*\))*?(?<![\w$])binding\s*:\s*\{[^}]*?(?<![\w$])kind\s*:\s*([''"`])(?!(?:url|pgPool|pgClient)\1)[^''"`]*\1'
        - '(?<![\w$.])postgres(?:<[^>]*>)?\(\s*\{(?:[^()]|\((?:[^()]|\([^()]*\))*\))*?(?<![\w$])binding\s*:\s*\{[^}]*?(?<![\w$])kind\s*:\s*([''"`])url\1'
---

# `supabase()` and `postgres()` check their database input when they are called

## `supabase()` takes one database input, checked when it is called

```ts
// Before: pg was used and url ignored
const db = await supabase({ contract, url, pg: pool, jwtSecret });

// After
const db = await supabase({ contract, pg: pool, jwtSecret });
```

In each `supabase(...)` call, keep exactly one of `url`, `pg` and `binding`. If you import `supabase` under another name (`import { supabase as createDb } from ...`), check the calls of that name. If you passed both `url` and `pg`, keep `pg`: that is the one the client used.

If `url` comes from an environment variable, make sure it is set. An empty `url` used to connect to whatever the `PG*` environment variables or localhost pointed at; it now fails at startup.

Code or tests that match a `pg` refusal on `SUPABASE.CONFIG_INVALID` keep working for a `pg.Client`. Update a match on the old message "The pg option takes a pg.Pool" to "Supabase takes a pg.Pool or a url, not a pg.Client". A `pg` value that is neither a pool nor a client now fails with `RUNTIME.BINDING_INVALID`.

`supabase()`'s errors about its input list only what it takes, and their `meta.extension` is `'supabase'`.

## `postgres()` checks its database input when it is called

These checks apply to `postgres()` and to `supabase()`.

`null` as `pg`, `url` or `binding` now fails with `RUNTIME.BINDING_INVALID` on `postgres()` and on `supabase()`, even when another input is given beside it: `{ url: null, pg: pool }` fails on `url`. Code such as `pg: config.pool ?? null`, `url: value || null`, `url: ready ? value : null` or `url: ready ? null : value` should leave the option out instead:

```ts
// Before
postgres({ contract, url: process.env['DATABASE_URL'] ?? null });

// After
const url = process.env['DATABASE_URL'];
postgres({ contract, ...(url === undefined ? {} : { url }) });
```

A `binding` whose `kind` is not `'url'`, `'pgPool'` or `'pgClient'` now fails with `RUNTIME.BINDING_INVALID` when `postgres()` or `supabase()` is called, not on the first query. Correct the kind, for example `{ kind: 'pgpool', pool }` becomes `{ kind: 'pgPool', pool }`.

A `binding` of kind `'url'` now has its `url` checked like a top-level `url`: it must be a non-empty `postgres://` or `postgresql://` string. An empty one used to connect to whatever the `PG*` environment variables or localhost pointed at. A `binding` whose `pool` or `client` is missing or not an object now fails when `postgres()` is called, not on the first query.
