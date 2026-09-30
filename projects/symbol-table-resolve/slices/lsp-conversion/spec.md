# Slice: lsp-conversion

## At a glance

Use the PSL binder for existing language-server features, removing reverse-binding span scans and independent declaration-resolution cascades. The branch starts from Mongo PR #30538 while it awaits merge. No new LSP features or interpreter capabilities are included.

## Chosen design

The binder retains lexical scopes and exposes `scopeAt(node)`. Scope enumeration returns one entry per visible name with exactly the same kind-blind shadowing as lookup; filtering for a completion category happens afterward. Qualified completion enumerates only members of the resolved namespace. Scope retrieval uses snapshot-owned node identity and existing ancestor navigation, not span scans or another cursor resolver.

Language-server project artifacts own the binder alongside the symbol table, invalidating both on snapshot or configuration changes. Completion contexts retain their existing typed field nodes. Attribute/signature contexts use binder-declared owners, while incomplete attribute-name completion continues using the existing spec registry. Semantic tokens use binding results for references rather than string-based classification. Existing presentation-only tokens must not gain invented resolution diagnostics.

Diagnostic publishing selects exactly one semantic source. Keep parse and symbol-table diagnostics independent. When an interpreter exists, publish its warnings and failure diagnostics without appending binder output. When interpretation is unavailable, publish binder diagnostics using the configured control stack. Caught interpreter exceptions retain the existing failure marker and retry behavior, without binder fallback; cancellation continues to propagate. Missing or failed initial configuration does not create a standalone binder project.

Record named-type base annotation references in the binder without introducing new unresolved-base diagnostics or recursive alias interpretation, so completion and semantic tokens share resolution. Preserve constructor-versus-nonconstructor completion distinctions. For expressions without binding, semantic tokens use plain `type` with no modifiers rather than guessing a declaration from its spelling; preserve existing syntactic property/decorator/literal handling.

## Coherence rationale

The scope API supplies the missing enumeration operation needed to remove the LSP's competing resolver. All existing consumers convert within this slice.

## Scope

**In:** Parser binder/scope APIs and tests; existing language-server completion, signature help, semantic tokens, diagnostic publishing and snapshot lifecycle; directly affected tests.

**Out:** Go-to-definition, hover, new language features, namespace support changes, SQL/Mongo/Prisma7 interpretation changes, unrelated framework refactors, and CI/example changes without approval.

## Pre-investigated edge cases

- Filter visible symbols only after nearest-name shadowing, including cross-kind shadowing and contributed types.
- Preserve reopened namespace identity, multi-file source ownership and snapshot invalidation.
- Missing qualified members must not fall back to a top-level declaration.
- Assert exact diagnostic sets; interpreter-specific preset messages must not acquire a second binder error.
- Avoid duplicate name indexes, AST re-walks, compatibility helpers and unnecessary process artifacts. Validate the full relevant lint scripts, not just changed-file formatting.

## Slice-specific done conditions

- [x] Existing LSP declaration queries and completion enumeration use the binder; reverse-binding scans and duplicated name-resolution cascades are removed.

D1 and D2 passed independent review. The D2 reviewer replaced the previous reviewer after its harness session became unavailable. Review identified malformed decorator-name highlighting lost during conversion; `46e966273d` fixes it through a typed segments getter with test-first parser and token regressions.

Validation at `46e966273d`: parser 1,166 tests, LSP 751, SQL 572, Mongo 277, Prisma7 132, and 20 focused integration tests passed. All five package typechecks, integration typecheck, builds, fixtures, package lint and repository lint gates passed. LSP tests use two workers after a parallel dynamic-import timeout; no timeout was increased. Packaging installation was blocked by `ERR_PNPM_TRUST_DOWNGRADE` for `@vercel/detect-agent@1.2.5`; it was not bypassed or reported green. Production source is net 122 lines smaller than the Mongo prerequisite.

## Open Questions

None. Diagnostic ownership and presentation policy are specified above; no additional interpreter validation is introduced for named-type bases or arbitrary expressions.

## Dispatch plan

1. **D1 — Enumerable retained scopes.** Builds on the existing binder. Add `entries()` and `scopeAt(node)` with lookup-equivalent shadowing and snapshot ownership. Hands to D2: tested, exported scope API without a parallel name resolver. Tests first; parser tests/typecheck/build and affected downstream typechecks.
2. **D2 — Existing LSP features use binding.** Builds on D1 and the resolved diagnostic/presentation policy. Replace owner span scans, declaration classification and completion candidate enumeration; integrate the binder into artifact invalidation. Hands to D3: existing features migrated, precise regressions green, redundant helpers deleted. Tests first; LSP tests/typecheck and parser regression gates.
3. **D3 — Verify consumers and publish.** Builds on D2. Verify exact diagnostics, snapshot/config changes, multi-file resolution, signature help and semantic tokens through relevant integration tests. Run full relevant package lint plus repository gates, dependency builds and downstream typechecks. Independently review before opening the PR; no history rewriting of queued prerequisite branches.

## References

- [Project spec](../../spec.md)
- [Project plan](../../plan.md)
- [Learnings](../../learnings.md)
- [Mongo PR #30538](https://github.com/prisma/orm/pull/30538)
