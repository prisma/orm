# Slice plan: typed-sql-unhide

**Spec:** `projects/agent-native/slices/typed-sql-unhide/spec.md`
**Branches:** engines — from prisma-engines `main` (checkout `/tmp/prisma-engines-compact-plan-format`, freshen first); prisma/prisma half deferred (publish dependency).

## Dispatch plan

### Dispatch 1: engines change and PR (Half A)

- **Outcome:** The prisma-engines PR is open: `TypedSql` moved from the `hidden` to the
  `active` set in `psl/psl-core/src/common/preview_features.rs`; engines tests pinning the
  classification updated; validation per what the environment supports (cargo locally if
  available, else CI, stated in the PR body); PR body written for engines reviewers who
  have not seen this project.
- **Builds on:** The spec's chosen design; push access verified.
- **Hands to:** The open engines PR URL + the list of engines tests touched, recorded for
  Half B's bump PR to reference.
- **Focus:** Probe first (checkout freshness, toolchain, repo conventions); the one-line
  set move + test updates; nothing else in the engines repo.

### Dispatch 2: Half B prep note (no code)

- **Outcome:** `verification.md` for this slice records the engines PR URL, the exact
  prisma-side bump commands (per AGENTS.md's Wasm workflow), and the files expected to
  change — ready for whoever executes Half B post-publish.
- **Builds on:** Dispatch 1's PR.
- **Hands to:** Slice paused at its publish-dependency boundary; Linear note.
- **Focus:** Documentation only; authored by the orchestrator directly (write surface is
  the project workspace — no implementer needed).

## Sizing

| Dispatch | Size | dispatch-INVEST note                                                       |
| -------- | ---- | -------------------------------------------------------------------------- |
| 1        | S–M  | One outcome: engines PR open. Mechanical change; probing is environmental. |
| 2        | S    | Orchestrator-direct documentation.                                         |

## Handoff completeness

DoD condition 1 ← D1; condition 2 ← D2; condition 3 explicitly deferred past the publish
boundary (tracked on TML-2970).
