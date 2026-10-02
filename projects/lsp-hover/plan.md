# lsp-hover — Plan

**Spec:** `projects/lsp-hover/spec.md`
**Linear Project:** none (skipped by operator)

## At a glance

The project has two stacked slices.

1. The first adds `textDocument/hover` for everything the binder already resolves, and reads `///` doc comments. It changes the language server, plus a `docComment()` method on the psl-parser AST classes. The binder is unchanged.
2. The second adds the binder resolutions that only hover needs (`parameter`, `function`, `constant`, block `attribute`), plus the hover rendering for them.

## Composition

### Stack (deliver in order)

1. **Slice `hover`**. Linear: none. Folder: `projects/lsp-hover/slices/hover/`
   - **Outcome:** The language server declares `hoverProvider` and answers `textDocument/hover` for these:
     - `model`, `compositeType`, `field`, `namedType` and `block`, both declarations and references, with `///` documentation when present;
     - model and field `attribute` resolutions;
     - `contributedType`;
     - block keywords.

     Every other position returns `null`.
   - **Builds on:** The `go-to-definition` branch (stack base, per the spec). Nothing from it is consumed: the binder in `ProjectArtifacts` is already on `main`.
   - **Hands to:**
     - a hover provider that maps a `Resolution` to content through one switch on `kind`, so a new resolution kind is one new case;
     - the cursor-to-resolution lookup;
     - the declaration-line renderer;
     - the `///` reader.
   - **Focus:**
     - the `///` reader: a run of consecutive `///` lines above a declaration, broken by a blank line or a `//` line;
     - the declaration-line renderer for models, composite types, fields, named types and blocks (the spec's two open questions are settled here);
     - attribute signature labels shared with `signature-help.ts`;
     - contributed-type fallback from descriptor `args`;
     - server registration and the capability test;
     - tests for references across files;
     - the README entry.

     No `binder.ts` changes.

2. **Slice `hover-arguments`**. Linear: none. Folder: `projects/lsp-hover/slices/hover-arguments/`
   - **Outcome:** The binder records:
     - `parameter` on named attribute-argument keys, named function-call-argument keys and struct-block entry keys;
     - `function` on function-call names;
     - `constant` on fixed identifier values;
     - `attribute` (level `'block'`) on block attribute names.

     Hover shows each of them with its documentation.
   - **Builds on:** Slice 1's hover provider and its `kind` switch.
   - **Hands to:** Project close-out. Every row of the spec's At-a-glance table answers.
   - **Focus:**
     - the `Resolution` union and `AttributeSymbol.level` in `binder.ts`;
     - binding in `bindAttributes`, `bindBlock`, `bindArguments` and `tryBindExpression`, where symbols recorded in `oneOf` trials are kept only for the matching alternative;
     - psl-parser binder tests;
     - checking that every existing binder consumer is unaffected by the new kinds (SQL/Mongo interpreters, completion, semantic tokens, signature help, and definition if go-to-definition slice 2 has landed);
     - the hover cases and tests for the new kinds;
     - the manual QA script and run covering the full spec table.

## Dependencies (external)

- [ ] **`lsp-go-to-definition` slice 1, PR #30563** (open). Both slices are stacked on it. Slice 2 edits `binder.ts`, which #30563 also rewrites.
- [ ] **`lsp-go-to-definition` slice 2** (not started). It adds a cursor-to-resolution lookup for definition. Whichever of it and this project's slice 1 lands first owns that helper, and the other reuses it. If it lands first, it must also return `null` for the new resolution kinds before this project's slice 2 merges.

## Sequencing rationale

- **Why this split.** Hover for existing resolutions is useful without any binder change: users get model, field and attribute documentation and `///` comments. So it ships first and keeps the binder review separate from the language-server review.
- **Why slice 2 can't run in parallel.** Its hover cases plug into slice 1's provider. A parallel binder-only slice would have no consumer and would only be preparation for slice 1.
