# drive/spec — project-context for spec authoring

Loaded by `drive-specify-project` and `drive-specify-slice`. Holds prisma-next's spec-authoring conventions — template extensions and tracker / branch linkage.

> **Trial period in effect (ends 2026-06-02).** When any drive-* skill in this category produces a finding, record it in [`findings.md`](./findings.md). Quality bar, tags, and format live in [`drive/trial.md`](../trial.md).

## Calibration

Spec authoring reads:

- [`drive/calibration/patterns.md § Edge-case patterns`](../calibration/patterns.md#edge-case-patterns-example-mapping) — Example-Mapping prompts the slice author walks during spec-shaping
- [`drive/calibration/failure-modes.md § Slice-shape scope traps`](../calibration/failure-modes.md#slice-shape-scope-traps) — recurring scope-creep patterns caught at triage / spec time
- [`drive/calibration/dor.md`](../calibration/dor.md) — slice-DoR overlay (Linear issue, branch, parent-branch items)
- [`drive/calibration/dod.md`](../calibration/dod.md) — slice-DoD overlay (plan-side items live there)

## Required sections (beyond template)

In addition to the canonical project-spec / slice-spec templates, this repo expects:

- **Contract-impact section** for any spec that touches the contract surface (`packages/0-shared/contract/**`, `packages/1-framework-core/**`). Names the contract entities affected, the new / changed kinds, the migration plan for downstream consumers.
- **Adapter-impact section** for any spec that affects target adapters (`packages/3-targets/**`). Names which adapters are affected (postgres / sqlite / mongo / etc.).
- **ADR pointer** for any architectural shift. Either link an existing ADR or commit to authoring one as part of the project's close-out.
- **Failure-state section** for any spec of a command that edits files it did not write. For each way the command can fail after it starts, name the state the user's project is left in, and require that a failure the command can predict is reported before the first edit. (Added 2026-09-24, orm-init-prisma7-detection final retro: `orm init` renamed the Prisma 7 config and rewrote scripts before finding out Prisma 8 could not read the schema, and the problem surfaced only in manual review after five dispatches.)

## Grounding illustrative snippets before execution

Specs legitimately carry illustrative code (PSL grammar, IR type shapes) while shaping. Before a slice executor treats any snippet as fact, they must re-verify it against shipped code — not re-read the spec sketch.

TML-2500 hit this four times in M3b: a PSL snippet used a model name that the shipped extension had renamed; the spec assumed a native-type auto-propagation that doesn't exist; a field attribute was written in field syntax when it is only valid inside a `types {}` block; and a doc update copied a discriminator field name from the spec's illustrative IR shape when the shipped IR uses presence-based discrimination on an optional field instead. The fix every time was "read the code, not the spec sketch." A doc author has the same obligation: re-verify each snippet before it bakes into a long-lived document.

## When this file changes

Append when a new required section emerges from a retro (a spec consistently missed a piece of context, and the team agreed a section header should prompt for it). For new edge-case patterns, new scope traps, or new DoR/DoD items: edit the matching file under [`drive/calibration/`](../calibration/) — never duplicate calibration here.
