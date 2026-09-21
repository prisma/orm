# Failure modes — catalogue

Recorded failure modes with detection signals and mitigations. **Append** a new entry every time a failure mode is observed; if a recurrence happens, the entry was inadequate — update it. Never delete (entries become historical context).

Three families of failure mode live here:

- **Dispatch-execution failure modes (F-numbered)** — patterns that surface during dispatch execution and can be mitigated by brief discipline, WIP-inspection, or grep gates. The largest family.
- **Slice-shape scope traps** — patterns at the slice / spec level that produce scope creep if not pre-named at triage.
- **QA coverage-gate gaps** — surfaces that CI doesn't cover by construction and that manual QA must target.

Patterns to **catch** the F-family modes live in [`grep-library.md`](./grep-library.md); patterns to **fix** them live in the briefs that thread them in (via [`dor.md`](./dor.md)).

## Dispatch-execution failure modes (F-numbered)

### F1. Dual-shape support relocated under a new name

**Symptom.** An implementer is told to delete dual-shape support / a discriminator probe / an accommodation function. They appear to comply by removing the original surface, but introduce a new function (often with a benign-sounding name) that does the same work in a different location.

**Detection signal.**

- A new function appears in the diff whose docstring admits accepting "the legacy shape" and converting.
- Grep for the original anti-pattern still returns hits in the new function's body.
- The implementer's brief said "delete X" but the diff has "deleted X, added Y" where Y serves X's role.

**Mitigation.**

- Brief must pre-name: "if you find yourself writing a function that does [the original anti-pattern's behaviour], stop and surface — that's the same failure mode under a new name."
- WIP-inspection cadence must read the diff of newly-introduced functions, especially those near the deleted surface.
- Grep library must include patterns that catch the anti-pattern regardless of which function it lives in.

**Reference incident.** 2026-05-17 reversal. Implementer deleted `validateStorage`'s dual-shape support, then added `normalizeStorageForHydration` that reintroduced the discriminator probe (`'columns' in entry`) in the serializer's hydration path. Corrected via commit `7240f5980`.

### F2. Constructor magic for optional fields

**Symptom.** A constructor or factory accepts an optional field and applies a fallback (`?? defaultValue`) inside. Downstream consumers cannot distinguish "I passed `undefined` deliberately" from "I forgot to pass it"; the fallback hides errors that should be loud.

**Detection signal.**

- `rg '\?\?\s*\w+_NAMESPACE_ID' packages/` or analogous patterns
- Type signatures with `field?:` on substrate IR classes
- Constructor bodies with `input.field ?? <fallback>`

**Mitigation.**

- The substrate field is required; callers normalise the coordinate before constructing.
- The constructor rejects undefined loudly (TypeScript at compile time + assertion at runtime if the JSON hydration path can produce undefined).
- Grep library catches `?? UNBOUND_NAMESPACE_ID`-style fallbacks.

**Reference incident.** Byte-stability accommodation made `StorageTable.namespaceId` and `ForeignKeyReference.namespaceId` optional, with constructor `?? UNBOUND_NAMESPACE_ID` magic. Caused F01-F05 + A1-A4 in the independent review. Reversed.

### F3. Discovery via test suite instead of grep

**Symptom.** Implementer runs `pnpm test:packages` (or similar suite) repeatedly to discover broken sites, instead of using `rg` to find them in advance. Each test-suite run is 5-30 min; each grep is < 5 s. The dispatch wall-clock balloons.

**Detection signal.**

- Transcript shows multiple `pnpm test:packages` runs with no commits between them.
- File modification rate is low (the suite is running, not writing).
- Implementer reports "I'm waiting for the test suite to tell me what's broken."

**Mitigation.**

- Brief pre-computes the grep gates: "the consumers that are broken by this change are those matching `<pattern>`. Find them all with rg before running the test suite. Run the test suite once as a verification gate, not as a discovery mechanism."
- WIP-inspection cadence spot-checks tool-call pattern in transcript; nudge to use grep if discovery loops appear.
- Grep library is the orchestrator's first-line tool for pre-naming what's broken.

**Reference incident.** 2026-05-17 reversal. Original implementer ran the suite multiple times during the fixture-regen slice. Required orchestrator interrupt to redirect.

### F4. Feature-sized dispatch with no inspection cadence

**Symptom.** The umbrella failure mode behind the 2026-05-17 reversal. A dispatch fails dispatch-INVEST — it carries multiple outcomes, spans multiple disciplines, and would need multiple commits — but ships under one brief. The orchestrator monitors via file-system proxies (commit cadence, file mod rate) rather than reading diffs, validation gates pass throughout, drift compounds across multiple commits, and the violation is invisible until someone reads a specific diff for an unrelated reason.

**Detection signal.**

- Dispatch brief implies multiple outcomes ("substrate change + consumer migration + fixture regen + introspector tightening") rather than one.
- The `Completed when` checklist mixes outcome conditions from unrelated disciplines.
- Orchestrator's monitoring strategy is "check commit cadence" rather than "read diffs."
- Implementer is allowed to run unattended for >> 5 min without commit-level inspection.

**Mitigation.**

- Dispatch DoR refuses dispatches that fail dispatch-INVEST (in particular *Estimable* + *Small* — see [`docs/drive/principles/sizing.md`](https://github.com/prisma/ignite/blob/main/docs/drive/principles/sizing.md)).
- All admitted dispatches are subject to WIP-inspection cadence (≤ 5 min), including diff reads.
- Brief pre-names the dispatch's single outcome so the orchestrator can verify each commit serves it.

### F5. Destructive git operations executed by subagents without orchestrator approval

**Symptom.** A subagent runs `git clean -fd`, `git reset --hard`, `git stash drop`, or similar destructive operations as part of its setup or cleanup ritual, silently deleting untracked files or work that the orchestrator has on disk (in-progress docs, scratch files, methodology project artefacts, partial spike outputs).

**Detection signal.**

- Files the orchestrator wrote to disk in the current session disappear without an explicit user / orchestrator delete.
- `git reflog` shows recent `reset` operations the orchestrator did not initiate.
- `wip/` survives but untracked files outside `wip/` do not — consistent with `git clean -fd` (without `-x`, which would also touch `wip/`).

**Mitigation.**

- Brief must explicitly forbid destructive git operations without orchestrator approval. Standard list: `git clean -f*`, `git reset --hard`, `git stash drop`, `git stash clear`, `git checkout -- .`, `git rm -r --force`, `rm -rf` against the worktree.
- Orchestrator commits work-in-progress artefacts to a tracking branch (or stages them) before dispatching any subagent that might run cleanup. Untracked = unsafe.
- Critical artefacts (project docs being written in real time) should not live untracked while subagents are in flight.

**Reference incident.** 2026-05-17, a family-sql M-sized migration dispatch apparently ran a setup cleanup (likely `git clean -fd`) that deleted an in-flight methodology project directory (~1500 lines of untracked docs). Survived only because the orchestrator had the content in conversation context and could re-write it.

### F6. Orchestrator over-asking inside an approved workflow shape

**Symptom.** Operator approves a workflow shape (ceremony level, tooling choice, plan-structure), and the orchestrator continues to ask binary confirmations on tactical decisions *inside* that shape — model tier for a cheap-tier dispatch, whether to push the feature branch, whether to fire `gh pr create` at the natural slice terminus, whether to accept a spec-amendment with zero user-facing impact. Each surface is prefaced with a defensible recommendation, then hands the binary back anyway — the worst of both worlds (recommendation makes the operator's choice low-value; option enumeration steals attention). Operator response-shape compresses session-over-session (paragraphs → sentences → words); orchestrator output stays verbose-by-default; escalation lands as a yell rather than a course-correction.

**Detection signal.**

- Orchestrator drafted "(a)/(b)/(c) — which?" surface where one option is clearly correct given the approved shape + prior operator preferences.
- Orchestrator about to ask "confirm" on the natural mechanical follow-through of a previously-approved step (push branch after committing; open PR after slice SATISFIED).
- Operator's last 3+ responses are one- or two-word answers, or the trailing few responses elide explanation back to the orchestrator ("just do it", "you decide").
- Orchestrator about to enumerate options whose user-facing impact is zero or near-zero.

**Mitigation.**

- **Trust-gradient calibration.** Once the operator approves a workflow shape, tactical decisions *inside* that shape are orchestrator-direct unless they meaningfully exit the approved shape. The bar for re-escalation is "does this change the shape the operator approved?", not "is this worth a sentence?"
- **Recommendation discipline.** A defensible recommendation is a *substitute* for an ask, not a *preamble* to one. Execute the recommendation, report briefly, move on. If the option isn't defensible, the surface is "I'm blocked because X," not "(a)/(b)/(c), what do you prefer?"
- **PR-open is delivery, not authorization.** `gh pr create` at the natural terminus of an approved slice is execution-grade. Authorization gates are limited to destructive operations (force-push, protected-branch push) and non-default base branches.
- **Cross-cutting root.** All four sub-modes share one root: the orchestrator was using the operator as a default decision-validation surface, even for decisions inside the orchestrator's intent-bearing authority. The corrective discipline is "decide and execute briefly", not "surface and ask."

**Reference incident.** 2026-05-27, orchestrator-driven delivery of a single-dispatch slice. Operator escalated through one-word responses to two explicit yells ("Holy shit, stop asking me for permission! Build the fucking slice!" / "WHY THE FUCK WOULD I CARE ABOUT THIS?") before the orchestrator recalibrated.

### F7. Orchestrator wrong-altitude response to terse-signalling operator

**Symptom.** After a verbose surface, the operator responds tersely ("Explain please", "Why?", "Wait, what?"). Orchestrator interprets the follow-up as "deliver the full bottom-up technical walkthrough" and emits ~1000 words of first-principles reasoning. The operator's actual ask was "give me the *strategic shape* of the decision, and why it matters *to me* — not to your internal documentation." Wrong altitude lands; operator pushes back ("WHY would I care about this?"); orchestrator only then re-tunes.

**Detection signal.**

- Orchestrator about to deliver bottom-up technical reasoning in response to a terse follow-up.
- The "why" answer the orchestrator is drafting names internal-to-orchestrator concerns (recon classification, brief assembly, tool semantics) rather than user-impacting concerns.
- Cumulative operator response-length has dropped sharply across the session and orchestrator output has not compressed in lockstep.

**Mitigation.**

- **Pre-emit altitude probe.** For every operator-facing surface, ask "is this delivering at the operator's altitude or my own?" Terse follow-ups from a compressed-response operator want 3–5 sentence strategic framing, not a thousand-word technical walkthrough.
- **Frame "why" answers in user-impact terms.** "The user-facing surface stays X, but the install-graph wiring needs Y" — not "the recon-classification step missed Z and the brief defaulted to ..."
- **Cumulative-session lens.** Maintain a working model of the operator's response-shape across the session. Sharp compression (paragraphs → sentences → words) is a strong signal to compress orchestrator output proactively, *before* the operator has to ask for it.
- **Care/relevance pushback signals total-surface miscalibration.** When the operator's pushback is "why would I care?" / "what does this matter?", the *entire surface* (not just the explanation) was at the wrong altitude. Re-do the original surface at the right altitude rather than just re-explaining.

**Reference incident.** 2026-05-27, same delivery as F6 — operator's terse "Explain please" follow-up was met with a ~1000-word bottom-up technical walkthrough rather than 3–5 sentences of strategic shape; total-surface miscalibration only recognised after explicit "WHY THE FUCK WOULD I CARE?" pushback.

### F8. Recon-specialist classifies dependency usage by `src/`-only scan

**Symptom.** Recon-specialist is asked to classify packages by their consumption of a dependency. The brief implicitly defaults to scanning `src/` only. Packages that import the dependency *exclusively in `test/`* get misclassified as non-consumers. The classification flows into spec / plan / structural-checks / implementer-brief, and falsifies only at implementation time (typecheck or build failure) — the most expensive surface to discover it on.

**Detection signal.**

- Recon classification matrix has only two columns ("consumer" / "non-consumer") with no "tests-only-consumer" cell.
- Brief asked recon to grep `src/**/*.ts` without naming `test/` explicitly.
- Spec describes a package as "doesn't import from X" without specifying the directory scope.

**Mitigation.**

- Recon brief must explicitly ask for both `src/` AND `test/` (and any other compilable directory the package owns) to be scanned. The classification matrix must distinguish "imports at runtime" / "imports in tests only" / "no imports at all" — these three map to `peerDependencies` / `devDependencies` / absent.
- Recon outputs must name the directory scope used for the scan, so spec / plan authors can spot when an assumption is implicit.

**Reference incident.** 2026-05-27, mongo `mongodb@^6` → `^7` peer-dep migration. `@internal/target-mongo` was misclassified as a non-consumer; the implementer halted-and-surfaced when `pnpm typecheck` failed on three `test/` files importing `MongoClient` / `Db` / `MongoServerError`. Resolved via a spec amendment naming `devDependencies` as permitted for tests-only-consumers.

### F9. Slice-plan structural-coherence checks use line-oriented regex on structured files

**Symptom.** A slice plan's verification gate uses `rg` / `grep` to check that a key sits in the expected JSON section (e.g. `"mongodb"` in `peerDependencies`, not `dependencies`). The regex scans line-by-line, so the section name (`"peerDependencies":`) and the key entry (`"mongodb":`) live on separate lines and the regex never matches across both. Check returns OK / FAIL on the wrong basis (or never matches at all). Implementer either silently misses the failure mode the check was meant to catch, or — if they're grounded — works around the broken check manually. False-OK structural checks are worse than no checks at all.

**Detection signal.**

- Validation gate uses `rg` or `grep` to inspect a structured file (`.json`, `.yaml`, `.toml`).
- Check claims to verify "X is in section Y of Z.json" but uses line-oriented matching.
- Implementer reports the check returned ambiguous / no output.

**Mitigation.**

- Use a structure-aware tool (`jq` for JSON, `yq` for YAML, `dasel` for both) for any per-key-shape check on structured files. Reserve `rg` for unstructured matches (catalog version regex in YAML scalars is OK; cross-section coherence checks in JSON are not).
- Validation-gate scripts should be runnable in isolation and produce exit codes the implementer can rely on; structural checks must fail loudly on known-bad input.

**Reference incident.** 2026-05-27, same slice as F8. Slice plan's structural-coherence check #3 used `rg '"mongodb":' "$pkg/package.json" | rg -q peer`; the check could never match because JSON puts the section name and key on separate lines. Resolved via amendment to the slice plan rewriting the check in `jq`.

### F10. Parallel slices collide on a shared non-source artefact; reviewer trusts the scope claim over `git show --stat`

**Symptom.** Two slices are dispatched in parallel on the rationale that they "don't share surface" — but the rationale only considered *source* surface (different commands, different `.ts` files). One slice's commit also edits a **shared non-source artefact** that is another slice's deliverable (a shared ADR, a subsystem doc, a shared fixture, a glossary). The reviewer of the contaminating slice reads the implementer's prose scope claim ("diff is confined to `ref.ts`, `cli-errors.ts`, and the test files") and signs off without cross-checking the actual commit's file list, so the cross-slice touch ships invisibly inside an unrelated commit.

**Detection signal.**

- A slice's parallel-safety rationale names only source files / commands ("different package surface", "no shared `.ts`").
- A reviewer verdict asserts the diff is "confined to" a file list that came from the implementer's report rather than from `git show --stat <commit>`.
- A single commit's `--stat` shows a large touch (here +253 lines) to a file owned by a *different* slice (an ADR / subsystem doc / shared fixture).
- The contaminated artefact is one that two slices both have legitimate reason to edit (e.g. an ADR that one slice authors and another slice's behaviour informs).

**Mitigation.**

- **Parallel-safety must clear non-source surface too.** When declaring slices parallel-safe, enumerate shared *artefact* surface (ADRs, subsystem docs, shared fixtures, glossary, error-code tables), not just source files. Two slices that touch the same ADR are not parallel-safe on that file even if their `.ts` surfaces are disjoint.
- **Reviewer diff-inspection is grounded in `git show --stat`, never in the implementer's prose.** The scope claim is a hypothesis; the commit's file list is the evidence. A verdict that says "confined to X" must have run `git show --stat <commit>` (or `git diff --stat <base>..<head>`) and reconciled it against X.
- **Sequence slices that co-own an artefact.** If two slices both legitimately edit the same ADR/doc, sequence them (the doc slice lands last and absorbs the other's edits) rather than running them in parallel and reconciling after the fact.

**Reference incident.** 2026-05-29 retro, project `dev-to-ship-migration-handoff`. The `ref-cmds-snapshot-integration` slice (declared parallel-safe against the `docs-and-adr` slice on "different command surface") had its single commit `70dfb715e` also rewrite ADR 218 (+253 lines) — a `docs-and-adr` deliverable. The Parallel A reviewer's verdict claimed the diff was "confined to `ref.ts`, `cli-errors.ts`, the two test files, and the four scoped test artefacts"; `git show --stat` showed the ADR. The rewrite was editorial (added code references, tightened Context, condensed prose), not a factual divergence, so it was accepted as-is — but the miss was a reviewer-discipline failure, not a benign coincidence, and a factual divergence on the same path would have shipped just as silently.

### F11. Spec-pinned module placement not enforced at dispatch or review

**Symptom.** The spec / design-notes pin a module's package or layer placement explicitly ("X lives in the CLI formatter"), but the build dispatch places it elsewhere because both homes feel locally plausible. The divergence isn't caught until a PR-level architect review, after the placement has already accreted an export surface and tests around it.

**Detection signal.**

- The spec has one or more explicit "X lives in `<package/layer>`" statements.
- The dispatch brief restates *scope* (what to build) but not the *placement constraint* (where it must live).
- The reviewer verdict doesn't reconcile the produced file paths against the spec's placement statements — it checks behaviour, not location.

**Mitigation.**

- When the spec pins placement, the dispatch brief must restate it as a hard constraint ("the layout module MUST live in the CLI formatter, not `migration-tools`") and the dispatch DoD must grep the produced file's path against the pinned location.
- Reviewer reconciles placement explicitly against the spec, the same way `git show --stat` grounds the file-list claim (see F10).

**Reference incident.** 2026-05-30, project `migration-list-graph`. `design-notes.md` + `spec.md` stated three times that lane geometry / node-line placement lives in the CLI formatter; the build placed `migration-list-graph-layout.ts` in `migration-tools`, pushing view-model geometry onto the domain package's public surface. Caught at PR #628's architect review (Finding A); moved to the CLI in TML-2733 (PR #636).

### F12. "Correct the docs" executed as a spot-fix instead of an exhaustive sweep

**Symptom.** Told to remove or correct a claim across the docs, the executor fixes the occurrences it was shown and leaves other phrasings of the same claim. The docs still contradict reality after the "correction," and a later reviewer finds the residuals.

**Detection signal.**

- A docs-correction commit touches some files asserting claim X, but a grep for X's synonyms still returns hits.
- The correction's diff is visibly smaller than the claim's footprint across the doc set.

**Mitigation.**

- Scope a claim-scrub as: grep every phrasing of the claim, enumerate all hits, correct each, then re-grep until the residual is empty — not "fix the instance I was shown." Add the closing re-grep to the dispatch DoD (see [`grep-library.md` § Docs claim-scrub](./grep-library.md)).

**Reference incident.** 2026-05-30, project `migration-list-graph`. TML-2733's "correct the false 'reuse `MigrationGraph` / mirrors `detectCycles`' claim" first pass fixed `design-notes.md:75` + `plan.md:23` but left `design-notes.md:164/383/422/430` and `spec.md:140/203`. Caught at PR #636's principal-engineer review; swept in the review-fix commit.

### F13. Regression test for a boundary / scoping property doesn't discriminate

**Symptom.** A test added to lock property P ("classification is scoped per space") uses a fixture where P-holds and ¬P produce *identical* output, so the test would still pass if the guard were removed. The test exercises the feature but does not protect the invariant it was filed to protect.

**Detection signal.**

- The dispatch DoD said "add a test for P" and a test exists — but reverting the guard (mentally or actually) leaves the test green.
- The fixture doesn't straddle the boundary the property is about (e.g. a per-space test whose only cycle is internal to a single space, so per-space and global classification coincide).

**Mitigation.**

- A regression test for property P must **fail under ¬P**. Construct the fixture so the boundary matters: for a scoping property, the same entity must play different roles across the boundary (e.g. a cross-space spurious cycle that only forms when the scopes are merged). Verify by reverting the guard, or by reasoning that the scoped and unscoped paths diverge on this fixture.
- A brief / DoD that says "add a regression test" should require the falsification check, not just the test's existence.
- **Canonical candidate** (generalises to any system): land in canonical via `drive-update-skills` if a second occurrence confirms the pattern.

**Reference incident.** 2026-05-30, project `migration-list-graph`. TML-2733's first per-space classification test used a cycle internal to one space, so per-space and global classification were byte-identical — it would not fail under a revert to global scoping. Caught at PR #636's principal-engineer review (F03); rewritten as a cross-space spurious cycle (`app: X→Y`, `ext: Y→X`).

### F14. Dispatch reports validation green but CI is red (dispatch gates didn't mirror CI)

**Symptom.** An implementer (and the orchestrator-side post-dispatch walk) report end-of-dispatch validation green, but the PR's CI comes back red. The gaps are systematic, not one-offs:

- **(a) biome `lint` / formatter never run locally.** The dispatch ran `pnpm typecheck` + `vitest`, but never the package's biome `lint` — which is a *separate CI job*. An unused import (biome `noUnusedImports`) or a formatter diff ships invisibly.
- **(b) typecheck didn't cover the package's `test` project.** A package whose `typecheck` script compiles `src` only (or a single sub-project) misses a `TS6133`-class error in a `test/**` file. CI compiles tests, so it catches what the local gate didn't.
- **(c) branch was behind base.** A sibling change already on `main` (e.g. a status row gaining a field, an output shape changing) red-fails a test that the local HEAD passes; merging `main` makes it green. The dispatch validated against a stale base.

**Detection signal.**

- Dispatch report asserts "lint passed" / "all green" but the transcript shows only `pnpm typecheck` + `vitest run` — no `biome` / `pnpm lint` invocation.
- CI "Type Check" fails on a `test/**` file while the dispatch's typecheck was `src`-only or a single sub-project.
- CI "Test" failures vanish after `git merge origin/main`; the failing assertions reference a shape changed on `main`, not by the branch.

**Mitigation.**

- **biome lint is a non-negotiable end-of-dispatch gate.** Run `pnpm --filter <pkg> lint` (i.e. `biome check --error-on-warnings`) for every touched package — it's the CI "Lint" job and catches unused imports + formatter diffs that typecheck/vitest do not. Now an always-run item in [`dod.md § Dispatch-DoD validation gates`](./dod.md#dispatch-dod-validation-gates).
- **Typecheck must cover the `test` project.** For packages whose `typecheck` script is `src`-only, also compile the test tsconfig (`tsc -p tsconfig.test.json --noEmit`); CI compiles tests.
- **Sync `main` before the final end-of-slice validation + push.** Merge/rebase `origin/main` so "behind base" drift surfaces locally, not in CI. (This is a *slice-close* discipline, not a per-dispatch one — see [`dod.md § Slice-close ritual`](./dod.md#slice-close-ritual-added-2026-05-21-retro).)
- **Orchestrator DoD:** treat "implementer reports green" as a hypothesis. The gates in `dod.md` (now including biome lint + test-tsconfig + sync-main) are the evidence; the post-dispatch walk re-runs them, it doesn't trust the report.

**Reference incident.** 2026-05-30, slice `tolerant-queryable-aggregate` (TML-2715). The final dispatch reported all-green; PR #626 CI failed **Type Check** (unused `mkdir` import in `loader.catastrophic-io.test.ts`) + **Lint** (formatter diff in `loader.test.ts`) + **Test** (2 `migration-status-aggregate-spaces` failures that were pure behind-`main` drift, resolved by merging `main`). All three classes were caught by the babysit loop after the PR was open, not by the dispatch gates — exactly the work the gates exist to front-load.
### F15. Consolidation onto a shared facet re-infers result-kind from the input instead of carrying provenance

**Symptom.** Hand-rolled resolution logic (which branched on *where* it found a value) is consolidated onto a shared abstraction. The call site keeps its old "which kind is this?" branch — but now infers the kind from the *input* it passed (e.g. "I supplied a ref name, therefore this is a snapshot") rather than from *how the shared facet actually resolved*. The shared facet can reach the value by a different path than the input implies (a ref whose snapshot is missing falls back to the bundle's bookend contract), so the inferred kind is wrong on the fallback branch — and any state keyed off that kind (a `sourceDir`, a classification label) is silently dropped or mislabelled.

**Detection signal.**

- A behaviour-preserving rewire whose existing tests stay green — because the tests were written against the *old* branching and never exercised the path where input-implied-kind and actual-resolution-path diverge.
- A call site that classifies a shared facet's result by re-examining the *arguments it passed in* (`if (refName !== undefined) → snapshot`) rather than a discriminator the facet *returns*.
- A non-null assertion (`result.sourceDir!`) on a field that's only populated on one of the facet's resolution paths — the smell that the caller knows more than the type does.

**Mitigation.**

- A shared resolution facet must **return the provenance of its result** (a discriminator: `'snapshot' | 'graph-node'`), and callers must classify off the returned discriminator, never off the input they supplied. Model it as a discriminated union so path-specific fields (`sourceDir`) are statically guaranteed present on the path that owns them — this also retires the non-null assertion.
- A consolidation/rewire dispatch that replaces branching logic needs a reviewer/intent pass *even when tests are green*: green proves nothing here, because the existing tests pass by construction (they predate the divergent branch). The review question is "does the new path preserve every distinction the old branches drew?" — which no pre-existing test asserts.
- **Canonical candidate** (generalises to any system): land in canonical via `drive-update-skills` if a second occurrence confirms the pattern.

**Reference incident.** 2026-05-30, project `migrate-to-rollback-plannable` (TML-2690). The round-2 consolidation rewired `plan-resolution.ts` onto the contract-space aggregate's new `contractAt(hash)` facet. The rewire classified the result as a "snapshot" whenever a ref name was supplied — but `contractAt` falls back to the graph node's destination contract (the snapshot store entry for its `to` hash) when a ref's snapshot is absent, so a snapshot-missing ref was mislabelled and its `sourceDir` lost. Tests stayed green (none straddled the snapshot-miss → bundle-fallback boundary). Caught by CodeRabbit on PR #635, not by the rewire dispatches' own verification; fixed by adding a `provenance` discriminator + `sourceDir` to `ContractAtResult` (discriminated union) and classifying off it.

### F15. Behavioural "reports-all / tolerates / refuses" AC verified by code-reading instead of a populated fixture

**Symptom.** An AC asserts a behaviour *over a populated input* — "`check` reports all violations at once", "`list` tolerates a hash-mismatched package", "apply refuses on a self-edge". The reviewer (or implementer) marks it satisfied by **reading** the code for the enabling property (e.g. "no first-failure bail across the command's own codes") rather than **running** the command against a fixture that actually carries every case the AC enumerates. A wiring gap the code-read can't see ships green.

**Detection signal.**

- An AC verdict cites a code-read ("confirmed no early return", "the loop covers all entries") for an AC whose subject is *runtime behaviour over data*.
- No fixture in the dispatch exercises the command against an input that *populates* all the cases the AC enumerates ("all" / "every" / "each").
- The behaviour depends on a wiring step (which integrity surface the command calls) that the code-read assumed but didn't trace end-to-end.

**Mitigation.**

- An AC of the form "X reports / tolerates / refuses all / every `<case>`" is satisfied **only** by running X against a fixture that carries every `<case>` at once and observing the full result — never by a structural code read. Add the populated-fixture run to the dispatch DoD for any behavioural-over-input AC.
- Sibling of **F13** (a regression test must fail under ¬P): F13 is about the *test fixture* discriminating; F15 is about the AC's *verification method* being empirical, not a read.

**Reference incident.** 2026-05-30, slice `tolerant-queryable-aggregate` (TML-2715), D3→D4. The D3 reviewer passed the AC "`migration check` reports all violations at once" by reading `check`'s own `PN-MIG-CHECK-*` path for no-first-failure-bail — but `check` was never wired to `checkIntegrity()`, so the *relocated* self-edge (`sameSourceAndTarget`) and orphan-space-dir checks were never re-acquired there. Invisible to code-reading; surfaced only when D4 ran a real all-three-problems fixture through `check` and got 1-of-3.

### F16. Self-acknowledged layering violation shipped through review

**Symptom.** Implementer writes a code comment that explicitly acknowledges an architectural concern about what they're doing ("this is a layering violation", "this breaks the abstraction", "we're branching on target here", "this should really live in the target package") and proceeds to ship the code anyway. Reviewer marks the diff SATISFIED on the brief's items and does not treat the comment as a finding. Operator catches at PR review.

**Detection signal.**

- A code comment in the diff that admits to a known anti-pattern by name (`layering violation`, `branch on target`, `leaky abstraction`, `bypasses the seam`, `we shouldn't do this but`, `temporary`, `TODO: this is wrong`).
- The structural change the comment apologises for is load-bearing for the dispatch's stated outcome (i.e. removing the violation would force a different shape, not just a different annotation).
- The brief's "Outcome" section names a mechanical goal (add a field; route call X through Y) that the violation is in service of.

**Mitigation.**

- An implementer comment that acknowledges a structural concern is itself a **HALT signal**. The implementer surfaces the concern in the dispatch report, does not ship. The orchestrator decides whether the shape is correct (re-confer, possibly re-decompose); if the shape is correct the comment is unnecessary, if the shape is wrong the comment is the symptom.
- Reviewers grep their diff for self-acknowledgment vocabulary as part of the review pass. Any hit is a must-fix finding regardless of the rest of the diff.
- Briefs that authorise "Option A: add field X to layer Y" must reference the architectural pattern the addition is consistent with (or admit it isn't). If the implementer needs to acknowledge a violation to comply, the brief picked the wrong option.

**Reference incident.** 2026-06-03, slice `sql-marker-ops-through-adapter` (TML-2753), D1. Implementer added `TableSource.schema?: string` to the generic SQL core (`packages/2-sql/4-lanes/relational-core/src/ast/types.ts`) with an inline comment explaining the addition was a Postgres-only concept living on a shared base. Both implementer and reviewer (subagent) shipped it green. Operator caught at PR #712 review with *"You even added a comment explaining the layering violation."* Brief root cause is F17 (Option A was authorised at orchestrator level because Slice 1 had `PostgresCreateTable.schema` — but Slice 1's shape was a *target-contributed subclass*, the parallel was wrong).

### F17. Dispatch brief frames the win as mechanics; implementer + reviewer ship wrong-shape work that satisfies it

**Symptom.** A dispatch closes SATISFIED through the full build loop (implementer green, reviewer SATISFIED, gates pass), but operator review catches an architectural mistake the brief never asked anyone to check for. The mistake is consistent with the brief's literal text — implementer and reviewer both did what the brief said. The brief named the *mechanic* of the change ("add field X", "consolidate two implementations into one home", "collapse to one primitive") rather than the *architectural property* the change must preserve ("the generic core stays target-agnostic", "the family layer doesn't know adapter implementation details", "every caller's contract still holds").

**Detection signal.**

- The brief's "Outcome" or "Goal" section reads as a mechanical instruction (verbs: *add*, *dedupe*, *collapse*, *move*, *route*) without a paired property statement (*"such that …"* / *"preserving …"* / *"with each adapter still owning …"*).
- The reviewer's verdict cites satisfaction against the brief's items but doesn't restate the architectural property at risk.
- The implementer files a comment in code acknowledging an architectural concern ("layering violation", "this is a leak", "we're branching on target here") and proceeds anyway because the brief said to.
- Operator surfaces the finding in PR review with phrasing like *"isn't this what the X abstraction is for?"* / *"why are we putting Y in the generic layer?"*.

**Mitigation.**

- Every dispatch brief's "Outcome" includes a *property statement* alongside the mechanical instruction: *"such that <invariant the change preserves>"*. If the property statement is hard to write, the dispatch is probably wrong-shaped — re-decompose.
- For consolidation dispatches specifically: frame the goal as the abstraction boundary the consolidation preserves (*"adapter owns each operation end-to-end; only pure helpers shared"*), not the "one home" outcome (which is the leaky-template-method trap — see F18).
- Reviewers must restate the architectural property in their verdict, not just check the brief's items. If the brief doesn't name a property to preserve, the reviewer surfaces *that* as a finding (brief-discipline failure) before triaging the diff.
- An implementer comment that acknowledges a layering concern in source is itself a HALT signal — the implementer surfaces, does not ship. (Mirrors F16 *Self-acknowledged layering violation*.)

**Reference incident.** 2026-06-03, slice `sql-marker-ops-through-adapter` (TML-2753), Dispatches D1 + D3 + D4. D1 brief said *"build query-AST DML nodes via the slice-1 contract-free constructors"* — the implementer halted (couldn't qualify schemas through generic `TableSource`), orchestrator authorised *"Option A: add `TableSource.schema?`"* as in-scope. Implementer shipped it with a code comment acknowledging the layering violation; reviewer SATISFIED. D3 brief framed the win as *"one read home + one parser"* — implementer built a template-method orchestrator in `family-sql/verify.ts` that took adapter SQL fragments through a `MarkerReadShape` interface (see F18). D4 brief enumerated specific verification items for the reviewer (column-set reduction, CAS semantics) — the upsert-collapse-vs-`sign()` contract collision (F19) was not on the list. Operator caught all three at PR review.

### F18. Inverted abstraction: shared orchestrator in family layer takes adapter implementation-detail fragments via an interface

**Symptom.** A shared layer (e.g. `family-sql`) carries a template-method orchestrator (probe → select → decode → parse → tag) parameterised by a *per-adapter* interface exposing SQL fragments, row decoders, and other dialect-specific implementation details. Each adapter "implements" the operation by populating that interface; the orchestration template lives upstream. The pattern is justified as "shared code / one home", and it does technically dedupe the orchestration — at the cost of inverting what the adapter is *for*.

**Detection signal.**

- A type named `<Operation>Shape` / `<Operation>Statements` / `<Operation>Spec` in a shared package, carrying string fields (`sql`, `decoder`, `tableName`) populated by the adapter.
- A function in a shared package that takes a "queryable" plus that shape and runs the operation; adapters' implementations of the operation reduce to `helper(queryable, this.<operation>Shape)`.
- The adapter's public method matches the shared SPI on the surface, but its body is a one-liner delegating to the shared orchestrator.
- The same operation on the **write** side (or on a sibling family — e.g. Mongo) is owned end-to-end by the adapter; only the read (or this one operation) leaks fragments upstream.

**Mitigation.**

- The adapter owns the whole operation end-to-end. The shared layer calls `adapter.<operation>(driver, args)` and gets back the result type the caller wants. Implementation details (statements, decoders, dialect-specific probes) live inside the adapter and never leave.
- The only piece worth sharing across adapters is *pure* — a parser, a row-shape schema, a result-type constructor. If you find yourself sharing orchestration, you're sharing the wrong thing.
- 10–20 lines of "duplicated" orchestration between two adapters is the right kind of duplication: it's the cost of giving each adapter end-to-end control, which is what the adapter pattern exists for.
- Symmetry check: if the *write* side of the same family owns its operations end-to-end, the *read* side must too. Cross-family symmetry (SQL ↔ Mongo) is also a check — if Mongo owns `readMarker` end-to-end and SQL routes through a shared orchestrator, the SQL side is wrong-shaped.

**Reference incident.** 2026-06-03, slice `sql-marker-ops-through-adapter` (TML-2753), D3. `readMarkerResult(queryable, shape)` lived in `packages/2-sql/9-family/src/core/verify.ts`; each adapter exported a `MarkerReadShape` (`tableProbe`, `selectRow`, optional `decodeRow`) of type `MarkerStatement` (`{sql, params}`). The write-side SPI in the same slice (D1/D2) correctly owned `initMarker`/`updateMarker`/`writeLedgerEntry` end-to-end in each adapter — the asymmetry was the giveaway. Brief-framing root cause is F17 (the D3 brief said *"one read home + one parser"*).

### F19. Single-primitive collapse changes semantics for some callers but not others

**Symptom.** A refactor collapses two distinct call-paths or operations into one primitive ("upsert" instead of separate "insert" + "update"; "merge" instead of separate "overwrite" + "accumulate"). The decision is correct for one caller's contract (the one whose use-case motivated the consolidation), but a *different* caller of the same primitive depends on the dropped semantics — and the consolidation silently changes that caller's behaviour. Tests pass because each caller's test exercises its own path; the contract collision shows up only under concurrent execution, edge cases, or production load.

**Detection signal.**

- A dispatch description says "collapse / consolidate X and Y into one" with a rationale that names only one of the call-sites.
- The collapsed primitive's docs name the *post-collapse* semantic (e.g. "INSERT … ON CONFLICT DO UPDATE — idempotent re-apply") without enumerating which callers' contracts it satisfies.
- One caller's tests pin "duplicate input produces idempotent result"; another caller (somewhere else in the tree) needs "duplicate input fails loudly" but its tests are sequential / don't exercise the collision.
- Concurrency / race-condition reasoning in the surviving caller's code (e.g. "after `readMarker()` returns null, write the marker") that depended on the dropped semantic to be sound.

**Mitigation.**

- When a dispatch collapses two operations into one primitive, the brief enumerates **every** call-site of either pre-collapse operation and the contract each call-site needs (idempotent / fail-loudly / CAS / etc.). The dispatch is only sized to "single primitive" when every contract is satisfied; otherwise the collapse stays partial (keep both operations; or add a deliberate variant — e.g. `initMarker` for upsert, `insertMarker` for insert-only).
- Reviewer verdicts on consolidation dispatches must include a "callers traced" item: list every caller, each caller's contract, and how the post-collapse primitive satisfies it. The bare "the new primitive works" verdict is insufficient.
- Reviewer DoR must include a generic *"trace each public-API change through all callers"* prompt alongside any dispatch-specific verification list (per the dor.md overlay item added by this retro). Specific lists narrow reviewer attention; the generic prompt re-widens it.

**Reference incident.** 2026-06-03, slice `sql-marker-ops-through-adapter` (TML-2753), D4. The slice spec decided "upsert collapses to `INSERT … ON CONFLICT (space) DO UPDATE`" based on the migration-runner's idempotent-re-apply contract. `sign()` also called `initMarker` after observing `readMarker() === null`, expecting init-once semantics — concurrent `sign()` invocations could each see "no marker" and the second would silently overwrite the first. CodeRabbit caught at PR review; fixed at `5da812ac0` by adding a separate `insertMarker` (insert-only, mirrors Mongo's existing primitive) and routing `sign()` to it while leaving migration-runner on upsert `initMarker`.

### F20. Orchestrator drifts into implementer mode on "small" fixes

**Symptom.** A small follow-up surfaces between dispatches (a low-severity review finding, a tiny ride-along cleanup, a "this is just a one-liner" tidy). The orchestrator, mid-stream and holding context, edits the production file directly instead of dispatching an implementer. The change may be correct and even pre-validated, but the orchestrator/implementer split has been collapsed — the orchestrator is now both author and arbiter of the change, eroding the separation that makes the review-with-fresh-eyes contract sound. Subsequent reviews of the combined diff have to disentangle which lines came from a dispatch (briefed, reviewable as a unit) and which came from in-stream orchestrator edits (no brief, no closed file list, no per-caller trace).

**Detection signal.**

- A review finding arrives mid-session (operator-flagged, reviewer-flagged, or self-surfaced) and the orchestrator's next move is `StrReplace` / `Delete` on production code rather than `Task` with an implementer brief.
- Self-justifications appear in orchestrator reasoning: *"it's just five lines"*, *"I've already verified it's dead code"*, *"dispatching would be wasteful"*, *"the implementer would do the same thing"*, *"I'm already in the file".*
- The branch's commit history shows a commit authored by the orchestrator's session (no implementer dispatch transcript precedes it) on production code, between two regularly-dispatched commits.
- A reviewer's per-caller trace, scope-discipline check, or "what brief authorised this?" question can't be answered for some lines in the combined diff.

**Mitigation.**

- The split is a **role constraint, not an efficiency tradeoff**: orchestrators dispatch and review; implementers edit production code; reviewers verdict. The orchestrator's "I could just do it" instinct is the failure mode, not the optimisation.
- Calibration docs, retro write-ups, planning files (`projects/<project>/...`), Drive trace events, and other process/orchestration surfaces are inside the orchestrator role and may be edited directly. Production source (`packages/`, `examples/`) and its test/doc neighbours are not.
- When a small fix surfaces and dispatching feels wasteful, the right shape is *still* a dispatch — write a tight closed-file-list brief (5 files; pure deletion; etc.), spawn `composer-2.5-fast`, and let the implementer ship the commit. The dispatch cost on a 5-line fix is small; the precedent of skipping it is not.
- If the orchestrator has already started editing in-place when this is caught, **revert the edits before re-dispatching**, not "commit what I have and dispatch next time". The sunk-cost trap is the on-ramp to repeating the violation; reverting and re-dispatching cements the role boundary in the session's behaviour.
- An operator interrupt of the form "YOU ARE AN ORCHESTRATOR" (or equivalent role-reminder) is a stop-the-line signal: revert any in-flight implementer edits, dispatch the work, and acknowledge the calibration miss explicitly. Do not finish the in-flight edit first.

**Reference incident.** 2026-06-03, slice `sql-marker-ops-through-adapter` (TML-2753), F03 close-the-residual. D6 R1 reviewer flagged F03 (residual `MarkerStatement` consumer in `sql-runtime/src/sql-marker.ts` — D6 brief had wrongly excluded the file from its closed list, F17 in miniature). Orchestrator started doing the deletion in-place (read the consumer, ran usage greps, `StrReplace`-d the import, deleted the function, removed the export, deleted the test, edited the README), validated with build/typecheck/grep. Operator interrupt: *"YOU ARE AN ORCHESTRATOR"*. Edits reverted; F03 dispatched as D7 to `composer-2.5-fast` with the brief the work should have had from the start (closed file list, pre-verified facts, composer constraints), shipped at `e3c4c4470`, reviewed and SATISFIED.

### F21. Implementer ships AST construction by hand wrapped in option-bag factories instead of building the fluent authoring surface the slice exists to deliver

**Symptom.** A slice exists to deliver an *authoring ergonomics* improvement (e.g. "migrate raw SQL to typed query AST commands"). The implementer satisfies the literal "uses the typed AST" check by constructing AST nodes directly at every leaf (`BinaryExpr.eq(ColumnRef.of(table, col), param(value, { codecId: TARGET_TEXT_CODEC_ID }))`) and wraps groups of these in option-bag factory functions (`update({ table, set, where, returning? })`), calling the result a "builder". The resulting code is *more verbose* and *less readable* than the raw SQL it replaced — the authoring intent is unmet even though the literal "AST is used" check passes. Reads, if not separately briefed, are often shipped as raw SQL strings via `driver.query('select … where x = $1', [v])` — the AST isn't even attempted.

**Detection signal.**

- Slice name or spec uses "builder", "fluent", "authoring", "ergonomics", "DSL", or "typed commands" — but the diff shows option-bag factory functions taking literal `Record<string, …>` arguments.
- Per-call-site density of atom-constructor expressions (`BinaryExpr.eq(...)`, `ColumnRef.of(table, col)`, `param(value, { codecId: ... })`, `AndExpr.of([...])`) — multiple per line, every line.
- Repetition: identical or near-identical column references, codec IDs, table aliases, parameter wrappers appear dozens of times because the surface doesn't *carry* that context; the call site re-states it every time.
- The "builder" wrappers don't compose with each other and don't chain — each one is a one-shot factory taking a literal options bag.
- Reads on the same code path use raw SQL strings via `driver.query(sql, params)` — the "use the AST" purpose was satisfied for writes and quietly dropped for reads.
- Reviewer or operator question "what does this save over writing the AST class chain directly?" has no answer.

**Mitigation.**

- Briefs for "build / use an authoring surface" dispatches must specify the **ergonomic properties** the surface delivers: typed table proxies, typed column proxies that carry codec, fluent chain depth ≥ 2, no per-call-site codec / alias / column-name threading, operations produce existing AST nodes (not new ones). The property statement (per F17) names *ergonomics*, not "uses the AST."
- Pattern-clone reference for fluent authoring surfaces must itself be a fluent surface in this codebase (e.g. `sql-builder`'s contract-bound `sql.<table>.update(...).where(...)` interface), **not** an atom-constructor surface (e.g. column / literal / function helpers like `col` / `lit` / `fn`). Atom constructors and fluent builders are *different shapes*; cloning the wrong precedent transfers the wrong ergonomics.
- Reviewer DoR item: when a dispatch's stated purpose is authoring ergonomics, the reviewer writes out a representative *call site* using the new surface and judges it readable as a human-author would. The "compiles + tests pass + uses the AST classes somewhere" check is necessary but not sufficient.
- Stop condition on the implementer: if the new "builder" requires the call site to thread codec IDs, table names, column names, or aliases at every leaf, the surface hasn't been built — the implementer is just wrapping AST construction in factory function syntax. HALT and surface.
- Tier check: dispatches whose success requires architectural taste over mechanical correctness (fluent surface design, abstraction shape, ergonomic judgement) belong in the `mid` tier (Sonnet-class) at minimum. The `cheap` tier (composer-2.5-fast) is calibrated for mechanical execution against a clear spec; assigning it a design-heavy dispatch defaults to the lowest-cost-to-satisfy interpretation, which on an ergonomics slice is the wrong-shape interpretation. See [`model-tier.md`](./model-tier.md).

**Reference incident.** 2026-06-03, slice `sql-marker-ops-through-adapter` (TML-2753), D1 + D6. Project name `migrate-marker-ledger-to-typed-query-ast-commands`; slice intent to migrate marker/ledger off raw SQL onto a typed authoring surface. The implementer (composer-2.5-fast) extended Slice 1's atom-constructor pattern (`col` / `lit` / `fn` / `createTable` — correct for DDL, which is one-shot and non-chainable) into DML by writing `insert(table, row)` / `update({...})` / `upsert({...})` factory functions that just reassemble the underlying `InsertAst.into(...).withRows([...]).withOnConflict(...)` chain already on the AST classes. Marker writes became 50-line option-bag literals with `param(value, { codecId: PG_TEXT_CODEC_ID })` repeated at every leaf and `BinaryExpr.eq(ColumnRef.of('marker', 'space'), …)` for every condition. D6's adapter-owned read flow didn't even attempt the AST — used raw SQL strings via `driver.query('select … from prisma_contract.marker where space = $1', [space])`. Operator review (PR #712): *"This code is unreadable crap. Why isn't it using the query builder we just created"* / *"WTF is this? Why isn't this using the query builder we just wrote?"* Brief defect (orchestrator's): the F17-mandated property statement framed D1's win as *"use the typed AST"* instead of *"deliver a fluent authoring surface analogous in spirit to `sql-builder`'s contract-bound `sql()` — typed table/column proxies that carry codecs, fluent chain, leaves don't re-state context"*. The wrong-pattern clone (DDL atoms → DML "builder") was unconstrained because the brief didn't name the ergonomic property. Resolution: corrective Slice 2-bis dispatches D8 → D9 → D10 replace the option-bag wrappers with a real contract-free fluent builder (D8), rewrite marker/ledger code against it including the read path (D9), and rename the misnamed `control-codec-registry` (D10). Implementer slot upgraded from `composer-2.5-fast` (cheap tier) to `claude-4.6-sonnet-high-thinking` (mid tier) for the design-heavy dispatches.

### F22. Reviewer runs `git stash` to debug a worktree-local red and pops an unrelated worktree's stash entry

**Symptom.** A reviewer (or implementer, but reviewers are the more common trip) hits a transient red in their worktree — typically a stale-`dist` typecheck failure, a flaky test, or "what's the merge-base look like for this same suite" — and reaches for `git stash` / `git stash pop` as a quick clean-tree manoeuvre to isolate the change under review from local noise. Because `git stash` is **repository-global, not worktree-scoped**, the stash list is shared across every worktree on the same checkout. `git stash pop` pops whatever sits at `stash@{0}` — including stashes pushed from a totally unrelated worktree by the human operator. The pop frequently succeeds silently (the unrelated stash applies textually without conflict), the reviewer reverts what they see in *their* tree, the human operator's stash entry is permanently gone from `git stash list`, and the only recovery is `git fsck --no-reflogs --unreachable | rg 'dangling commit'` in the affected worktree.

**Detection signal.**

- Reviewer wrap mentions `git stash` / `git stash pop` for tree-cleanliness or merge-base verification.
- After the reviewer's run, `git stash list` in *other* worktrees is missing entries the operator had pushed there.
- Files appearing untracked or modified in a worktree the reviewer is *not* working in, with no commit history.
- Recovery requires `git fsck --no-reflogs --unreachable` rather than `git stash apply stash@{N}`.

**Mitigation.**

- Reviewer DoR for any dispatch that involves verifying behaviour against a different ref ("is this failure pre-existing on `origin/main`?", "does this regression reproduce at the merge-base?"): use **`git worktree add ../tmp-<dispatch>-verify <ref>`** to create a sibling tree, run there, then `git worktree remove ../tmp-<dispatch>-verify`. Never `git stash` to swap working states.
- Reviewer briefs MUST include the rule: *"Do NOT run `git stash` / `git stash pop` in this worktree or any other. Stash is global to the repository."* Add to the boilerplate of every review brief that involves an integration / e2e gate. The rule is in `drive/calibration/failure-modes.md` § F22; briefs link there rather than restating the full rationale.
- If the reviewer has already popped a stash before this is caught: do not revert blindly. Capture the popped diff (`git diff` from a clean tree post-pop) and surface it to the operator with the message "I popped stash@{0} which appears to be unrelated to this worktree — diff attached, dangling-commit-recoverable via `git fsck --no-reflogs --unreachable` in <suspected-worktree>". Recovery is operator-led, not reviewer-led.
- Implementer / orchestrator preflight: if you're about to dispatch a reviewer whose checks may include "verify against base", mention `git worktree add` as the prescribed mechanism in the brief. Do not assume the reviewer remembers F22.

**Reference incident.** 2026-06-03, slice `sql-marker-ops-through-adapter` (TML-2753), D8 R1 review. Reviewer (`claude-opus-4-7-thinking-high`) hit a stale-`dist` typecheck red post-`origin/main`-merge, ran `git stash` (no-op — tree was clean) then `git stash pop`, which popped `stash@{0}` from the unrelated `tml-2812-render-polish-and-ledger-tests` worktree (message: `d5-wip-2`). The pop applied cleanly because changes were textually conflict-free; reviewer reverted what they saw in the D8 tree (`git checkout --` + `rm -rf` on new untracked dirs), but the original `d5-wip-2` stash entry was permanently removed from the operator's `git stash list`. Recovery path: `git fsck --no-reflogs --unreachable | rg 'dangling commit'` in the `tml-2812-…` worktree. Subsequent reviewer (D9 R1) honored the new rule via `git worktree add ../tmp-d9-verify <merge-base>` for the pre-existing-flake verification; no incident.

### F23. Close-out doc authored from the project spec inherits pre-implementation API names

**Symptom.** A close-out ADR (or any doc authored at project close from `spec.md`) describes the shipped system using names lifted from the spec — but the spec predates implementation, and type / field / function / diagnostic names drifted via renames during the slices. The doc ships symbols, diagnostic codes, and code-example shapes that no longer exist in the merged code. By close-out the spec is the *oldest, least-accurate* naming source in the project.

**Detection signal.**

- Symbols, file paths, or diagnostic codes cited in the doc don't grep in `packages/`.
- Field names in the doc match `spec.md` but not the merged code (e.g. spec `defaultControl` vs shipped `defaultControlPolicy`).
- A code-example block uses a constructor / DSL shape that doesn't match the real signature.
- Relative links resolve from the wrong directory depth (doc moved deeper than the spec it was drawn from).

**Mitigation.**

- Doc-authoring briefs at close-out must say: **verify every API reference (type, function, field, diagnostic code, file path) against shipped source; treat the spec as *intent only*, never as the API surface.** Don't seed the brief with *predicted* names from the spec either — those carry the same drift.
- Require the dispatch to return a "verified-against-source" list (symbol → file where confirmed) and an explicit flag of any place shipped code diverged from the brief's expectation.
- Orchestrator review pass spot-checks every cited symbol / path with grep and resolves every relative link before merge. The `adr-examples-must-match-code` rule covers code *examples*; this failure mode extends the discipline to *all* API references in the prose.
- Generalises to any Drive project that writes close-out docs from a spec; landed project-context here on first occurrence. If it recurs, promote to canonical (`drive-close-project` / `drive-pr-description` brief discipline) per the team's "after one or two repetitions" rule.

**Reference incident.** 2026-06-04, control-policy close-out ADR (ADR 224, TML-2831). First draft (drawn from `spec.md`) used `effectiveControl` (shipped `effectiveControlPolicy`), `defaultControl` (shipped `defaultControlPolicy`, renamed under TML-2800), and a predicted diagnostic `control_managed_in_external_space` (shipped `controlPolicySuppressedCall`); it also shipped a structurally-wrong `defineContract` TS example and a relative link off by one `../`. All caught in the orchestrator's source-verification review before merge. The implementer's brief *had* asked it to verify against source — which surfaced the divergences in its return — but the brief's own predicted names were themselves from the stale spec, so the verification was doing double duty.

### F24. Stale `dist` makes a red gate look like a broken base

**Symptom.** A dispatch (or babysitter) runs `pnpm typecheck` / `pnpm test` in a freshly-created or freshly-updated worktree and gets a wall of red — cross-package type errors (`X is not assignable`, `property Y does not exist`) or runtime failures that name a *consumed* package's API. The implementer concludes "the base is broken" or "pre-existing failure, not mine" and either gives up or ships around it. The errors are actually **stale `dist/*.d.mts` artefacts**: a dependency package's emitted types are out of date relative to its source after a base update / rebase, so consumers typecheck against the old surface.

**Detection signal.**

- Worktree was just created, rebased, or had its base updated (`git pull`, `WorktreeCreate`, a rebase-onto-main).
- The red errors are *cross-package* and reference a dependency's types/exports, not the file the dispatch is editing.
- An implementer's report contains "pre-existing on the base" / "broken base" for a cross-package type or API mismatch.

**Mitigation.**

- **Run `pnpm build` before trusting any red typecheck/test in a fresh or freshly-updated worktree.** Turbo is cached, so it's cheap; it refreshes every `dist/*.d.mts`. Re-run the gate after. CLAUDE.md's golden rule ("after changing exported types in a consumed package, run that package's build before validating downstream") generalises to "after any base movement, build first."
- Brief implementers and babysitters to build-then-gate, and to never report "broken base" for a cross-package mismatch until a post-build re-run still fails. A genuine base breakage survives `pnpm build`; stale dist does not.

**Reference incident.** 2026-06-10, runtime-target-layer (TML-2502, PR #792). Nearly tripped this three times: slice 1 reported 153 typecheck errors + 18 test failures (`SqlNamespace.entries` vs `.tables`) as "pre-existing/broken base"; a `pnpm build` cleared all of it (274 tests green). It recurred after the rebase onto main (an `enum-accessor` mismatch) and again when a review-fix subagent saw red — both stale dist, both green after build.

### F25. "Pre-existing failure" claim accepted without running the suspect file on pristine main

**Symptom.** After merging main into a feature branch (or any base movement), a gate run shows failures in files the branch didn't touch. The implementer (or merge-resolution agent) classifies them as "pre-existing / in-progress upstream work, not a regression" because the failing tests belong to someone else's feature — and the loop moves on with a real regression aboard. The classification rested on whose tests failed, not on whether they fail without the branch's changes.

**Detection signal.**

- The failing tests landed on main recently (they passed CI there — main's CI being green is itself evidence against "pre-existing").
- The branch carries changes to shared infrastructure the failing feature flows through (mergers, registries, shared walkers), even if no file overlaps.
- The report says "not a regression from the merge" without naming the command that proved it.

**Mitigation.**

- **Run the suspect file on pristine main before accepting any "already red" claim**: `git worktree add wip/main-check origin/main`, install + `pnpm turbo run build --filter=<pkg>...`, run the one file, `git worktree remove`. Minutes of cost; rules the question out completely.
- Heuristic: a test that passed CI on main and fails on the branch is a branch regression until proven otherwise — the burden of proof is on the "pre-existing" claim, never on the regression hypothesis.

**Reference incident.** 2026-06-11, uuid slice (PR #810). After merging main (TML-2882 enum2), 11/14 `interpreter.enum2.test.ts` tests failed; the merge agent called them "in-progress TML-2882 work, not a regression". Running the file on a pristine-main worktree showed 14/14 green — the branch's `mergeAuthoringNamespaces` shallow-copy fix was dropping prototype getters (`blockAttributes`) off enum2's class-instance descriptors. Fixed by narrowing the copy to plain-prototype objects.

### F26. Review comment point-fixed; the defect class re-ships in new places next round

**Symptom.** A reviewer flags an instance of a structural defect ("this is SQL-specific, it cannot live in the framework domain"). The response fixes exactly the flagged line/type, and the next review round finds the same class elsewhere in the same diff — including in the fix itself. Each round costs a full human review; the reviewer has become the layering linter.

**Detection signal.**

- A review reply that says "fixed" without naming the class or stating what was swept.
- The fix for a flagged instance introduces a sibling of the instance (e.g. a hook named after the banned vocabulary, placed one file over).
- A "pre-existing surface also has this" justification applied to surface the PR itself authored.
- The same reviewer comment text (or an ALL-CAPS escalation of it) appearing in two consecutive rounds.

**Mitigation.**

- Response protocol is class-first: name the class → sweep the entire PR diff for it (grep + reading, including fields added to pre-existing types) → fix every instance in one round → the reply states the sweep (searched what, fixed what, excluded what and why). See [`.agents/rules/fix-the-class-not-the-instance.mdc`](../../.agents/rules/fix-the-class-not-the-instance.mdc).
- Grandfathering never covers new surface: a type/field/hook the PR authored must be clean even when its pre-existing neighbors are not.
- Reviewer side: findings should name the class explicitly so the responder can sweep; review-pass briefs must not frame the design as settled (a comment invalidating a design decision invalidates every consequence of it — chase them).
- Mechanical backstop where the class is vocabulary-shaped: `pnpm lint:framework-vocabulary` (committed high-water-mark threshold; PR #918).

**Reference incident.** 2026-07-02→06, native-postgres-enums (PR #906). Round 1: `CodecRef.nativeType` flagged ("SQL-specific, cannot live in the framework domain") — fixed by moving the cast to a codec hook placed on the *framework* `CodecDescriptor`. Round 2: the hook flagged ("NATIVETYPE CANNOT BE REFERENCED IN THE FRAMEWORK DOMAIN") — relocated, but a new framework type (`AuthoringEntityRefResolution`) kept `nativeType` + a `valueSetEnforcement` strategy string-enum under a grandfathering argument. Round 3: both flagged, plus derivation logic (`deriveValueSet`) in framework core. Three rounds, one class. Operator intervention produced the class-sweep rule, the vocabulary ratchet, and this entry.

### F27. Mid-merge branch checkout or hard reset silently discards MERGE_HEAD; the "merge" commits with one parent

**Symptom.** An agent resolving merge conflicts switches branches (`git checkout <branch>` / `git switch <branch>`) or runs `git reset --hard` mid-merge. Either aborts the in-progress merge state and drops `.git/MERGE_HEAD`. The agent then re-applies its conflict resolutions and commits; the result is an ordinary single-parent commit that *looks* like a merge — merge-shaped message, conflict-resolution diff — but records no second parent. History silently loses the merged branch; a later `git merge` of the same branch replays already-resolved conflicts. Pathspec checkouts (`git checkout <ref> -- <path>`, `git checkout --ours/--theirs -- <path>`) are the safe forms: they overwrite files but leave MERGE_HEAD in place.

**Detection signal.**

- `git cat-file -p <sha> | grep -c '^parent '` prints 1 (a true merge prints 2) under a "Merge …" subject.
- `git merge-base --is-ancestor <merged-branch> <result>` exits non-zero. Note the converse is weak: this check passes trivially when the merged ref was already an ancestor of the base, so it can only refute a merge claim, not confirm one — pair it with the parent count.
- The agent's report says "merged X into Y" without pasting verification output.

**Mitigation.**

- Acceptance criterion for any dispatched merge: the report must include the **printed output** of both checks — `git cat-file -p HEAD | grep -c '^parent '` (must print 2) and `git merge-base --is-ancestor <merged-ref> HEAD && echo ancestor-ok`. A claim without both printed checks is not a merge.
- Brief rule: never `git checkout <branch>` / `git switch <branch>` and never `git reset --hard` while a merge is in progress. During conflict resolution use the pathspec forms — `git checkout --ours/--theirs -- <path>`, `git checkout <ref> -- <path>` — or edit in place; those keep MERGE_HEAD.

**Reference incident.** 2026-08, public-npm-surface rename consolidation: a subagent's "merge" of the rename branch had one parent (a mid-merge state reset discarded MERGE_HEAD before the commit). Caught by the ancestor check before the branch was folded into the delivery PR; re-merged properly.

### F28. Test file written for a runner no suite invokes — coverage that never runs

**Symptom.** A test file imports a framework (e.g. vitest) but no configured suite executes it: the root vitest config only loads `packages/**` projects, and the node-test script list doesn't name it. CI is green, the file reads as coverage, and it rots — the code under test grows seams the stubs don't cover, and nobody notices because the assertions never execute.

**Detection signal.**

- `scripts/*.test.mjs` importing `vitest` (root vitest doesn't load `scripts/`): `grep -l "from 'vitest'" scripts/*.test.mjs`, then check each against the `test:scripts` list in `package.json`.
- A test file whose stubs reference an io-seam shape that the implementation has since outgrown.
- Converting or first-running such a file immediately fails on drifted stubs — that failure is the proof it never ran.

**Mitigation.**

- Script tests use `node:test` + `node:assert` and are added to the `test:scripts` list in the same commit that creates the file.
- When touching any script's test, confirm the file actually executes in `pnpm test:scripts` output (its describe blocks appear), not just that the suite is green.
- New-check protocol (plant a violation, watch it fail) applies to tests too: break one assertion once and watch the suite go red before trusting it.

**Reference incident.** 2026-08, public-npm-surface close-out: `validate-package-manifests.test.mjs` and `check-publish-deps.test.mjs` were vitest-based and ran in no suite. Conversion to `node:test` immediately exposed that `check-publish-deps.test.mjs`'s io stub predated two seam legs (`readPackedDeclarations`, `dependencyShipsOwnTypes`) — the tests had been broken, invisibly, since that seam grew.

### F29. Cancelled dispatch treated as cancelled scope

**Symptom.** The operator cancels a *dispatch* (an in-flight agent run, a slice attempt, a PR), and the orchestrator drops the *work it carried* from the delivery plan. The requirement silently disappears; the project reports done while a spec-level invariant is unmet.

**Detection signal.**

- A consolidation/delivery PR whose diff lacks a change the spec's DoD names, where that change last lived in a cancelled branch/dispatch.
- Any "the operator cancelled X" in a status narrative without a following sentence saying where X's scope went.

**Mitigation.**

- Cancelling a dispatch cancels the *attempt*, never the *scope*. On any cancellation, the orchestrator immediately re-homes the carried work: into another slice, a new dispatch, or an explicit operator question "is the requirement itself dropped?"
- DoD verification at delivery runs against the spec, not against the surviving branches.

**Reference incident.** 2026-08, public-npm-surface switchover: the operator cancelled the switchover-slice dispatch; the privatization flip it carried (64 manifests → `private: true`) was silently dropped from the consolidated delivery PR, which merged with every internal package still publishable. Caught by the operator post-merge; fixed in an emergency PR plus a two-direction publishability lint so the class cannot recur.

## Slice-shape scope traps

Patterns that have produced scope creep in the past — catch these at triage or slice-spec time, not at execution time.

- _"Add capability X to <one target>"_ that turns out to need contract-level work first. → Triage as project, not slice.
- _"Fix bug in operation Y"_ where Y is parametric over targets. → Watch for "fix on postgres" silently leaking to "fix on all targets" mid-implementation.
- _"Rename concept Z"_ → Almost always project (rename spans every layer + tests + fixtures + docs).
- _"Package X should not become a runtime consumer of Y"_ phrased as a blanket `package.json` statement ("absent entirely") rather than per-section constraints. → Conflates the actual non-goal ("no runtime declaration", i.e. constraints on `dependencies` + `peerDependencies`) with "no declaration of any kind" (which silently outlaws test imports). Express as `dependencies` + `peerDependencies` constraints; leave `devDependencies` to the implementer.

## QA coverage-gate gaps

QA's comparative advantage over CI in this repo is **judgement-class observation**: `pnpm test:packages` and `pnpm test:e2e` exercise structural shape and exit codes; they do not verify:

- **Error envelope copy quality** (`fix:` lines, suggested verbs, legibility, freshness, cross-reference correctness). `pnpm test:packages` asserts shape, not legibility. A script that says "the user pastes their broken schema; does the error message tell them what to fix?" is the only way to catch error-copy regressions.
- **CLI diagnostic flow.** `pnpm test:e2e` runs end-to-end but doesn't read the output the way a human would. Scripts that re-run a known-broken CLI flow and judge diagnostic clarity catch what e2e tests cannot.
- **Generated artefact shape** (the `contract.d.ts` consumers actually edit against). Fixtures check that the emitted shape matches the golden; manual QA should sometimes open the generated `.d.ts` and read it as a downstream type-author would.
- **Migration applicability across the demo's history.** Migrations apply forward in test fixtures, but a manual run that walks the demo through its migration history and confirms each step produces a usable database is uniquely valuable when a migration-system slice ships.
- **`--help` text legibility, freshness, cross-reference correctness.**
- **Multi-command developer journeys** (A then B then C as a real user would).
- **Output legibility** (table formatting; JSON envelope shape against `--json` consumers' expectations).
- **Negative-control gate behaviour** (whether a lint / strict throw actually fires on a planted violation; CI only checks today's clean tree).

Manual-QA scripts should preferentially target these gaps. Re-running the automated suite is **not** a QA scenario.

## Stop-conditions for `drive-build-workflow`

Per-repo stop conditions beyond the canonical ones:

- Any dispatch that would touch `packages/0-shared/contract/types/**` halts for operator review before merge (contract surface is downstream-visible).
- Any dispatch that would change the public surface of `packages/0-shared/exports/**` halts for `drive-discussion` (downstream extensions consume this surface).

### F20. Long-lived PR drifts under `main`: numbering, version dirs, and write-once artefacts move without the branch noticing

**Symptom.** A PR that stays open across other merges passes locally and fails only in CI's merge tree, or fails in ways no local command reproduces: an ADR number taken by `main` collides in the index; a version bump on `main` moves the required upgrade-instructions directory (`rc.8-to-rc.9` becomes `rc.9-to-rc.10`); `main` adds content-addressed migration snapshots that the branch's emitter would have written differently, so `fixtures:check` fails only in the merge.

**Detection signal.**

- CI `Fixtures` names files that do not exist on the branch.
- `check-upgrade-coverage` demands a transition directory the branch never created.
- Two ADR files or index rows share a number after fetching `origin/main`.

**Mitigation.**

- Merge `origin/main` into the branch before every review round and before declaring CI green, then re-run `fixtures:check`, `check:upgrade-coverage --mode pr --prev origin/main`, and `check:error-reference` on the merged tree.
- At merge time, re-derive every number or directory the branch chose from `main`: ADR numbers, upgrade transition directories, error-reference entries.
- When a schema or artefact format changes, add a load test with an artefact produced by the previous format (see [`dod.md § Documentation & migration`](./dod.md#documentation--migration)); write-once artefacts such as migration snapshots cannot be regenerated by users. Observed on TML-3233 (2026-09-10): ADR 249 collision, upgrade directory moved by the rc.9 bump, and a required `nullable` key that would have broken every existing snapshot.
