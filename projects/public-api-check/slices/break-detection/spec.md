# Slice: find breaks against the last release, and make API changes visible to the reviewer

Parent project: [`projects/public-api-check/`](../../spec.md). Linear: [TML-3933](https://linear.app/prisma-company/issue/TML-3933). One pull request. Builds on the committed lists from the first slice.

Status: written 2026-11-25; the mechanisms are settled by the two trials in [the spike record](../../spikes/2026-11-25-break-detection-trials.md).

## At a glance

A pull request that removes an export a release had, or makes a parameter narrower, gets a failing CI job that names the export. Before `8.0.0` the same job reports the break in its summary and passes.

A pull request that changes any `api.txt` gets a comment listing the lines it adds and removes, and a check that fails until its description has a section naming each added and removed export with a reason.

## Chosen design

The project spec's sections "Breaks", "Result types", "Human oversight" and "Until `8.0.0`" are the design. In short:

- **One reading.** The type-test generator takes its export names from the same compiler reading as the list (`readExports` in `scripts/public-api/read-exports.mjs`), run over the last release's declarations. It needs no printed signatures, so API Extractor's half is not involved and the reading needs no reshaping into a new function. This replaces the project plan's step of making the joined reading one function.
- **The last release.** The version is the registry's `latest` dist-tag of `@prisma/orm-postgres` (today `8.0.0-rc.25`), and its git tag is `v<version>`; a missing tag fails the job. A package with no published version equal to it has no release yet and is not checked (today `@prisma/orm-better-auth`, whose `latest` is a hand-published `0.0.0`). Both break checks use this one lookup.
- **Generated type tests.** Settled by the first trial ([spike record](../../spikes/2026-11-25-break-detection-trials.md)):
  - The last release's packages are installed from the registry into a gitignored folder with a workspace of its own, so the repository's lockfile never changes. Their third-party dependencies are pinned to the versions in the repository's lockfile, and the installed copies are stamped with a version of their own, because TypeScript treats two copies with one name and version as one package without comparing them.
  - For each export of each package's own import paths (forwarded names are checked in the package that owns them), one test asks whether the current build's type is assignable to the last release's, for types and for values. The comparison keeps call and construct signatures and turns methods into function-typed properties, through a helper written once per side so that method parameters are not compared bivariantly. One direction is enough: a new required member on a type users implement fails through the exported function that accepts it, and a new member on a type users only receive passes, so nobody records which interfaces users implement. Type parameters without a default are set to `never`, as Fluid does.
  - Every generated file ends with a test that must fail, so a run that compares nothing fails.
  - "Type instantiation is excessively deep" is reported as undecided, never as a break or a pass.
  - A deliberate break is recorded beside the package's `api.txt` with the export, the release it applies to and the reason. The generator writes `// @ts-expect-error <reason>` above that test, so the record fails once the break is undone. A record for an earlier release than the last one describes a break users already have; it is skipped and listed as removable, never failed, because failing it would fail every open pull request the moment a release is published.
- **The last release's example apps.** CI compiles the example apps as they were at the last release, with their type tests, against the current build. Settled by the second trial:
  - The last release is the git tag `v` plus the registry's `latest` dist-tag of `@prisma/orm-postgres` (today `v8.0.0-rc.25`). A missing tag fails the job.
  - In the `typecheck` job, after `pnpm typecheck:examples`: fetch that one tag shallowly; for each app that exists at the tag, replace its files, apart from `node_modules`, with the tag's (`git archive`); run each app's own typecheck, and its step before typecheck where it has one. The app's `node_modules` already resolve `@prisma/*` to the current build through `exports`, as a user's would. No second install and no database.
  - The apps' committed contracts are compiled as they were at the tag, not re-emitted, because the compatibility policy says a contract and its generated types are read by every later release with no re-emit.
  - The apps' type tests assert exact types, so an addition the policy allows, such as a new optional property on a row or an input that is now accepted, fails them. Each such failure is recorded once, with its reason, in the same kind of record as the generated tests. The records belong to one release's tag and are emptied when the last release moves on.
  - The report groups errors by file, because one deliberate change gave over 1,000 lines in the trial.
- **GA only.** A package counts as GA when its version at the last release has no pre-release part, and an export counts when its name does not start with `preview_` or `ea_`. A forwarded path is checked in the package that owns it. With today's `rc` versions every break check reports and does not fail, with nothing to switch on at `8.0.0`.
- **Description check and comment.** A job on `pull_request` with `pull-requests: write`, like `bundle-size.yml`, compares each `api.txt` with the base branch. It posts one comment with the added and removed lines and keeps it current, and fails until the description has a section that names each added and removed export. On a fork, where the token cannot comment, the same text goes in the job summary. In the merge queue it checks and does not comment. No `pull_request_target`.
- **Review instructions.** `packages/9-public/AGENTS.md` states what a reviewer checks in an `api.txt` change: is each addition meant to be supported until the next major, and is each removal or change allowed by the compatibility policy. `.coderabbit.yml` gets the same text as a path instruction for `**/api.txt`.
- **Documentation.** A decision record in `docs/architecture docs/adrs/`, and a contributor guide in `docs/` that says how to update the lists, how to fill the description section, how to record a deliberate break, and what the checks do before and from `8.0.0`. The decision record passes the ADR fresh-reader review before the pull request goes to review.

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
| Memory: up to 3.2 GB per package | The job runs a few packages at a time. |
| The description check cannot read a description in the merge queue | It runs on the pull request, including when the description is edited, and passes in the merge queue. |
| A pull request from a fork cannot comment | The text goes in the job summary. |
| The first release after this slice merges is the first whose tag has `api.txt` files | The type tests read the last release from the registry, which works for any release. |
| An export is forwarded by a facade | Checked once, in the package that owns it. |

## Slice-specific done conditions

- The project spec's definition of done, items 2 to 6.
- Manual QA on a real pull request: one that adds an export gets the comment and fails the description check until the description names it.

## References

- Trial briefs: [dispatches/](dispatches/). Trial reports (gitignored): `wip/break-spike/types/report.md`, `wip/break-spike/apps/report.md`.
- Fluid Framework type tests: the `typetests` command of `@fluid-tools/build-cli` in microsoft/FluidFramework.
- Comment precedent: `.github/workflows/bundle-size.yml`.
