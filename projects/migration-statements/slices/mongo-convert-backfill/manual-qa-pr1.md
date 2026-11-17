# Manual QA — slice 4b, PR 1: top-level fields on MongoDB

> **Be the user.** Run the built CLI against a real MongoDB in scratch projects, read every message as someone who has never seen this feature, and judge what the journeys cannot: whether each error tells you what to type next, whether the output explains itself, and whether anything loses data.
>
> **Out of scope.** Do not re-run `pnpm test`, the journeys or CI lints. Do not read the source to decide whether behaviour is right; decide from what the commands print and what the database holds.
>
> **Spec:** [`spec.md`](./spec.md), PR 1 · **Project spec:** [`../../spec.md`](../../spec.md)

## What this script is testing

**The problem.** A MongoDB validator change never failed. Documents that no longer fit stayed, and each failed its next update with "Document failed validation". Type changes, new required fields and fields made required were planned as a validator change and nothing else.

**What changed.** Every validator change the planner writes checks the documents first (`checkDocuments: true`) and stops with a count, one `_id` and a `mongosh` query. A type change the new validator rejects is a question: `--convert` writes a data transform to fill in (`migration plan` only), `--delete` casts with `$convert`. A cast that keeps every value (`Int` to `Int64`) is planned with nothing asked. A new required field gets a temporary value with `fillField`. `--backfill` writes a data transform to fill in. Changes that are not statements, such as a value object field changing type, give a warning.

**Audiences.** End users of the CLI (scenarios 1 to 8). Agents using the `prisma-8` skill and users following the upgrade fragment (scenario 9).

## Scenarios

| # | Scenario | What it proves | Isolation |
| - | -------- | -------------- | --------- |
| 1 | `User.age` `String` to `Int` through `migration plan`, with documents | Refused with both statements; `--convert` writes a slot; filled and applied, every value is an int; a further plan is empty; `db verify --schema-only` is clean | `wip/qa/` dir |
| 2 | The same change with `--delete` through `db update`, documents holding `"42"` and `"abc"` | Fails on `"abc"`, names the field and what to do, advice appears once; after fixing the document, a re-run finishes | `wip/qa/` dir |
| 3 | `Int` to `Int64` through `db update` | Nothing asked; values stored as `long` (check in `mongosh`) | `wip/qa/` dir |
| 4 | New required `String`, `Int64` and `Boolean` fields through `db update` | Filled with `''`, `0` (as `long`), `false`; the output lists the temporary values | `wip/qa/` dir |
| 5 | Optional field made required through `db update`, some documents lack it | The apply stops; the message gives the count, one `_id` and a query; the query run in `mongosh` finds the documents; after fixing them, a re-run finishes | `wip/qa/` dir |
| 6 | `--backfill` on scenario 5's change through `migration plan` | The slot is clear; filled and applied, every document has the field | `wip/qa/` dir |
| 7 | Adopting a database with extra fields and no validator (as a Prisma 6 app leaves it) | The first apply stops at the document check; following the advice (`checkDocuments: false`, or fixing the documents) works; nothing is lost | `wip/qa/` dir |
| 8 | A value object field changes type, through `db update` | A warning names the field and says what to do; the apply then stops at the document check | `wip/qa/` dir |
| 9 | Read the upgrade fragment, the skill reference and the error reference **(judgement)** | A user and an agent know what changed and what to do | read-only |
| 10 | Exploratory, 20 minutes | Lists of values, `null` and missing fields, variants in one collection, two root models in one collection, a field named with a dot, a re-run after a failure | `wip/qa/` dir |

## Pre-flight

1. In `wip/wt-4b`, `git branch --show-current` is `tml-3538-mongo-value-object-statements`; `git status --short` shows no source changes.
2. `mise exec -- pnpm install --frozen-lockfile` and `mise exec -- pnpm build`.
3. Scratch projects under `wip/qa/4b-pr1/`, one per scenario, copied from `test/integration/test/fixtures/cli/cli-e2e-test-app` or made with `prisma init` from the built CLI. MongoDB from `mongodb-memory-server` as the journeys start it, or a local `mongod` 8.x. Use `mongosh` (or the driver from a small script) to insert documents and read them back with their BSON types.
4. Never write to `/tmp` or any system temp directory.

## Report

Write `projects/migration-statements/manual-qa-reports/<date>-qa-4b-pr1.md`: per scenario, what you ran, what was printed (quote the messages), what the database held, and a verdict (pass, fail, or a problem with how it reads). Rank problems: data loss first, then wrong advice, then unclear text. Plain English, short sentences, no hard line wraps.
