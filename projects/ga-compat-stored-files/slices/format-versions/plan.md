# Plan: stored files carry a format version

The slice spec is [spec.md](spec.md). Every dispatch runs on Opus: implementers at medium effort, reviewers at high effort. No dispatch runs a whole test suite or any other repository-wide command (`pnpm build`, whole-repo typecheck, `pnpm fixtures:check`); CI runs those. Each dispatch runs the test files it touches, typecheck, lint of touched packages and `pnpm lint:deps`.

## Dispatches

1. **Code** (running). The shared check, one unit per version for the contract in each family and for `migration.json` and ref files in the migration tooling, every reader and writer routed through them, strict ref files, the migration hash leaving out `formatVersion`. Tests first. Committed fixture files are not touched; tests that fail only because a fixture on disk is in the old shape are listed in its report.
2. **Upgrade script.** Depends on 1. An `app` and an `extension` fragment in `upgrade-instructions/pending/stored-files-format-version/`, with a standalone script that renames `schemaVersion` to `formatVersion` in every `contract.json` and snapshot, adds `formatVersion: 1` to every `migration.json` and ref file, changes no hash, is safe to run twice, and reports and skips a file it cannot rewrite. Tests in `test/integration/test/upgrade-instructions/stored-files-format-version/` with `before` and `after` trees, modelled on the value-objects script.
3. **Repository files.** Depends on 2. `pnpm fixtures:emit` for what it reaches; the script from 2 for the rest (intermediate extension migrations, the examples the regeneration scripts do not walk, the graph fixtures, the telemetry app). Then the test files that dispatch 1 listed as failing on fixtures, and the docs that name `schemaVersion`. `pnpm fixtures:check` passes.
4. **Review.** `/drive-code-review`, both passes, on the tip.
5. **Fixes** from 4, by a new implementer dispatch; a second review if the fixes change behaviour.
6. **Manual QA**, the commands in the spec's done list, on PostgreSQL and MongoDB.
7. **Pull request.** Description drafted by the orchestrator, read by a fresh reader, rewritten, opened. The two marker-check commits on this branch are dropped first.

## Decisions taken in shaping

- The version is the integer `1`. The old field was the string `"1"`.
- `formatVersion` is outside the migration hash input, so this pull request changes no hash.
- The decision record is ADR 331, written by the orchestrator, already in the branch's working tree.
