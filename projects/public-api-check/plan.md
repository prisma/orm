# Public API check: plan

The design is in [spec.md](spec.md). Two slices, one pull request each, in order. Linear project: [Catch breaking API changes and accidental exports in CI](https://linear.app/prisma-company/project/catch-breaking-api-changes-and-accidental-exports-in-ci-d45c81b36a78).

- Slice 1: [TML-3932](https://linear.app/prisma-company/issue/TML-3932), files in [slices/api-lists/](slices/api-lists/spec.md).
- Slice 2: [TML-3933](https://linear.app/prisma-company/issue/TML-3933).

Spike records are in [spikes/](spikes/).

## Slice 1: every package lists its API in a committed file

**Outcome.** Each published package has an `api.txt`: one line per import path, export and member. `pnpm api:update` writes the files, `pnpm api:check` fails when they do not match the build, and the `Lint` job in CI runs the check. The files generated in CI and on a laptop are identical.

**Why first.** The files are what the next project in the compatibility work reviews when it removes exports.

**Starts from.** The trial scripts `gen-model.mjs` and `flatten.mjs`, which are not in the repository; the slice rewrites them under `scripts/` with tests. API Extractor's output is kept in each package's gitignored `dist-api/`, but it is only half of the reading; the join with what the compiler sees lives inside the list generator for now.

**Hands to slice 2.** The files on `main`, so the next release's tag contains them.

## Slice 2: detect breaks, and make API changes visible to the reviewer

**Outcome.**

- The joined reading of a package (what the compiler sees exported, written out by API Extractor) becomes one function that the list and the type-test generator both call, and it can write to a folder the caller chooses, so it can read the last release from the registry without writing into `node_modules`.
- Generated type tests compare each export of the last release with the current build. A deliberate break is recorded as an expected failure.
- CI compiles the last release's example apps, with their type tests, against the current build.
- A pull request that changes an `api.txt` fails until its description names each added and removed export, and gets a comment listing them.
- `packages/9-public/AGENTS.md` and `.coderabbit.yml` carry the review criteria.
- With today's `rc` versions the break checks report and do not fail.
- A decision record and a contributor's guide are written, and the project folder is deleted.

**Builds on.** Slice 1, and a trial of the generated type tests on our packages. If the trial fails, breaks are found by comparing the lists with those at the last release's git tag.

**Note.** The comparison of the last release's example apps needs no earlier slice. Until a release has been cut after slice 1, the generated tests read the previous release from the registry, which works for any release.

## Known limits of the lists, left as they are

- An outside type imported under a local alias prints under the alias. Printing API Extractor's referenced name instead was tried and made 133 lines worse, because that name is often not one any package exports (`SqlMigration` for `Migration`). A fix would ask the TypeScript checker which name the declaring module exports.
- Types inside the members of a `declare module` augmentation are not qualified on a name clash. Today's augmentation lines refer only to the package's own types.

## Recorded for the owner of the compatibility work

- A GA package depends only on GA packages. The maturity levels do not yet say so.
- The committed `exports` field of a published package is not checked in CI against what the build would write.
- 22 packages are published today, with 1,037 import paths. The compatibility documents say 21 and 1,036.
- The step that reads each package's API is the input for the generated reference documentation.
- Interfaces that users implement need no list for this check: the compiler decides whether a new required member breaks.
