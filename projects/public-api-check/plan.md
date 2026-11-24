# Public API check: plan

The design is in [spec.md](spec.md). Two slices, one pull request each, in order.

## Slice 1: every package lists its API in a committed file

**Outcome.** Each published package has an `api.txt`: one line per import path, export and member. `pnpm api:update` writes the files, `pnpm api:check` fails when they do not match the build, and the `Lint` job in CI runs the check. The files generated in CI and on a laptop are identical.

**Why first.** The files are what the next project in the compatibility work reviews when it removes exports.

**Starts from.** The trial scripts `gen-model.mjs` and `flatten.mjs`, which are not in the repository; the slice rewrites them under `scripts/` with tests. It lists each non-exported type once per package.

**Hands to slice 2.** The files on `main`, so the next release's tag contains them.

## Slice 2: compare with the last release, and require approval for changes

**Outcome.** CI compares the files with the pull request's base and posts the comment that lists added and removed lines, with new required members under their own heading. It compares them with the last release's tag and fails on a removed line of anything GA, and on a GA line that names a `preview_` or `ea_` type. `api/exceptions.txt` exists and is honoured. CI type-checks the last release's example apps against the current build. `CODEOWNERS` names the owners of every `api.txt`. With today's `rc` versions the checks report and do not fail. A decision record and a contributor's guide are written, and the project folder is deleted.

**Builds on.** Slice 1.

**Needs from a maintainer.** The branch rule that requires a code owner's approval, and the owners' names.

**Note.** Until a release tag contains the files, the comparison with the last release has nothing to read and says so. The first release after slice 1 merges fixes that.

## Recorded for the owner of the compatibility work

- A GA package depends only on GA packages. The maturity levels do not yet say so.
- The committed `exports` field of a published package is not checked in CI against what the build would write.
- 22 packages are published today, with 1,037 import paths. The compatibility documents say 21 and 1,036.
- The step that reads each package's API is meant to be shared with the generated reference documentation.
