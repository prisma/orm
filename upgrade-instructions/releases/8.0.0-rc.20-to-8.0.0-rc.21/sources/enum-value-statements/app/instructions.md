---
changes:
  - id: removed-enum-value-questions
    summary: |
      On Postgres and SQLite, when the contract removes a member of an enum, or changes the value a member stores, `migration plan` and `db update` now rewrite the rows that hold the old stored value, and ask about it first. Before, Postgres failed at apply on the new check when a row held the old value, and SQLite planned nothing. If the member was renamed, say so with `--rename Status.ARCHIVED:Status.RETIRED`, which changes the stored value in every row and list that holds it. Answer with `--delete Status.ARCHIVED` to set it to NULL in optional columns and take it out of lists.
---

# A removed enum value is asked about

If your contract removes a member of an enum, for example `ARCHIVED` from `Status`, the next `migration plan` or `db update` asks about it, as it asks about a model or field you remove: once, however many columns hold it.

If you renamed the member, give the rename, and the rows that held the old stored value hold the new one:

```bash
prisma db update --rename Status.ARCHIVED:Status.RETIRED
```

Otherwise the value is removed. A script that runs without a terminal fails with `CLI.CONSENT_REQUIRED`, naming the value. To let it go, add `--delete Status.ARCHIVED`: optional columns that hold it are set to NULL, and lists lose it. A required column cannot take NULL, so while rows of a required column hold the value, the apply fails with `MIGRATION.PRECHECK_FAILED`, changes nothing, counts the rows, and says how to keep them: rename the value to a new member, or keep that data by hand.

A member renamed with its stored value kept, for example with `RETIRED = "archived"`, changes nothing in the rows, and is not asked about. A member that keeps its name but stores a new value is asked about with `--delete` only, and so are two members that swap stored values; to keep the rows, the question names, for every column the enum types, the `this.removeStoredValue(...)` call to replace with `this.replaceStoredValue(...)` calls in the `migration.ts` that `migration plan` writes, and the `node` command that runs it. A swap goes through a temporary value. `db update` cannot keep that data in one run: its question says to plan the change with `migration plan --from <hash>`, or to rename the member to a new member and back in two runs of `db update`. For a swap only the plan works, and without migrations `db update` says it cannot keep the data.

Renames that shift stored values along, such as `Higher = 3` to `A = 4` while `Max = 4` becomes `B = 5`, are planned in one run, the last value first. Renames that move stored values in a cycle are refused; the refusal prints the `migration plan` command to write those rewrites by hand in, through a value no member stores.

Native Postgres enums (`pg.enum(...)`) are unchanged.
