# Slice: mongo-conversion

## At a glance

Convert the Mongo PSL interpreter to binder-based resolution without adding capabilities. Mongo continues rejecting every explicit namespace, as confirmed by the operator. Branch `mongo-conversion` started at SQL PR #30478's `d500d01d8b`. After SQL merged, `origin/main` at `9b5e188bcd` was merged without conflicts or history rewriting; the PR diff contains only Mongo changes and this slice record.

## Chosen design

Use `binder.symbolForNode(typeReferenceNode(field))` for type and relation classification. Use resolved declarations to obtain lowering metadata instead of resolving their names again. Keep the existing binder-backed polymorphism references. Consume `ResolvedAttribute.node` directly rather than finding the same attribute in the AST again.

The binder owns unresolved references. Remove blanket suppression of type-reference diagnostics and local unresolved-type fallbacks. Preserve specific constructor/preset diagnostics with narrowly justified suppression, and keep semantic validation distinct from resolution. Resolve physical names through attribute interpretation exactly once; do not add manual mapping parsers, validation-only passes, parallel coordinate indexes, or duplicate per-model name maps. If a replacement physical-name index is necessary, use at most one symbol-keyed map.

Preserve output bookkeeping and existing relation-pairing behavior unless they actually re-resolve declarations. Mongo's accepted top-level model names are unique; SQL's namespace-specific pairing changes are not a reason to redesign Mongo's helper.

## Coherence rationale

One interpreter stops answering declaration-resolution questions independently of its existing binder. Attribute-node reuse removes redundant traversal in the same interpretation paths.

## Scope

**In:** Mongo `contract-psl` implementation, package tests, and directly affected downstream diagnostic expectations.

**Out:** Namespace support, SQL/Prisma7 conversion changes, parser APIs, language-server conversion, new contract features, unrelated test flakes, and CI/example changes without approval.

## Pre-investigated edge cases

- Namespace declarations remain rejected; do not promise successful namespace lowering. Test supported shadowing of contributed types by declarations.
- Exact diagnostic sets must expose duplicate messages. Existing orphaned-relation/base semantic errors are not duplicate unresolved-reference errors and must not be silently removed.
- Presets, enum blocks, mapped forward relations, indexability, and wildcard indexes retain their semantics.
- SQL's missed CLI assertion requires checking provider and downstream tests as well as package tests.

## Slice-specific done conditions

- [x] No parallel type/relation name resolver or attribute AST re-walk remains in the converted interpreter paths; namespace rejection is unchanged.

D1 and D2 passed independent review. Preset collisions retain binder precedence; suppression follows actual preset handling. Final implementation at `021b221dbb` passed 277 Mongo package tests, 120 downstream tests across integration and packaging, both package and integration typechecks, dependency-chain build, fixtures, dependency checks, and the cast gate. Production changes remove 30 net lines. D3 needed no downstream fixes. The D2 reviewer replaced the D1 reviewer after the harness could no longer resume that agent.

## Open Questions

None. The operator explicitly confirmed that this slice changes resolution, not Mongo namespace capabilities.

## Dispatch plan

1. **D1 — Binder-owned classification and diagnostics.** Builds on the shared binder and SQL's resolved-attribute API. Replace type/relation classification sets and target-name lookups with binder results; adopt binder diagnostics with exact test assertions. Hands to D2: correct classification and diagnostics with presets, enums, composites, mapped relations, and namespace rejection preserved. Tests precede implementation. Gates: Mongo package tests/typecheck, changed-file lint, dependency build as needed.
2. **D2 — Direct attribute nodes and physical-name simplification.** Builds on D1. Remove model/field attribute lookup helpers and positional AST joins; simplify redundant physical-name metadata without reinterpreting attributes. Hands to D3: no competing resolver or traversal and green whole-result mapping/polymorphism/index tests. Same package gates.
3. **D3 — Downstream verification and review.** Builds on D1–D2. Validate provider and relevant Mongo integration/packaging paths, dependency boundaries, and fixtures; correct only conversion-related expectations. Hands to PR: reviewed Mongo-only conversion with explicit diagnostic changes and preserved namespace rejection. Run `pnpm lint:deps`, `pnpm fixtures:check`, and focused integration tests through the local package script. Do not repeat previously waived unrelated workspace failures.

## References

- [Project spec](../../spec.md)
- [Project plan](../../plan.md)
- [Learnings](../../learnings.md)
- [SQL PR #30478](https://github.com/prisma/orm/pull/30478)
