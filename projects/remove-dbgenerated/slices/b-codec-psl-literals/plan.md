# Slice B plan — rework of the branch to ADR 254

Spec: [`spec.md`](spec.md). One implementer and one reviewer, resumed across every dispatch. Review artifact: `wip/reviews/code-review.md` (gitignored). Every dispatch: tests first and red before the change; commits staged explicitly and signed off; the tree compiles and `pnpm test:packages` is green at the end of each dispatch, so the old and new surfaces coexist until the old one is deleted in dispatch 3.

The first seven dispatches (the "literal types" shape) are on the branch and superseded; their record is in the git history. The rework:

| # | Dispatch | Outcome (true when it lands) | Builds on | Hands to | Gate |
|---|---|---|---|---|---|
| R1 | Data types in the framework | `data-type.ts` with `DataTypeId`, `dataType()`, `Cast`, `listCast`, `DataTypeLookup`; `dataType` required on `CodecDescriptor`/`CodecDescriptorImpl` and on `mongoCodec()`; codec contributions carry `dataTypes`; the authoring contribution carries `dataTypes` entries (tag, plain kind, classifier, the `sql` lowering entry); assembly enforces the four invariants; the old literal-types modules still exist (spec B1, B2) | spec | R2 | framework-components typecheck and tests; root typecheck |
| R2 | Every pack declares its types | Postgres, SQLite, relational-core adapted codecs, pgvector, postgis, arktype-json and Mongo register data types and name them on every codec; casts and list casts per spec B3/B4; each target's authoring entries and classifier; the family exports the shared implementations; per-pack inventory and cast tests; the `sql`/`json` tags are registered in the new place and still in the old (spec B3, B4) | R1 | R3 | typecheck; every pack's tests; `pnpm test:packages`; `pnpm fixtures:check` (no change yet) |
| R3 | Readers, printer and codecs switch | interpreter, Prisma 7 reader and printer run on data types, entries and casts (spec B6, B7); `decodeJson` strict again and the two number-valued codecs on digit text (B5); the old literal-types modules, `literalTypes`, the tag registry under mutation defaults and `numberLiteralDefault`-era helpers are deleted; diagnostics renamed; fixtures re-emitted with exactly the `int8number`/`bigintnumber` columns changed | R1, R2 | R4 | typecheck; contract-psl, contract-prisma7, 9-family, postgres, sqlite, language-server tests; `pnpm test:packages`; `pnpm fixtures:check` |
| R4 | Journeys, docs, upgrade instructions, PR | e2e, pgvector, infer round-trip and parity journeys green under the new names; codec authoring guide, error reference, README, both upgrade-instruction fragments, the ADR's SQLite note; the B8 grep empty; PR #30350 description rewritten around ADR 254; every Definition-of-done command green | R3 | PR | every command in the spec's Definition of done |

Open items:
- Element-level spans for list-literal diagnostics need the parser argument types to carry spans; handed to the editor-tooling brief (project D14), not this slice.
- The TypeScript contract builder's `.default()` cannot take a `bigint` or a non-finite number; PSL is the only surface for `BigInt` defaults beyond 2^53 and `Float @default(NaN)`. Follow-up outside this slice.
- `useDevDatabase` in `test/integration` passes its timeout as `beforeAll`'s third argument, which vitest ignores, so journeys flake at 5 s on a loaded machine. Follow-up outside this slice.
- The Prisma 7 fixture updater (`UPDATE_PRISMA7_FIXTURES=1`) writes golden JSON in a different format from the committed files. Follow-up outside this slice.
- The rest of ADR 254 (DDL name, parameters and rendering on data types; `nativeType` removal; type constructors; function parameters as typed receivers) is an independent project.
