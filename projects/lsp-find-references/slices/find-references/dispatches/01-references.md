# Brief: D1 — references, binder namespace names, definition on declarations

## Task

Add `textDocument/references` to the PSL language server (`packages/1-framework/3-tooling/language-server`), record a `namespace` resolution on every namespace block's name node in the binder (`packages/1-framework/2-authoring/psl-parser/src/binder.ts`), and make go-to-definition on a declaration's own name return that declaration. The slice spec's "Chosen design" section is the design; follow it.

## Scope

**In:**

- `psl-parser`: `src/binder.ts`, binder tests, README sentence on which declaration names carry a resolution.
- `language-server`: new `src/references.ts`, `src/definition.ts`, `src/project-artifacts.ts`, `src/project.ts`, `src/server.ts`, a new `test/references.test.ts`, changes to `test/definition.test.ts`, `test/server.test.ts`, `test/hover.test.ts` (one test: hover on a namespace block name), README.
- `apps/lsp-playground/README.md`: list find references among the requests the editor sends.

**Out:**

- Any other binder behaviour, any diagnostics.
- Enum member references, rename, document highlight.
- `apps/lsp-playground` source code.
- `projects/**` (read-only for you).

## Completed when

- [ ] Every test condition in the project spec's "Project Definition of Done" has a test, and every row of the slice spec's "Edge cases" table has a test. Tests were written before the implementation they cover.
- [ ] Every location returned by the provider is the range of one identifier token.
- [ ] The token lookup at the cursor is shared between `definition.ts` and `references.ts`, not copied.
- [ ] Existing semantic-token, completion and signature-help tests pass without edits.
- [ ] The validation gates below pass.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal — even if it looks useful — halts and surfaces.

## References

- Slice spec: `projects/lsp-find-references/slices/find-references/spec.md`
- Slice plan entry: `projects/lsp-find-references/slices/find-references/plan.md` § Dispatch 1
- Project spec: `projects/lsp-find-references/spec.md` (behaviour table, requirements, Definition of Done)
- Closest prior work: commit `7bc1b4dd20` (go-to-definition), especially `language-server/src/definition.ts`, `src/cursor-resolution.ts`, `test/definition.test.ts`, and the `definition` wiring in `project.ts` and `server.ts`.

## Operational metadata

- **Model tier:** mid — a new provider with a known pattern to follow.
- **Time-box:** 90 minutes.
- **Halt conditions:**
  - a statement in the slice spec or project spec turns out to be false in the code;
  - a design choice the specs do not settle and that changes observable behaviour;
  - a file outside "Scope: In" needs a change;
  - an existing semantic-token, completion or signature-help test fails because of the binder change.
