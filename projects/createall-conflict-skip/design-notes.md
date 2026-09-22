# Design notes: createAll conflict skip

## Principles

- **Say what the database did.** A batch write returns the rows or the count the database reports, never a number derived from the input.
- **Name the constraint when portability needs it.** An API that only works on databases with a bare `ON CONFLICT` form would have to change when MySQL and SQL Server arrive. The target is optional today and required by capability on those targets.
- **Gate on capabilities, not targets.** The ORM never asks which database it is talking to.

## The model

```
createAll(rows, { onConflict: 'skip', conflictOn?: Field[] }, configure?)
createAndCount(rows, { onConflict: 'skip', conflictOn?: Field[] }, configure?)
```

- `onConflict: 'skip'` adds `InsertOnConflict` with a `do-nothing` action to every insert plan the call compiles (one on Postgres, one per column-signature group on SQLite).
- `conflictOn` maps fields to columns and becomes the clause's `columns`. Absent, `columns` is empty and the renderer emits `ON CONFLICT DO NOTHING`.
- Capability check at the consumption site: `sql.insertOnConflictSkip` for the option, `sql.insertOnConflictWithoutTarget` for the absent target.
- `createAll` streams the `RETURNING` rows. `createAndCount` returns `affectedRows` from the execute statistics, summed on the split path.
- Multi-table inheritance variants refuse the option.

## Alternatives considered

| Option | Why not |
| --- | --- |
| `createAll(rows, { skipDuplicates: true })`, Prisma 7 parity | Says nothing about which constraint. Always the bare form, which SQL Server cannot express. |
| `onConflict: 'doNothing'` (Serhii, 2026-09-21) | Matches the SQL and the AST action name. Rejected for now because it is Postgres wording in a portable API: MySQL spells this `INSERT IGNORE`, SQL Server `MERGE`. `'skip'` names what the caller observes. Neither side considers this a blocking preference. |
| Separate method `createAllIgnoringConflicts(rows)` | Doubles with `createAndCount`. |
| Chained modifier `db.User.onConflict('skip').createAll(rows)` | Puts a write-only flag into builder state that `find`, `select`, and `include` share. |
| Always require `conflictOn` | Most portable, but forces every Postgres and SQLite user to name a constraint for the common "any unique" case. The capability key makes the requirement target-specific instead. |
| Support MTI variants with a savepoint per row | Correct, but a second transaction-shape concern inside an experimental surface. Refuse now, revisit if asked. |

## Decisions

1. **Option name `onConflict: 'skip'`, with optional `conflictOn` field list.** Same vocabulary as `upsert`. Reads as a policy, not a boolean. The option never gains an update value; `upsert` owns that (Serhii, 2026-09-21).
2. **Two capability keys, not one.** `insertOnConflictSkip` says the adapter can skip on conflict at all. `insertOnConflictWithoutTarget` says it can do so without naming a constraint. SQL Server will report the first and not the second.
3. **`createAndCount` count fix is its own slice, before the feature.** It is a bug regardless of this feature, and the feature slice should not carry a behaviour change to an unrelated code path.
4. **A contract emitted before the keys exist is refused, not assumed.** Missing capability means "not supported". Users regenerate. This matches how `defaultInInsert` behaved when it was introduced.

## Open questions

Carried in [`spec.md`](./spec.md) § Open questions.

## References

See [`spec.md`](./spec.md) § References.
