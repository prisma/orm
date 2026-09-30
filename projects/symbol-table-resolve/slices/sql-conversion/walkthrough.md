# Walkthrough — SQL lowering follows bound model identities

## Sources and intent

Range: `origin/main...2c815e3163` (fetched main `e1f125185e`). The full 21-file implementation/test diff was read. [Slice specification](spec.md) and [project decisions](../../design-decisions.md) supply intent; Linear is deliberately omitted. No PR exists yet.

The SQL interpreter must lower the declaration the binder resolved, not reinterpret a written name through an unrelated table. Two namespaces can both declare `User` and `Membership`: an unqualified relation in each must retain that namespace through FK construction, reverse relations, uniqueness checks, and junction recognition.

## The story

1. **Carry the resolved declaration all the way to storage.** The binder already chooses the target. SQL now looks up the mapping by that `ModelSymbol`, using the mapping's namespace when emitting the FK. A last-wins bare-name map can no longer substitute `auth.User` for `public.User`.
2. **Pair relations by identity too.** Fixing forward FKs alone leaves false ambiguity on reverse relations. The pairing indexes, rejected-pair records, ID/unique-column maps, and junction comparisons now retain model identities. Shared helpers use a defaulted key parameter, so the Prisma7 consumer continues using strings without source changes.
3. **Keep the binder's diagnostic instead of adding a fallback opinion.** Unresolved field types no longer also trigger SQL's unsupported-type fallback. A bare `pgvector.Vector` retains the binder's missing-type diagnostic; `pgvector.Vector(1536)` retains SQL's richer extension-composition guidance. This requires distinguishing constructor calls in binder diagnostic data.
4. **Read attribute nodes already collected by the parser.** A resolved attribute carries its typed declaration node. SQL stops walking syntax again to locate the same node; the defaulted generic preserves existing consumers. This is structural cleanup, not a new authoring syntax.

## Behavior changes and evidence

- **Correct namespace-local foreign keys and reverse relations.** [Interpreter](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts) and [relation pairing](../../../../packages/2-sql/2-authoring/contract-psl/src/psl-relation-resolution.ts) use resolved identities. [Duplicate-name regressions](../../../../packages/2-sql/2-authoring/contract-psl/test/interpreter.namespaces.shared-model-names.test.ts) cover both directions, singular uniqueness, invalid-pair isolation, and junctions. [Manual CLI run](manual-qa-reports/2026-09-28-slice-close-r3.md) confirms the public authoring flow.
- **One source diagnostic for a simple unknown field type, with richer constructor advice preserved.** [Field lowering](../../../../packages/2-sql/2-authoring/contract-psl/src/psl-field-resolution.ts), [replacement predicate](../../../../packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts), and [binder tagging](../../../../packages/1-framework/2-authoring/psl-parser/src/binder.ts) implement the boundary. [Target-voice tests](../../../../packages/2-sql/2-authoring/contract-psl/test/interpreter.relations.target-voice.test.ts) and [preset-misuse tests](../../../../packages/2-sql/2-authoring/contract-psl/test/interpreter.defaults.preset-misuse.test.ts) assert exact diagnostic sets. Independent missing referenced fields may still produce their own diagnostics; this is not a blanket one-error-per-schema policy.
- **Attribute node reuse without a CST search.** [Resolved attributes](../../../../packages/1-framework/2-authoring/psl-parser/src/resolve.ts) retain field/model AST types, and [symbol-table tests](../../../../packages/1-framework/2-authoring/psl-parser/test/symbol-table.test.ts) pin the carried node identity. No behavior change is intended for valid attributes.

## Merge reconciliation

The signed-off merge of current main preserves upstream block/enum diagnostics, shared authoring/parser helper ownership, and unbound-namespace constants at live callers. Unique indexes over plain columns with no partial predicate still participate in singular backrelation checks, but the sets are keyed by model symbol. The Mergiraf-resolved field/relation files were inspected against the pre-merge branch: only upstream helper imports and uniqueness documentation were added there; the branch generic maps remain intact. The upstream [constraint roundtrip tests](../../../../test/integration/test/psl-print/constraints-roundtrip.integration.test.ts) pass after the merge.

## Compatibility and scope

Prisma7 is byte-for-byte identical to fetched main. There are no branch changes to demos/examples/CI or the lockfile. Internal consumers constructing `ResolvedAttribute` values now need a node; readers using its default generic remain source-compatible. Diagnostic consumers should expect the existing `PSL_UNRESOLVED_REFERENCE` instead of a duplicate `PSL_UNSUPPORTED_FIELD_TYPE` for names the binder could not resolve. Coordinate indexes used for polymorphism/storage remain; they are not alternate relation name resolvers.

The extension-block model-reference resolver's namespace-only lookup is explicitly deferred under the block-reference design decision. Mongo and LSP consumer conversion are subsequent slices, not delivered here.

## Validation boundaries

Post-sync package tests: SQL 543, parser 1059, Prisma7 129; focused upstream constraint roundtrip 10 cases across runtime/typecheck projects. Package typechecks and SQL/parser lints pass, full build passes (87 tasks), dependency and cast gates pass. Fixtures and the throw ratchet passed on independent-budget reruns (exit 0; zero fixture drift and unchanged throw count of 40), completing the two initially timed-out gates. The accepted 39 baseline workspace failures and two isolated-passing/full-run timeout cases remain accepted limitations, not a green workspace suite. See [close checklist](close-checklist.md) for exact commands and evidence paths.
