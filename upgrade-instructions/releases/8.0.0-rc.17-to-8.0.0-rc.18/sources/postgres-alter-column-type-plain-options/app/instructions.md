---
changes:
  - id: postgres-alter-column-type-plain-options
    summary: |
      `this.alterColumnType(...)` in a Postgres `migration.ts` now takes `{ schema, table, column, type, using?, operationClass? }`. The `options` object with `qualifiedTargetType`, `formatTypeExpected`, `rawTargetTypeForLabel` and `using` is gone. Move `options.qualifiedTargetType` to `type` and `options.using` to `using`, and drop the other two.
    detection:
      glob: "**/migration.ts"
      matches:
        - '\bqualifiedTargetType\s*:'
---

# `alterColumnType` takes the new type and the conversion directly

A hand-written Postgres migration that changes a column's type called `alterColumnType` with an `options` object that carried internal names:

```ts
this.alterColumnType({
  schema: 'public',
  table: 'user',
  column: 'age',
  options: {
    qualifiedTargetType: 'int4',
    formatTypeExpected: 'integer',
    rawTargetTypeForLabel: 'int4',
    using: '"age"::integer',
  },
}),
```

It now takes the new type and the conversion directly:

```ts
this.alterColumnType({
  schema: 'public',
  table: 'user',
  column: 'age',
  type: 'int4',
  using: '"age"::integer',
}),
```

A `migration.ts` that still passes `options` stops with `MIGRATION.OPERATION_OPTION_REMOVED` when it runs, naming the column and the new shape.

For each `migration.ts` the detection matches:

1. Replace `options: { ... }` with `type: <the value of qualifiedTargetType>`, and `using: <the value of options.using>` when the old call had one.
2. Delete `formatTypeExpected` and `rawTargetTypeForLabel`. The operation now works out the type the database prints from `type`, through the data types of the configured stack. A type it cannot read fails with `MIGRATION.COLUMN_TYPE_UNREADABLE`, which names the call. Write the type as a migration writes it, such as `int4`, `varchar(20)`, or `"Mood"` for an enum, or add the extension that provides it to the configuration.
3. Check `operationClass`. Left out, it is now `data` when the call has a `using`, and `destructive` otherwise. A call with a `using` that said `operationClass: 'destructive'` keeps that class only if you keep the option; delete it to class the conversion as `data`. A call that said `operationClass: 'widening'` keeps it.
4. Check `using`. A semicolon, a SQL comment or dollar quoting outside a quoted literal, or a comma or a keyword such as `FROM` or `UNION` outside parentheses, now fails with `MIGRATION.SQL_EXPRESSION_INVALID`, which names the call. `FROM` directly after `DISTINCT`, as in `IS DISTINCT FROM`, is accepted. Remove a trailing comment. If the expression holds a comma or a keyword such as `FROM` at the top level, wrap it in parentheses.
5. If the migration has not been applied to any database, run it (`node <package dir>/migration.ts`) to write `ops.json` and `migration.json` again. If it has been applied, leave those two files as they are: the operation's label now names the type as written in `type`, so writing them again would change the migration's hash.
