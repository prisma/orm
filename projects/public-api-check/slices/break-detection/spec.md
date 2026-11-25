# Slice: find breaks against the last release, and make API changes visible to the reviewer

Parent project: [`projects/public-api-check/`](../../spec.md). Linear: [TML-3933](https://linear.app/prisma-company/issue/TML-3933). One pull request. Builds on the committed lists from the first slice.

Status: written 2026-11-25, brought up to date 2026-11-26 after the third trial and two rounds of code review.

## At a glance

A pull request that removes an export a release had, or makes a parameter narrower, gets a failing CI job that names the export. Before `8.0.0` the same job reports the break in its summary and passes.

A pull request that changes any `api.txt` gets a comment listing the lines it adds and removes, and a check that fails until its description has a section naming each added and removed export with a reason.

## Chosen design

The decision record, `docs/architecture docs/adrs/ADR 330 - CI finds breaking and accidental API changes against the last release.md`, is the full and current design; where this summary and the record differ, the record wins. The mechanisms were settled by the three trials in [the spike record](../../spikes/2026-11-25-break-detection-trials.md) and by two rounds of code review.

- **One reading.** The type-test generator takes its export names from the same compiler reading as the list (`readExports` in `scripts/public-api/read-exports.mjs`), run over the last release's declarations, including whether each forwarded name is a type or a value.
- **The last release** is the newest `v<version>` git tag, not a `-dev.` build, at or below the root `package.json` version of the branch the pull request merges into, as `docs/oss/versioning.md` prescribes. The registry is asked only whether each package was published at that version. One module, `scripts/public-api/release.mjs`, holds the lookup and the release rules for both checks.
- **Generated type tests** (`pnpm api:compat`, the `api-compat` job). The release is installed beside the current build, twice, in a gitignored folder with its own workspace file and the repository's supply-chain settings; third-party versions come from the lockfile; our packages are stamped with versions of their own. TypeScript compares each export natively, on declarations a compiler host rewrites as it reads them (methods to function-typed properties; private members to one marker naming the class; protected members kept; unique symbols to string literals named by package and name; one copy per third-party version). A native failure is a break if the same test passes between the release and its second copy; otherwise the structural helpers, then member-by-member comparison, decide, and the rest is undecided with its stage. Value exports also get a value-position use, classes a constructor test and abstract members their own test, `declare module` additions are compared, a removed import path or package is a break, and a forwarded name gets an existence test.
- **The last release's example apps** (`pnpm api:compat:examples`, in the `api-compat` job). Each app at the tag is extracted into a folder the run owns, at the repository's depth, with the real app's `node_modules` linked in, and its own typecheck script runs there. Committed contracts are compiled as they were, never emitted again. The developer's app folders are never touched.
- **Records.** A deliberate break, or a false break the one-direction rule causes, is recorded with its kind, the last release it is measured against, and its reason: in the package's `api-breaks.json`, in `packages/9-public/removed-packages.json` for a deleted package, or in `examples/last-release-errors.json` for an app error. A record for an earlier release is skipped and listed as removable; one that no longer matches fails.
- **GA only.** A break fails the run when the last release's version has no pre-release part and, for the type tests, the export's name does not start with `preview_` or `ea_`. Otherwise it is reported. A problem (a lookup that fails, a package that cannot be read) fails the run either way.
- **Description check and comment** (`.github/workflows/api-changes.yml`). On `pull_request`, it compares the merge commit with its first parent. When an `api.txt` or a record file changes, it posts one comment listing the changes and keeps it current, and fails until the description's `## API changes` section names each changed export, package or app with a reason. Forks get the job summary instead; the merge queue passes. No `pull_request_target`.
- **Review instructions** in `packages/9-public/AGENTS.md` and `.coderabbit.yml`, for `api.txt` and the record files.
- **Documentation.** The decision record and `docs/Public API Compatibility.md`.

## Coherence rationale

Everything in it serves one statement to a reviewer: "this pull request changes the public API in these ways, and these are breaks". The break checks, the comment and the description check share the reading and the last-release lookup. The documentation describes all of them together, which is why it ships in the same pull request.

## Scope

**In:** `scripts/public-api/` (the type-test generator, the last-release lookup, the description check and comment), the per-package records of deliberate breaks, `.github/workflows/` (new jobs or steps), `packages/9-public/AGENTS.md`, `.coderabbit.yml`, the decision record, the contributor guide, the playbook section from the first slice, and the project close-out (the project folder is deleted and its lasting content moved into `docs/`).

**Deliberately out:** removing or renaming exports; the reference documentation; a check on the committed `exports` field; per-package maturity levels; `packages/1-framework`.

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| Classes with private members and branded types do not fit themselves across two copies | The signature-keeping comparison gave no such false failure in the trial; a control run compares the build with a copy of itself. |
| Known blind spots: brands reduce to their primitive; generic functions compare at their constraints; overloads by their last signature; a break inside an undecided type | Recorded in the decision record as what the check does not see. |
| Memory: up to 6 GB for the largest packages | CI runs two packages at a time. |
| The description check cannot read a description in the merge queue | It runs on the pull request, including when the description is edited, and passes in the merge queue. |
| A pull request from a fork cannot comment | The text goes in the job summary. |
| The first release after this slice merges is the first whose tag has `api.txt` files | The type tests install the last release from the registry, which works for any release. |
| An export is forwarded by a facade | Checked once, in the package that owns it. |

## Slice-specific done conditions

- The project spec's definition of done, items 2 to 6.
- Manual QA on a real pull request: one that adds an export gets the comment and fails the description check until the description names it.

## References

- Trial briefs: [dispatches/](dispatches/). Trial reports (gitignored): `wip/break-spike/types/report.md`, `wip/break-spike/apps/report.md`.
- Fluid Framework type tests: the `typetests` command of `@fluid-tools/build-cli` in microsoft/FluidFramework.
- Comment precedent: `.github/workflows/bundle-size.yml`.
