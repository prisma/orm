# Public API check: plan

The design is in [spec.md](spec.md). Three slices, one pull request each, in order.

## Slice 1: every package lists its API in a committed file

**Outcome.** Each published package has an `api.txt`: one line per import path, export and member. `pnpm api:update` writes the files, `pnpm api:check` fails when they do not match the build, and the `Lint` job in CI runs the check. The files generated in CI and on a laptop are identical.

**Why first.** The files are what the next project in the compatibility work reviews when it removes exports.

**Starts from.** The trial scripts `gen-model.mjs` and `flatten.mjs`, which are not in the repository; the slice rewrites them under `scripts/` with tests. It lists each non-exported type once per package, and measures how many lines change in a week of real pull requests.

**Hands to slice 2.** The files on `main`, so the next release's tag contains them.

## Slice 2: compare with the last release, and require approval for changes

**Outcome.** CI compares the files with the pull request's base and posts the comment that lists added and removed lines. It compares them with the last release's tag and fails on a removed line of anything GA. `api/exceptions.txt` and `api/type-roles.txt` exist and are honoured. `CODEOWNERS` names the owners of every `api.txt`. With today's `rc` versions the check reports and does not fail.

**Builds on.** Slice 1.

**Needs from a maintainer.** The branch rule that requires a code owner's approval.

**Note.** Until a release tag contains the files, the comparison with the last release has nothing to read and says so. The first release after slice 1 merges fixes that.

## Slice 3: record the decision and tell contributors

**Outcome.** A decision record in `docs/architecture docs/adrs/` states the design. A guide in `docs/` tells a contributor what the check does, how to update the files, how to read the comment, and when an exception is right. The project folder is deleted.

**Builds on.** Slice 2.

## Recorded for the owner of the compatibility work

- Type tests against the published packages, as a new project. They cover what this check cannot see: types computed from the user's contract and query.
- The committed `exports` field of a published package is not checked in CI against what the build would write.
- 22 packages are published today, with 1,037 import paths. The compatibility documents say 21 and 1,036.
