# Retros — mongo-defaults-codecs-prisma6-source

## 2026-09-25 — mandatory final retro (project close)

**Trigger.** Project close, invariant I10. All five slices are open as PRs (#30396, #30399, #30403, #30405, and the slice 4 PR); slice 4 D2 was the last dispatch.

**What happened, against what was planned.** Shaped as four slices; delivered as five. The framework ref rename was split out of the runtime hoist during slice 3's first dispatch when a Mongo-only `execution` type produced over a thousand type errors. Slice 1 grew from "move the codecs" to "fix the target/adapter layering first" because the Mongo target imported its adapter and driver against ADR 198. Slice 3's generator placement bounced twice (runtime package, then adapter, then family) because the Mongo runtime dev-depended on the family, target, and adapter for its tests; SQL's runtime never did. Two CI failures reached GitHub after green local gates: biome lint on slice 3, upgrade coverage against the stacked base on slice 5.

**Root causes.**
1. Both CI failures were gate omissions by the orchestrator, not implementer errors. The per-package lint rule already existed in `drive/calibration/dod.md` (F14); the briefs did not carry it. The stacked-base coverage rule did not exist anywhere.
2. The layering surprises (target importing adapter; runtime dev-depending on family) were pre-existing violations of ADR 198 and of the SQL layout that no lint enforces: `architecture.config.json` puts target packages in the `extensions` domain, which may import `targets`, and dependency-cruiser ignores devDependencies. Grounding found them only because the slice tried to mirror Postgres exactly.
3. The Mongo-only `execution` type was foreseeable from the grounding (`MongoContract<S> = Contract<S>`, emitted `contract.d.ts` derived from the framework type) but the shaping discussion treated "neutral names" as a naming choice rather than a type-identity constraint.

**What worked.** Grounding every slice with a read-only Explore dispatch before writing the spec caught the layering problems before code was written. Persistent implementer and reviewer across dispatches kept context after the OS crash's forced respawn. Reviewer findings were consistently actionable; the findings discipline (every finding blocks) produced 2 to 3 rounds per dispatch with no carry-over. Mirroring Postgres as the single design rule resolved every fork without a discussion round except the one Will was asked about.

**Lessons landed.**
- `drive/calibration/dod.md`: upgrade coverage runs against the PR base; stacked PRs need their own declaration.
- `drive/calibration/failure-modes.md § F32`: the two CI-after-green incidents, with the orchestrator-side root cause.
- Memory: gate-includes-package-biome-lint (personal), drive subagents on Opus, no padded options.
- Plan open items carried to close-out: the `extensions` domain mapping for target packages (so `lint:deps` can enforce ADR 198), ADR 198's stale DDL-visitor text, the PSL/TS Mongo storage-hash gap, `orm init` Prisma 6 detection, Binary subtypes, unknown codec ids in closed validators.

**Calibration.** Slices sized as "one PR, one reviewer sitting" held: the largest PR (slice 3) took three review rounds across three dispatches and stayed coherent. Every dispatch ran on Opus by operator instruction; no dispatch failed for capability reasons.
