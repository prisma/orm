# Manual QA — slice 4a, renames and deletes on MongoDB (TML-3478)

> **Be the user.** Run the built CLI against a real MongoDB (mongodb-memory-server replica set) in scratch projects. Read every message as someone who has never seen this feature. Judge what the journeys cannot: whether a refusal tells you what to type next, whether the questions make sense, and whether anything loses or breaks documents without you saying so.
>
> **Out of scope.** Do not re-run `pnpm test`, the journeys or CI lints. Decide from what the commands print and what the database holds, not from the source.
>
> **Spec:** `projects/migration-statements/slices/mongo-renames/spec.md`

## What this script is testing

**The problem.** MongoDB refused every `--rename` and printed steps to run by hand in `mongosh`. Removing a field asked nothing, and every document that still held the field then failed each update against Prisma's closed validator.

**What changed.**
- `--rename Profile:User` renames the collection; `--rename User.name:User.fullName` renames the field in every document (only the variant's documents for a variant's field).
- Removing a field is data loss: it is asked about, and `--delete User.nickname` removes it from every document.
- Both `migration plan` and `db update` do this.
- Some renames are refused with a reason and steps: `_id`, dotted names, time-series collections, a discriminator value change, a collection name MongoDB rejects.

**Audiences.** End users in a terminal and in scripts; agents using the `prisma-8` skill; extension authors reading the upgrade fragment.

## Scenarios

| # | Scenario | What it proves |
| - | -------- | -------------- |
| 1 | PSL project with documents. Rename model `Profile` to `User` (collection `profiles` to `users`), rename `name` to `fullName` (unique index), remove `nickname`. `migration plan` with no flags, non-interactive | The refusal names `nickname` and the flags; nothing is written |
| 2 | Same, in a real terminal, answering by typing `rename …` and `delete` | The questions read clearly; a wrong answer is explained and re-asked; the written `migration.ts` reads like hand-written code (`renameCollection`, `renameField`, `unsetField`) |
| 3 | Apply scenario 2's plan with `db migrate`; then update a document through the ORM | Documents under the new names, `nickname` gone, unique index on `fullName`, updates succeed, `db verify --schema-only` clean, a further plan empty |
| 4 | The same change through `db update`, then run it again | No prompt with the flags; the second run fails and says why |
| 5 | Polymorphic collection: base `Task`, variants `Bug` and `Feature` both store `score`. Rename `Bug.score` to `Bug.severity` | `Feature` documents keep `score`; every document accepts an update |
| 6 | Move a base field `Task.note` to `Bug`. Answer `delete`; in a second project answer `rename Task.note:Task.remark` | `Feature` documents lose `note` (or get `remark`); `Bug` documents keep `note` |
| 7 | `db update --db <url>` with no snapshot, removing a field | The question names `profiles.nickname` and says why; the printed `--delete` works |
| 8 | Each refusal: rename `_id`; a field mapped to `a.b`; a time-series collection; `Bug` renamed with its discriminator value changed; a collection mapped to `system.x` | Each names the reason; each piece of advice, followed as printed, ends in a correct state with no lost documents |
| 9 | A field removed from an `external` collection (TypeScript contract with `defaultControlPolicy: 'external'`) | Nothing asked, nothing removed |
| 10 | Interrupt a field rename half way (kill the process after some documents moved, or move one by hand), then run `db migrate` again | It finishes; no document holds both names |
| 11 | Read the app and extension upgrade fragments as their audiences **(judgement)** | A user knows what changed; an extension author knows every rename and removal |
| 12 | Ask the skill how to rename a MongoDB field **(judgement)** | `skills/prisma-8/references/migrations.md` leads to `--rename` in the right form |
| 13 | Exploratory: 20 minutes | Anything the scenarios missed |

## Pre-flight

1. In the worktree, `git status --short` shows no source changes.
2. `mise exec -- pnpm build`.
3. Scratch projects under `wip/qa-4a/`, one per scenario, with a mongodb-memory-server replica set (`examples/mongo-demo` shows the config). Stop every server by PID at the end.

## Report

Write `projects/migration-statements/manual-qa-reports/<YYYY-MM-DD>-qa-slice-4a.md`: a summary table with a verdict per scenario (✅ / ⚠️ / 🛑 Blocker), then each finding numbered `F<N>` with the exact command and output. A blocker is anything that loses or breaks documents without the user saying so, or advice that does so when followed.
