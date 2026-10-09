# Brief: D1 — rename provider, handlers and capability

## Task

Add `textDocument/prepareRename` and `textDocument/rename` to the PSL language server (`packages/1-framework/3-tooling/language-server`). The slice spec's "Chosen design" section is the design; follow it. The provider maps the result of `provideReferences` (with `includeDeclaration: true`) to text edits and has no symbol lookup of its own.

## Scope

**In:**

- `language-server`: new `src/rename.ts`, `src/project.ts`, `src/server.ts`, a new `test/rename.test.ts`, additions to `test/server.test.ts`.
- `src/guarded-connection.ts` only if the refused-name error cannot reach the client as an error response without a change. If you change it, every other handler keeps its current behaviour.
- Language-server README: add rename where the other features are listed. One statement that rename is supported. No description of how it works, what it checks or what it leaves out.

**Out:**

- `src/references.ts`, `src/cursor-resolution.ts`, anything in `psl-parser`.
- Collision checks of any kind, `@map` insertion.
- `apps/lsp-playground` (next dispatch).
- `projects/**` (read-only for you).

## Completed when

- [ ] Every test condition in the project spec's "Project Definition of Done" that names tests has a test, and every row of the slice spec's "Pre-investigated edge cases" table has a test. Tests were written before the implementation they cover.
- [ ] Each test case is a plain `it` whose name states the behaviour; no `it.each` over booleans; no "should" in names.
- [ ] `git diff find-usage -- src/references.ts src/cursor-resolution.ts` and the psl-parser package show no change.
- [ ] No code comments added. No bare `as` casts in `src/`.
- [ ] `typecheck`, `lint` and the changed test files pass for the language-server package.
- [ ] Work is committed on `psl-rename` (new commits only; no amend, no rebase, no push).

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal halts and surfaces.

## References

- Slice spec: `projects/lsp-rename/slices/rename/spec.md`
- Project spec: `projects/lsp-rename/spec.md` (behaviour table, requirements, Definition of Done)
- Closest prior work: `src/references.ts`, `test/references.test.ts`, and the `references` wiring in `src/project.ts` and `src/server.ts` (commits on `find-usage`).
- Repo rules: root `CLAUDE.md`.

## Operational metadata

- **Time-box:** 60 minutes.
- **Halt conditions:**
  - a statement in the slice spec or project spec turns out to be false in the code;
  - a design choice the specs do not settle and that changes observable behaviour;
  - a file outside "Scope: In" needs a change.
