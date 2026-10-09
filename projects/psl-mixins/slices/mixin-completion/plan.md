# Slice plan: mixin-completion

**Spec:** `projects/psl-mixins/slices/mixin-completion/spec.md`

## Dispatch plan

### Dispatch 1: completion after `+`

- **Outcome:** The spec's "Completion after `+`" table holds, `+` is a trigger character, and a test covers each row and each exclusion. `language-server` typecheck, tests and lint pass.
- **Builds on:** Mixin symbols in scope entries and `lookupMixinReference` from `mixin-inclusion`.
- **Hands to:** A completion context kind for an inclusion, and mixin items in the scope item builder.
- **Focus:** tests first. `classifyPslCompletionContext` (before the entry-key rule), `providePslCompletionItems`, `scopeCompletionItems`, `server.ts`.

### Dispatch 2: completion and signature help inside a mixin body, and keys from symbols

- **Outcome:** The spec's "Inside a mixin body" table and "Keys a block already has" hold, each cell tested against the same position in an ordinary block. `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps` and package lint pass apart from the known environment failures.
- **Builds on:** Dispatch 1's classifier changes.
- **Hands to:** The code part of the slice complete.
- **Focus:** tests first. The classifier's enclosing-declaration checks, the owner types and `attributeSpecResolver`, `ownerSyntax`, `localFieldNames`, `existingGenericBlockParameterNames`, `signatureOwner`, `blockValueSignatureContext`; the README.

### Dispatch 3: the ADR and the RC feature list

- **Outcome:** The ADR is written to `docs/architecture docs/adrs/` with the next free number, and `projects/prisma-8-rc1/feature-surface.md` item 6 shows the agreed spelling.
- **Builds on:** `projects/psl-mixins/spec.md` and `team-brief.md` for the decisions and alternatives.
- **Hands to:** The project's documentation items met.
- **Focus:** documents only, following the `write-architecture-docs` skill.

### Dispatch 4: manual QA script and run

- **Outcome:** `projects/psl-mixins/qa/manual-qa.md` and one run report exist; the report shows each scenario's result.
- **Builds on:** Dispatches 1 and 2, and `mixin-navigation`.
- **Hands to:** The branch ready for the PR.
- **Focus:** the `drive-qa-plan` and `drive-qa-run` skills, reusing the `lsp-rename` driver.
