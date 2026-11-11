# Dispatch 21: the statement vocabulary for value object fields and variants

**Plan:** [`../plan-pr4.md`](../plan-pr4.md) · **Grounding:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/pr4-grounding.md`, sections 1, 2 and 8 · **Worktree:** `/Users/wmadden/Projects/prisma/orm/.claude/worktrees/pollyanna-30-context-6ee51c/wip/wt-pr4` · **Branch:** `tml-3537-value-object-variant-statements`

Work only inside the worktree. Run `mise exec -- pnpm install` and `mise exec -- pnpm build` first.

PR 2 added enum value statements (`EnumValueCoordinate`, subject kind `enumValue`, the `Enum.value` reading). Follow how it did each step. This dispatch adds the words; later dispatches plan the operations. Write a failing test first for every behaviour.

## Framework types

These are the only framework changes allowed. Each names a concept the framework already defines. Add nothing else to `packages/1-framework`; if you find you need more, stop and report it.

In `packages/1-framework/1-core/framework-components/src/control/migration-statements.ts`:

1. `ValueObjectFieldCoordinate`: `{ namespaceId, valueObject, field }`, beside `EnumValueCoordinate`. `namespaceId` is the storage namespace the value object lives in.
2. `MigrationSubject` gains `{ kind: 'valueObjectField' } & ValueObjectFieldCoordinate`. Update `migrationSubjectKey`, `migrationSubjectJson` and `MigrationSubjectJson`.
3. `ResolvedRenameStatement` gains a value object field rename (`entity: 'valueObjectField'`, `from`, `to`).
4. `ResolvedMigrationStatement` gains:
   - a value object member backfill (`kind: 'backfill'`, `entity: 'valueObjectField'`);
   - a variant convert (`kind: 'convert'`, `entity: 'model'`, `model: ModelCoordinate`).
5. `MigrationStatementJson`, `migrationStatementJson` and `describeMigrationStatement` handle the new statements. They must stop assuming every non-rename statement names a model field. Add `valueObjectFieldStatementText` beside `enumValueStatementText`.

## CLI (`packages/1-framework/3-tooling/cli`)

6. `readSide` reads `ValueObject.field` (two names) and `namespace.ValueObject.field` (three names). When several readings resolve, refuse naming each, as today.
7. A rename of a value object field resolves when the value object is in both contracts and the field is in the origin and not the destination, or the reverse for the new name. Read value objects from the storage plane, as `hasValueObject` does.
8. `--backfill GeoPoint.country` resolves when the member is required in the destination value object and absent or optional in the origin one. Remove the refusal of value objects in `resolveFieldStatement` for this case.
9. `--convert Bug` (one name, or `namespace.Bug`) parses and resolves to a variant convert. Refuse a model that is not a variant in both contracts, or whose discriminator value did not change. Read the base, discriminator and variants from the domain types (`ContractModelBase`).
10. `db update` resolves statements first, then refuses only field converts and backfills with `MIGRATION.STATEMENT_NEEDS_MIGRATION_FILE`. A variant convert passes. A value object member backfill is refused there as a field backfill is.
11. Every switch over the subject kind handles `valueObjectField`: `subjectText`, `lossText`, `sameCoordinate`, `renameForm`, `inDestination`, `ENTITY_WORDS` and the prompt. Offer the one new member of the value object as the rename form, as `onlyNewMember` does for enums.
12. A question about a model subject that is a variant whose discriminator value changed offers `--convert <Variant>` first, then `--delete`. Decide this from the two contracts' domain types, in the CLI.

## MongoDB

13. The Mongo statement planner refuses value object field renames and backfills and variant converts with one refusal each, as it refuses enum value statements (`mongo-statement-planning.ts`), until a later release.

## SQL family

14. The SQL statement planner returns no operations for the new statements for now (`ok([])`), as it does for enum values. Later dispatches plan them.

## Rules

- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`. Run named files with `pnpm test <file>` inside `test/integration`, and journeys with `pnpm test:journeys <file>`. `pnpm test:packages` is allowed.
- Use `mise exec --` for node and pnpm. Never `npx`. Do not write to `/tmp` or any system temp directory. Save slow output under `wip/` in the worktree and read the file. Never use bare `git stash`.
- No comments where the code can say it. No bare `as` casts in production code. No `any`. No file extensions in imports. No backwards-compatibility exports. Framework packages name no family or target.
- No invented nouns: use the names in this brief or in the code. Never hard-wrap Markdown prose.
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No AI attribution lines (no Co-Authored-By, no "Generated with"). Stage files explicitly.
- Do not push. Do not open a PR.

## Done when

- `pnpm build` is clean; typecheck, lint and `test --coverage` pass in every touched package.
- `lint:deps`, `lint:ratchets` and `check:error-reference` pass.
- The enum value statement journeys (`enum-value-statements*`) still pass.

## Report

Plain English, short sentences: each item and what you did, every file you changed in `packages/1-framework`, the tests that were red first, the checks, anything you could not do and why, and the commits.
