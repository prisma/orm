---
changes:
  - id: supabase-one-binding-input
    summary: |
      `supabase()` now checks its database input the way `postgres()` does. Passing both `url` and `pg` rejects with `RUNTIME.BINDING_INVALID`, where `pg` used to win silently; pass only one. A `url` that is empty, unparseable or not `postgres://` / `postgresql://` rejects with `RUNTIME.BINDING_INVALID` when `supabase()` is called, instead of failing on the first query.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '\bsupabase\(\s*\{'
---

# `supabase()` takes one database input

```ts
// Before: pg was used and url ignored
const db = await supabase({ contract, url, pg: pool, jwtSecret });

// After
const db = await supabase({ contract, pg: pool, jwtSecret });
```

In each `supabase({ ... })` call, keep exactly one of `url`, `pg` and `binding`. If you passed both `url` and `pg`, keep `pg`: that is the one the client used.
