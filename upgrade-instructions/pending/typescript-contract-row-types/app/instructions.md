---
changes:
  - id: typescript-contract-namespace-keys
    summary: |
      A contract built with `defineContract` from TypeScript now types `contract.domain.namespaces` with only the namespaces it has: `public` on Postgres, `__unbound__` on SQLite, plus each namespace listed in `namespaces`. Before, any key typechecked. Replace a key the contract does not have with the one it has. ORM rows of such a contract, which were typed `unknown` field by field, now have each field's codec output type, so casts that stated those types can go.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.domain\.namespaces\b'
---

# A TypeScript contract's namespaces and rows have precise types

A contract built with `defineContract` from TypeScript typed `contract.domain.namespaces` as a record with any string key, so any key typechecked. It now has only the keys the built contract has at runtime: `public` on Postgres, `__unbound__` on SQLite, and each namespace the definition lists in `namespaces`.

Code that reads a namespace the contract does not have now fails to typecheck. At runtime that key was always `undefined`. Use the namespace the contract has:

```diff
  // A Postgres contract built with defineContract
- type User = (typeof contract.domain.namespaces)['__unbound__']['models']['User'];
+ type User = (typeof contract.domain.namespaces)['public']['models']['User'];
```

The ORM client of such a contract now types each row field as its codec's output type, narrowed to the enum's values for an enum field. Before, every field was `unknown`. On Postgres, `db.orm.public` is no longer possibly `undefined`. Casts and non-null assertions written to work around this still typecheck, and you can remove them:

```diff
  const row = await db.orm.Sample.first();
- const level = row.level as 1n | 10n;
+ const level = row.level;
```

`field.column({ codecId: 'pg/int4@1', nativeType: 'int4' })` now keeps the literal codec id without `as const`, so the field reads as that codec's output type instead of `unknown`.
