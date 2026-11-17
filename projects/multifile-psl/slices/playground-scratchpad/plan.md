# playground-scratchpad — Dispatch plan

Spec: [`./spec.md`](./spec.md). Two dispatches, sequential.

### Dispatch 1: scratch-project-server-side

- **Outcome:** `psl-playground` (no arguments) stages/reuses the gitignored scratch directory with the three seed files, generates the glob config (`contract: './scratch/**/*.prisma'`), and serves the plural `RuntimeConfig` (`members: { uri, text }[]` + scratch-root URI) from `/__psl_playground_runtime.json`. A positional argument exits with the clear error. The client still compiles (temporary shim: it may render only the first member until dispatch 2).
- **Builds on:** The spec's chosen design; slice 1's glob config surface (on main).
- **Hands to:** The plural runtime contract dispatch 2 renders.
- **Focus:** `cli.ts`, `default-config.ts`, seeding, runtime endpoint + `RuntimeConfig` type and its client-side validator mirror. Not the tab UI.

### Dispatch 2: tabs-and-lazy-open

- **Outcome:** the client registers one memory file per member, renders the tab strip, opens the first tab on startup and every other tab lazily on first click (`openTextDocument` only then); the format button acts on the active document; README updated including the interim limitation. The slice's three done conditions verifiably hold via a manual run.
- **Builds on:** Dispatch 1's plural runtime contract.
- **Hands to:** Slice DoD; the manual test bench slice 3 verifies against.
- **Focus:** `client/main.ts`, `index.html`, README. No LSP behavior changes.

## Handoff-contract check

Linear; dispatch 2 consumes dispatch 1's contract. All three slice done conditions land in dispatch 2 (conditions 1–2 verified by manual run + bridge traffic; condition 3 by dispatch 1's error path, re-verified at close).

## Size distribution

D1 M · D2 M.
