# Brief: D3 providers-emit-membership-set

## Task

Make both PSL providers emit one contract from the whole membership set. In `packages/2-sql/2-authoring/contract-psl/src/provider.ts` and the Mongo twin: `load()` reads **every** `context.resolvedInputs` entry (treat the list as a set — sort internally so the emitted contract is independent of input order), applies the directive gate to each file's text, parses each member with its own path as the source id, merges all parse results into one `PslSources` registry, builds one symbol table over all documents, and interprets once with the full `documents` array. The directive predicate (`isPrismaNextSchema`, `renameLegacyDirective`) relocates from `language-server/src/schema-directive.ts` to an exported `@internal/psl-parser` module; the language server imports the new home (pure relocation, no behavior change). A glob-matched file whose text lacks the directive is silently not a member (project decision 2). Error semantics per the slice spec's edge-case table: zero `resolvedInputs` → error diagnostic naming the configured patterns (working code `PSL_NO_SCHEMA_FILES_MATCHED`); members matched but none carries the directive → error listing the candidate files that lacked it (working code `PSL_NO_OPTED_IN_SCHEMA_FILES`); an unreadable file keeps the existing per-file `PSL_SCHEMA_READ_FAILED` and collection continues. Adjust the working diagnostic codes to the existing catalog's naming conventions if they conflict. Ship a multi-file fixture (≥3 files: cross-file model references, a reopened namespace across two files, plus one directive-less file that must be excluded) and the emission-determinism test: `load()` with permuted `resolvedInputs` orderings produces byte-identical contract JSON. If merging N per-file `PslSources` into one registry needs a helper, put it in `psl-parser` next to the existing multi-document test utilities. Tests before implementation.

## Scope

**In:** Both `contract-psl` providers (+ their tests/fixtures), the directive-predicate relocation (`psl-parser` + language-server import fix), any small `PslSources`-merging helper in `psl-parser`.

**Out:** Output derivation and `defineConfig` wrappers (D4); `orm format` (D4); language-server behavior (slice 3); `contract-prisma7`.

## Completed when

- [ ] Determinism test green: permuted `resolvedInputs` orderings → byte-identical contract JSON (delivers AC-1).
- [ ] Directive-exclusion test green: the fixture's directive-less file absent from the emitted contract (delivers AC-2).
- [ ] `rg 'resolvedInputs\[0\]|const \[absoluteSchemaPath\]'` over both providers returns nothing.
- [ ] `language-server/src/schema-directive.ts` is gone; the language server imports the predicate from `@internal/psl-parser`; language-server tests green.
- [ ] Full validation gate set green.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes with a one-line note; drift halts and surfaces.

## References

- Slice spec §§ Chosen design + Pre-investigated edge cases; plan § Dispatch 3; project decisions entries 1–3.
- Multi-document precedent: `packages/1-framework/2-authoring/psl-parser/test/symbol-table.multiple-documents.test.ts` (its merge helper is the shape to promote if needed).
- Repo rules: `.agents/rules/non-vacuous-verification.mdc` (determinism test must fail if sorting is removed — verify by temporary mutation, don't commit it), `.agents/rules/use-ast-factories.mdc`, `.agents/rules/running-tests.mdc`, `.agents/rules/git-staging.mdc`.

## Operational metadata

- **Model tier:** `mid` (`implementer/fast`).
- **Time-box:** 90 minutes wall-clock (the slice's largest dispatch).
- **Halt conditions:** first-wins duplicate-declaration semantics under sorted order produce a user-visible attribution change that any existing test pins differently (surface, don't re-pin); the directive gate needs config-layer knowledge inside `psl-parser` (layering smell — surface); an out-of-scope surface must change to compile.
