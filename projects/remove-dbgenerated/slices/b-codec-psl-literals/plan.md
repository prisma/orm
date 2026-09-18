# Slice B plan — dispatch sequence

Spec: [`spec.md`](spec.md). One implementer and one reviewer, resumed across every dispatch. Review artifact: `wip/reviews/code-review.md` (gitignored). Every dispatch: tests first and red before the change; commits staged explicitly and signed off; `pnpm typecheck` at the root plus the package-scoped test commands named in the gate, run through their `:agent` variants where they exist and read from the log file.

| # | Dispatch | Outcome (true when it lands) | Builds on | Hands to | Gate |
|---|---|---|---|---|---|
| 1 | Literal types in the framework | `literal-types.ts` exists with `readLiteral`, `isCompatible`, `describeDeclarations`, `writeLiteral`, `integerLiteralTypesUpTo`, `jsonDefaultLiteralTagEntry`; `CodecDescriptor.literalTypes` and the tag-entry union exist; nothing consumes them yet (spec B1, B3 types) | spec | 2, 3 | framework-components typecheck + tests |
| 2 | Inventory and coercion | every production codec declares `literalTypes` per spec B2; seven per-pack inventory tests; `decodeJson` coercion in the codecs B2 lists, with the float4/float8 non-finite fix | 1 | 3, 5 | typecheck; postgres, sqlite, relational-core, pgvector, postgis, arktype-json, mongo-adapter tests; `pnpm fixtures:check` |
| 3 | The interpreter and the `json` tag | both adapters and the fixture registry register `json`; PSL reads every Outcome form and reports every error form (spec B4); `number-literal-default.ts` deleted; language-server completion test unchanged and green | 1, 2 | 4, 5, 6 | typecheck; contract-psl, language-server, adapter tests; `pnpm fixtures:check`; `pnpm test:packages` |
| 4 | The Prisma 7 reader | spec B5; `contract-prisma7` tests green with the new messages | 3 | 6 | typecheck; contract-prisma7 tests |
| 5 | The printer | spec B6; the deleted formatter names are gone; postgres print tests green | 2, 3 | 6 | typecheck; 9-family and postgres psl-infer tests; grep in DoD |
| 6 | Journeys | e2e test, roundtrip-fidelity jsonb case, parity pair, integration number-defaults test (spec B9 and Tests § Journeys); `pnpm test:integration` and `pnpm test:e2e` green | 3, 4, 5 | 7 | `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm fixtures:check` |
| 7 | Docs, upgrade instructions, ADR amendment | spec B8 and B10; every DoD command green | 6 | PR | every command in the spec's Definition of done |

Open items:
- Element-level spans for list-literal diagnostics need the parser argument types to carry spans; handed to the editor-tooling brief (project D14), not this slice.
- The TypeScript contract builder's `.default()` cannot take a `bigint` or a non-finite number; PSL is the only surface for `BigInt` defaults beyond 2^53 and `Float @default(NaN)`. Follow-up outside this slice.
- `useDevDatabase` in `test/integration` passes its timeout as `beforeAll`'s third argument, which vitest ignores, so journeys flake at 5 s on a loaded machine. Follow-up outside this slice.
- The Prisma 7 fixture updater (`UPDATE_PRISMA7_FIXTURES=1`) writes golden JSON in a different format from the committed files. Follow-up outside this slice.
