---
changes:
  - id: select-ast-options-carry-locking
    summary: "SelectAstOptions has a new required key, locking; when rebuilding a select from an existing SelectAst, carry ast.locking so a row lock is not dropped."
    detection:
      glob: "**/*.ts"
      contains:
        - "new SelectAst("
  - id: render-lowered-sql-takes-capabilities
    summary: "renderLoweredSql from @internal/adapter-postgres/sql-renderer takes a required fourth argument, the capability matrix to check locking clauses against; pass postgresAdapterCapabilities from @internal/adapter-postgres/adapter."
    detection:
      glob: "**/*.ts"
      contains:
        - "renderLoweredSql("
---

## `select-ast-options-carry-locking`

`SelectAstOptions` now has a required `locking: ReadonlyArray<LockingClause> | undefined`. Where you construct `new SelectAst({ ... })` from an existing select's fields, add `locking: ast.locking` when you rebuild an existing select. Pass `locking: undefined` only for a select you build from nothing. Setting it to `undefined` while rebuilding an existing select removes the caller's `FOR UPDATE` without an error.

## `render-lowered-sql-takes-capabilities`

`renderLoweredSql(ast, contract, codecDescriptorRegistry)` is now `renderLoweredSql(ast, contract, codecDescriptorRegistry, capabilities)`. The renderer refuses a locking clause whose strength or option the given capabilities do not report. To render as the Postgres adapter does, pass its capabilities:

```ts
import { postgresAdapterCapabilities } from '@internal/adapter-postgres/adapter';
import { renderLoweredSql } from '@internal/adapter-postgres/sql-renderer';

renderLoweredSql(ast, contract, codecDescriptorRegistry, postgresAdapterCapabilities);
```
