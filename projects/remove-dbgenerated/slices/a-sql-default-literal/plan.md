# Slice A plan — dispatch sequence

Spec: [`spec.md`](spec.md). Branch: `remove-dbgenerated-sql-literal`, cut from `remove-dbgenerated-plan` (main plus the project docs). One PR.

Three dispatches, strictly sequential. Each hands the next a compiling, tested state.

## Dispatch 1 — Parser foundation

**Outcome:** PSL parses `tag\`body\`` and `tag"body"` into a `TaggedLiteral` expression node with a canonical body, and an attribute spec can accept one through `taggedLiteral(tags)`.

**Builds on:** nothing. **Hands to:** dispatch 2 the `TaggedLiteralExprAst` class, the `TaggedLiteralValue` type, the `taggedLiteral()` combinator, and `canonicalizeTaggedLiteralBody`.

**Spec sections:** A1, A2, A3, A4. Tests: the tokenizer/parser, canonicalization, and combinator groups.

**Files:** `packages/1-framework/2-authoring/psl-parser/src/tokenizer.ts`, `psl-parser/src/syntax/**`, `psl-parser/src/format/format.ts`, `psl-parser/src/attribute-spec/{types.ts,combinators/tagged-literal.ts}`, `packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts` and their tests.

**Gates:** `pnpm --filter @internal/psl-parser test`, `pnpm --filter @internal/framework-components test`, root `pnpm typecheck`.

## Dispatch 2 — Registry, lowering, named function, SQLite verify hook

**Outcome:** `@default(sql\`...\`)`, `@default(sql"...")`, `@default(pg.sql\`...\`)` on Postgres and `@default(sqlite.sql\`...\`)` on SQLite lower to `{ kind: 'function', expression }`; `@default(gen_random_uuid())` lowers on Postgres and infer prints it; list columns take any storage default; SQLite verifies defaults through its parser on both sides.

**Builds on:** dispatch 1. **Hands to:** dispatch 3 the `ControlMutationDefaults.defaultLiteralTagRegistry` shape and the family's `checkSqlDefaultBody`.

**Spec sections:** A5, A6, A7, A8, A9. Tests: registry assembly, interpreter, adapters, verify, infer groups.

**Files:** `framework-components/src/shared/mutation-default-types.ts`, `framework-components/src/control/control-stack.ts`, `packages/2-sql/9-family/src/core/sql-default-literal-tag.ts` (new) and its export, `packages/3-targets/6-adapters/{postgres,sqlite}/src/core/control-mutation-defaults.ts` and `exports/control.ts`, `packages/2-sql/2-authoring/contract-psl/src/{sql-attribute-specs.ts,psl-column-resolution.ts,psl-field-resolution.ts}`, `contract-psl/test/fixtures.ts`, `packages/3-targets/3-targets/postgres/src/core/psl-infer/postgres-default-mapping.ts`, `packages/3-targets/3-targets/sqlite/src/core/{default-normalizer.ts,migrations/planner-ddl-builders.ts}` plus the SQLite resolver wiring, and their tests; the language-server completion test.

**Gates:** package tests for framework-components, psl-parser, family, contract-psl, both adapters, both targets, language-server; root `pnpm typecheck`; `pnpm lint:deps`.

## Dispatch 3 — TypeScript, call-site rewrite, fixtures, docs, ADR amendment

**Outcome:** the TypeScript `sql` tag and the `now()`, `autoincrement()`, `genRandomUuid()` helpers exist; `.defaultSql()` is deprecated; every in-repo `.defaultSql(...)` call is rewritten; the parity fixture, examples, READMEs, error reference, and ADR 129 amendment are in place; the whole workspace is green.

**Builds on:** dispatch 2. **Hands to:** slice review.

**Spec sections:** A10, A11, A12, A13. Tests: TypeScript, journeys groups, plus the slice Definition of done.

**Files:** `packages/2-sql/2-authoring/contract-ts/src/{contract-dsl.ts,sql-default-literal.ts,default-functions.ts,exports/contract-builder.ts}`, `packages/3-targets/3-targets/postgres/src/exports/contract-builder.ts`, every `.defaultSql(` call site, `test/integration/test/authoring/parity/default-sql-literal/**` (new), `examples/prisma-8-demo-sqlite/prisma/contract.ts`, READMEs, `docs/reference/error-reference.md`, `docs/architecture docs/subsystems/9. No-Emit Workflow.md`, ADR 129 and the ADR index.

**Gates:** everything in the slice Definition of done: `pnpm test:packages`, `pnpm test:integration`, `pnpm fixtures:check`, `pnpm lint:deps`, `pnpm lint:docs`, root `pnpm typecheck`, the `defaultSql(` grep.
