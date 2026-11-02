---
changes:
  - id: supabase-one-binding-input
    summary: |
      `supabase()` now checks its database input the way `postgres()` does, when it is called. On both `postgres()` and `supabase()`, `null` or a value of the wrong type as `pg`, `url` or `binding` (a `pg` or `binding` that is not an object, a `url` that is not a string) now rejects with `RUNTIME.BINDING_INVALID`, with a message that names the option, a `why` and a `fix`; `meta.receivedType` gives the value's type, never the value. A `binding` object whose `kind` is not `'url'`, `'pgPool'` or `'pgClient'` (for example `{}`, an array or a misspelt kind) now also rejects with `RUNTIME.BINDING_INVALID` when the factory is called; `postgres()` used to accept it and throw a `TypeError` on the first query. The check runs before the inputs are counted, so `{ url: null, pg: pool }` fails on `url`, not with "Provide one binding input". `postgres()` used to throw a `TypeError` with no error code, and `supabase()` used to reject `pg: null` with `SUPABASE.CONFIG_INVALID`; match on the new code, and pass the option only when it has a value. Passing both `url` and `pg` rejects with `RUNTIME.BINDING_INVALID`, where `pg` used to win silently; pass only one. An empty `url` used to make `pg` connect with the `PG*` environment variables or to localhost; it now rejects with `RUNTIME.BINDING_INVALID`, so check that the variable you pass as `url` is set. A `url` that cannot be parsed or is not `postgres://` / `postgresql://` also rejects with `RUNTIME.BINDING_INVALID`, instead of failing on the first query. A `pg` value that is neither a `pg.Pool` nor a `pg.Client` now rejects with `RUNTIME.BINDING_INVALID` instead of `SUPABASE.CONFIG_INVALID`. A `pg.Client` still rejects with `SUPABASE.CONFIG_INVALID`, and its message is now "Supabase takes a pg.Pool or a url, not a pg.Client".
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\w$.])supabase(?:<[^>]*>)?\(\s*[{A-Za-z_$]'
        - 'The pg option takes a pg\.Pool'
        - 'import\s*\{[^}]*(?<![\w$])supabase\s+as\s+[A-Za-z_$][^}]*\}\s*from\s*[''"]@(?:prisma/orm-|internal/)extension-supabase(?:/[^''"]*)?[''"]'
        - '(?<![\w$.])(?:pg|url|binding)\s*:\s*(?:null\b|[^,}\n]*(?:\?|\|\||:)\s*null\b)'
---

# `supabase()` takes one database input, checked when it is called

```ts
// Before: pg was used and url ignored
const db = await supabase({ contract, url, pg: pool, jwtSecret });

// After
const db = await supabase({ contract, pg: pool, jwtSecret });
```

In each `supabase(...)` call, keep exactly one of `url`, `pg` and `binding`. If you import `supabase` under another name (`import { supabase as createDb } from ...`), check the calls of that name. If you passed both `url` and `pg`, keep `pg`: that is the one the client used.

If `url` comes from an environment variable, make sure it is set. An empty `url` used to connect to whatever the `PG*` environment variables or localhost pointed at; it now fails at startup.

Code or tests that match a `pg` refusal on `SUPABASE.CONFIG_INVALID` keep working for a `pg.Client`. Update a match on the old message "The pg option takes a pg.Pool" to "Supabase takes a pg.Pool or a url, not a pg.Client". A `pg` value that is neither a pool nor a client now fails with `RUNTIME.BINDING_INVALID`.

`null` as `pg`, `url` or `binding` now fails with `RUNTIME.BINDING_INVALID` on `postgres()` and on `supabase()`, even when another input is given beside it: `{ url: null, pg: pool }` fails on `url`. Code such as `pg: config.pool ?? null`, `url: value || null`, `url: ready ? value : null` or `url: ready ? null : value` should leave the option out instead:

```ts
// Before
postgres({ contract, url: process.env['DATABASE_URL'] ?? null });

// After
const url = process.env['DATABASE_URL'];
postgres({ contract, ...(url === undefined ? {} : { url }) });
```
