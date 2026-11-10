# ADR 038 — Operation idempotency classification & enforcement

## Decision

Before the runner applies an operation, it runs the operation's postchecks. If they all hold, the operation is already applied, and the runner skips it. Otherwise it runs the prechecks, executes the operation, and runs the postchecks again to confirm the result. After the last operation, the runner checks the whole database against the migration's end contract.

That order makes every postcheck do two jobs: it confirms an operation worked, and it decides whether the operation runs at all. So every postcheck follows one rule:

> Before an operation runs, its postchecks may all hold only when the operation's full effect is already in place.

A postcheck that also holds for another state lets the runner skip work that was never done. Where the full effect cannot be checked reliably, the operation carries a weaker postcheck or none, and the final check against the end contract catches most differences. [Where a postcheck is weaker than the full effect](#where-a-postcheck-is-weaker-than-the-full-effect) lists each case and what catches it.

### Example: changing a default from `'open'` to `'closed'`

A `ticket` table has a column `status text DEFAULT 'open'`. A migration changes the default to `'closed'`. The Postgres planner writes this operation:

```json
{
  "id": "setDefault.ticket.status",
  "operationClass": "widening",
  "precheck": [{ "description": "ensure column \"status\" exists", "sql": "…" }],
  "execute": [
    {
      "description": "set default on \"status\"",
      "sql": "ALTER TABLE \"public\".\"ticket\" ALTER COLUMN \"status\" SET DEFAULT 'closed'"
    }
  ],
  "postcheck": []
}
```

Suppose the operation had the postcheck "column `status` has a default". Before the operation runs, the column has the default `'open'`, so that check already holds. The runner would skip the operation and the default would stay `'open'`. The check holds for a state other than the operation's full effect, so it breaks the rule.

A postcheck that compares the value would follow the rule, but Postgres stores a default as text in its own normalized form, for example `'closed'::text`. The check would need that text predicted at plan time for every type and expression, which is fragile. So `setDefault` carries no postcheck. With an empty postcheck list the runner never skips the operation: it checks that the column exists and runs `SET DEFAULT 'closed'`. Running it again on a column that already has that default is harmless. The final check against the end contract compares the default's value.

The class is `widening` because the column already has a default; on a column without one it is `additive`. A hand-written Postgres migration's `this.setDefault` takes no `operationClass` option. It reads the column in the migration's start contract, after renames made earlier in the same migration, and picks the class the same way ([ADR 232](ADR%20232%20-%20A%20migration%20is%20authored%20against%20its%20start%20and%20end%20contract%20snapshots.md)).

An `autoincrement()` default is different: `setDefault` then creates and attaches a sequence, and that operation keeps a postcheck: the column owns a sequence of the planned width.

## Runner behavior

The Postgres, SQLite and MongoDB runners all do the same thing for each operation:

1. **Postchecks first.** Run the postchecks. If the list is not empty and every postcheck holds, the operation is already applied: skip it and continue. Postgres and SQLite record the skip with the reason `postcheck_pre_satisfied`. An empty list never skips.
2. **Prechecks.** Run the prechecks. If one fails, halt with `MIGRATION.PRECHECK_FAILED`.
3. **Execute.** Run the operation's statements or commands. On a database error, halt.
4. **Postchecks again.** If one fails, halt with `MIGRATION.POSTCHECK_FAILED`.

After the last operation, the runner introspects the database and compares it with the end contract, the same comparison `db verify` runs. A difference halts with `MIGRATION.SCHEMA_VERIFY_FAILED`, and the marker does not move. Postgres and SQLite do this for the app space on every run. MongoDB does it on every run except one where no operation ran and the marker is already at the destination.

Postgres and SQLite run the whole migration in one transaction, so a halt rolls back every operation (see [ADR 037](ADR%20037%20-%20Transactional%20DDL%20Fallback.md)). MongoDB has no transaction for DDL. A failed run leaves earlier operations applied, and the next run relies on step 1 to pass over them.

The runner options `prechecks`, `postchecks` and `idempotencyChecks` can each turn a step off. Step 1 runs only when both postchecks and idempotency checks are on.

Separately, the SQL runners skip every operation of a migration when the marker is already at its destination and the plan has an origin that differs from the destination. The final check still runs.

## Conflict matrix

| Before the operation | Result |
|---|---|
| Postchecks all hold (list not empty) | Skip as already applied |
| Postchecks do not all hold, a precheck fails | Halt: `MIGRATION.PRECHECK_FAILED` |
| Prechecks hold, execution fails | Halt with the database error |
| Prechecks hold, execution succeeds, a postcheck fails | Halt: `MIGRATION.POSTCHECK_FAILED` |
| All operations done, database differs from the end contract | Halt: `MIGRATION.SCHEMA_VERIFY_FAILED` |

## What a postcheck compares

A postcheck compares structure the database reports in its catalog: the kind of object, its table, its ordered columns, a foreign key's target and referential actions, an index's method and uniqueness, and so on. It does not compare text Postgres reprints in its own form: expressions, index predicates, check constraint and policy bodies, and defaults. Postgres may print the same thing differently from how the plan wrote it, so such a comparison would fail on a correct database.

What each target checks, beyond "an object with this name exists":

- **Postgres.**
  - `createTable`: the relation is a table.
  - `addColumn` and the two recipes that add a required column: the column's type, and `NOT NULL` where the column declares it. The type is compared as `format_type` prints it when the column's data type can read that text, and by type OID otherwise.
  - `alterColumnType`: the column's new type, compared the same way. When the column owns a sequence, the operation also changes that sequence to the new width. The sequence is found when the operation runs, with `pg_get_serial_sequence`, so its name is not fixed at plan time. When the new width is narrower, a precheck reads the sequence's position and refuses when it has already handed out a value past that width. A step changes the sequence to the new type after the column change, and a postcheck asks that the column owns a sequence of the new width, whatever its name. A column that owns no sequence, such as one whose `nextval` default uses a sequence it does not own, gets only the column type change.
  - `createIndex`: the index is on the planned table, with the planned uniqueness and access method, and has a predicate exactly when the plan does. For an index over columns, the postcheck also compares the columns in order. For an index written as a list of elements (`expression:`), it does not compare the elements at all.
  - `addPrimaryKey`, `addUnique`: the constraint kind and its ordered columns.
  - `addForeignKey`: the kind, the columns, the referenced table and columns, and the `ON DELETE` and `ON UPDATE` actions.
  - `addCheckConstraint`: the constraint kind.
  - `createRlsPolicy`: the command, whether it is permissive, and the roles as a set.
  - `renameTable`, `renameColumn`, `renameIndex`, `renameConstraint`, `renameRlsPolicy`: the new name exists and the old name is gone.
  - `setDefault`: no postcheck for a literal or function default; for `autoincrement()`, the column owns a sequence of the planned width, whatever its name. The sequence is found when the operation runs, with `pg_get_serial_sequence`.
  - `replaceStoredValue`, `removeStoredValue`: unlike the others, these read rows, as a data transform does. The postcheck states that no row holds the old value in the column, or, for a Postgres list column, that no list contains it. So the runner skips the operation when no row holds the value, before or after it ran. `removeStoredValue` on a scalar column has a precheck that the column takes NULL or that no row holds the value, so on a required column it fails only while rows hold the value.
- **SQLite.**
  - `createTable`: the table has exactly the planned columns, each with its declared type, nullability and primary key position.
  - `addColumn`: the column's declared type and nullability.
  - `createIndex`: the index is on the planned table, over the planned columns in order, with the planned uniqueness.
  - `recreateTable`: the `CREATE TABLE` text SQLite stores for the table in `sqlite_master` equals exactly the statement the rebuild writes. SQLite keeps that text as written and only swaps in the new name when the rebuilt table is renamed, so the check holds once the rebuild ran and not before. It covers every part of the table, including `AUTOINCREMENT`, which SQLite keeps nowhere else. A table that was written any other way, even with the same meaning, fails the check and is rebuilt; see [Where a postcheck is stricter than the full effect](#where-a-postcheck-is-stricter-than-the-full-effect) for what protects its data. The rebuild also keeps its column, default, primary key, unique and foreign key checks, including the `ON DELETE` and `ON UPDATE` actions.
  - `replaceStoredValue`, `removeStoredValue`: unlike the others, these read rows, as a data transform does. The postcheck states that no row holds the old value in the column. So the runner skips the operation when no row holds the value, before or after it ran. `removeStoredValue` on a scalar column has a precheck that the column takes NULL or that no row holds the value, so on a required column it fails only while rows hold the value.
- **MongoDB.**
  - `createIndex`: the keys and every option that tells two indexes apart: `unique` and `sparse` (set or not), the TTL, the partial filter, the wildcard projection, the collation, and for a text index the key, weights and languages as MongoDB lists them. The list of options has one source, `MONGO_INDEX_OPTION_KEYS` in `mongo-schema-ir`, which the planner, the schema verifier and the postcheck share. It is checked both ways at compile time: the list fails to compile when it misses an index option of the schema IR, and the postcheck fails to compile when the list misses an option `createIndex` accepts. `name` is left out on purpose, since the name is not part of an index's definition. MongoDB returns index options as they were given, so these are document comparisons, with two exceptions where it fills in defaults. A collation given by the call is compared on the fields given, since MongoDB fills in the rest; a call with no collation requires the live index to have none, because the verifier reports a collation the contract does not give as drift. A text index's weights and languages are compared with MongoDB's defaults filled in.
  - `collMod` that sets a validator: the whole validator document. For a validator that is only a `$jsonSchema`, the `$jsonSchema` body.

### Where a postcheck is weaker than the full effect

Some postchecks hold for states other than the operation's full effect. They are kept because the alternative is worse. Without a postcheck the runner always runs the prechecks, and a create-style operation has a precheck that its object does not exist yet. On a database that already has the object, such as one where migrations are replayed without a marker, that precheck fails. A structural postcheck lets the runner skip the object instead.

Each weak case, and what catches a difference:

- **Check constraint, policy, and an index with an expression or a predicate.** The postcheck compares structure only, not the body, expression or predicate. An object with the same name and structure but another body passes it, and the runner skips the operation. When the planner names the object, the name carries a hash of the body, so another body means another name and the postcheck does not hold. When the user names the object, the final check against the end contract compares the body and fails the run. Nothing catches a hand-made object that has the planner's hashed name but another body, because the final check compares only the name of such an object.
- **An index written as a list of elements.** The postcheck compares the name, table, uniqueness, access method and whether there is a predicate, not the elements. Two such indexes that differ only in their elements, such as `("email" DESC)` and `(lower("email"))`, both pass it. For a name the user chooses, the final check compares the elements and fails the run. For a name the planner chooses, the name carries a hash of the elements, so other elements mean another name. Nothing catches a hand-made index that has the planner's hashed name but other elements.
- **A column type compared by type OID.** This happens when the column's data type cannot read the text `format_type` prints, such as some raw types. The OID ignores modifiers, so `varchar(20)` passes a check for `varchar(50)`. The final check compares the full type and fails the run.
- **A column type compared as `format_type` text.** This is text Postgres prints. The plan predicts it the same way the final check does, so a wrong prediction makes the postcheck fail after a correct change. It does not cause a skip.
- **Postgres `createTable`.** The postcheck checks the relation kind, not the columns. The final check compares the columns.
- **No postcheck at all.** `setDefault` with a literal or function default. The final check compares the value.

On Postgres and SQLite the final check runs inside the migration's transaction, so a failure rolls back the whole run. On MongoDB earlier operations stay applied.

An operation whose postcheck cannot tell its effect apart from no change at all is refused. A hand-written Postgres `this.alterColumnType` with `using`, on a column that already has the new type in the migration's start contract after the migration's earlier renames, is refused when `migration.ts` builds its operations (see the error reference). Its postcheck checks the column's type, which already holds, so the runner would skip it and the conversion in `using` would never run. A conversion that keeps the type is written as a `dataTransform`, whose checks look at the rows. A type change to the same type without `using` is not refused: skipping it loses nothing.

### Where a postcheck is stricter than the full effect

SQLite `recreateTable` compares text. It checks that the table's stored `CREATE TABLE` text equals the statement the rebuild writes, and compares a column's default with `pragma_table_info.dflt_value`. SQLite stores both as they were written, not reprinted, so the comparisons are reliable. They hold for less than the full effect, not more: a table with the same meaning written another way fails them, and the runner rebuilds it.

Such a rebuild is common on a database that is further along than the migration, such as one where migrations are replayed without a marker. A later `ALTER TABLE … ADD COLUMN`, rename or rebuild rewrites the stored text, so an earlier rebuild's postcheck no longer holds and the rebuild runs again. The rebuild copies only the columns it planned for. To keep it from dropping a column it does not know, a precheck checks that the live table's columns, from `pragma_table_info`, are exactly the rebuild's source columns. A table with other columns fails with `MIGRATION.PRECHECK_FAILED` and the transaction rolls back, instead of losing that column's data. A table with the same columns written in another form is rebuilt without loss.

## Context

The migration runner applies a sequence of operations defined on an edge from `fromHash` to `toHash`. Real databases can be retried, interrupted, or concurrently modified. To remain safe and resumable, the runner must distinguish between an operation that is already applied, a true conflict, and a fresh apply.

The skip in step 1 decides the outcome when the database does not match the migration's start state:

- A database with no marker. `db migrate` runs every operation of every migration against whatever is there. This works when the database is at or behind each migration's state: an operation already applied is skipped, and the rest run. A database that is already ahead of a migration stops at that migration's precheck. For example, migration A adds `x int4` and migration B changes it to `int8`. On a database that already has `x int8`, A's postcheck does not hold, because the type differs, and A's precheck fails, because `x` exists. The run halts with `MIGRATION.PRECHECK_FAILED`. An existing database is adopted with `db sign` instead, which writes the marker for the contract the database already satisfies ([Adopting](../../design/10-domains/migration/user-journeys.md#adopting)).
- `db init` and `db update`, which plan from the live database.
- A database that drifted from its marker, or a hand-written migration whose operations do not match the database.
- MongoDB only: running again after a partial failure.

## Problem

- Without explicit idempotency semantics, a retried migration may partially reapply destructive steps or hide conflicts
- Different operations have different safety characteristics and verification strategies
- The runner needs a uniform way to decide continue, skip or fail on every replay scenario

## Goals

- Classify operations by idempotency and define precise pre/post invariants
- Define what "already applied" means and how the runner records outcomes
- Specify runner behavior on replays vs true conflicts
- Keep semantics deterministic and auditable

## Non-goals

- Designing compensation logic for every possible database defect
- Auto-healing external state or application data
- Replacing human review for destructive changes

## Definitions

**Precondition**
A set of checks evaluated before execution that must hold for the operation to be safely applied

**Postcondition**
A set of checks that hold exactly when the operation's full effect is in place. The runner evaluates them before execution, to detect an applied operation, and after execution, to confirm success

**Already applied**
A state where the postcondition fully holds before the operation runs, with effects equivalent to a successful apply

**Conflict**
A state where the postcondition does not hold and the precondition fails, indicating divergence from the planned edge

## Idempotency classes

The classes below describe how operations behave on replay. The runner does not read a class from the operation: it decides from the postchecks and prechecks alone, as described in [Runner behavior](#runner-behavior). An operation's class shows in which checks it carries.

### 1. Strictly idempotent (creates)

**Examples:** create table, column, index or constraint

- **Pre:** target does not exist
- **Post:** target exists and matches its definition by structure
- **Already applied:** post holds before the run, so the runner skips the operation

### 2. Effect-idempotent

**Examples:** set nullability, set a default

- **Pre:** the target exists and is compatible with the change
- **Post:** the metadata matches the desired spec, when that can be checked by structure
- **Already applied:** post holds before the run. When the effect cannot be checked by structure, as for a column default, there is no post and the operation runs again; this is safe because running it again is harmless

### 3. Replay-sensitive but bounded by unique identity

**Examples:** insert into ledger tables, enqueue background task with unique opId

- **Pre:** no prior execution with the same identity AND schema compatible
- **Post:** effect observed for that identity
- **Already applied:** post holds before the run

### 4. Non-idempotent requiring explicit guard

**Examples:** destructive DDL (drop table/column), irreversible data transforms

- **Pre:** exact match of expected pre-state
- **Post:** exact match of desired post-state
- **Already applied:** post holds before the run. Policy decides whether such an operation may run at all

## Examples

### Strict

**createIndex**
- **Pre:** no index with this name
- **Post:** an index with this name exists on the planned table, over the planned columns in order, with the planned uniqueness (and on Postgres the planned access method, and an expression and predicate exactly when the plan has them)
- **Replay:** post holds, so the runner skips it

### Effect

**setDefault to `'closed'`** (see the [example](#example-changing-a-default-from-open-to-closed))
- **Pre:** column exists
- **Post:** none
- **Replay:** runs `SET DEFAULT` again; the final check compares the value

### Data transform

**dataTransform that backfills a column**
- **Pre:** some rows still need the change
- **Post:** no row needs the change
- **Replay:** post holds, so the runner skips it

### Non-idempotent

**dropColumn**
- **Pre:** column exists
- **Post:** column missing
- **Replay:** post holds, so the runner skips it

## Rationale

- One decision tree for every operation keeps the runner simple and auditable
- Checking the postcondition first lets a migration run again, or run against a database that already has part of its effect, without failing on prechecks
- The rule keeps that skip safe: a skip happens only when the work is done
- The final check against the end contract catches anything an operation's own checks cannot see, such as a default's value

## Alternatives considered

- **Prechecks first, postchecks only when a precheck fails.** An operation whose precheck still holds after it was applied, such as making a column required when no row holds NULL, would run again. Checking the postcondition first gives one test for "already applied". In both orders the postcheck decides the skip, so it must follow the same rule.
- **A postcheck that compares the text the database stores.** Exact when it matches, but the database prints values, expressions and bodies in its own normalized form. Predicting that text at plan time for every type and expression is fragile, and a wrong prediction fails a correct migration.
- **Treat all ops as effect-idempotent with best-effort checks.** Too optimistic; a weak check skips work that was never done.
- **Require operators to mark everything idempotent manually.** Too error-prone and inconsistent.

## Consequences

### Positive

- Safe retries and resumability across failures
- Migrations can be replayed without a marker on a database that is at or behind each migration's state
- Clear operator signals on conflicts vs harmless replays

### Negative

- Every postcheck must be reviewed against the rule; a weak postcheck silently skips work
- Some operations carry no postcheck and rely on the final check against the end contract
- Replaying migrations without a marker on a database that is already ahead of a migration fails with `MIGRATION.PRECHECK_FAILED` at that migration, where a looser postcheck would have skipped it. For example, a migration that adds `x int4` fails on a database that already has `x int8`. Such a database is adopted with `db sign`, not by replaying history. When the run has no marker, the precheck failure points to `db sign`.

## Implementation notes

- Postgres and SQLite express checks as SQL statements that return one boolean ([ADR 028](ADR%20028%20-%20Migration%20Structure%20&%20Operations.md)); MongoDB uses `{ source, filter, expect }` checks ([ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md)). All share the three-phase envelope of [ADR 191](ADR%20191%20-%20Generic%20three-phase%20migration%20operation%20envelope.md).
- Operations carry no `idempotency` field, and the ledger records migrations, not operation identities or fingerprints.
- Map runner outcomes to stable errors per [ADR 027](ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md).

## Testing

- For each postcheck, a test that the postcheck does not hold on a database where the operation's effect is only partly in place
- Unit tests for success, replay and conflict paths
- Tests that interrupt mid-edge and verify resumability

## References

- [ADR 027 — Error envelope & stable codes](ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md)
- [ADR 028 — Migration structure & operations](ADR%20028%20-%20Migration%20Structure%20&%20Operations.md)
- [ADR 037 — Transactional DDL fallback & compensation](ADR%20037%20-%20Transactional%20DDL%20Fallback.md)
- [ADR 039 — Migration graph path resolution & integrity](ADR%20039%20-%20Migration%20graph%20path%20resolution%20&%20integrity.md)
- [ADR 188 — MongoDB migration operation model](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md)
- [ADR 191 — Generic three-phase migration operation envelope](ADR%20191%20-%20Generic%20three-phase%20migration%20operation%20envelope.md)
