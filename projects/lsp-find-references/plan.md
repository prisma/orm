# lsp-find-references — Plan

**Spec:** `projects/lsp-find-references/spec.md`
**Linear Project:** none (skipped by operator)

## At a glance

The project is one slice, delivered as one PR. It adds `textDocument/references` to the language server, records a `namespace` resolution on namespace block names in the binder, and makes go-to-definition on a declaration's own name return that declaration.

## Composition

### Stack (deliver in order)

1. **Slice `find-references`**. Linear: none. Folder: `projects/lsp-find-references/slices/find-references/`
   - **Outcome:**
     - The language server declares `referencesProvider` and answers `textDocument/references` for models, composite types, named types, blocks (including enum blocks), fields and namespaces, from a declaration name or from a reference, across every schema file of the project.
     - Go-to-definition on a declaration's own name returns the declaration's location; on a namespace block name it returns every block of the namespace.
     - Every other position returns an empty references result.
   - **Builds on:** `main`. `resolvedNodeAt`, the per-project binder in `ProjectArtifacts` and the declaration-name resolutions from #30569 are already merged.
   - **Hands to:** Project close-out, and the future rename project: a function that returns, for a cursor position, the identifier token ranges of every usage of the symbol at that position, with declarations marked.
   - **Focus:**
     - `binder.ts`: a `namespace` resolution on the name node of each `namespace` block, with a psl-parser binder test for a namespace declared in two blocks;
     - checking the existing readers of binder resolutions for the new one:
       - hover on a namespace block name starts showing `namespace <name>` (`hover.ts` already renders the `namespace` kind); the slice adds a hover test for it and the README sentence on hover is checked against it;
       - semantic tokens, completion and signature help are expected to be unaffected, confirmed by their existing tests;
     - a new `references.ts` provider: target symbol from `resolvedNodeAt`, text search per project file, exact identifier token check, `resolvedNodeAt` on each candidate, symbol identity comparison, token ranges, `includeDeclaration`, and the namespace rule (block names always returned);
     - an accessor on `ProjectArtifacts` for every project document with its text, parsed document and source file;
     - `Project.references` with the same membership checks as `definition`, and the `referencesProvider` capability and handler in `server.ts`, with a capability test;
     - `definition.ts`: remove the `null` on a declaration's own name, and change the tests that assert it;
     - tests for every item in the spec's Definition of Done;
     - the language-server README entry;
     - `apps/lsp-playground`: README entry and a hand check of references in another scratch file (spec open question 1);
     - the manual QA script and run in VS Code.

## Dependencies (external)

None. Everything the slice consumes is on `main`.

## Sequencing rationale

- **Why one slice.** The three changes are only useful together. The binder change has no visible effect except through find references and go-to-definition on a namespace block name. The go-to-definition change gives VS Code something to show only once `referencesProvider` is declared. Each is small, and one reviewer can read the provider, the binder lines and the definition change in one sitting.
- **Why the binder change is not its own PR.** A binder-only PR would be preparation with no consumer, and its one observable effect (hover on a namespace block name) is a side effect, not the reason for the change.
