# Brief: D1 plural-interpreter-input

## Task

Make the PSL interpreter input plural and remove the last consumer of the singular anchor document. `PslInterpretInput` (`packages/1-framework/2-authoring/psl-parser/src/interpret.ts`) changes from `{ document: DocumentAst; sources; symbolTable }` to `{ documents: readonly DocumentAst[]; sources; symbolTable }`. In both interpreters (`packages/2-sql/2-authoring/contract-psl/src/interpreter.ts` and `packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts`), the `PSL_TARGET_CONTEXT_REQUIRED` and `PSL_SCALAR_TYPE_CONTEXT_REQUIRED` guard diagnostics become `InternalError` assertions (these states are unreachable through the typed configuration surface — `PrismaContractOptions.target` is required and always forwarded; see `projects/multifile-psl/design-decisions.md` entry 3), and their `InterpretPsl*Input` types drop the now-unused anchor `document` field in favor of `documents`. All consumers adapt at compile level with behavior unchanged: both providers pass `documents: [document]`, the language server passes `documents: [document]` inside its existing per-open-document interpret loop (`packages/1-framework/3-tooling/language-server/src/project-artifacts.ts`). Write or update tests before implementation per repo convention.

## Scope

**In:** `psl-parser` interpret types; both `contract-psl` interpreters and providers (SQL + Mongo); language-server interpret call sites (compile-level only); tests of all the above that touch the changed shapes.

**Out:** Any glob or multi-file reading (D2/D3); config packages; `defineConfig` wrappers; `orm format`; language-server behavior changes beyond the compile fix; `contract-prisma7` (its interpreter is separate and stays as is).

## Completed when

- [ ] `rg 'input\.document\b'` over `packages/2-sql/2-authoring/contract-psl/src` and `packages/2-mongo-family/2-authoring/contract-psl/src` returns nothing.
- [ ] `rg 'PSL_TARGET_CONTEXT_REQUIRED|PSL_SCALAR_TYPE_CONTEXT_REQUIRED'` in production code returns only `InternalError`-path occurrences (no diagnostic pushes); tests asserting those diagnostics are updated to assert the throw.
- [ ] Full validation gate set green (see § Validation gates in the delegation prompt).

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal — even if it looks useful — halts and surfaces.

## References

- Slice spec: `projects/multifile-psl/slices/multi-file-emit/spec.md` — chosen design + coherence rationale + slice-DoD.
- Slice plan entry: `projects/multifile-psl/slices/multi-file-emit/plan.md` § Dispatch 1.
- Project decisions: `projects/multifile-psl/design-decisions.md` — entry 3 is this dispatch's rationale.
- PSL layering guidance: invoke the `psl-ast-layers` skill before touching `psl-parser` internals.
- Repo rules that bite here: `.agents/rules/prefer-assertions-over-defensive-checks.mdc`, `.agents/rules/prefer-to-throw.mdc` (assert the throw with `expect().toThrow()`), `.agents/rules/running-tests.mdc` (save gate output to a file once; don't re-run to grep), `.agents/rules/git-staging.mdc`.

## Operational metadata

- **Model tier:** `mid` (`implementer/fast`) — mechanical substrate change with well-pinned design; no open judgment.
- **Time-box:** 60 minutes wall-clock. Overrun → halt and surface.
- **Halt conditions:** an out-of-scope surface must be touched to compile; either interpreter consumes `input.document` beyond the diagnostic anchor at sql `interpreter.ts:2055` / mongo equivalent; a test reveals the "unreachable" states are in fact reachable through a typed surface (that falsifies design-decision 3 — halt, do not adapt silently).
