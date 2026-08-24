---
from: "0.10"
to: "0.11"
changes:
  - id: insert-single-row-wrap-in-array
    summary: Wrap single-row `.insert({...})` call sites in an array — `.insert([{...}])`. The single-object overload is removed; `.insert()` now exclusively accepts an array of row objects.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - ".insert("
      anyMatch: true
---

# 0.10 → 0.11 — User upgrade instructions

## `insert-single-row-wrap-in-array`

Starting at the 0.11 release, the `.insert()` method on the SQL builder accepts **only** an array of row objects. The single-object overload that previously allowed `.insert({ field: value })` is removed.

Before 0.11:

```ts
await runtime.execute(db.sql.user.insert({ email: 'alice@example.com' }).build());
```

Starting at 0.11:

```ts
await runtime.execute(db.sql.user.insert([{ email: 'alice@example.com' }]).build());
```

Walk every `.ts` / `.tsx` file matched by the `detection.glob` above. For each call site that passes a plain object directly to `.insert(...)`, wrap the argument in an array:

- `.insert(row)` → `.insert([row])`
- `.insert({ field: value })` → `.insert([{ field: value }])`

Variable references to a row object are safe to wrap directly:

```ts
// Before
for (const item of items) {
  await runtime.execute(db.sql.table.insert(item).build());
}
// After
for (const item of items) {
  await runtime.execute(db.sql.table.insert([item]).build());
}
```

If a call site already passes an array (`.insert([row1, row2])`), it is already correct — leave it unchanged.

TypeScript will flag bare-object call sites as type errors after the bump, providing a reliable compile-time signal for every affected site.

### Validation

After applying the rule above, run `pnpm typecheck && pnpm test` (or your application's equivalent). The change is mechanical — every affected call site is flagged at compile time.
