---
changes:
  - id: setdefault-operation-class-derived
    summary: |
      On PostgreSQL, `this.setDefault` in `migration.ts` no longer takes `operationClass`. The operation is widening when the migration's start contract gives the column a default, and additive otherwise. `migration plan` no longer writes `operationClass` into the call. A `migration.ts` that passes it no longer type-checks; delete the option.
    detection:
      glob: "**/migration.ts"
      matches:
        - '\bsetDefault\(\{(?:(?!\bthis\.)[\s\S])*?\boperationClass\s*:'
  - id: setdefault-has-no-postcheck
    summary: |
      On PostgreSQL, a `setDefault` operation no longer checks afterwards that the column has a default, so the runner no longer skips it when the column already has a different default. A package planned by 8.0.0-rc.15 or 8.0.0-rc.16 whose `migration.ts` has a hand-written `setDefault` that changes an existing default still carries the old check in `ops.json`; write its `ops.json` again before you apply it.
    detection:
      glob: "**/ops.json"
      matches:
        - 'verify column \\"(?:[^"\\]|\\.)*?\\" has a default'
---

# `setDefault` derives its operation class and has no postcheck

## `setdefault-operation-class-derived`

`this.setDefault` on the PostgreSQL `Migration` class used to take `operationClass`, and `migration plan` wrote `operationClass: 'widening'` when a migration changed an existing default. The option is gone. The method reads the migration's start contract: the operation is widening when the start contract gives the column a default, and additive otherwise, including in a migration with no start contract. Delete the option:

```typescript
// before
this.setDefault({ table: 'user', column: col('role', 'text', { default: lit('member'), codecRef: { codecId: 'pg/text@1' } }), operationClass: 'widening' })
// after
this.setDefault({ table: 'user', column: col('role', 'text', { default: lit('member'), codecRef: { codecId: 'pg/text@1' } }) })
```

`node migration.ts` does not check types, so a file that still passes `operationClass` runs and ignores it. An applied migration needs nothing: `prisma db migrate` applies `ops.json`.

## `setdefault-has-no-postcheck`

A `setDefault` operation checked afterwards that the column has a default. The old default passes that check, and the runner skips an operation whose check already passes before it runs. In 8.0.0-rc.15 and 8.0.0-rc.16 only an additive `setDefault` carried the check, and a hand-written `this.setDefault` was additive unless it passed `operationClass: 'widening'`. Such a call on a column that already had a different default was skipped, and `prisma db migrate` then failed with `MIGRATION.SCHEMA_VERIFY_FAILED`. A `setDefault` operation now carries no check afterwards; the final schema verification compares the default's value, and setting a default twice changes nothing.

A matched `ops.json` needs action only when its migration is not applied yet and a hand-written `setDefault` in its `migration.ts` changes a default the column already has. Write its `ops.json` again before you apply it: run its `migration.ts` (`node migration.ts`), or delete the package and run `prisma migration plan` again. A package the planner wrote for a column with no default, and an applied migration, need nothing.
