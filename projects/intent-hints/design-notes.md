# Design notes — Destructive changes need stated intent

Record of the design discussion on 2026-10-01 between the operator and the orchestrator. Each decision carries its reasoning, the assumptions it rests on, and the alternatives rejected.

## Principles

- The planner never guesses. It acts on a destructive-looking change only when the user has stated the intent, and refuses when the statement is ambiguous against the database it sees.
- The contract is self-contained. Interpreting it needs no other contract, no migration directory and no source file.
- A hint is sugar over the hand-written route. Whatever a hint produces, a user could have written by hand, and the hand-written route stays available.
- The ideal is the recovered design: destructive operations refused by default, hints as the way to make a change non-destructive, and a lifecycle for removals. The project delivers the practical subset first and designs for the rest.

## The recovered design and what changed since

`docs/architecture docs/Contract-Driven DB Update.md` was deleted on 2026-02-25 (commit `39cecd86ce`, "refresh docs index and remove deprecated docs"). It describes `db update` as a production-grade alternative to migrations on disk. Verified against the code on 2026-10-01:

| Claim | Today |
| --- | --- |
| The hashed contract carries only what the app requires; no hints or lifecycle flags | Still true. Hashing covers target, family and storage. |
| `db update` reads the environment's current contract from the marker's `contract_json` | Changed. `db update` introspects the live schema and diffs it against the contract (ADR 235). Marker contract storage exists but is off by default. |
| Extra objects in the database do not violate the contract | Changed. Under the default `managed` policy an undeclared object fails `db verify` and plans as a drop (ADR 224). |
| `db update` default mode is safe and aborts on anything destructive | Partly built. Destructive operations are planned, and apply stops for consent: the database name typed, or `--confirm`. |
| `migration plan` has the same safety | Only for auto-baselines. An ordinary plan writes the drop into the migration file. |
| Deterministic planner, one operation IR, pre and post checks per operation | True. One planner serves `migration plan`, `db update` and `db init`; operation classes are additive, widening, destructive, data. |
| Every `db update` lands in the same ledger as a migration | True by the runner's options: one collapsed ledger row per apply when no graph edges are passed. Read from the runner's option docs, not an executed test. |
| `@deprecated` and `@deleted` authoring states | Never built. |
| CI classifies contract changes and checks promotion against each environment's marker contract | Never built. No `contract diff` command exists. |
| `db update` is a production path | Reversed in the docs: the migration domain doc and the user journeys call it dev-only. New since then: it advances the `db` ref (ADR 218). |
| Extension packs contribute operations | True, through contract spaces (ADR 212). |

What the project takes from it: the lifecycle vocabulary (`deprecated`, `deleted`), the refusal default, hints in the authoring layer, and hints resolved per environment. What it replaces: the marker-based environment history check, which tombstones make unnecessary. What it leaves alone: the dev-only stance on `db update`. The operator chose to focus on the mechanism.

## Scenarios considered

| Scenario | What the diff shows | Group |
| --- | --- | --- |
| Model renamed | drop table, create table | identity |
| Field renamed | drop column, add column | identity |
| Model or field removed on purpose | drop | removal |
| Model or field the app no longer needs, database may keep it | drop | removal, two-phase |
| Model moved to another namespace | drop in one, create in another | identity |
| Enum value renamed | value removed, value added | identity |
| Explicitly named (`map:`) index or constraint renamed | drop, create | identity |
| Field type changed | type mismatch, no conversion | value |
| Required field added to a table with rows | add column, nothing for existing rows | value |
| Field moved to another model; model split or merged | several drops and creates | data migration |

**In this project:** model and field renames, confirmed removals. **Designed, built later:** two-phase removal. **Declared future extensions of the same attribute:** value hints. **Out:** data moves.

## Decisions

### 1. Refuse destructive operations by default, in `migration plan` too

**Why:** `db update` already refuses and asks for consent. `migration plan` writes the drop into a file, and a reviewer may miss it. With both refusing, the only way a drop reaches a database is a stated intent: a hint, or the command-level consent for a change no hint can express. **Assumes** the consent prompt stays as the fallback. **Rejected:** moving all consent into the schema. A change such as a column type that cannot be converted has no non-destructive form and nothing to attach a hint to.

### 2. `was` holds the old storage name

`@@hint(was: "Profile")` means the table used to be called `Profile`, exactly what `@@map("Profile")` would have said.

**Why:** `db update` and `db init` have no origin contract, only an introspected database. A domain-level `was` could only be resolved by opening the previous contract, which `db update` does not have and which breaks the self-contained contract. With verbatim table names the two coincide unless `@@map` was in play. **Rejected:** the domain reading, by the operator, because the contract must be self-contained.

### 3. A spent hint is silently ignored

**Why:** with migration history, a hint is consumed once, at plan time, and the migration file carries the result. Without history, each environment plans live, so the hint must stay until the last environment is updated, and nobody can tell the user when that is. Deleting it early silently turns the next environment's update into the destructive plan the mechanism exists to prevent. Leaving a hint in place forever must therefore cost nothing. **Rejected:** warning on a hint that matches nothing, because `db update` users would see it forever and learn to delete hints early.

### 4. An origin with both names of a `was` hint refuses

**Why:** acting on it would either drop a table the contract no longer declares while claiming a rename, or rename over an existing table.

### 5. `deleted` is a tombstone, `deprecated` is reserved

`model Legacy { @@hint(deleted: true) }` keeps the block in the schema so there is something to hang the intent on. The block contributes nothing to the contract except a hints entry.

**Why the block stays:** a drop is absence, and absence cannot carry an attribute. Keeping the block gives the intent a home, keeps git history showing what was removed, and survives until every environment has run the drop, like `was`. **Why `deleted`, not `drop`:** the recovered design's lifecycle is `deprecated` then `deleted`; the vocabulary is adopted whole so nothing is renamed later. **Why `deprecated` waits:** a deprecated object leaves the contract and the types but may stay in the database, which needs `db verify` to tolerate a declared absence under the `managed` policy (ADR 224). That is a verify change on top of the hint mechanism. **Rejected:** one-phase `drop` as the whole story. A rolling deploy may still have the old app version reading a column when the new contract drops it; the two-phase lifecycle exists for that.

### 6. Hints travel in `contract.json`, outside the hashed sections

**Why:** `migration plan` is offline and reads `contract.json` (ADR 097). TypeScript authoring builds the contract in process with no PSL file to re-read. An unhashed section keeps one artifact and leaves every hash unchanged. The subsystem docs' "not part of the canonical contract" is honoured as "does not participate in hashing". **Rejected:** a sibling file; re-reading the source at plan time; recording hints in the migration manifest (ADR 199 removed the field, and `ops.json` records what the hint produced).

### 7. Tombstones replace the environment history check

**Why:** the recovered design dropped an object only if the environment's marker contract already did not require it. That needs marker contract storage, which is off by default, and it is exactly the "open an older contract" the operator ruled out. A tombstone says what to drop; the environment's own schema says whether it is still there.

### 8. One attribute with named arguments

**Why:** the user learns one word, and the attribute spec grows by one named argument per kind. `was` must be a string, not an identifier: the old name is no longer a symbol. **Rejected:** one attribute per hint kind.

### 9. Surfaces and targets

PSL and TypeScript authoring. Postgres and SQLite. Mongo later. Prisma 6 and 7 sources excluded. **Why:** Mongo doubles the operation work and a Mongo field rename is a rewrite of every document. The Prisma 6 and 7 sources read older schemas unmodified; a user who is renaming is already editing the schema.

### 10. `db verify` ignores hints in this project

**Why:** until an environment is updated, the drift it reports is real. The `deprecated` follow-on is where verify learns a tolerated absence.

### 11. Builds on the rename-table PR

The model rename reuses `applyTableRename` and the companion-rename rules from prisma/orm#30331. The planner with a hint produces the same `migration.ts` a user would hand-write.

## Routine calls made by the orchestrator

- Hints compose: model rename first, then field renames under the new table name.
- The verbatim guard's remedy list names the hint first; the hand-written migration and the by-hand statements stay as fallbacks.
- The column rename operation is exported through each target's migration facade, so it serves hand-written migrations too.
- `deprecated` is rejected by the attribute spec with a "not yet supported" message, so the reserved word cannot be silently ignored.
- Facade calls in a migration file are order-dependent: each call advances a working schema that starts as the start contract's schema, so `renameColumn` after `renameTable` sees the renamed table. (Settled in discussion, 2026-10-01: this is the direction the migration system must take in general, towards operations carrying dependency information and `migration.ts` being an ordered walk of that graph; do not pull dependent operations up into composite operations, as a first draft did with a `columns` map on `renameTable`.)
- Whether a constraint keeps or changes its name after a rename is decided from the destination contract, which says whether the name is explicit, and from the origin's actual name. A first draft guessed from whether the actual name looked default-generated, which was rejected in discussion as a hack. Hand-named constraints the contract declares unnamed are the user's responsibility; after a rename they take the derived name.
- Destructive means data is lost. Drops of indexes, unique constraints, foreign keys, checks and policies lose nothing the contract cannot recreate and are `widening`; only table drops, column drops and narrowing type changes are destructive. A policy drop widens access, which is a separate concern from data loss and may get its own flag later. (Settled in discussion, 2026-10-01.)
- A rename hint on a table whose control policy forbids altering it is ignored with a warning, not refused: a hint only ever informs the choice of an operation that is going to take place. The old table's drop then goes through the normal consent path. (Settled in discussion, 2026-10-01.)
- A hint the running command cannot act on is ignored, never refused. Under `db init`, which is additive only, a `was` hint does nothing; the new table is created and the old one is left alone, and a later `db update` reports the contradiction. (Settled in discussion, 2026-10-01: a hint that is not applicable is simply ignored; nothing is destroyed.)
- Slice order: `was` on models; `was` on fields; the `migration plan` refusal; `deleted`. Namespace moves, enum value renames, named-index renames, Mongo, `deprecated` and value hints are follow-ons.

## Open questions

None at shaping. Settled in slice specs: the exact contract key layout; the refusal's wording; how a tombstone block that still carries fields and relations is parsed; whether the language server needs anything beyond the registered spec.

## References

- [`spec.md`](./spec.md)
- `docs/architecture docs/Contract-Driven DB Update.md` at `39cecd86ce^`
- [prisma/orm#30331](https://github.com/prisma/orm/pull/30331)
- [ADR 224 — Control Policy](../../docs/architecture%20docs/adrs/ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md)
- [ADR 199 — Storage-only migration identity](../../docs/architecture%20docs/adrs/ADR%20199%20-%20Storage-only%20migration%20identity.md)
