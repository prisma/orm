# Handover: drafts of the compatibility policy records

This branch, `docs/compatibility-policy-records`, was pull request prisma/orm#31194. It recorded the whole Prisma 8 compatibility policy on `main` at once and corrected the docs that contradicted it. It was closed without merging: no document describing part of the `8.0.0` policy merges before the code follows it. Each project of the compatibility work brings its code, its checks and its documentation together.

So this branch is a set of drafts. This file lists every change on it and the project that should take it. Project numbers are those in `projects/ga-compatibility/plan.md` on the branch `ga-compatibility`:

| Number | Project |
| --- | --- |
| 2 | Later releases read the stored files and database records of earlier releases |
| 3 | Minimise the exports of GA packages and keep them until the next major |
| 4 | A CI check of each package's exports against the last release |
| 5 | Additions that cannot break user code |
| 6 | Maturity levels in versions and names, and releasing each package at its level |
| 7 | Prisma's own tables brought up to date in each release |
| 8 | Reference documentation shipped in each package |
| 9 | Classifying each change to behaviour, in pull requests and release notes |
| 10 | A deterministic upgrade tool |
| 11 | Supported versions of Node.js, TypeScript, databases and drivers |
| 12 | Publishing the policy for users |

To read a draft: `git show bot/docs/compatibility-policy-records:<path>`. The reviews of the drafts (system design, code, OSS specialist, CodeRabbit) are summarised under "What the reviews found" below.

## The two new decision records

`docs/architecture docs/adrs/ADR 329 - From 8.0.0, an application upgrades within Prisma 8 without changes.md` records the whole policy. Split it by section; each project takes its sections into its own decision record. The number 329 is not reserved: take the next free number when a record merges.

| Section of the ADR 329 draft | Project |
| --- | --- |
| Opening example, Decision, "When the rules start" (including the definition of a release, which excludes pre-releases), Terms, "What the promise covers", "Both audiences get identical rules" | The first project to merge a decision record; then each later record links to it |
| "Additions" (optional members on implemented interfaces, open sets with a catch-all member, built-in names) | 5 |
| "Changes to existing behaviour" (the four classes), "Rejecting input that was previously accepted", "Release notes", "How a change is checked" (first bullet) | 9 |
| "Replaced APIs", the bullets on exporting as little as possible and on nothing named "internal" | 3 |
| "How a change is checked" (second bullet, the exports comparison) | 4 |
| "Supported versions of what Prisma runs on" | 11 |
| "A later release reads what an earlier release stored", "Format versions", "Hashes", "The runtime marker check only warns" | 2 |
| "Database records" | 7 |
| "Migrations across a major", "Upgrades that need a change are made by a tool" | 10 |
| "The reference documentation is the specification" | 8 |
| "Releases and how long they are supported", "No feature flags" | 6 |
| "Earlier records" | Split by row: each project takes the rows for the records it supersedes (below) |
| "Alternatives considered" | With the section each alternative belongs to |

`docs/architecture docs/adrs/ADR 330 - A maturity level is written in a package's version and an API's name.md` records the maturity levels whole. It goes to project 6.

`docs/architecture docs/ADR-INDEX.md`: the rows, steering-list entries and the Notes line for ADRs 329 and 330, and "for the Prisma 8 prototype" changed to "for Prisma 8". Each project adds the index entries for its own record. The "prototype" wording is true to remove whenever.

## Notes on earlier decision records

Each is a one-line note at the top of an older record that names the part the new policy replaces.

| Record | What the note says | Project |
| --- | --- | --- |
| ADR 222, version support | "We raise floors freely" ends at `8.0.0` | 11 |
| ADR 219, database drivers | One driver major at a time ends at `8.0.0`; how driver types are exported must be decided before `8.0.0` | 11, with 3 for the driver types |
| ADR 257, 316, 322, scalar type names | The "one release line" alias rule ends at `8.0.0` | 3 |
| ADR 252, earlier Prisma schema as a contract source | The naming rule does not change after `8.0.0`; a GA reader is not removed within the major | 2 for the naming rule, 3 for the reader |
| ADR 010, canonicalization; ADR 234, wire names | No "re-emit and re-sign" after `8.0.0`; same content, same hash | 2 |
| ADR 140, package layering | "No shims, no external consumers" ends at `8.0.0` | 3 |
| ADR 016, SQL lowering | Its feature flag for SQL changes no longer applies; SQL text is unspecified detail | 9 (SQL text), 6 (no feature flags) |
| ADR 017, extension compatibility | Its per-component version matrix no longer applies | True today, see below |

## Docs, rules and skills

| File | Change | Project |
| --- | --- | --- |
| `.agents/rules/no-backward-compatibility.mdc`, its line in `.agents/rules/README.md`, `AGENTS.md` line 53, `CONTRIBUTING.md` ("No backward-compat shims" and the "From `8.0.0` this changes" status line), `skills-contrib/contrib-pr/SKILL.md`, `docs/Architecture Overview.md` (the "no transitional shims" line) | "No compatibility code" holds until `8.0.0`; what contributors do from `8.0.0` (keep a replaced API deprecated, state the class of a change, no flags) | 9, which changes contributor process; 3 if it merges first, for the part on keeping exports |
| `docs/design/00-purpose/project-intent.md` | The new "Upgrades that need no changes" value, and the end of raising minimums freely | The first project to merge a decision record (value); 11 (minimums) |
| `docs/Supported Versions.md`, the header of `scripts/validate-typescript-peer.mjs` | Minimums rise only in a new major or at the maker's end of support, from `8.0.0` | 11 |
| `docs/architecture docs/subsystems/1. Data Contract.md`, the "Format version" line | A format version written from `8.0.0` is read by every later release; `schemaVersion` is renamed | 2 |
| `docs/oss/versioning.md`: the paragraph "From `8.0.0` the opposite holds", the pin bullet ending at `8.0.0`, and the section "Procedure: release `8.0.0`" (the table of docs to rewrite at `8.0.0`) | Release and version rules | 6 |
| `docs/CLI Style Guide.md`, the paragraph before "Removed-verb redirects" | A GA command or flag is removed only in a new major | 3 |
| `upgrade-instructions/README.md`, `skills-contrib/record-upgrade-instructions/SKILL.md` | The per-release guides serve the release candidates; after `8.0.0` a tool makes any change an upgrade needs | 10 |
| `docs/architecture docs/subsystems/6. Ecosystem Extensions & Packs.md`, the bullets on unready work shipping below GA and on maturity in the version and the name | Maturity levels | 6 |
| `docs/reference/capabilities.md`, "Stability Contract" (a GA capability key is not removed within a major; a capability has its package's level) | Maturity levels | 6 |

## True of the code today: could merge by itself now

These corrections do not describe the `8.0.0` policy. They fix docs that describe something that was never built, or use a word wrongly.

1. **A per-capability stability scheme that was never built.** `docs/architecture docs/subsystems/6. Ecosystem Extensions & Packs.md` describes each pack capability carrying `experimental | preview | stable` in a pack manifest, environment policies that block experimental capabilities in production, and an `experimental-capability-in-prod` lint. No code has any of it. The draft removes those passages (the "Stability metadata in packs" bullet, "Default policy by environment", "Manifest stability metadata" and "Lints and policies"). `docs/reference/capabilities.md` has a "Stability" column marking every capability `Stable` and a "Stability Contract" with Stable, Deprecated and Experimental; the draft removes the column. Take only the removals here; the sentences that replace them describe ADR 330 and go to project 6.
2. **ADR 017's version matrix.** It gives the contract format, the plan model, the hook interface and each adapter separate versions. Only the contract's format version exists. A note saying the rest was not built is true today.
3. **"Early-access install"** in `docs/oss/versioning.md` ("The v8 RC line") means a release-candidate install. "Early Access" will be a maturity level. Saying "release-candidate install" is true today.
4. **The pin bullet in `docs/oss/versioning.md`** ("Lockstep across the workspace") tells extension authors to pin `@internal/sql-core`, which is never published. Today the exact pin applies to the `@prisma/orm-*` platform packages. Restating it with those names, without the sentence that it ends at `8.0.0`, is true today.
5. **"for the Prisma 8 prototype"** at the top of `docs/architecture docs/ADR-INDEX.md`, and "This is a prototype" at the end of `AGENTS.md`.

Of these, 1 is worth a pull request of its own: it removes about forty lines of design that a contributor could take as a requirement, and a capability table column that tells readers every key is "Stable". Items 2 to 5 are small enough to ride along with it.

## What the reviews found that is still open

The reviews found gaps in the agreed policy itself. They are recorded in `projects/ga-compatibility/open-questions.md` on the branch `ga-compatibility`. Two bear on how the drafts are taken:

- "Specified" means "stated in the reference documentation" (project 8). Until that documentation exists, the classes of change in project 9 have nothing to judge "specified" against.
- How a database driver's own types are exported must be decided before `8.0.0` (projects 3 and 11).

The reviewers also flagged two places where the release tooling and the drafts disagree, both for project 6: `scripts/set-version.ts` and the publish workflow give every package one version, so a package below GA would be published as `8.0.0`; and `scripts/check-upgrade-coverage.mjs` requires an upgrade guide for every release, which must change with the guides after `8.0.0`.
