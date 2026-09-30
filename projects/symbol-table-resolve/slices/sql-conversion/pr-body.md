## Linked issue

Follow-up to [#30349](https://github.com/prisma/orm/pull/30349) (merged binder groundwork).

## At a glance

The namespace regression uses this model pair in both `public` and `auth`, with each namespace's own mapped table names:

```prisma
// use prisma-8
namespace public {
  model User {
    id Int @id
    memberships Membership[]
    @@map("public_users")
  }
  model Membership {
    id Int @id
    userId Int
    user User @relation(fields: [userId], references: [id])
    @@map("public_memberships")
  }
}
```

With the corresponding `auth` block, `public.Membership.user` now points to `public.public_users`, while `auth.Membership.user` points to `auth.auth_users`; both backrelations emit without false ambiguity. Previously, bare-name maps could substitute the last same-named model.

## Summary

Make SQL contract lowering use the binder's resolved declaration consistently, so namespace-local relations survive FK generation and reverse-relation pairing. Remove SQL's redundant name-resolution structures and duplicate missing-type diagnostics.

## Decision

Use bound model identities throughout SQL relation lowering and pairing. Carry typed attribute declaration nodes in parser results instead of finding them again through syntax walks. Keep the binder as the missing-reference diagnostic owner, while retaining SQL's richer field-preset and extension-composition messages where those apply.

## Notes for the reviewer

- Prisma7 has an empty diff against current main. Shared pairing helpers default their generic key to strings; SQL supplies model symbols.
- Current main is merged, including its shared authoring helper extraction and unique-index participation in singular backrelation checks. These unique-column sets are now keyed by model symbol.
- Coordinate indexes remain for polymorphism and storage bookkeeping; the removed fallback is the separate name-resolution path.
- The extension-block model-reference resolver's namespace-only lookup is deferred. Mongo and language-server consumer conversion are outside this slice.

## How it fits together

1. Resolve the field's type through the binder and retrieve the mapping by its model symbol. The mapping supplies the FK target namespace and table.
2. Retain those symbols in forward/reverse relation indexes, rejected-pair bookkeeping, uniqueness checks, and junction pairing. Names are rendered only when producing user-facing output.
3. Classify model and composite fields from binder results rather than flattened name sets. Skip SQL's fallback complaint when the binder already reported that reference unresolved.
4. Distinguish bare missing names from constructor calls in diagnostic data, so a missing extension call still explains how to compose the pack.
5. Carry each resolved attribute's typed AST node from parser collection to SQL interpretation, deleting the repeated syntax searches.

## Behavior changes & evidence

- **Same-named models no longer leak relation targets across namespaces.** [Interpreter](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts) and [pairing](packages/2-sql/2-authoring/contract-psl/src/psl-relation-resolution.ts); [regressions](packages/2-sql/2-authoring/contract-psl/test/interpreter.namespaces.shared-model-names.test.ts) cover forward/reverse relations, uniqueness, invalid-pair isolation, and junctions.
- **An unresolved field type has one source diagnostic, not a second unsupported-type fallback.** [Field lowering](packages/2-sql/2-authoring/contract-psl/src/psl-field-resolution.ts) and [SQL replacement predicate](packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts); [exact diagnostic sets](packages/2-sql/2-authoring/contract-psl/test/interpreter.relations.target-voice.test.ts) and [preset coverage](packages/2-sql/2-authoring/contract-psl/test/interpreter.defaults.preset-misuse.test.ts). Independent referenced-field failures can still report separately.
- **Attribute lookup becomes a direct read, with no intended valid-schema behavior change.** [Resolved attribute nodes](packages/1-framework/2-authoring/psl-parser/src/resolve.ts) and [identity tests](packages/1-framework/2-authoring/psl-parser/test/symbol-table.test.ts).

## Compatibility / migration / risk

No new PSL syntax or diagnostic code is introduced. Consumers inspecting diagnostic lists should expect the existing `PSL_UNRESOLVED_REFERENCE` instead of duplicate SQL fallback errors. Internal code manually constructing `ResolvedAttribute` values must include the originating node. No Prisma7 source migration is needed, and no demos/examples/CI changes are part of the branch delta.

## Testing performed

At merged implementation HEAD `2c815e3163` (or identical working implementation immediately before its merge commit):

- `pnpm install --frozen-lockfile` — pass; no lockfile churn.
- `pnpm build --filter=@internal/sql-contract-psl... --filter=@internal/sql-contract-prisma7... --filter=@internal/cli...` — 33 tasks passed; then `pnpm build` — 87 tasks passed.
- `pnpm --filter @internal/sql-contract-psl typecheck`, `pnpm --filter @internal/psl-parser typecheck`, `pnpm --filter @internal/sql-contract-prisma7 typecheck` — pass, including test source coverage.
- `pnpm --filter @internal/sql-contract-psl lint`, `pnpm --filter @internal/psl-parser lint` — pass; parser has three informational vocabulary notices.
- `pnpm --filter @internal/sql-contract-psl test` — 543 tests passed; parser equivalent — 1059 passed; Prisma7 equivalent — 129 passed.
- `pnpm --filter integration-tests test test/psl-print/constraints-roundtrip.integration.test.ts` — 10 cases passed across runtime/typecheck projects, including upstream unique-index roundtrip coverage.
- `pnpm lint:deps`, `pnpm lint:casts`, and `pnpm lint:throws` — pass; throw count unchanged at 40.
- `pnpm fixtures:check` — pass, exit 0; fixture emission and migration regeneration completed with zero tracked drift.
- [Manual CLI QA](projects/symbol-table-resolve/slices/sql-conversion/manual-qa-reports/2026-09-28-slice-close-r3.md) — duplicate-namespace emission, typo refusal, bare-versus-constructor diagnostics, and explicit qualification pass.
- **Accepted full-workspace limitations:** 39 failures reproduced on baseline, plus full-run CLI telemetry (5000ms) and Postgres migration roundtrip (8000ms) timeouts that passed in isolation. Full workspace suites were not rerun after the merge; the affected-package and focused integration results above are the post-sync coverage.

## Skill update

No authoring workflow or descriptor SPI is added: the correction makes existing namespace syntax reliable. Existing diagnostic codes remain, with fewer duplicate messages. No end-user skill update is required; the behavior and compatibility boundary are documented here and in the focused manual QA.

## Checklist

- [x] All branch commits, including the merge, have author-matching DCO signoffs.
- [x] CONTRIBUTING.md read; one logical concern: SQL's use of binder results.
- [x] Behavioral regressions are covered by tests.
- [ ] Linear-prefixed title — N/A for this follow-up to #30349.
- [x] Skill update section filled in.

## Alternatives considered

- Keeping a bare-name fallback would retain the namespace collision even though the binder had already selected the correct declaration.
- Retyping Prisma7 to model symbols would unnecessarily convert an explicitly excluded consumer; defaulted key generics preserve its string-based usage.
- Deleting every coordinate index would remove legitimate polymorphism/storage bookkeeping unrelated to name resolution, so those indexes remain.
