## 2026-08-27 — Typed attribute parsers project close

**Trigger:** Mandatory final retro at project close per invariant I10.

**What happened:** The project delivered the shared attribute-spec engine and migrated SQL and Mongo interpreter attributes through four PR-sized slices. The original three-slice plan gained a dedicated SQL `@default` slice when registry-driven function calls and enum defaults proved too large and distinct for the general SQL migration.

**Root cause:** The substrate design was implemented before its composition rules and consumer packaging boundary were fully settled. Review therefore discovered structural decisions—literal alternatives, function-call signatures, dynamic specs, diagnostic policy, and comment placement—that should have been reconciled before later dispatches. Delegation briefs also weakened an operator-scoped tool constraint by treating “no search” as merely “no search MCP,” which authorized commands the operator had explicitly forbidden.

**Landing surface(s):**

- ADR: `docs/architecture docs/adrs/ADR 231 - Declarative attribute specifications.md` — reconciled the accepted interpreter architecture with the shipped combinators, dynamic specs, typed function calls, native Mongo literals, and explicit language-tooling follow-up.

### What went well

- The substrate landed with a real SQL `@relation` consumer, proving the interpretation seam before the migration fanned out.
- Attribute-by-attribute migration kept semantic validation separate from argument grammar and allowed legacy helpers to be removed as their final consumers moved.
- Splitting SQL `@default` preserved review coherence instead of forcing registry-sensitive function-call work into the general SQL slice.
- Dynamic composition from registries, enum members, and model fields eliminated proposed special-purpose combinators while keeping family ownership explicit.
- Dist-consuming and fixture validation caught failures that source-resolved package tests could not see, including duplicated parser classes and stale encoded Mongo syntax.
- Consumer upgrade instructions now accompany the intentional Mongo projection and weight syntax changes.

### What surprised us

- The first slice required repeated structural review rounds rather than ordinary polish. The combinator vocabulary, diagnostics policy, and engine shape were not sufficiently settled at implementation start.
- Several combinators or variants were introduced and then removed within the project: `enumOf`, flexible/raw function calls, `funcCallFrom`, scalar-literal helpers, and proposed Mongo-specific index leaves.
- The parent plan was not amended when SQL `@default` became a fourth slice, leaving the project-level record stale.
- “Search-free” delegation briefs still authorized terminal search commands. The durable lesson is to preserve task-scoped constraints verbatim in every delegation and avoid contradictory completion gates. The operator's personal no-search preference remains an operator instruction and is not committed as a project-wide repository rule.
- Historical retail migration inputs retained encoded text-index weights after the current example and integration fixture had moved to native records, so the full fixture pipeline found the remaining consumer lineage late.

### Calibration lessons

- A substrate slice that receives structural API feedback should pause for design reconciliation before spawning a sequence of review-fix dispatches.
- A slice boundary change must update the parent plan immediately; sibling slice specs alone are not a sufficient project record.
- Changes crossing package or bundling boundaries need at least one dist-consuming consumer test before the substrate is considered review-ready.
- A delivery brief must not silently weaken an operator-scoped tool constraint. If a completion gate requires a prohibited tool, the orchestrator owns an alternative verification path rather than delegating the contradiction.
- Fixture validation must include historical migration sources when a user-facing syntax changes, not only current examples and integration schemas.

These process lessons remain in this transient retro because no repo-wide policy change is justified solely by this project. The accepted architectural outcome is preserved in ADR 231.

### Deferred work

Language-server discovery, traversal, completion, navigation, and diagnostic reuse over attribute specs remain a separate follow-up under the Language Tools project. This project deliberately delivered the interpreter substrate only.

### ADR audit

ADR 231 contained several aspirational or superseded API shapes. It has been rewritten and accepted to distinguish the shipped interpreter architecture from future language-tooling requirements. No additional architectural decision requires a new ADR.

### Team summary

SQL and Mongo interpreters now derive attribute argument parsing from typed declarative specs, and ADR 231 records the shipped substrate that future PSL language tooling can extend.
