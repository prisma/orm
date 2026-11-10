# Design notes — Migration statements

Record of the design discussion on 2026-10-05 between the operator and the orchestrator, after the contract-source attempt was shelved. Each section carries the reasoning and the alternatives rejected.

## Principles

- The planner never guesses. It acts on a destructive-looking change only when the user has stated what it is.
- The user states intent in the vocabulary of their contract. Storage names, SQL and literal values never appear on the command line.
- A statement is sugar over the hand-written route. Whatever it produces, a user could have written in `migration.ts`, and that route stays.
- `migration plan` and `db update` share one planner. A statement means the same thing to both, and `db update` is a migration planned in memory and applied at once.

## Why not the contract source

The first attempt put `@@hint(was: "Profile")` on the model. It was shelved because stating intent in the source felt unintuitive, and because intent in the source has to survive until every environment has consumed it, which produced the rules about spent and ignored hints and the unhashed contract section that snapshots had to strip. A statement on the command line applies to one planning run. For `migration plan` the migration file is the record; for `db update` the database is. Nothing has to be left behind or cleaned up.

The prior art is honest about the trade-off. Atlas and Terraform both started with the command line, Atlas with an interactive prompt and Terraform with `state mv`, and both moved to a declaration in the source, because a command-line statement is not in version control and a prompt cannot be answered by a script or an agent. We accept the first objection knowingly: the migration file is in version control, and `db update` is dev-only. We avoid the second by having no prompt.

## Prior art

| Tool | How a rename is stated | Non-interactive answer |
| --- | --- | --- |
| Prisma Migrate 2 to 7 | Not detected; edit the generated SQL with `--create-only` | the edited migration file |
| ActiveRecord | No diffing; `rename_column` in a hand-written migration; generator shorthand writes `add_column` calls from command arguments | the migration file |
| Alembic, EF Core, pgroll | hand-written or hand-edited migration | the migration file |
| Django `makemigrations` | detects candidate pairs and asks "Did you rename X to Y?" | `--noinput` treats it as drop and add; no way to pre-answer |
| Drizzle Kit | detects candidate pairs and asks | none shipped; an open request proposes `--preflight` to export questions and `--answers` to answer them; internally the planner takes a `HintsHandler` whose only source is the prompt |
| Atlas | asked at plan time until 2024; now `renamed_from` on the object in the HCL or SQL source | the source declaration; the prompt was abandoned because an agent cannot answer it |
| Terraform | `terraform state mv`, then the `moved` block in the source from 1.1 | the source declaration |
| PlanetScale, sqldef, Skeema | no rename; expand, dual-write, backfill, contract | nothing to answer |

The ActiveRecord generator is the closest precedent to what we build: command arguments that produce explicit operations in a migration file, which is then the record. Nobody offers a rename argument on a plan command.

## The vocabulary

Four verbs and four nouns, all in the application domain.

| | namespace | model | field | value |
| --- | --- | --- | --- | --- |
| rename | `--rename billing:finance` | `--rename Profile:User`, `--rename auth.User:public.User` | `--rename User.name:User.fullName`, `--rename Address.street:Address.streetName` | `--rename Status.ARCHIVED:Status.RETIRED` |
| delete | `--delete billing` | `--delete Legacy` | `--delete User.name` | `--delete Status.ARCHIVED` |
| convert | | `--convert Bug` (discriminator value changed) | `--convert User.age` | |
| backfill | | | `--backfill User.phone` | |

Rename is an identity change, delete is a removal, convert is an in-place change to a definition that existing data must follow, backfill fills existing rows for a field that has become required. A model rename whose namespace part changes is a move; there is no separate move verb because the coordinate already says it. `--delete` is consent, not a hint: the contract already lacks the thing, the planner already plans the drop, and the statement allows it.

Coordinates are the names the user wrote in the contract source. The namespace is omitted when the contract has one. Model and value object names share one namespace for resolution, and an ambiguous reading is an error that says which readings were tried. The separator is a colon because `->` redirects in a shell and names cannot contain a colon.

### What each statement replaces

| Statement | Diff shows | Postgres and SQLite | Mongo |
| --- | --- | --- | --- |
| rename namespace | every model removed under one, added under the other | alter schema rename | not applicable, one namespace |
| rename model | model removed and added | rename table, retarget foreign keys, rename constraints and indexes to destination names | rename collection |
| rename model across namespaces | removed in one, added in another | alter table set schema | not applicable |
| rename variant, single-table | model removed and added, storage unchanged | nothing unless the discriminator value changed | nothing |
| rename variant, multi-table | same | rename the variant's table | not applicable |
| rename value object | removed and added under value objects | nothing, reported as applied | nothing |
| rename field | field removed and added | rename column, rename constraints and indexes on it | update every document |
| rename value object field | removed and added under the value object | rewrite the JSON in every column of that type, arrays included | rewrite subdocuments |
| rename relation field | relation removed and added | nothing, reported as applied | nothing |
| rename enum value | value removed and added | update rows holding the old value; native Postgres enums rename the value | update documents |
| delete model | model removed | drop table | drop collection |
| delete variant, single-table | model removed | delete rows with that discriminator value, drop its columns; the refusal says it deletes rows | delete documents |
| delete field | field removed | drop column | unset in every document |
| delete value object field | removed | nothing or a cleanup rewrite; consent still required, the application loses the data | same |
| delete enum value | value removed | set the field to null where nullable, otherwise refuse and point at rename or convert; never deletes rows | same |
| convert field | type changed | `alterColumnType` with `using: placeholder(...)`; a data transform scaffold only where a separate pass is needed, such as nulls before not null | data transform scaffold, then the validator change |
| convert variant | discriminator value changed | update rows holding the old value, no placeholder, both values are known | update documents |
| backfill field | field added non-nullable, or nullable to required | the scaffolded backfill transform; without the statement the temporary-default recipe | data transform scaffold |

Not offered, deliberately: split or merge tables, move a field between models, change a primary key, move a variant between single-table and multi-table storage, make an existing model a variant. These are data migrations and belong in a hand-written file.

### Why no value or expression on the command line

Two proposals were rejected in turn. A conversion expression in the family's language with a token for the current value, `--convert User.age:"nullif(trim($value),'')::integer"`: users cannot be expected to type SQL on a command line. A fill value as a JSON literal, `--fill 0`: JSON has no types, which is the gap the data-type and cast design closes for `@default` and would reopen here. A fill value in the `@default` grammar was considered and dropped for the same reason the expression was: the command line carries intent only. The conversion and the value are written into the migration file where the placeholder is, which is the existing editing flow.

### Why no prompt and no detection

A prompt only helps in a terminal and only when a candidate pair exists; the operator distrusts automatic detection and called the prompt an ugly guardrail. Django, Drizzle and the old Atlas all carry open complaints about it. The refusal message does the prompt's job without guessing: it names the operation and prints the statements.

## Resolution and the origin contract

Both sides of a rename resolve against a contract, so the user writes model and field names and never storage names. Resolution happens in the framework, against the origin contract and the destination contract; the family receives resolved entities. The new side is always available, the destination is the emitted contract. The old side needs the origin contract. `migration plan` has it from its origin ref. `db update` today passes the planner `fromContract: null` and must instead resolve the marker's hash in the local snapshot store.

When the origin contract cannot be found, every rename and convert statement fails with one error. `--delete` still works because consent resolves against the diff's own operations. The user then consents and, in a migration project, edits the file. The marker's `contract_json` column is not used: the docs call it optional and diagnostic, and the planner is offline.

The contract-level comparison also covers changes the schema differ cannot see: value object fields, discriminator values, and on Mongo any field the validator does not carry. Those changes are visible in a diff of the two contracts and get the same refusal and statements as a dropped column. Without the origin contract they are invisible, which is one more reason the error is loud.

## Scenarios that stress the model

1. **Composition in order.** `--rename Profile:User --rename User.name:User.fullName`: the second uses the new name. Statements apply to the working copy in the order given.
2. **Swap.** `--rename A:B --rename B:A` needs a temporary name. Refused in this project with a clear message.
3. **Rename plus convert on one field.** `--rename User.age:User.years --convert User.years` works because convert resolves after the rename.
4. **Old name missing.** Error before planning, naming the contract searched.
5. **New name missing.** Error, naming the destination contract.
6. **Both names exist in the origin.** Error: cannot rename onto an existing entity.
7. **The rename changed nothing in storage.** The user renamed the model and kept `@@map("profiles")`. The statement resolves, no operation is emitted, and the plan reports it as applied with nothing to do.
8. **Repeated run.** `db update --rename Profile:User` twice. The second run fails because `Profile` is not in the origin. Chosen deliberately: a statement is intent for this run, and a script that always passes it is wrong.
9. **No origin contract.** Renames and converts fail, deletes work. Baselines and `--from @empty` have no origin models and nothing to rename.
10. **Rollback.** `migration plan --to <dir>^` reverses the diff; statements are written in the direction of this plan.
11. **Re-running the migration file** reproduces the operations from the file. Mongo and value object rewrites are data transform operations the facade offers.
12. **Control policy forbids altering the model.** The statement is an error, not ignored. Statements express intent; intent that makes no sense is rejected.
13. **Extension contract spaces.** A name that resolves only in an extension's space is an error.
14. **Ambiguous coordinates.** `A.B.C` could be namespace, model, field or model, field, value. Resolution usually settles it; when two readings resolve, error. The first slice's spec fixes the grammar.
15. **Renaming the default namespace.** `public` on Postgres is target-owned. Needs a check in the slice that adds namespace renames.
16. **Interactive consent.** In a terminal the refusal becomes the per-operation consent question, and an answer equals the statement. No prompt for renames.

## The type-change walkthrough and its evaluation

Postgres, a migration project, `age String` to `age Int`.

1. Edit the contract source, `contract emit`.
2. `migration plan --name age-to-int` refuses; nothing is written; the message prints `--convert User.age` and `--delete User.age`.
3. `migration plan --name age-to-int --convert User.age` writes the migration with `alterColumnType({ ..., using: placeholder('typechange-users-age:using') })`, `ops.json` as `[]`, and the existing pending-placeholders warning.
4. The user replaces the placeholder with the expression their data needs.
5. `node migrations/<dir>/migration.ts` re-emits.
6. `db migrate`.

The round trip in step 2 is the expected outcome: the user says which of the two they meant, and `db update` behaves the same way. The cost is paid by making the refusal copy-and-paste. Two substrate defects found on the way: the existing scaffold puts placeholders in a separate data transform and leaves the alter bare, so a user who fills the two slots gets a migration that fails at apply, because Postgres will not cast text to integer without `using`; and the alter's rendered options expose internal field names. Both are fixed in the convert slice. `placeholder()` is typed `never` and the CLI catches its error by code, so it can sit in any slot of any operation; ADR 200's statement that only data transforms have holes described the scaffolder at the time, not a constraint.

`--convert` promises more than it delivers today, since it scaffolds a slot rather than converting. It keeps the name because it names the intent, and the planner can do more of the work later without the statement changing. `--placeholder` was considered and rejected: it names the mechanism and merges two intents.

## What changed from the shelved design

| Shelved | Now |
| --- | --- |
| `@@hint(was:)` in the contract source, lowered to an unhashed contract section stripped from snapshots | statements on the command line; no contract change |
| a spent hint is silently ignored; a non-applicable hint is ignored | an unusable statement is an error |
| the old side is a storage name resolved against the origin schema | both sides are contract names resolved against the two contracts |
| `deleted: true` tombstone blocks and a reserved `deprecated` | `--delete` per operation; no lifecycle vocabulary |
| blanket `--confirm` kept as the fallback | `--confirm` replaced by `--delete` |
| field hints, refusal, tombstones as later slices | rename, delete, convert, backfill as verbs over four nouns |

Kept unchanged: destructive means data loss; the working schema shared by the planner and the facade; companion constraint names from the destination contract; foreign-key pairing by own and referenced columns; operations should carry dependency information and `migration.ts` should become an ordered graph walk, with no composite operations.

## Open questions

- Grammar details for coordinates and the separator, settled in the first slice's spec.
- Whether `--delete` on a type-changed field keeps the word or gets its own.
- Whether the Mongo slice needs a collection rename operation added to the Mongo migration facade first, or ships it inside the slice.

## References

- [`spec.md`](./spec.md)
- [Atlas declarative renames](https://atlasgo.io/changelog/declarative-schema-renames), [Atlas v0.22 rename detector](https://atlasgo.io/blog/2024/05/01/atlas-v-0-22)
- [Django ticket 24735](https://code.djangoproject.com/ticket/24735), [Drizzle issue 5307](https://github.com/drizzle-team/drizzle-orm/issues/5307), [Drizzle issue 6053](https://github.com/drizzle-team/drizzle-orm/issues/6053)
- [Prisma customizing migrations](https://prisma.io/docs/orm/prisma-migrate/workflows/customizing-migrations), [PlanetScale renames](https://planetscale.com/docs/learn/handling-table-and-column-renames)
- prisma/orm#30557 and prisma/orm#30570, the shelved attempt
