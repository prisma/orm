---
changes:
  - id: sql-builder-insert-required-columns
    summary: |
      A SQL builder insert, `db.sql.<namespace>.<table>.insert(rows)`, must now include every column that is not nullable and has no default. Leaving one out is a type error that names the column, and so is a value typed `T | undefined` for such a column. Add a real value, narrowed to `T`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\.insert\('
  - id: orm-create-on-update-only-field
    summary: |
      In ORM `create` and `upsert`, a field that is not nullable, has no default and generates a value only on update is now required. That is a field with `@onUpdate(...)` and no `@onCreate(...)`, a temporal preset with only its update phase such as `temporal.timestamptz(onUpdate: now)` or `field.temporal.timestamptz(undefined, undefined, 'now')`, or a TypeScript field with `.onUpdate(...)` and no `.onCreate(...)`. Pass a value for it on create, or make it generate on create too.
    detection:
      glob: "**/*.{prisma,ts}"
      matches:
        - '@onUpdate\('
        - 'onUpdate:\s*now'
        - '\.onUpdate\('
        - '\.temporal\.\w+\([^)]*,\s*[''"]now[''"]'
---

# Inserts must include the columns the database requires

The SQL builder's `insert` used to accept a row that left out any column. A row without a value for a column that is not nullable and has no default compiled, and then the database rejected it with a not-null error. The row type now requires those columns:

```typescript
// User.displayName is `String` with no default
db.sql.public.user.insert([{ email: 'admin@example.com', kind: 'admin' }]);
// error: Property 'displayName' is missing

db.sql.public.user.insert([{ email: 'admin@example.com', kind: 'admin', displayName: 'Admin' }]);
```

A column is still optional when it is nullable, when it has a default (`@default(...)`, including `now()` and `autoincrement()`), or when the client generates its value on create with `@onCreate(...)` or a preset that generates on create. Rows in one `insert` call are checked one by one, so they may set different optional columns.

For each insert that stops compiling, add a real value for each column the error names. Do not cast the row. A required property does not accept `undefined`, so a value typed `T | undefined` for one of these columns is now an error too: check it before the insert. Rows built in a variable and passed as `insert(rows)` get the same check, so give the variable the row type or build each row with every required column.

## ORM create for fields that generate only on update

A field generates its value on update only when it has `@onUpdate(...)` without `@onCreate(...)`, or when a temporal preset sets only its update phase: `temporal.timestamptz(onUpdate: now)` and `temporal.timestamp(3, onUpdate: now)` in PSL, `field.temporal.timestamptz(undefined, undefined, 'now')` in TypeScript. Such a field that is not nullable and has no default was optional in ORM `create` input, and the create then failed in the database. It is now required. Pass a value for it on create, or make it generate on create too: add `@onCreate(...)`, or set the preset's create phase (`temporal.timestamptz(onCreate: now, onUpdate: now)`).
