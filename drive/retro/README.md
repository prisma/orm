# drive/retro — project-context for retros

Loaded by `drive-run-retro`. Holds prisma-next's retro conventions, recurring-pattern catalogue, and landing-surface preferences.

> **Trial period in effect (ends 2026-06-02).** When any drive-* skill in this category produces a finding, record it in [`findings.md`](./findings.md). Quality bar, tags, and format live in [`drive/trial.md`](../trial.md).

## Landing-surface preferences

When a retro lesson could land in multiple surfaces, the team's preference:

- **Calibration of size / cost / DoR / DoD items** → the matching file under [`drive/calibration/`](../calibration/README.md). These rarely generalise; they're tied to this repo's package layout and CI shape.
- **Triage / sizing heuristics** → triage decision rules go to [`drive/triage/README.md`](../triage/README.md); sizing anchors themselves go to [`drive/calibration/sizing.md`](../calibration/sizing.md).
- **Failure-mode patterns specific to this codebase** → [`drive/calibration/failure-modes.md`](../calibration/failure-modes.md); the matching grep pattern (if any) → [`drive/calibration/grep-library.md`](../calibration/grep-library.md).
- **Failure-mode patterns that generalise to any contract-first system** → canonical (via `drive-update-skills`).
- **Durable architectural decisions** → ADR under [docs/architecture docs/adrs/](../../docs/architecture%20docs/adrs/).
- **Process changes that affect the whole methodology** → propose upstream PR to `prisma/ignite` (after one or two repetitions to confirm the pattern).

## Recurring-pattern catalogue

One entry per finished project, newest first: what it delivered, then what went wrong or right, each with a link to where the lesson lives.

- **2026-11-24 — External target integration.** `prisma orm init --target <package>` and `prisma contract emit` work for a target package that Prisma did not write, with nothing about that target in the CLI (ADR 324 "Generated files import from the module the facade names" and ADR 325 "`init` gets everything about a database from its facade").
  - With every slice merged the project was reported as finished, while no release carried it and the outside team's first attempt had failed on a table named `constructor`; the close-out now checks the purpose against published packages first ([project checklist](../calibration/dod.md#reached-the-user)).
  - That one report showed a class of defect (names such as `__proto__` used as object keys) that took three pull requests to fix, because each fixed the places its brief named; a brief that said "every emitter" had the opposite fault and changed a migration planner ([dispatch checklist](../calibration/dor.md#dispatch-dor-overlay)).
  - The upgrade guide for a published release said the release refused names it did not refuse, because it was written before checking the tag ([project checklist](../calibration/dod.md#reached-the-user)).
  - A plan split one change so that the first dispatch broke applications until the second repaired them, and two briefs claimed nothing emitted would change when it did ([slice checklist](../calibration/dor.md#plan-side-items)).
  - Four follow-up tickets written from a pull request's summary described the code wrongly, and a bare `git commit` in a worktree shared with a subagent took the subagent's staged files three times ([slice checklist](../calibration/dod.md#pr-side-items), [dispatch checklist](../calibration/dor.md#dispatch-dor-overlay)).
  - The design documents used words the glossary does not, and a draft decision record left two questions open in its text ([project checklist](../calibration/dor.md#project-dor-overlay), [decision records](../project/README.md#adr-cadence)).
  - The close-out started from the plan's own checklist; this was the third project to do so ([close-out rule](../project/README.md#close-out-runs-the-close-out-procedure)).
- **2026-11-20 — Scalar convenience types.** `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` and `Json` are convenience types on PostgreSQL, MongoDB, SQLite, MySQL and MariaDB, each choosing one explicit type named after what stores it (ADR 316 and ADR 322).
  - The merge queue dropped the SQLite pull request because auto-merge was turned on ten seconds after the push, and the queue tested the commit before it ([slice checklist](../calibration/dod.md#pr-side-items)).
  - It dropped it again on an integration test the slice never touched, which asserted an error message the slice had reworded; search `test/integration` for the old text of every changed message ([slice checklist](../calibration/dod.md#pr-side-items)).
  - The MySQL pull request failed CI's coverage check on a shared package that requires every branch covered, because coverage was run in the target packages only ([conditional checks](../calibration/dod.md#conditional)).
  - An earlier `Json` attempt was closed with a note that `Json` gets no convenience type, when only its default had been decided; the pull request comment and the ticket had to be corrected. See [F32](../calibration/failure-modes.md#f32-a-brief-restates-an-operator-ruling-in-its-own-words-and-the-restatement-is-stricter-than-the-ruling).
  - The MySQL pull request said it closed a ticket whose title also promised work on PostgreSQL and SQLite that it did not do, and the ticket closed. Before writing "Closes", read the ticket's title and done-criteria against the diff.
  - The MySQL slice was one pull request of about 117 files and took six review rounds, the later ones mostly on fixes to earlier ones.
  - Measuring both live servers before designing the MySQL codecs turned eight assumptions into decisions, among them that `IN` compares a decimal text as a floating-point number ([reference doc](../../docs/reference/mysql-mariadb-scalar-column-behaviour.md)).
  - Every review round and each of three manual QA runs on both servers found a defect the tests passed over, and a bot reviewer then found a regular expression that overflowed on an 8 MiB value.
- **2026-11-19 — MySQL proof of concept.** Prisma 8 has an early MySQL 8.4 target and a MariaDB 10.11 target that extends it, and every place the shared SQL code assumed Postgres is fixed or filed.
  - A finding recorded as "decided by test" had no slice that owned it, and turned out at close-out to be ordinary ORM writes that MySQL refuses. See [F57](../calibration/failure-modes.md#f57-a-row-in-a-projects-register-of-open-findings-is-marked-decided-by-a-test-and-no-slice-owns-it).
  - A rewrite of a write statement passed every test and deadlocked under concurrent writes. See [F58](../calibration/failure-modes.md#f58-a-rewrite-that-makes-a-write-statement-run-passes-every-single-connection-test-and-deadlocks-under-concurrent-writes).
  - An error message described the problem through our function names, and fourteen more had the same fault. See [F59](../calibration/failure-modes.md#f59-a-user-facing-message-describes-the-problem-through-our-function-names-or-internals).
  - A new check ran on a contract passed as a path and not on one passed as an object. A review of a new check lists every way input reaches it ([dispatch checklist](../calibration/dod.md#dispatch-dod-overlay-beyond-validation-gates)).
  - Four integration test files skipped themselves in CI for the whole project, because their job had no MySQL server. A test that skips without its server must fail in CI ([slice checklist](../calibration/dod.md#plan-side-items)).
  - Working notes were copied into package READMEs at close-out, with one-run timings and claims about other libraries. A permanent doc takes the reason, not the notes ([close-out rule](../project/README.md#close-out-moves-reasons-into-docs-not-notes)).
- **2026-11-17 — MongoDB prepared statements.** A MongoDB client can build a query once with `db.prepare` and run it many times with different values, each checked against the field's codec.
  - A review finding deleted a public type that the SQL family keeps, and the two families' interfaces drifted apart. See [F56](../calibration/failure-modes.md#f56-a-review-finding-removes-a-public-type-that-the-sibling-family-keeps-and-the-two-families-interfaces-drift-apart).
  - The first pull request merged with three open review threads, two of them real errors in the ADR; this was the second project with the same miss ([slice checklist](../calibration/dod.md#pr-side-items)).
  - The close-out first ran without this repository's own close-out rules, so the retro had nowhere to land and one pull request's threads went unchecked ([close-out rule](../project/README.md#close-out-runs-the-close-out-procedure)).
  - Checking the inherited design against the code before building found three errors, one of them a query that silently matched nothing ([slice checklist](../calibration/dor.md#plan-side-items)).
  - Manual QA that ran every documented sample found upgrade advice that was wrong. See [F46](../calibration/failure-modes.md#f46-advice-that-a-refusal-or-error-prints-is-checked-by-reading-it-and-following-it-loses-data-or-does-not-work).
- **2026-10-28 — Date and time convenience types.** PostgreSQL schemas can write `DateTime`, `Date`, `Time` and `Duration`, each meaning one explicit type, and `contract infer`, `contract print` and `prisma orm init` write them.
  - A merge of `main` that resolved 42 conflicted files went to the operator with no review round, and the round he asked for found twelve defects. See [F51](../calibration/failure-modes.md#f51-a-merge-of-main-that-resolves-a-large-overlapping-change-goes-to-review-as-if-it-were-not-new-work).
  - A release bump carried the branch's later edits into the released upgrade instructions. See [F52](../calibration/failure-modes.md#f52-a-release-bump-archives-pending-upgrade-instructions-and-the-branchs-later-edits-land-in-the-released-copy).
  - The merge queue dropped the pull request on a test fixture that still used `DateTime`'s old meaning. See [F53](../calibration/failure-modes.md#f53-a-name-changes-meaning-and-a-hand-written-source-that-fixturescheck-does-not-emit-keeps-the-old-meaning).
  - The merge queue dropped it again on a journey `main` had changed, because the checks before auto-merge were not run; this was the fourth project in a row ([slice checklist](../calibration/dod.md#pr-side-items)).
- **2026-10-27 — MongoDB authoring structure.** MongoDB contracts written in TypeScript, PSL or Prisma 6 build through one builder, so the same contract written two ways emits the same `contract.json`.
  - The close-out ran from the plan's short checklist instead of the close-out procedure, and skipped the retro, the DoD evidence and the file classification ([close-out rule](../project/README.md#close-out-runs-the-close-out-procedure)).
  - The first pull request merged with four open review threads, one of them a real ADR inconsistency ([slice checklist](../calibration/dod.md#pr-side-items)).
  - Both pull requests grew a client bundle, and the cause was traced only after CI's size report ([slice checklist](../calibration/dod.md#pr-side-items)).
  - Moving every rule into one builder missed two invariants the collection validator relied on and no rule enforced. See [F50](../calibration/failure-modes.md#f50-rules-are-moved-into-one-place-and-an-invariant-that-a-derived-artefact-relies-on-was-never-a-rule).
- **2026-10-21 — Complete client surfaces.** An application's client is one complete object, built from `contractFromJson<Contract>(json)` with every other option inferred.
  - A mechanical rewrite of README samples changed what one sample did, and only a bot reviewer caught it, three review rounds later ([review checklist](../calibration/dod.md#dispatch-dod-overlay-beyond-validation-gates)).
  - A branch built on an approved pull request conflicted in every shared file once that pull request was squash-merged. See [F47](../calibration/failure-modes.md#f47-a-stack-of-prs-outlives-its-bases-squash-merge-and-the-last-pr-cannot-pass-the-dco-check).
  - Nothing reported the previous slice's merge, so the next slice started hours late. See [F54](../calibration/failure-modes.md#f54-auto-merge-is-on-and-the-pr-never-enters-the-merge-queue).
- **2026-10-21 — Raw columns.** A column of any type the database has can be declared with ``Raw(sql`...`)``, created, verified and read, and a Prisma 7 schema with `Unsupported("...")` fields loads into Prisma 8.
  - The merge queue dropped this project's pull requests three times for checks that pull request CI does not run ([slice checklist](../calibration/dod.md#pr-side-items)).
  - A slice that waited on another project's unmerged change was planned first and built last, and another slice took seven merges of `main` before it shipped ([project rule](../project/README.md#pr-boundaries-under-mid-flight-scope-shifts)).
  - A reviewer checked out another commit in a worktree that other agents were using. See [F22](../calibration/failure-modes.md#f22-reviewer-runs-git-stash-to-debug-a-worktree-local-red-and-pops-an-unrelated-worktrees-stash-entry).
- **2026-10-21 — Data types own column types.** A column's type is read, compared and written through data types, and every value written in a schema is a typed value checked by one cast rule.
  - `main` merged a redesign of the same code while the last slice was being built, and the slice had to be ported after its review ([project rule](../project/README.md#pr-boundaries-under-mid-flight-scope-shifts)).
  - A message reworded by a concurrent merge broke one of the branch's integration tests in the merge queue ([slice checklist](../calibration/dod.md#pr-side-items)).
  - Two background watches on the merge queue failed every query silently and never reported an ejection. See [F54](../calibration/failure-modes.md#f54-auto-merge-is-on-and-the-pr-never-enters-the-merge-queue).
- **2026-10-15 — Collection scopes.** Packages can contribute collection methods computed from a model, which appear under `using`.
  - A design was approved, built and reviewed, then rejected, because an earlier ruling of the operator's never reached the handover ([slice checklist](../calibration/dor.md#plan-side-items)).
  - An order-only method typed as filtering would have let `deleteAll()` compile; a method's type now claims only what the method establishes ([ADR 272](../../docs/architecture%20docs/adrs/ADR%20272%20-%20Packages%20contribute%20collection%20methods%20computed%20from%20a%20model.md#a-contribution)).
  - A slice failed the merge queue three times on a test that only the queue runs ([slice checklist](../calibration/dod.md#pr-side-items)).
- **2026-10-07 — PSL find references.** The PSL language server finds references to a symbol.
  - A QA script under `projects/` failed CI's Lint job, because the root lint scripts check it too ([slice checklist](../calibration/dod.md#plan-side-items)).
- **2026-10-01 — Nullable scalar lists.** A scalar list field can be nullable, and the list's own nullability is separate from its elements' nullability.
  - After a rebase of shared contract changes, focused test runs missed failures in code the rebase changed. See [F14](../calibration/failure-modes.md#f14-dispatch-reports-validation-green-but-ci-is-red-dispatch-gates-didnt-mirror-ci).
  - An automatic conflict resolution produced a duplicate declaration that nobody reviewed. See [F51](../calibration/failure-modes.md#f51-a-merge-of-main-that-resolves-a-large-overlapping-change-goes-to-review-as-if-it-were-not-new-work).
- **2026-09-28 — Shared PSL value specifications.** PSL blocks describe their values with shared struct and map specifications, which replace the old block-value helpers.
  - The binder was redesigned several times because an interpretation the operator disputed was delegated before he confirmed it. See [F32](../calibration/failure-modes.md#f32-a-brief-restates-an-operator-ruling-in-its-own-words-and-the-restatement-is-stricter-than-the-ruling).
  - Checks after an authoring change missed the MongoDB extension, a package that consumes it ([slice checklist](../calibration/dod.md#plan-side-items)).
- **2026-09-24 — Prisma 7 detection in `orm init`.** `prisma orm init` detects a Prisma 7 schema and sets up the project from it.
  - A brief restated an operator ruling more strictly than he said it, and a round of questions was built on it. See [F32](../calibration/failure-modes.md#f32-a-brief-restates-an-operator-ruling-in-its-own-words-and-the-restatement-is-stricter-than-the-ruling).
  - A test fake returned a value the real prompt never returns. See [F33](../calibration/failure-modes.md#f33-a-test-double-returns-what-the-real-dependency-never-returns-so-the-test-covers-a-path-production-cannot-reach).
  - The feature merged while the published package it needs did not yet support it ([project rule](../project/README.md#status-update-cadence)).
  - Manual QA ran an old branch against packages built from a newer `main` ([QA rule](../qa/README.md#standard-pre-qa-gate)).
- **2026-09-23 — Remove `dbgenerated`.** Prisma 8 has no `dbgenerated(...)`: a raw SQL default is an `sql` tagged literal, and `contract infer` prints it that way.
  - A slice was built on a design the operator had not settled, and was withdrawn after review ([brief checklist](../calibration/dor.md#dispatch-dor-overlay)).
  - Deleting a syntax before regenerating a committed file that used it kept the fixtures check red for several steps. See [F30](../calibration/failure-modes.md#f30-a-syntax-deletion-lands-before-the-committed-generated-artefact-that-still-uses-it-is-regenerated).
  - A stale `dist` made a journey look broken on `main`. See [F31](../calibration/failure-modes.md#f31-a-stale-dist-in-a-worktree-makes-a-journey-fail-on-behaviour-the-branch-already-has).
- **2026-09-15 — Editor completions.** The PSL language server completes attribute names and required arguments in the editor.
  - Acceptance checked the language server's replies but not what the editor showed ([QA checklist](../calibration/dod.md#qa-side-items)).

## Mandatory-final-retro template

Per `drive-run-retro` § Step 8, the project-close retro covers the project as a whole. Template prompts:

1. **What went well?** Patterns worth keeping; calibrations that proved out; protocol points that earned their cost.
2. **What surprised us?** Things the protocol didn't predict; assumptions that turned out to be wrong; sizing that drifted.
3. **What lessons land where?** For each lesson: pick canonical / project-context / ADR per the preferences above.
4. **What deferred work surfaced?** Genuinely-deferred *scope* — slices/features pushed out of the project (typically tracked in `projects/<project>/deferred.md`) that should become Linear tickets vs items that should just be discarded.
5. **What's the ADR-worthy decision (if any)?** Not every project has one; many do. Write it as an ADR; the entry links it only when it holds a lesson.
6. **What did the project deliver, in one sentence?** That sentence opens the entry.

**An entry is short.** One sentence saying what the project delivered, then at most seven bullets of one sentence each. Each bullet states one thing that went wrong or right and links to where the lesson now lives (a failure mode, a checklist item, an ADR). The detail belongs there, not here. No narrative, no list of pull requests, no account of who asked what.

**A retro collects *process* findings, not code-review findings.** The retro is about how the work was *delivered* — protocol failures, calibration drift, surprises, reviewer/dispatch discipline. Code-review NITs (deferrable lint-level findings, "add a real-rollback test", "handle ENOENT more cleanly", redundant fields) are **not retro material**: they belong in the slice's `code-review.md`, the PR thread, or a follow-up Linear ticket, and they're dispositioned there. Do not enumerate them in the retro or treat "what deferred work surfaced?" (prompt 4) as a place to relist them — that prompt is for deferred *scope*, not for review nits.

## Retro-trigger frequency baselines

- Healthy team: ~1 retro per slice (on average), most fired as dispatch-failure or drift triggers.
- Mature team on a stable subsystem: < 1 retro per slice, fired mostly on surprise / scope-shift triggers.
- New domain / first project in a subsystem: 2-3 retros per slice, mostly on calibration surprises. Expected; the lessons are populating the project-context surfaces.

If retros stop firing for weeks: check whether (a) the team's actually triggering them when triggers hit OR (b) the project is genuinely going so smoothly that no triggers fire. The second is rare.
