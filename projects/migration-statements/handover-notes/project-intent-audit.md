# Audit: has "Destructive changes need stated intent" done what it was for?

Judged against `origin/main` at `f1712a228a` on 2026-11-21. The closed plan-stop output pull request (#31147) is not counted. `projects/migration-statements/deferred.md` was read from the working tree and each important entry was checked against the code on main.

## Verdict

Not yet. Every planned slice except MongoDB stored-name renames is merged, and the Definition of Done journeys mostly prove what they should, but on main there are still six ways a user's rows are moved, stranded or left unreadable without the user having said so, and nine cases where the user cannot act on what the planner asks or refuses. The close-out has not started: there is no project ADR, ADR 001 and ADR 028 are only amended with a banner, and there is no final retro.

## Real state of the plan

| Plan row | What it delivers | State on main |
| --- | --- | --- |
| 1 | `--rename` for models and fields, PostgreSQL and SQLite | Merged, #30638, 2026-10-08 |
| 2 | Refusal of data loss, `--delete`, `--allow`, the interactive prompt | Merged, #30648, 2026-10-08 (engine: prisma/prisma-cli#337) |
| 3a | `--convert` and `--backfill`, PostgreSQL and SQLite | Merged, #30695, 2026-10-14. Plan table still says "Spec" |
| 4a | Renames and deletes on MongoDB | Merged, #30691, 2026-10-13. Plan table still says "Spec" |
| 4p | TypeScript MongoDB contracts get the PSL validator | Merged, #30733 (2026-10-16) and #30773 (2026-10-20). Plan table says "Next after 4a" |
| 3b | Remaining SQL nouns: enum values, namespaces, moves, value object fields, variants | Merged in four pull requests: #30823 (10-22), #30849 (10-23), #30869 (10-28), #30929 (11-06). Plan table says "Not started" |
| 4b | `--convert`, `--backfill`, value object renames on MongoDB | Merged, #30970 (11-11) and #31061 (11-17). Plan table says "Not started" |
| Stored-name renames, PR 1 | Same name, changed stored name is a rename, PostgreSQL and SQLite; ADR 324 | Merged, #31088, 2026-11-20. Plan table says "in review" |
| Stored-name renames, PR 2 | The same on MongoDB | Not started. Linear: backlog (TML-3840) |
| Not in the plan | Refusal output that says what would be lost and what each flag does | #31147 closed without merging on 2026-11-20. Linear still shows it as started (TML-3900) |
| Close-out | ADR, doc amendments, retro, delete the project folder | Not started. The plan issue is marked Completed in Linear anyway (TML-3474) |

Project tickets still open in Linear: MongoDB stored-name renames (TML-3840), the stale snapshot after a change that keeps the storage hash (TML-3720), SQLite `BigInt` to `Int` without a question (TML-3564), generic `db migrate` advice for an unfilled placeholder (TML-3563), and `--rename A:B --delete A` wording (TML-3565). The variant rename defect (TML-3906) and the doubled `--allow` advice (TML-3845) exist but are not in the project.

## Project Definition of Done

| Item | Verdict | Evidence on main |
| --- | --- | --- |
| Journey renames a model and a field and deletes a model in one `migration plan`, migrates tables with rows, unique, foreign key, index, check; rows and objects under new names, further plan empty, `db verify --schema-only` clean | Met | `test/integration/test/cli-journeys/delete-statements-migration.e2e.test.ts` S1 (`expectRenamedWithoutLegacy` asserts rows, constraints, indexes, the foreign key, the dropped table, and runs `db verify --schema-only`; S1.09 asserts `noOp`). SQLite twin `delete-statements-migration.sqlite.e2e.test.ts` S1, without a check because SQLite contracts cannot declare one |
| Same change through `db update` gives the same state with no prompt; running it again fails on the first statement | Met | Same files, S2: the same helper asserts the state; S2.07 asserts `MIGRATION.STATEMENT_UNRESOLVED` |
| Without `--delete` both commands refuse, and the refusal contains the exact statement that then succeeds | Met | S1.05 (`migration plan`) and S2.04 (`db update`) assert the `nextActions` contain `--delete Legacy`; the same flag then succeeds. Asserted on the next actions, not on the human text |
| `--convert` writes a migration whose only placeholder is in the PostgreSQL `using` slot; filling and re-running converts the rows; without a statement both commands refuse; `--delete` plans the direct alter | Met | `convert-backfill.e2e.test.ts` "Postgres: a lossy type change" and "db update on a table with rows". "Only placeholder" is proven indirectly: the file is filled at the one named slot and then emits and applies |
| `--backfill` writes the backfill transform; without it both commands plan the temporary value | Met | `convert-backfill.e2e.test.ts` "new required fields" (plan) and "db update on a table with rows" (temporary value line); SQLite twin |
| MongoDB: the rename journey with a collection and a document field through both commands, and a value object field rename that rewrites subdocuments | Met | `rename-delete-statements.mongo.e2e.test.ts` R1 and R2; `value-object-statements.mongo.e2e.test.ts` O1 and O3 |
| `db update` whose marker hash has no local snapshot fails every rename and convert with one error naming the hash, and succeeds with `--delete` alone | Weakly evidenced | `rename-statements-migration.e2e.test.ts` S3.04 asserts the code and the snapshot directory, not the hash (the text does name it: `packages/1-framework/3-tooling/cli/src/utils/cli-errors.ts:906`). Only one `--rename` is given, so "one error for every statement" is not exercised. `--delete` alone: `delete-statements-migration.e2e.test.ts` S5, where the subject is the storage name `public.Legacy` |
| `--confirm` gone, README describes statements and consent, upgrade fragments validated by execution | Met; execution not visible | S2.04 asserts `--confirm` no longer consents. README sections for `db update` (line 1013) and `migration plan` (line 1100) describe the flags. Fragments: `upgrade-instructions/releases/8.0.0-rc.16-to-8.0.0-rc.17/sources/migration-statement-refusal/`. Validation by execution is recorded only in dispatch briefs |
| The project ADR and doc amendments are merged | Not met | No project ADR on main. See close-out readiness |

## A. The purpose is broken

### A1. A variant renamed to a model that is not a variant moves or strands rows

Scenario: `Task` (table `task`, discriminator `type`) has variants `Bug` and `Epic` sharing `task`. The contract removes all three and adds a plain model `Nope`. The user runs `prisma db update --rename Bug:Nope --delete Epic.scope --delete Task.type`. Table `task` is renamed to `nope`, and the `Epic` rows become `Nope` rows; nothing said they would move. In a second form, `Bug` has its own table `bug` and is renamed to a plain `Issue`: table `bug` becomes `issue`, and rows in `task` keep `type = 'bug'`, a value no variant claims.

Evidence: `packages/2-sql-family/9-family/src/core/migrations/storage-renames.ts:305-327` (`sharedTable` says "A model the destination removes, or a new model, blocks nothing"); `variant-planning.ts:199` (`rewriteOf` plans no rewrite when the new model exists and is not a variant). Reproduced by hand in the closed work's QA transcripts.

Affects: PostgreSQL and SQLite, `migration plan` and `db update`. Ticket: TML-3906, backlog, not in the project.

### A2. A new model or enum member takes the storage of one removed in the same change, with no question

Scenario: the contract removes `Account` (table `accounts`) and adds `Person` with `@@map("accounts")`. `migration plan` and `db update` plan nothing for the table, and the rows of `Account` are now read as `Person`. For enums: origin `A = "a"`, `X = "x"`, destination `A = "b"`, `N = "x"`: the rows of `X` become rows of `N`, and nothing is asked.

Evidence: `packages/2-sql-family/9-family/src/core/migrations/enum-value-planning.ts:442` (a removed member is not treated as removed when the destination still stores its value); `storage-renames.ts:94` (`modelRenamesOf` pairs only by statement or same name, so no question about `Account` arises while the storage diff keeps the table). On MongoDB the same result comes from an explicit pairing: `packages/3-targets/mongo/1-target/src/core/migrations/mongo-statement-planning.ts:598-626` (`destinationModelOf` pairs a removed model with "the only new model stored the same way"). ADR 324 records storage pairing for MongoDB variants only; the code applies it to root models too.

Affects: all three databases, both commands. Decided by Will on 2026-11-19: ask about the removed model or member. Not built, no ticket.

### A3. After a change that keeps the storage hash, later plans read an old contract and can move rows between members

Scenario (derived from two documented behaviours, not run): the user renames enum member `CANCELLED = "cancelled"` to `VOIDED = "cancelled"` and runs `db update`. The storage hash does not change, so the stored snapshot still names `CANCELLED`. Later the user adds a new member `CANCELLED = "c2"`. The planner compares the old snapshot with the new contract, sees `CANCELLED` change its stored value from `"cancelled"` to `"c2"` (a rename with no question since ADR 324), and rewrites every `"cancelled"` row. The rows the user knows as `VOIDED` become `CANCELLED`.

Evidence: the snapshot store keeps the first contract written under a hash (`packages/1-framework/3-tooling/migration/src/contract-snapshot-store.ts:193`); a new member taking a value that a kept member gives up is planned with no question (`deferred.md`, "A rename statement for an enum value is refused where the same change without a statement is planned"). The same reasoning applies to `migration plan` when the earlier change was planned with no statement, since it then writes nothing (`migration-plan.ts:770`).

Affects: PostgreSQL and SQLite, mainly `db update`. Ticket: TML-3720 covers the stale snapshot, but describes it as harmless ("No data is lost"); it does not cover this consequence.

### A4. Value object changes the planner does not compare

Scenario: a value object field changes type, `GeoPoint.lat String` to `Int`. On SQLite both commands plan nothing for the stored JSON and ask nothing; the rows keep strings the contract now reads as numbers. A value object renamed together with one of its fields (`Address.street` to `Location.line1`) is in the same position: no key is rewritten and nothing is asked.

Evidence: `packages/2-sql-family/9-family/src/core/migrations/value-object-field-planning.ts:222-262` (`fieldChanges` looks only for renamed or removed keys of a value object with the same name in both contracts; it skips a renamed value object and never compares types). The SQLite outcome is recorded in `deferred.md` ("A type change of a value object field is not a statement").

Affects: SQLite, both commands. On PostgreSQL the apply fails instead (B3). No ticket.

### A5. SQLite changes `BigInt` to `Int` with no question

Scenario: `id BigInt` becomes `id Int` on SQLite. Both commands rebuild the table with no question; values above 2^53 can no longer be read exactly. PostgreSQL asks about the same change.

Evidence: `packages/3-targets/sqlite/1-target/src/core/migrations/planner-strategies.ts:112-150` (both types are stored as `INTEGER`, so the change is classified `widening`).

Affects: SQLite, both commands; planned differently from PostgreSQL. Ticket: TML-3564, in the project, backlog.

### A6. An enum stored-value change rewrites a column that a field of another enum also uses

Scenario: variants `Bug` and `Feature` share column `status`, typed by `Status` and `LegacyStatus`, both storing `A = "a"`. The user changes `Status.A` to store `"b"`. Since ADR 324 this is planned with no question, and the `UPDATE` rewrites `"a"` in every row, including the rows of `Feature`, which then hold a value `LegacyStatus` does not list.

Evidence: `planEnumValueRewrites`, `packages/2-sql-family/9-family/src/core/migrations/enum-value-planning.ts:503`. Found by automated review, not proven by a test.

Affects: PostgreSQL and SQLite, both commands. No ticket.

### Decided, not counted as gaps

- A swap of two tables or columns of identical shape: `migration plan` reports no change and the rows are read as the other model's, while `db update` refuses. Will decided on 2026-11-19 to leave it until the contract language can express which reading the user means.
- Enum members that trade stored values while the list stays the same (`A = "a", B = "b"` to `B = "a", A = "b"`). `deferred.md` puts this in the same class as the swap, so the same decision covers it. One difference to note: for this case `db update` plans nothing as well, where for the table swap it refuses.

### Checked and found fixed on main

- A MongoDB validator that requires a new field no longer leaves documents unwritable without warning: the validator change checks documents first and stops (#30970; `mongo-runner.ts:1719`).

## B. The purpose is met, but the user cannot act on it

### B1. MongoDB has no way to keep data when only a stored name changes

Scenario: on MongoDB the user keeps `model User` and changes `@@map("users")` to `@@map("app_users")`, or changes a field's `@map` or an enum member's stored value. The command asks for `--delete User`; no statement keeps the documents, and the advice is to rename the collection by hand. PostgreSQL and SQLite rename it with no question (ADR 324).

Evidence: `packages/3-targets/mongo/1-target/src/core/migrations/mongo-statement-planning.ts:556-572` (`keepCollectionByHandAdvice`). Affects: MongoDB, both commands. Ticket: TML-3840, in the plan, backlog.

### B2. An enum change inside a union, dictionary or self-containing value object has no way through

Scenario: a column holds a union of value objects whose member is typed by `Status`. Removing, renaming or re-storing a `Status` value is refused with "This change cannot be planned yet. Until it can, keep the members and stored values of enum "Status" as the origin contract has them". No statement and no hand-written route is offered, so the user cannot make the change at all.

Evidence: `packages/2-sql-family/9-family/src/core/migrations/enum-value-planning.ts:193-210`. Affects: PostgreSQL and SQLite, both commands. No ticket.

### B3. A value object field type change has no statement on PostgreSQL

Scenario: `GeoPoint.lat String` becomes `Int`. Nothing asks and `--convert GeoPoint.lat` does not exist; the apply fails when the new shape check meets the old rows. The only way through is a hand-written migration.

Evidence: as A4. Affects: PostgreSQL, both commands. No ticket.

### B4. Deleting a SQLite variant fails when another table's foreign key cascades to its rows

Scenario: `--delete Bug` where `bug_attachment` references `bug` with a cascading foreign key. The SQLite runner turns foreign keys off, so the cascade does not run, and the apply fails at `PRAGMA foreign_key_check` with `MIGRATION.FOREIGN_KEY_VIOLATION`. The statement the refusal offered cannot be completed.

Evidence: `deferred.md`, "On SQLite, a foreign key that cascades to a deleted row…"; no change on main. Affects: SQLite, both commands. No ticket.

### B5. One model with two access changes: the printed `--allow` fails when pasted once

Scenario: `db update` drops two policies of `User`. The refusal prints `--allow User` twice; a user who passes it once is refused again.

Evidence: the fix was in the closed #31147. Affects: PostgreSQL, `db update`. Ticket: TML-3845, started, not in the project.

### B6. A refused rename is offered again by the next question

Scenario: a variant stored in its base's table gets a table of its own under a new name. `--rename Bug:Defect` is refused because it would move the whole table, and the advice is to leave it out. The plan without it asks about `Bug` and offers `--rename Bug:Defect` first again.

Evidence: question offers in `packages/1-framework/3-tooling/cli/src/control-api/statements/plan-questions.ts:506-527` (`renameForm`). Affects: PostgreSQL and SQLite, both commands. No ticket.

### B7. `db update --dry-run` suggests an apply command that is refused

Scenario: a dry run whose plan has unanswered questions ends with "Apply the planned operations: prisma db update". Run as printed, non-interactively, it fails with `CLI.CONSENT_REQUIRED`.

Evidence: `packages/1-framework/3-tooling/cli/src/orm/db/migration-blocks.ts:393-399`. Affects: all databases, `db update`. No ticket.

### B8. A rename statement for an enum value is refused where the same change without one is planned

Scenario: origin `A = "a"`; destination `V = "v"` and a new `N = "a"`. `--rename Role.A:Role.V` is refused because the destination still stores `"a"`, though the rows holding `"a"` belong to `A`. The user has no statement that says what they mean.

Evidence: `stillStoredRefusal`, `enum-value-planning.ts:278`. Affects: PostgreSQL and SQLite, both commands. No ticket.

### B9. MongoDB variant restructures have only by-hand routes

Scenario: an existing field `Task.type` becomes the discriminator and a new variant `Bug` has a required `severity`. The apply stops at the document check; `--backfill Bug.severity` is refused because a new model "has no existing rows". The same holds when a base loses its discriminator and all its variants (the removed variants' fields block the validator, and `--delete Bug` "answers no question"), and when a discriminator backfill set only the discriminator. The only routes are `mongosh` or `checkDocuments: false`.

Evidence: `resolve-statements.ts` ("A new model has no existing rows to backfill"), `mongo-variant-planning.ts`, `mongo-runner.ts`. Nothing is lost. Affects: MongoDB, both commands. No ticket.

### The refusal text and requirement 4

On main the refusal headline is the engine's `"Shop.legacy" needs a statement, and the session is not interactive.`, not the spec's "The plan would lose data". The rest meets requirement 4 in substance: the `why` lists every question with its operation labels and what would be lost, and the next actions give each flag that answers it (`Run the command again with --delete Legacy`, and `--rename Legacy:<new name>` where no single candidate exists, as the spec shows). The gaps are those in B5 to B8, plus wording: texts say "origin contract" and "destination contract", quote target labels with stored names (a policy's hashed name), and name the default namespace (`public.Cat`).

## C. Everything else

About 70 further entries in `deferred.md`, all polish, performance, wording or internal debt. Examples:

- Statement errors and advice say "rows" on MongoDB.
- `migration plan` writes extension-space files before it stops to ask, while the docs say nothing is written.
- A repeated run reports outdated statements one at a time.
- Row rewrites and derived checks hold locks for a whole table scan.

Two items not in `deferred.md`: main has two ADRs numbered 324 and two numbered 325, and one of the 324s is this project's ADR.

## Close-out readiness

- Project ADR ("destructive changes need stated intent"): does not exist on main. ADR 324 covers only the stored-name amendment.
- ADR 001 and ADR 028: each has an "Update — 2026-10" banner pointing at statements, but their bodies still describe planner hints (ADR 001 lines 34, 56, 89, 145, 157; ADR 028's `hints` JSON example at line 132). Partly amended.
- Data Contract subsystem doc: describes statements (`1. Data Contract.md:81`). Done.
- Migration System subsystem doc: describes statements and has no `@hint(was:)`. Done, but `deferred.md` lists nine statements in it that contradict each other; they are on main.
- Final retro: missing. `retros.md` has only the slice 2 retro.

## What to add to the plan

1. Refuse or ask when a variant is renamed to a model that is not a variant, and count a removed model's rows when a table is renamed (TML-3906, moved into the project). Without it, rows move or are stranded with no statement.
2. Ask about a removed model or member whose storage a new one takes, on all three databases, and stop MongoDB pairing root models by collection; with an upgrade note (Will's 2026-11-19 decision; needs a ticket). Without it, a new model silently inherits another model's rows.
3. Make the origin contract follow changes that keep the storage hash, and test the enum scenario in A3 (TML-3720, with its "nothing is lost" premise corrected). Same-name pairing is only safe if the origin names are current.
4. Ask before SQLite `BigInt` to `Int` (TML-3564). Values become unreadable with no question, and the two SQL targets disagree.
5. Compare value object field types and value object renames on both SQL targets: plan, ask with a `--convert` route, or refuse with a route. This fixes the silent SQLite case and the stuck PostgreSQL case.
6. Refuse, when the contract is written, a column shared by fields of different enums, or limit the rewrite to the variant's rows. Without it, a no-question rename rewrites another enum's data.
7. MongoDB stored-name renames (already in the plan, TML-3840). MongoDB users have no way to keep data when only a stored name changes.
8. Give a working route for each refusal that leaves the user stuck: enums inside unions, dictionaries and recursive value objects; SQLite variant deletes with cascading foreign keys; MongoDB discriminator restructures; the enum rename statement in B8. The project promises a statement for each such change.
9. Land the refusal output again in place of the closed #31147, including the doubled `--allow` (TML-3845), the re-offered refused rename, the dry run's apply command, and the engine's headline. Requirement 4 needs every printed flag to work when pasted.
10. Close-out: write the project ADR, rewrite the bodies of ADR 001 and ADR 028, correct the nine contradictions in the Migration System doc, renumber the duplicate ADRs, strengthen the no-snapshot journey to assert the hash and several statements, and write the final retro.
