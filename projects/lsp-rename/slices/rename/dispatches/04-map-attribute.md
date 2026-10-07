# Brief: D4 — map attribute on rename

## Task

Make rename add `@map("<old>")` / `@@map("<old>")` to the renamed declaration when the rename would change a database name and the declaration has no map attribute. The design is the slice spec's sections "Map attribute" and "Block descriptor flag"; the rules and the test list are in the project spec's "Cross-cutting requirements" and "Project Definition of Done". The operator decided the shape: the rule for models and fields is written in the language server, blocks opt in with a boolean `mappable` flag on their descriptor, and the attribute is always `map`.

## Scope

**In:**

- `packages/1-framework/3-tooling/language-server`: `src/rename.ts`, `src/project.ts` (passing what the function needs), `test/rename.test.ts`, `test/server.test.ts`, `test/helpers/reference-fixtures.ts` if a fixture is needed by both test files.
- `packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts`: the `mappable` flag on `AuthoringPslBlockDescriptor`, with a doc comment in the style of `requiresModelAttribute` next to it (this one comment is required by the spec).
- The Postgres target's `native_enum` block descriptor (`packages/3-targets/3-targets/postgres/src/core/authoring.ts`) and a test that it is `mappable`.
- One test in SQL `contract-psl` and one in Mongo `contract-psl`: a schema and the same schema with a model and a field renamed and the map attributes rename would add produce the same storage names.

**Out:**

- Any change to an interpreter, the binder, `references.ts`, `cursor-resolution.ts`.
- A family- or target-contributed function; an attribute name other than `map`; keywords of target blocks in the language server.
- READMEs (they already state that rename is supported).
- `projects/**` (read-only for you).

## Completed when

- [ ] Every item of the project spec's Definition of Done that mentions the map attribute has tests, and every row added to the slice spec's edge-case table on 2026-10-07 has a test. Tests were written before the implementation they cover. Plain `it` per case; no `it.each` over booleans; no "should".
- [ ] For every position test, the test formats the edited text with the package's formatter and asserts the attribute's line is unchanged.
- [ ] The existing rename tests still pass; expectations change only where a map attribute is now part of the edit, and you list each changed expectation in your report.
- [ ] No comment added except the doc comment on `mappable`. No bare `as` in `src/`. No word flagged by the framework vocabulary lint in `packages/1-framework/**` (`table`, `column`, `sql`, `mongo`, `postgres`, …): check with the lint.
- [ ] `typecheck`, `lint` and the changed tests pass for every changed package; then, once: full language-server tests, `pnpm lint:deps`, `pnpm test:packages` (three tarball tests fail with `ERR_PNPM_TRUST_DOWNGRADE` for reasons outside this branch; confirm the error text if you see them).
- [ ] Work is committed on `psl-rename` (new commits, `-s`, no amend, no rebase, no push).

## Standing instruction

Stay focused on the goal; control scope. Anything that pulls you off the goal halts and surfaces.

## References

- Slice spec: `projects/lsp-rename/slices/rename/spec.md` (sections "Map attribute", "Block descriptor flag", edge-case table)
- Project spec: `projects/lsp-rename/spec.md`
- Formatter layout rules: `packages/1-framework/2-authoring/psl-parser/src/format/emit.ts` (`streamRow`, `walkRegion`, `separationBlankWanted`)
- Attribute-spec resolver: `language-server/src/attribute-spec-resolution.ts`
- AST access: `psl-parser/src/syntax/ast/declarations.ts` (`attributes()`, `rbrace()`), and the `psl-ast-layers` skill at `skills-contrib/psl-ast-layers/SKILL.md`
- Storage rules being restated: SQL `contract-psl/src/interpreter.ts` (`hasExplicitMap`), Mongo `contract-psl/src/interpreter.ts` (`PSL_MONGO_VARIANT_SEPARATE_COLLECTION`)

## Operational metadata

- **Time-box:** 90 minutes.
- **Halt conditions:**
  - a statement in the specs turns out to be false in the code (for example: a field's type resolution does not tell a relation field apart, or the formatter's normal form cannot be produced by an insertion alone);
  - the rule needs a fact about a model, field or block that the language server cannot get from the binder, the attribute-spec resolver or the block descriptors;
  - a file outside "Scope: In" needs a change.
