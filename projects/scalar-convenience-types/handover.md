# Handover: scalar convenience types project

Written 2026-11-11 by dostoevsky-67, before a rate limit. Read this file, then `decision-json.md` beside it, then `spec.md` and `plan.md`.

## Transcript

The full session transcript is at `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-tml-3715-scalar-convenience-types-95950d/a57c3a94-0533-4f3a-a580-9da7621ab65c.jsonl`. It is large; search it rather than reading it whole. Useful searches: `PlainJson`, `Serhii`, `ADR 318`, `deferred`.

## What the project is

Repository: prisma/orm (Prisma 8). Linear: TML-3715 (done) and TML-3789 (to be cancelled).

Will's principle: a convenience type names an application concept (`Int` means "an integer"). Its optional `storage` and `as` arguments choose one explicit type. An explicit type names one codec and is named after the database type, plus a suffix for the JavaScript value when one database type has several codecs (ADR 257, amended by ADR 316). The contract stores only the explicit type. The mechanism is the type choice from ADR 279, which lives in the framework domain and must not change.

## State

| Part | State |
| --- | --- |
| Slice 1: PostgreSQL `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` become convenience types; explicit types renamed (`Int2`, `Int4`, `Int8BigInt`, `Int8Number`, `NumericString`, `NumericBigInt`, `Float4`, `Float8`, `Text`, `Varchar`, `Char`, `Bool`, `Bytea`, `Varbit`) with deprecated aliases warning `PSL_DEPRECATED_SCALAR_NAME`; ADR 316 | Merged: prisma/orm#30942, 2026-11-06 |
| Old rename project `target-named-scalars-sql` deleted | Merged: prisma/orm#30916 |
| Slice 2: `Json` as a convenience type defaulting to `jsonb` | **Rejected 2026-11-11.** See `decision-json.md`. PR prisma/orm#30966 (branch `tml-3789-json-convenience-type`, fully pushed to the `bot` remote) is to be closed unmerged. |
| This handover and the decision | Branch `tml-3789-json-stays-explicit`, cut from main, pushed to the `bot` remote. No PR. |

## Work left, in order

1. **Close prisma/orm#30966** with a comment linking `decision-json.md`. Cancel TML-3789 in Linear with the reason.
2. **One small PR from this branch** (`tml-3789-json-stays-explicit`), closing the project:
   - ADR 316 and `spec.md` record that `Json` stays an explicit type, and why (`decision-json.md` steps 2 and 4).
   - `docs/reference/scalar-types.md` and the `prisma-8` skill reference (`skills/prisma-8/references/contract.md`) recommend `Jsonb` unless the input must be kept exactly.
   - **ADR number clash.** Main has two ADRs numbered 316: ours (PostgreSQL scalars, merged 16:07 on 2026-11-06) and `ADR 316 - An extension pack's extension is found through the connection's search_path.md` (from #30956, merged 16:10). Ours merged first, so the `search_path` one moves. 318 is now taken on main (MongoDB prepared statements) and 319 is used by open PR #30926, so use the next free number; check main and open PRs first. Update its heading, ADR 312's "Amended by" link, the two rows in `docs/architecture docs/ADR-INDEX.md`, and the comments in `packages/3-targets/postgres/1-target/src/core/migrations/postgres-migration.ts` and `resolve-ddl-schema.ts`. Commit `e258802bff` and `fabf6ba7ad` on the #30966 branch show the edits for 318; redo them, do not cherry-pick (they also change the index row to list `Json`).
   - The project close-out, per Will's close-project process (final retro, definition-of-done evidence, deferred items).
3. **Clearer errors for `json` limits** (Serhii's suggestion, `decision-json.md` step 3). Search Linear, then file a ticket. Build only when Will says so.
4. **Keep `Json` explicit on other targets.** TML-3790 and the other-targets work (memory: project TML-3714, iris-50) must not turn `Json` into a convenience type. Check their state and add a comment to TML-3790.

## Deferred items found during this project

- The Supabase pack's contract generator does not reproduce the committed `contract.prisma` on main. Ticket TML-3598 already covers it.
- Slice 1's released extension upgrade instruction did not detect imports from `@prisma/orm-target-postgres/adapter/column-types`. Already released; no action unless Will asks.

## How to work here (Will's rules that tripped me)

- Run node, pnpm and git commits through `mise exec --`. Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. Push to the `bot` remote. No AI attribution lines in commits or PRs; put `Agent: <your name>` in PR descriptions.
- Never change `packages/1-framework`.
- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all` in full; run touched files only. Run `pnpm test --coverage` in touched packages, plus `pnpm lint:ratchets`, `pnpm fixtures:check` and `pnpm check:upgrade-coverage --mode pr` before pushing.
- Check main and open PRs before choosing an ADR number.
- `git mv` stages the rename before you edit the file; stage the edit too.
- Design with Will, then build without asking about small things. Run `/drive-code-review` (no walkthrough) and manual QA on the pushed tip before handing a PR to Will.
- Weigh pros and cons honestly and hold a position for stated reasons; Will noticed when I changed position under pushback rather than on new facts.
- Do not open a PR for a small change unless it is the main work of a ticket; small changes ride along in the next real PR.
