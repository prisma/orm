# Project plan — Destructive changes need stated intent

**Spec:** `projects/intent-hints/spec.md` · **Design:** `projects/intent-hints/design.md` (section 12 maps rules to slices) · **Linear:** [Destructive changes need stated intent](https://linear.app/prisma-company/project/destructive-changes-need-stated-intent-7626c0107cd9)

## Slices

### Slice 1 — The hint attribute, the contract section, and model renames

- **Outcome:** `@@hint(was: "...")` in PSL and the equivalent on the TypeScript model builder lower to an unhashed `hints` section of `contract.json`; the attribute spec reserves `deleted` and `deprecated` and rejects them with a "not yet supported" message; the snapshot store and migration directories strip the section; the Postgres and SQLite planners take hints as an input, resolve each model hint against the origin schema with the spent, no-op and refusal rules, and plan the table rename plus companion renames through `applyTableRename`; `migration plan` reports the hints it consumed; the verbatim guard names the hint as its first remedy; the upgrade fragment and the language server reflect the attribute.
- **Builds on:** prisma/orm#30331 merged.
- **Hands to:** the contract section and its validation, the planner's hint input and resolution helper, the consumed-hints report.
- **Linear:** TML-3422.
- **PR:** https://github.com/prisma/orm/pull/30570, stacked on the shaping PR prisma/orm#30557; retarget to `main` once that merges.

### Slice 2 — Field renames

- **Outcome:** `@hint(was: "...")` on a PSL field and the equivalent on the TypeScript field builder; a column rename operation on Postgres and SQLite with prechecks and postchecks, exported through each migration facade; the planner renames the column and every constraint and index whose name derives from it, including wire-named indexes whose content hash changes with the column name, instead of rebuilding them; model and field hints in one change compose.
- **Builds on:** slice 1.
- **Hands to:** the column rename operation and the companion-rename rules for column-derived names.
- **Linear:** TML-3423.

### Slice 3 — `migration plan` refuses destructive operations by default

- **Outcome:** an ordinary `migration plan` whose plan carries a destructive operation refuses with `MIGRATION.DESTRUCTIVE_CHANGES`, the same consent model `db update` and the auto-baseline path use; the refusal names each object and the hint that would state the intent; `db update`'s refusal gains the same hint-naming text; an upgrade fragment records the behaviour change.
- **Builds on:** slice 2, so the refusal's way out exists for renames.
- **Hands to:** the refusal text shared by both commands.
- **Linear:** TML-3424.

### Slice 4 — `deleted`

- **Outcome:** `@@hint(deleted: true)` on a model and `@hint(deleted: true)` on a field make the block a tombstone: excluded from domain, storage and generated types, present only in the hints section; the planners drop the named table or column when the origin has it and do nothing when it does not, with no consent prompt; both targets.
- **Builds on:** slice 3.
- **Hands to:** the tombstone lowering, which the `deprecated` follow-on extends.
- **Note from slice 1 QA:** the release switch `deletedHintsShipped` exists in two unexported modules (`contract-psl/src/release-switches.ts`, `family-sql/src/core/release-switches.ts`); slice 4 flips both and restores the final texts of R1.6, R1.10 and the contradicted `why`.
- **Note from slice 1 review:** `resolveHints` returns early when the policy lacks `widening`; slice 4 must move that check into the rename branches, because the `deleted` rules act under `destructive` alone.
- **Linear:** TML-3432.

## Sequencing

One stack: slice 1, 2, 3, 4. Each needs the previous slice's hand-off.

## Dependencies

- prisma/orm#30331 (rename-table operation) must merge before slice 1 is cut.
- Users get the feature through the next npm minor of the `@prisma/orm-*` packages after the last slice merges.

## Follow-ups filed outside this project

- `deprecated`: a tombstone that leaves the contract and the types but is tolerated in the database, which needs `db verify` to accept a declared absence under the `managed` policy.
- Namespace moves, enum value renames and explicitly named index renames as `was` hints.
- MongoDB hints: collection rename, field rename as a document rewrite, and `deleted`, reusing the contract section.
- Value hints: `cast` for type changes and `backfill` for new required columns.
- Whether to reverse the documented dev-only stance on `db update` once the mechanism exists.

## Close-out (required)

- Verify every Project DoD item in `spec.md`.
- Write the ADR on stated intent for destructive changes; amend ADR 001, ADR 028 and the Data Contract and Migration System subsystem docs to remove the "recorded in migration edges" text.
- Strip repo-wide references to `projects/intent-hints/**`.
- Delete `projects/intent-hints/`.
