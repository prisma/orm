# Plan: a hash covers what a contract means

The slice spec is [spec.md](spec.md). The branch starts from the format-versions branch. Every dispatch runs on Opus: implementers at medium effort, reviewers at high effort. No dispatch runs a whole test suite or any other repository-wide command (`pnpm build`, whole-repo typecheck, `pnpm fixtures:check`); CI runs those.

## Dispatches

1. **Fixed answers first.** Saved contracts for each target, taken from committed fixtures, with the hashes the new rules give written as literals, and the published helper that runs such a test for any family or target. The test fails until 2 lands.
2. **The hash input.** `computeStorageHash`, `computeProfileHash` and `computeExecutionHash` build their input from exactly the target, the family and their own section. The existing hash-pinning tests take their new values. Test 1 passes.
3. **Upgrade script.** Modelled on the script for value objects in storage: standalone, carrying its own copy of the old and new hash rules, verifying each stored hash under the old rules before it rewrites anything. Fragments for applications and extensions. Tests with `before` and `after` trees.
4. **Repository files.** The script over the repository outside frozen history; the test files that pin hashes from committed fixtures. `pnpm fixtures:check` runs in CI, not locally.
5. **Review**, both passes of `/drive-code-review`, on the tip; **fixes** by a new dispatch; a second review if fixes change behaviour.
6. **Manual QA** of the upgrade on PostgreSQL and MongoDB.
7. **Pull request**: description by the orchestrator, read by a fresh reader, rewritten, opened.

The decision record and the doc changes are written by the orchestrator alongside 2.

## Decisions taken in shaping

- The input of each hash is a JSON object with the keys `target`, `targetFamily` and one section, canonicalized by today's rules.
- The helper lives in the contract foundation package, beside the hash functions it tests, and is published through the package that already exports them to extension authors.
- A database is moved to the new hash by `prisma db sign`, as the design says. No migration-system mechanism is built.
