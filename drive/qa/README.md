# drive/qa — project-context for manual QA

Loaded by `drive-qa-plan` and `drive-qa-run` when authoring manual-QA scripts and running them against this repo.

> **Trial period in effect (ends 2026-06-02).** When any drive-* skill in this category produces a finding, record it in [`findings.md`](./findings.md). Quality bar, tags, and format live in [`drive/trial.md`](../trial.md).

## Calibration

Manual QA reads:

- [`drive/calibration/patterns.md § Consumer audiences`](../calibration/patterns.md#consumer-audiences) — the two audience groups every script must consider (extension authors via `packages/3-extensions/`, end users via `examples/`)
- [`drive/calibration/failure-modes.md § QA coverage-gate gaps`](../calibration/failure-modes.md#qa-coverage-gate-gaps) — surfaces CI doesn't cover, that QA scripts should preferentially target
- [`drive/calibration/dod.md § Slice-DoD overlay (QA-side items)`](../calibration/dod.md#qa-side-items) — what manual QA needs to deliver as part of the slice DoD

## Substrate locations

| Surface | Where to find it |
|---|---|
| Demo (end-user happy path) | `pnpm demo` from repo root |
| Example apps | `examples/<app>/` — each has its own `README.md` describing what it demonstrates |
| Extension worked-examples | `packages/3-extensions/<extension>/` — each has its own tests describing the extension's contract |
| Upgrade-skills coverage gate | `pnpm check:upgrade-coverage` (relevant for any framework-breaking change) |
| Fixture suite | `pnpm fixtures:check` (relevant for any IR / emitter / serialiser change) |
| Standard test gates | `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e` (these are CI gates, not manual QA — listed here so scripts don't redundantly re-author them) |

## Standard pre-QA gate

A clean pre-QA tree means `pnpm typecheck && pnpm test:packages && pnpm fixtures:check` all green. QA against an unverified tree wastes the runner's time discovering broken assertions that a 1-minute `pnpm test:packages` would have surfaced.

When the QA project installs published builds made from `main` (for example a package's `dev` dist-tag), merge the current `origin/main` into the branch, rebuild every workspace package the run executes (`pnpm build`, or `pnpm --filter <package> build` for each one), and run the rebuilt binary, not one installed earlier. A branch that is behind `main`, run against packages built from a later `main`, fails in ways neither side fails alone. (Added 2026-09-24: a Prisma 7 schema check on a branch based on a week-old `main` refused `@default(false)`, because the branch's CLI lacked a lookup the `dev` target package expected. The same run on the merged branch passed.)

## Sample coherence, not just placement, for content-preamble dispatches

Symptom seen during the drive trial (project `orchestrator-role`): a dispatch added a uniform delegated-execution preamble across 19 atomic skills. Manual-QA dry-run sampled preamble placement (right line, right format, cross-link resolves) — found nothing wrong. Reviewer (CodeRabbit) then surfaced three "critical" findings on stop-condition coherence: the preamble's "STOP. Dispatch on Read/Grep/Glob" rule contradicted skill bodies whose Step 2 explicitly required Read/Grep/Glob investigation as the default first step.

Rule: when manual-QA covers a preamble / boilerplate insertion across many files, sample **both**:

1. **Placement** — preamble at the right line, right format, cross-links resolve. (What a sweep-style audit catches.)
2. **Coherence** — preamble's operational rules agree with each file's body. A 2-3 file deep-read pass: do the preamble's stop-conditions, output descriptions, and constraint enumeration align with each body's Step N operational requirements? Sample disjoint files (not the first three by alphabetical order) to surface boilerplate-vs-body mismatch.

Placement-only sampling is a leading indicator of "did the dispatch land mechanically"; coherence sampling is a leading indicator of "did the dispatch produce semantically correct output". Both gates matter for content insertions across many files.

## Where QA artefacts live

- **In-project slices** (project under `projects/<x>/`): `projects/<x>/manual-qa.md` (script) + `projects/<x>/manual-qa-reports/<YYYY-MM-DD>-<runner>.md` (one per run).
- **Orphan slices**: inline in the PR description (script under `## Manual QA` heading; findings as a review-comment thread).
- **Artefacts referenced by findings**: `projects/<x>/manual-qa-reports/artefacts/F-<N>/`.

Both `drive-qa-plan` and `drive-qa-run` enforce these locations.

## When to mark "N/A"

A slice may legitimately mark "Manual QA: N/A" when:

- The change is internal-refactor with no user-observable surface (no new envelope copy, no new CLI surface, no new error path, no new extension contract).
- The change is doc-only (a README rewrite, an ADR addition).
- The change is purely infrastructural (a CI workflow tweak, a build-config change) that has no consumer-visible behaviour.

The slice's DoD records the N/A with a one-line rationale; the project DoD's QA-coverage check confirms the rationale is honest. An "internal refactor" that turns out to have changed a user-visible error message is the failure mode this check exists to catch.

## When this file changes

Append when a new substrate location emerges (a new place QA scripts repeatedly need to touch), a new artefact-storage convention is needed, or a new "N/A" rationale becomes common enough to enumerate. For new consumer audiences, new coverage-gate gaps, or new QA-side DoD items: edit the matching file under [`drive/calibration/`](../calibration/) — never duplicate calibration here.
