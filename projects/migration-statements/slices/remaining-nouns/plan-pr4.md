# Slice plan — 3b, PR 4: value object field and variant statements

**Spec:** [`spec.md`](./spec.md), PR 4 row · **ADR:** ADR 309 · **Linear:** [TML-3537](https://linear.app/prisma-company/issue/TML-3537) · **Branch:** `tml-3537-value-object-variant-statements`, from `origin/main` · **Grounding:** `wip/pr4-grounding.md` (gitignored)

PR 4 adds value object field renames, removals and backfills, enum values inside value objects, and variant converts and deletes, on Postgres and SQLite. MongoDB refuses the new statements until slice 4b.

## Decisions (Will, 2026-10-29 and 2026-10-30)

- **Four new operations on Postgres and SQLite:** `renameStoredKey`, `removeStoredKey`, `fillStoredKey` and `deleteRows`. The key operations rewrite JSON in a column; `deleteRows` deletes the rows whose column holds a stored value. Renames and the fill are `widening`, so `db update` can run a fill with a temporary value; removals and deletions are `destructive`. An enum value inside JSON reuses `replaceStoredValue` and `removeStoredValue` with a `path` option.
- **No `invariantId`.** Every path to a contract that changes a value object or variant contains the rewrite, and the Postgres check at that contract refuses rows that were not rewritten. Refs are not touched.
- **A path is an RFC 9535 JSONPath string, limited to member name selectors (`.lat`) and the wildcard selector (`[*]`, `.*`).** We follow the standard and invent nothing. `$` is the column's value, and the path ends at the key: `renameStoredKey({ table: 'place', column: 'history', path: '$[*].lat', to: 'latitude' })`. The operation refuses any other JSONPath feature (filters, indexes, `..`) when it is built. Each target turns the parsed path into its own form. PR 4 has no dictionaries, so the planner writes the wildcard only for list elements.
- **`--backfill GeoPoint.country`** writes `fillStoredKey` with `value: placeholder('GeoPoint.country:value')`, one call per column and path. Without it, `migration plan` refuses and names `--backfill`; `db update` fills a temporary value for a scalar member whose codec has one, and refuses a value object or enum member.
- **A variant whose discriminator value changes** is asked about as the model. `--convert Bug` rewrites the value with `replaceStoredValue`; `--delete Bug` deletes its rows with `deleteRows`, which is the default plan. The question offers `--convert` first. `db update` runs `--convert Bug`.
- **`--rename Bug:Defect` rewrites the stored value too** when the value changes, as an enum value rename does. No `--convert` is needed.
- **A removed variant** is one model question. `--delete Bug` deletes its rows, then its columns or table are dropped.

## Framework changes (to show Will before building)

All are vocabulary for concepts the framework already defines. No helper moves into the framework; the SQL family reads the domain types itself.

- `packages/1-framework/1-core/framework-components/src/control/migration-statements.ts`:
  - `ValueObjectFieldCoordinate` `{ namespaceId, valueObject, field }`, naming a `ContractValueObjectField`.
  - `MigrationSubject` gains `valueObjectField` (approved 2026-10-28).
  - `ResolvedMigrationStatement` gains a value object field rename, a value object member backfill, and a convert whose entity is `'model'` (a variant is a model).
  - The JSON forms, `migrationSubjectKey`, `migrationStatementJson` and `describeMigrationStatement` follow.
- `packages/1-framework/3-tooling/cli` (CLI code, not domain types): the resolver readings, the one-name `--convert` parse, `db update` letting a variant convert through, every subject switch in the questions.

## Engineering decisions

- JSON rewrites are planned beside the diff, as PR 2's `storedValueCallsStrategy` is, classified `alter`, so on Postgres they run after the old check is dropped and before the new one is added. SQLite appends them after the diff.
- The family planner result gains an outcome "planned with the diff", so enum values, value object fields and variant converts share one path. Family code only.
- Paths come from the destination contract and the working schema. Outer renames run before inner ones.
- A path through a value object that can reach itself is refused, as a `SqlPlannerConflict`. Unions and dictionaries are refused, naming the column.
- The CLI decides a variant can be converted from the two contracts' domain types: the model is in both, is a variant, and its value changed.
- An enum value removed from an optional member becomes JSON `null`; from a list, the element is removed; from a required member, the apply fails with `MIGRATION.PRECHECK_FAILED` and a count, as for a required column. Share the stored value helpers between the targets first (`deferred.md`).
- Deleting variant rows follows each referencing foreign key on Postgres. On SQLite the apply fails at `PRAGMA foreign_key_check`; the message says so. No cascade emulation.
- Out, recorded in `deferred.md`: a value object rename, a member type change.

## Checks for every dispatch

Typecheck; lint and `test --coverage` in every touched package; `lint:deps`; `lint:ratchets`; `fixtures:check` when contracts or rendering change; `check:error-reference`; `check:upgrade-coverage` when a fragment is added. Integration tests and journeys by named file only. The reviewer runs the SQL on PGlite and SQLite.

## Dispatches

| # | Outcome | Builds on |
| --- | --- | --- |
| 21 | Framework and CLI vocabulary: the coordinate, subject and statements, JSON forms, subject switches; resolver readings for `ValueObject.field`, one-name variant convert, member backfill; `db update` lets a variant convert through; MongoDB refuses the new statements | — |
| 22 | Family groundwork: the "planned with the diff" outcome; shared stored value helpers and the rows-holding-value failure | 21 |
| 23 | The four operations on both targets: call class, prechecks and postchecks, `renderTypeScript`, facade method, subjects, bucket; tests on PGlite and SQLite with nested objects, lists, JSON `null` and SQL `NULL` | 22 |
| 24 | Value object field renames and removals: path enumeration, member comparison, recursion refusal, questions offering the new member as the rename | 23 |
| 25 | Variants: convert, rename with a new value, changed and removed variants deleted, removed variant columns as one model question | 23 |
| 26 | Enum values inside value objects | 24 |
| 27 | Member backfill and the no-backfill behaviour | 24 |
| 28 | Journeys on both targets through `migration plan` and `db update`; Migration System doc, error reference, CLI README, skill reference; spec rows; PR text | all |

**Order:** 21, 22, 23; then 24 and 25; then 26 and 27; then 28. Then `/drive-code-review`, fixes, manual QA, the PR.
