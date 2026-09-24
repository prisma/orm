# Slice A — The `sql` tagged literal for raw SQL defaults

**Project:** [Remove `dbgenerated`](../../spec.md). **Linear:** not yet created. **Branch:** `remove-dbgenerated-sql-literal` off `main`. **Shape:** one PR. **Runs in parallel with:** [slice B](../b-codec-psl-literals/spec.md). **Touches nothing slice B touches** except the `@default` argument arms in `sql-attribute-specs.ts`, where each slice adds its own arm.

## Outcome

A Prisma 8 schema can write a raw SQL column default as a tagged literal, in PSL and in TypeScript, and the result is exactly the contract shape `dbgenerated("...")` produces today. `dbgenerated` still exists at the end of this slice; slice C deletes it.

After this slice, all of the following are true:

```prisma
model T {
  id        String   @id @default(sql`gen_random_uuid()`)
  expires   DateTime @default(sql"(now() + '00:03:00'::interval)")
  createdAt DateTime @default(pg.sql`CURRENT_TIMESTAMP`)
  tags      String[] @default(sql`'{}'::text[]`)
}
```

```ts
const T = model('T', {
  fields: {
    id: field.column(textColumn).default(sql`gen_random_uuid()`).id(),
    createdAt: field.column(timestamptzTemporalColumn).default(now()),
    seq: field.column(int4Column).default(autoincrement()),
  },
});
```

Every one of those emits, migrates onto a dev database, verifies clean, and `contract infer` prints the named-function forms back.

## Amendments made during the build

These supersede the sections below where they differ.

- A8 is withdrawn (project spec D6, amended): Postgres registers no named `gen_random_uuid()` and TypeScript has no `genRandomUuid()`. Write `` sql`gen_random_uuid()` ``. `contract infer` prints that default as on main until slice C.
- A body that is exactly `now()` or `autoincrement()` is refused in PSL and TypeScript with a hint to write the named function (shared `reservedSqlDefaultBody` beside `checkSqlDefaultBody`). Any other body passes verbatim.
- `autoincrement()` on a list column is refused (`PSL_LIST_AUTOINCREMENT_UNSUPPORTED`); other storage defaults on lists lower (project spec D8).
- A PSL tagged literal has no interpolation rule; the backtick fence has two escapes, `` \` `` and `\\`.
- A quoted fence is any PSL string literal, double or single quotes.
- An unterminated backtick fence ends before the next line whose first non-whitespace character is `}`.
- After SevInf's review: no separate token kind or fence concept. A tagged literal is a qualified name followed by an ordinary string literal, which accepts backticks (two escapes) as a third quote style; whitespace between tag and string is allowed; a backtick string outside a tagged literal is `PSL_BACKTICK_STRING_REQUIRES_TAG`; `PSL_TAGGED_LITERAL_FENCE_EXPECTED` and `PSL_UNTERMINATED_TEMPLATE_LITERAL` are deleted in favour of `PSL_UNTERMINATED_STRING`. `oneOf` is unchanged from main: tag membership and canonicalization are checked at lowering. The language server completes registered tags.
- The TypeScript `sql` tag reads raw template text through the same escape resolver as PSL.
- Both targets' planners render the authored default and compare through the resolver in planning and verification alike.
- `PSL_INVALID_DEFAULT_SQL` and `PSL_LIST_AUTOINCREMENT_UNSUPPORTED` are contributed codes declared in the SQL layer, not framework codes.

## Design

### A1. Tokenizer: the backtick fence

File: [`packages/1-framework/2-authoring/psl-parser/src/tokenizer.ts`](../../../../packages/1-framework/2-authoring/psl-parser/src/tokenizer.ts).

- New `TokenKind` member `TemplateLiteral`.
- A `TemplateLiteral` token starts at a backtick and ends at the next backtick that is not escaped. A backtick is escaped when it is preceded by an odd number of consecutive backslashes, the same rule `isTerminatedStringLiteral` applies to quotes. The token may span any number of lines. Its `text` is the source slice including both fences.
- An unterminated template literal produces an `Invalid` token for the rest of the source and the parser reports `PSL_UNTERMINATED_TEMPLATE_LITERAL` at the opening backtick.

### A2. Parser: the `TaggedLiteral` expression

Files: `packages/1-framework/2-authoring/psl-parser/src/syntax/` (syntax kinds, green-tree builder, red-tree AST classes; follow the `psl-ast-layers` skill).

- New `SyntaxKind` member `TaggedLiteral`.
- Grammar: `TaggedLiteral := QualifiedTag Fence`, where `QualifiedTag := Ident ('.' Ident)*` and `Fence := TemplateLiteral | StringLiteral`. No whitespace, newline, or comment may appear between the last identifier of the tag and the fence. `sql \`x\`` with a space is not a tagged literal; the parser reports `PSL_TAGGED_LITERAL_FENCE_EXPECTED` at the identifier.
- The node is an expression and may appear anywhere an expression may appear. Only the `@default` attribute accepts it in this project; every other attribute rejects it through the normal combinator diagnostic ("Expected a string literal" and so on).
- AST class `TaggedLiteralExprAst` with: `tag(): string` (identifiers joined by `.`), `fence(): 'backtick' | 'quote'`, `rawBody(): string` (the text between the fences, escapes not yet resolved), `body(): string | undefined` (the canonical body, `undefined` when canonicalization fails), and the node's span. It joins the `ExpressionAst` union.
- `printSyntax` prints the node's source verbatim. The formatter in `psl-parser/src/format/format.ts` treats the token as opaque: it never re-indents, trims, or rewraps a `TemplateLiteral` token's text.

### A3. Escapes and canonicalization

Escape resolution happens before canonicalization and depends on the fence:

- Backtick fence: `` \` `` becomes a backtick; `\\` becomes one backslash. Every other backslash sequence is kept as written, both characters. So a SQL body may contain `E'\n'` unchanged.
- Quote fence: the existing PSL string-literal escape rules apply, exactly as `StringLiteralExprAst.value()` resolves them. Backticks need no escaping inside a quote fence.

Canonicalization is one shared function used by PSL and TypeScript. New file `packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts` exporting:

```ts
export type TaggedLiteralCanonicalization =
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly reason: 'nul' | 'too-large'; readonly offset: number };

export function canonicalizeTaggedLiteralBody(resolved: string): TaggedLiteralCanonicalization;
```

Steps, in this order, on the escape-resolved text:

1. If the text contains a NUL character, fail with `nul`. (An earlier draft also rejected `${`; that rule was dropped: a PSL tagged literal has no interpolation, so there is nothing to reject.)
3. Replace `\r\n` and lone `\r` with `\n`.
4. If the first line is blank (empty or only spaces and tabs), drop it.
5. If the last line is blank, drop it.
6. Compute the smallest count of leading spaces and tabs over all non-blank lines and remove that many leading characters from every line. Tabs and spaces are counted as characters; there is no tab expansion.
7. Keep internal blank lines as empty lines.
8. Do not add a trailing newline.
9. If the UTF-8 byte length exceeds 65536, fail with `too-large`.

The canonical body is what the `TaggedLiteralExprAst.body()` returns and what becomes the contract expression. Two literals with different fences and the same canonical body are the same default.

### A4. Attribute-spec combinator

File: new `packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/tagged-literal.ts`; types in `attribute-spec/types.ts`.

```ts
export interface TaggedLiteralValue {
  readonly tag: string;
  readonly body: string;
  readonly span: PslSpan;
}

export function taggedLiteral(tags: readonly string[]): TaggedLiteralArgType<AttributeCtx>;
```

- `ArgTypeKind` gains `'taggedLiteral'`. The `label` is `` `tag`...` `` for the first tag, used in "expected one of" messages.
- `parse` casts the argument to `TaggedLiteralExprAst`. If it is not one, the leaf diagnostic is `Expected a tagged literal`. If `tag()` is not in `tags`, the diagnostic is `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` with message `Unknown literal tag "<tag>". Known tags: <comma-separated tags in registration order>.` If `body()` is undefined, the diagnostic is one of `PSL_TAGGED_LITERAL_NUL` (`Tagged literals must not contain NUL characters.`), `PSL_TAGGED_LITERAL_TOO_LARGE` (`Tagged literal exceeds 65536 bytes.`), each at the literal's span. Otherwise `ok({ tag, body, span })`.

### A5. The tag registry

File: [`packages/1-framework/1-core/framework-components/src/shared/mutation-default-types.ts`](../../../../packages/1-framework/1-core/framework-components/src/shared/mutation-default-types.ts) and the assembly in [`control-stack.ts`](../../../../packages/1-framework/1-core/framework-components/src/control/control-stack.ts).

```ts
export interface ControlDefaultLiteralTagEntry {
  readonly usage: string; // e.g. 'sql`...`'
  lower(input: {
    readonly literal: { readonly tag: string; readonly body: string; readonly span: PslSpan };
    readonly context: DefaultFunctionContext; // the same context type the function registry receives
  }): LoweredDefaultResult;
}

export type ControlDefaultLiteralTagRegistry = ReadonlyMap<string, ControlDefaultLiteralTagEntry>;

export interface ControlMutationDefaults {
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly defaultLiteralTagRegistry: ControlDefaultLiteralTagRegistry; // new
  readonly generatorDescriptors: ...; // unchanged
}
```

- `assembleControlMutationDefaults` merges every contributor's tag registry the same way it merges function registries. Two contributors registering the same tag is an assembly error naming both contributors and the tag.
- Contributor surface: wherever a pack today supplies `defaultFunctionRegistry` (Postgres `exports/control.ts`, SQLite `exports/control.ts`), it also supplies `defaultLiteralTagRegistry`.
- The SQL family exports the shared entry from `packages/2-sql/9-family` (new file `src/core/sql-default-literal-tag.ts`, exported through the family's control export):

```ts
export function sqlDefaultLiteralTagEntry(usage: string): ControlDefaultLiteralTagEntry;
```

Its `lower` runs `checkSqlDefaultBody(body)` (below) and returns `{ ok: true, value: { kind: 'storage', defaultValue: { kind: 'function', expression: body } } }`, or `{ ok: false, diagnostic }` with code `PSL_INVALID_DEFAULT_SQL`.

- Postgres registers `sql` and `pg.sql`. SQLite registers `sql` and `sqlite.sql`. Both map to `sqlDefaultLiteralTagEntry` with usage `` sql`...` `` and `` pg.sql`...` `` / `` sqlite.sql`...` ``.
- The test fixture registry in [`contract-psl/test/fixtures.ts`](../../../../packages/2-sql/2-authoring/contract-psl/test/fixtures.ts) gains a tag registry with `sql` and `pg.sql`.

### A6. The body check

New function in the SQL contract package (`packages/2-sql/1-core/contract/src/default-sql-body.ts`, exported from `@internal/sql-contract/validators`), because the TypeScript builder needs it too and cannot depend on the family. The family's control export re-exports it for the tag entry and the planners. (Amended during dispatch 3; the first draft placed it in the family.)

```ts
/** Returns undefined when the body may be rendered as `DEFAULT (<body>)`, else the reason. */
export function checkSqlDefaultBody(body: string): string | undefined;
```

It rejects a body containing `;`, `--`, `/*`, `$$`, or the whole word `SELECT` (case-insensitive), with the message `Default SQL must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.` This is the same rule as `assertSafeDefaultExpression` in the Postgres planner. The Postgres planner keeps its own call. The SQLite planner's `buildColumnDefaultSql` adds the same call before rendering a function-kind default, raising `CONTRACT.DEFAULT_INVALID` as Postgres does. An empty body passes the check.

### A7. Interpreter wiring

Files: [`sql-attribute-specs.ts`](../../../../packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts), [`psl-column-resolution.ts`](../../../../packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts), [`psl-field-resolution.ts`](../../../../packages/2-sql/2-authoring/contract-psl/src/psl-field-resolution.ts).

- `scalarDefaultArms` gains a `taggedLiteral([...registry.defaultLiteralTagRegistry.keys()])` arm, appended after the function arms, for both the list and the non-list case. The enum arms (`enumDefaultArms`) do not gain it: an enum column takes a member name.
- `psl-column-resolution.ts`: when the interpreted value has a `tag` property, look up `registry.defaultLiteralTagRegistry.get(value.tag)` and call `lower`. The entry is guaranteed present because the combinator only accepted registered tags; assert rather than branch. The lowering result is handled exactly like a function-registry result.
- `psl-field-resolution.ts`: the list check that emits `PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED` now tests only `loweredOnCreate` (a client-side generator). The `loweredFunctionDefault` condition is deleted, so named storage functions and tagged literals lower on a list column like on any other column (project spec D8). The message keeps its wording; it only ever fires for generators now.

### A8. Named `gen_random_uuid()` on Postgres

File: [`postgres/src/core/control-mutation-defaults.ts`](../../../../packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts).

- Signature `{}`. Registered immediately after `now`. Lowers to `{ kind: 'storage', defaultValue: { kind: 'function', expression: 'gen_random_uuid()' } }`. Usage string `gen_random_uuid()`.
- The registry-order test in [`sql-attribute-specs.test.ts:287`](../../../../packages/2-sql/2-authoring/contract-psl/test/sql-attribute-specs.test.ts) is a family test using the fixture registry; the fixture registry adds `gen_random_uuid` after `now` too, so the expected order becomes `['autoincrement', 'now', 'gen_random_uuid', 'uuid', 'cuid', 'ulid', 'nanoid', 'dbgenerated']`.
- The Postgres infer mapping [`postgres-default-mapping.ts`](../../../../packages/3-targets/3-targets/postgres/src/core/psl-infer/postgres-default-mapping.ts) changes `'gen_random_uuid()'` to print `@default(gen_random_uuid())`. The `dbgenerated` fallback stays until slice C.
- The verifier already normalises the live default to `gen_random_uuid()`; no change there.
- The language-server completion test gains `gen_random_uuid` in the Postgres function list.

### A9. SQLite verifies defaults exactly the way Postgres does

(Amended during dispatch 3.) The SQLite resolver runs only where verify derives the live and expected schemas (`diffSqliteSchema`), not in the shared derivation the planners also use, because the planners render DDL from the resolved default and D4 forbids changing the authored SQL in DDL. Postgres is unchanged because its resolver returns the authored expression unchanged for every function default it does not recognise.

Postgres passes `postgresResolveDefault` into the family's `contract-to-schema-ir` resolver hook so an authored function expression is parsed the same way an introspected one is before comparison. SQLite provides the equivalent:

- New export `sqliteResolveDefault(columnDefault, column)` in `packages/3-targets/3-targets/sqlite/src/core/default-normalizer.ts`: for a function-kind default, return `parseSqliteDefault(expression)`; otherwise return the default unchanged.
- Wire it where Postgres wires `postgresResolveDefault` (grep `resolveDefault` under `packages/3-targets/3-targets/postgres/src` to find the seam, then mirror it under `sqlite`).
- Effect: a contract with `sql\`CURRENT_TIMESTAMP\`` on SQLite stores and renders `CURRENT_TIMESTAMP` verbatim, and verify compares equal to the database's `CURRENT_TIMESTAMP`, because both sides pass through `parseSqliteDefault`. Nothing stored changes.

### A10. TypeScript

Files: [`contract-ts/src/contract-dsl.ts`](../../../../packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts), new `contract-ts/src/sql-default-literal.ts`, new `contract-ts/src/default-functions.ts`, exports in `contract-ts/src/exports/contract-builder.ts`, and the Postgres contract-builder export at `packages/3-targets/3-targets/postgres/src/exports/contract-builder.ts`.

```ts
// contract-ts/src/sql-default-literal.ts
export function sql(strings: TemplateStringsArray, ...values: readonly never[]): ColumnDefault;
```

- Interpolation is a type error through `values: readonly never[]`. At runtime, `values.length > 0` throws a structured error `CONTRACT.DEFAULT_SQL_INTERPOLATION` with message `sql\`...\` does not support interpolation; write the SQL as one literal.`
- The body is `strings.join('')` (the cooked strings, so JavaScript escapes apply), passed through `canonicalizeTaggedLiteralBody`. A canonicalization failure throws `CONTRACT.DEFAULT_INVALID` with the reason. `checkSqlDefaultBody` runs and a failure throws `CONTRACT.DEFAULT_INVALID` with its message.
- Returns `{ kind: 'function', expression: body }`.

```ts
// contract-ts/src/default-functions.ts
export function now(): ColumnDefault;            // { kind: 'function', expression: 'now()' }
export function autoincrement(): ColumnDefault;  // { kind: 'function', expression: 'autoincrement()' }
```

```ts
// postgres contract-builder export
export function genRandomUuid(): ColumnDefault;  // { kind: 'function', expression: 'gen_random_uuid()' }
```

- `.default(value)` already accepts a `ColumnDefault`; no builder change is needed for these.
- `.defaultSql(expression)` stays. Its doc comment becomes: `@deprecated Write \`.default(sql\`...\`)\`, or \`.default(now())\` / \`.default(autoincrement())\` / \`.default(genRandomUuid())\` for a named function. Removed in 8.0.0.` The enum-field override that rejects `defaultSql` is unchanged.
- Every `.defaultSql(...)` call in `packages/`, `examples/`, `test/`, and docs is rewritten: `'autoincrement()'` → `.default(autoincrement())`, `'now()'` → `.default(now())`, `'gen_random_uuid()'` → `.default(genRandomUuid())`, `'CURRENT_TIMESTAMP'` → `.default(sql\`CURRENT_TIMESTAMP\`)`. The two DSL tests that test `.defaultSql` itself stay as the deprecated member's tests. The sql-orm-client test helper that maps a string default to `defaultSql` is rewritten to `.default(sql\`...\`)`.

### A11. Fixtures and examples

- New PSL/TS parity pair `test/integration/test/authoring/parity/default-sql-literal/` with the four forms from the Outcome section (backtick, quote, `pg.sql`, list column) and the matching TypeScript. The pair must emit identical contracts.
- The existing `default-dbgenerated` parity pair is unchanged in this slice (slice C renames it).
- `examples/prisma-8-demo-sqlite/prisma/contract.ts` uses `.default(now())`.

### A12. ADR 129 amendment

Add a section "Amendment — column defaults" to [ADR 129](../../../../docs/architecture%20docs/adrs/ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md) recording: the two fences and their escape rules; that canonicalization applies to both; the registration rule (the target registers the unprefixed `sql` tag through a family-shared implementation, plus its prefixed alias; every other extension prefixes); that the `TaggedLiteral` node's fields are `tag`, `fence`, `rawBody`, `body`, `span`; that a column default lowers to `{ kind: 'function', expression }` rather than the `ext` envelope, with a pointer to [`deferred.md`](../../deferred.md) item 1; and that only `@default` accepts the node today. Update the ADR index summary line.

### A13. Docs

- [`contract-psl/README.md`](../../../../packages/2-sql/2-authoring/contract-psl/README.md): document `sql\`...\``, `sql"..."`, `pg.sql`, `sqlite.sql`, and `gen_random_uuid()` beside `now()` and `autoincrement()`.
- [`contract-ts/README.md`](../../../../packages/2-sql/2-authoring/contract-ts/README.md): replace the `defaultSql` example with `sql`, `now()`, `autoincrement()`, `genRandomUuid()`; note the deprecation.
- [`docs/reference/error-reference.md`](../../../../docs/reference/error-reference.md): add every new diagnostic code from A2, A4, A6, A10.
- `docs/architecture docs/subsystems/9. No-Emit Workflow.md` lines that show `defaultSql` use the new form.

## Tests (written first; each named test must fail before its implementation lands)

Tokenizer and parser (`psl-parser/test`):
- backtick fence single line; multi-line; escaped backtick; `\\`; `\$`; unterminated → `PSL_UNTERMINATED_TEMPLATE_LITERAL`; tag with dots; whitespace between tag and fence → `PSL_TAGGED_LITERAL_FENCE_EXPECTED`; quote fence; `printSyntax` round-trips source; formatter leaves a multi-line body byte-identical.

Canonicalization (`framework-components/test`):
- each of the nine steps with a table of input → output; NUL; 65537 bytes → `too-large`; 65536 bytes passes.

Combinator (`psl-parser/test/attribute-spec`):
- known tag ok; unknown tag → `PSL_UNKNOWN_DEFAULT_LITERAL_TAG` listing tags; non-literal argument → `Expected a tagged literal`.

Registry assembly (`framework-components/test`):
- two contributors, distinct tags, merged; duplicate tag → assembly error naming both.

Interpreter (`contract-psl/test/interpreter.defaults.test.ts`):
- `@default(sql\`gen_random_uuid()\`)` → `{ kind: 'function', expression: 'gen_random_uuid()' }`; quote fence equal; `pg.sql` equal; `sqlite.sql` with the Postgres fixture registry → unknown tag; body with `;` → `PSL_INVALID_DEFAULT_SQL`; empty body → `{ kind: 'function', expression: '' }` with no diagnostic; list column with `sql\`'{}'::text[]\`` → function default, no diagnostic; list column with `@default(now())` → function default `now()`, no diagnostic; list column with `@default(uuid())` → `PSL_LIST_EXECUTION_DEFAULT_UNSUPPORTED`; enum column with `sql\`...\`` → rejected by the enum arms.
- `@default(gen_random_uuid())` on Postgres fixture → function default `gen_random_uuid()`.

Adapters:
- Postgres registry test: `gen_random_uuid` present after `now`; tag registry has `sql` and `pg.sql`.
- SQLite registry test: tag registry has `sql` and `sqlite.sql`; `sql\`CURRENT_TIMESTAMP\`` lowers verbatim (no rewrite).
- SQLite planner: function default renders `DEFAULT (<body>)`; body with `;` → `CONTRACT.DEFAULT_INVALID`.
- SQLite `sqliteResolveDefault`: `CURRENT_TIMESTAMP` and `datetime('now')` both resolve to `now()`; a literal passes through.

Verify (`9-family/test/schema-verify*`):
- SQLite contract with `sql\`CURRENT_TIMESTAMP\`` against a database column with `DEFAULT CURRENT_TIMESTAMP` → no findings.

TypeScript (`contract-ts/test`):
- `sql\`x\`` → function default `x`; interpolation is a type error (`test-d`) and a runtime error; multi-line body dedents; `;` → `CONTRACT.DEFAULT_INVALID`; `now()`, `autoincrement()`, `genRandomUuid()` shapes; `.defaultSql` still works.

Infer (`postgres/test/psl-infer`):
- a column with live default `gen_random_uuid()` prints `@default(gen_random_uuid())`.

Journeys (`test/integration`, `test/e2e`):
- Parity pair `default-sql-literal` emits identical contracts from PSL and TS.
- Postgres journey: the Outcome schema emits, `db init` succeeds, `db verify --schema-only --strict` reports nothing, `contract infer` prints `@default(gen_random_uuid())` for both uuid columns and `@default(sql\`(now() + '00:03:00'::interval)\`)` for `expires` only after slice C (until then it prints `dbgenerated`; assert the slice-A form for the named function only).
- SQLite e2e: `sql\`CURRENT_TIMESTAMP\`` column migrates and verifies clean.

## Definition of done

- All tests above green; `pnpm test:packages`, `pnpm test:integration`, `pnpm fixtures:check`, `pnpm lint:deps`, `pnpm lint:docs`, root typecheck green.
- `git grep -n "defaultSql(" -- packages examples test docs` returns only the DSL definition, its deprecated-member tests, and the deprecation note.
- `git grep -n "NOW_SYNONYMS"` still returns the SQLite adapter (slice C deletes it).
- ADR 129 amendment merged with the PR.
- PR body records that `contract.json` output for every existing fixture is unchanged (`pnpm fixtures:check` proves it).

## Halt conditions

- The parser cannot add an expression node without changing how existing attribute arguments parse. Report; do not fork the grammar.
- The family cannot export the tag entry without a layering violation (`pnpm lint:deps`). Report the violation; do not put the entry in the framework.
- The SQLite resolver seam does not exist in the family in a form SQLite can reuse. Report the seam's shape.

## Repository rules that apply

`CLAUDE.md`; `.agents/rules/running-tests.mdc`; `.agents/rules/git-staging.mdc`; `.agents/rules/no-bare-casts.mdc`; `.agents/rules/contract-default-values.mdc`; `.agents/rules/omit-should-in-tests.mdc`; the `psl-ast-layers` skill; `.agents/rules/no-backward-compatibility.mdc` except for the `.defaultSql` deprecation the project spec allows.
