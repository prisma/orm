---
changes:
  - id: supabase-one-binding-input
    summary: |
      `supabase()` now checks its database input the way `postgres()` does, when it is called. On both `postgres()` and `supabase()`, `null` as `pg`, `url` or `binding` now rejects with `RUNTIME.BINDING_INVALID`, with a `why` and a `fix`. `postgres()` used to throw a `TypeError` with no error code, and `supabase()` used to reject `pg: null` with `SUPABASE.CONFIG_INVALID`; match on the new code, and pass the option only when it has a value. Passing both `url` and `pg` rejects with `RUNTIME.BINDING_INVALID`, where `pg` used to win silently; pass only one. An empty `url` used to make `pg` connect with the `PG*` environment variables or to localhost; it now rejects with `RUNTIME.BINDING_INVALID`, so check that the variable you pass as `url` is set. A `url` that cannot be parsed or is not `postgres://` / `postgresql://` also rejects with `RUNTIME.BINDING_INVALID`, instead of failing on the first query. A `pg` value that is neither a `pg.Pool` nor a `pg.Client` now rejects with `RUNTIME.BINDING_INVALID` instead of `SUPABASE.CONFIG_INVALID`. A `pg.Client` still rejects with `SUPABASE.CONFIG_INVALID`, and its message is now "Supabase takes a pg.Pool or a url, not a pg.Client".
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\w$.])supabase(?:<[^>]*>)?\(\s*[{A-Za-z_$]'
        - 'The pg option takes a pg\.Pool'
        - '(?<![\w$.])(?:pg|url|binding)\s*:\s*(?:null\b|[^,}\n]*\?\?\s*null\b)'
---

# `supabase()` takes one database input, checked when it is called

```ts
// Before: pg was used and url ignored
const db = await supabase({ contract, url, pg: pool, jwtSecret });

// After
const db = await supabase({ contract, pg: pool, jwtSecret });
```

In each `supabase(...)` call, keep exactly one of `url`, `pg` and `binding`. If you passed both `url` and `pg`, keep `pg`: that is the one the client used.

If `url` comes from an environment variable, make sure it is set. An empty `url` used to connect to whatever the `PG*` environment variables or localhost pointed at; it now fails at startup.

Code or tests that match a `pg` refusal on `SUPABASE.CONFIG_INVALID` keep working for a `pg.Client`. Update a match on the old message "The pg option takes a pg.Pool" to "Supabase takes a pg.Pool or a url, not a pg.Client". A `pg` value that is neither a pool nor a client now fails with `RUNTIME.BINDING_INVALID`.

`null` as `pg`, `url` or `binding` now fails with `RUNTIME.BINDING_INVALID` on `postgres()` and on `supabase()`. Code such as `pg: config.pool ?? null` should leave the option out instead:

```ts
// Before
postgres({ contract, url: process.env['DATABASE_URL'] ?? null });

// After
const url = process.env['DATABASE_URL'];
postgres({ contract, ...(url === undefined ? {} : { url }) });
```
