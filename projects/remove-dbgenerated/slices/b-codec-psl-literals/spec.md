# Slice B — Codec-owned PSL literals (the PSL half of ADR 184)

**Project:** [Remove `dbgenerated`](../../spec.md). **Linear:** not yet created. **Branch:** `remove-dbgenerated-codec-psl-literals` off `main`. **Shape:** one PR. **Runs in parallel with:** [slice A](../a-sql-default-literal/spec.md). **Touches nothing slice A touches** except the `@default` argument arms in `sql-attribute-specs.ts`, where each slice adds its own arm.

## Outcome

Every typed literal default is read from PSL and printed back to PSL by the column's codec. There is no type-specific code in the interpreter, the printer, or the Prisma 7 source for numbers, JSON, or anything else. Concretely, after this slice:

```prisma
model T {
  meta    Jsonb   @default("{}")
  items   Json    @default("[1, 2]")
  big     BigInt  @default(9007199254740993)
  price   Decimal @default(1.50)
  ratio   Float   @default("NaN")
  name    String  @default("x")
  flag    Boolean @default(true)
  scores  Int[]   @default([1, 2])
}
```

emits a contract in which `meta` holds the JSON object `{}`, `big` holds every digit, `price` holds `1.50` with its trailing zero, and `contract infer` prints each of them back in exactly that form.

## Design

### B1. The `PslLiteral` type

File: [`packages/1-framework/1-core/framework-components/src/shared/codec-types.ts`](../../../../packages/1-framework/1-core/framework-components/src/shared/codec-types.ts).

```ts
/** A PSL scalar literal as its content, with the fence removed and escapes resolved. */
export interface PslLiteral {
  readonly kind: 'string' | 'number' | 'boolean';
  /** string: the characters between the quotes with escapes resolved. number: the digits exactly as written. boolean: 'true' or 'false'. */
  readonly text: string;
}
```

Nothing converts `text` to a JavaScript number before a codec sees it.

### B2. The `Codec` interface

File: [`packages/1-framework/1-core/framework-components/src/shared/codec.ts`](../../../../packages/1-framework/1-core/framework-components/src/shared/codec.ts).

```ts
export interface Codec<...> {
  // existing: encode, decode, encodeJson, decodeJson
  /** The PSL literal that denotes this value in schema source. */
  encodePsl(value: TInput): PslLiteral;
  /** The value a PSL literal denotes. Throws when the literal is not a value of this type. */
  decodePsl(literal: PslLiteral): TInput;
}

export abstract class CodecImpl<...> {
  abstract encodePsl(value: TInput): PslLiteral;
  abstract decodePsl(literal: PslLiteral): TInput;
}
```

- Both members are required. There is no base-class default. A codec that omits them fails to compile.
- `decodePsl` throws an ordinary `Error` whose message says what the codec accepts, for example `pg/int4@1 reads a number literal; got a string`. Callers turn the message into a diagnostic.
- Update the file's header comment, which lists the four conversion methods, to list six and say when each pair runs (PSL: schema reading and schema printing).

### B3. The PSL form of each codec

One rule, applied to every codec:

- If `encodeJson(value)` is a JSON string, the PSL form is `{ kind: 'string', text: <that string> }`, and `decodePsl` accepts a string literal and returns `decodeJson(text)`.
- If `encodeJson(value)` is a JSON number, the PSL form is `{ kind: 'number', text }` where `text` is the exact decimal text of the value with no exponent, and `decodePsl` accepts a number literal and reads its text without passing through `Number()` unless the codec's own type is a JavaScript number.
- If `encodeJson(value)` is a JSON boolean, the PSL form is `{ kind: 'boolean', text }`, and `decodePsl` accepts a boolean literal.
- If `encodeJson(value)` is a JSON object, array, or null, the PSL form is `{ kind: 'string', text: JSON.stringify(encodeJson(value)) }`, and `decodePsl` accepts a string literal, parses it as JSON, and returns `decodeJson(parsed)`. This covers the JSON codecs, the arktype-json codec, pgvector, and postgis.

Named exceptions to the rule, each already how PSL is written today:

- Float codecs (`pg/float4@1`, `pg/float8@1`, and SQLite's real codec): `NaN`, `Infinity`, and `-Infinity` are written as string literals `"NaN"`, `"Infinity"`, `"-Infinity"`, because PSL has no number token for them. `decodePsl` accepts both a number literal and one of those three strings.
- Integer codecs whose JavaScript type is `bigint` or a decimal string (`pg/int8@1`, `pg/numeric@1`, the decimal codecs): `decodePsl` reads the digits from `text` directly; `encodePsl` prints them directly. The number never touches a JavaScript `number`.
- Codecs whose JSON form is a string but whose PSL form must be a number (none known). If one is found, stop and report.

Per-codec inventory the implementer must complete (grep `extends CodecImpl`; the abstract members make omissions compile errors, so the list is checked by the typecheck):

- `packages/3-targets/3-targets/postgres/src/core/codecs.ts` (21 classes)
- `packages/3-targets/3-targets/postgres/src/core/temporal-codecs.ts` (4)
- `packages/3-targets/3-targets/postgres/src/core/temporal-string-codecs.ts` (4)
- `packages/3-targets/3-targets/postgres/src/core/date-codecs.ts` (1)
- `packages/3-targets/3-targets/sqlite/src/core/codecs.ts` (8)
- `packages/2-sql/4-lanes/relational-core/src/ast/sql-codecs.ts` (5)
- `packages/3-extensions/pgvector/src/core/codecs.ts` (1)
- `packages/3-extensions/postgis/src/core/codecs.ts` (1)
- `packages/3-extensions/arktype-json/src/core/arktype-json-codec.ts` (1)
- `packages/2-mongo-family/1-foundation/mongo-codec/src/codecs.ts` (all classes; nothing in Mongo authoring calls them yet)
- Any alias or higher-order codec class the typecheck reports.

Shared helpers are allowed and expected: for instance one `stringPslCodec()` mixin-style pair of functions the identity-string codecs share, one `jsonTextPsl` pair the object-valued codecs share. Put family-shared helpers in `packages/1-framework/1-core/framework-components/src/shared/psl-literal-helpers.ts`. Do not put a default on `CodecImpl`.

### B4. The `literal()` combinator

File: new `packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators/literal.ts`; types in `attribute-spec/types.ts`.

```ts
export function literal(): LiteralArgType<AttributeCtx>; // parses to PslLiteral
```

- `ArgTypeKind` gains `'literal'`. Label `literal`.
- A `StringLiteralExprAst` yields `{ kind: 'string', text: literal.value() }` (escapes resolved by the existing `value()`). A `NumberLiteralExprAst` yields `{ kind: 'number', text: token.text }`. A boolean literal yields `{ kind: 'boolean', text }`. Anything else: `Expected a string, number, or boolean literal`.
- `numLiteral()` stays for its other consumers (the Prisma 7 source uses it for attribute arguments); `@default` no longer uses it.

### B5. Interpreter

Files: [`sql-attribute-specs.ts`](../../../../packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts), [`psl-column-resolution.ts`](../../../../packages/2-sql/2-authoring/contract-psl/src/psl-column-resolution.ts), [`number-literal-default.ts`](../../../../packages/2-sql/2-authoring/contract-psl/src/number-literal-default.ts).

- `scalarDefaultArms`: the literal arms `str(), numLiteral(), bool()` become one `literal()` arm; the list case becomes `list(literal())`. The function arms are unchanged. (Slice A appends a tagged-literal arm after the function arms; the two edits do not overlap.)
- `DefaultArgValue` becomes `PslLiteral | PslLiteral[] | TypedFuncCall` (slice A adds its own member).
- `psl-column-resolution.ts`: for a `PslLiteral` or a list of them, look up the column codec with `codecLookup.get(codecId)`. The codec must exist; a missing codec is an `InternalError` (the codec lookup is already required to build the column). Call `codec.decodePsl(literal)` for the value or for each element. A thrown error becomes diagnostic `PSL_INVALID_DEFAULT_LITERAL` at the attribute's span with message `Field "<Model>.<field>": @default(<source text>) is not a value of <codecId>: <error message>`. The decoded value goes into `{ kind: 'literal', value }` exactly where today's value goes; encoding to JSON for the contract happens where it happens today (`encodeColumnDefault` in `contract-ts/src/build-contract.ts` calls `encodeJson`).
- Delete `number-literal-default.ts` and its test. Delete the `numeric` trait check that gated it. Remove `numberLiteralDefault` from `contract-psl`'s `resolution` export; its one external consumer (the Prisma 7 source) is rewritten in B7.
- The enum-member arm is unchanged: members lower to their storage value as today.

### B6. Printer

Files: [`9-family/src/core/psl-contract-infer/default-mapping.ts`](../../../../packages/2-sql/9-family/src/core/psl-contract-infer/default-mapping.ts), [`postgres/src/core/psl-infer/psl-literals.ts`](../../../../packages/3-targets/3-targets/postgres/src/core/psl-infer/psl-literals.ts), [`infer-model-blocks.ts`](../../../../packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-model-blocks.ts), `printer-config.ts`.

- `mapDefault(columnDefault, options)` gains a required `codec: Codec` in its options for the literal arm. The literal arm prints `formatPslLiteral(codec.encodePsl(codec.decodeJson(value)))`; for a list column, each element, joined as `[a, b]`. The contract holds values in JSON form, so `decodeJson` runs first to get the codec's own type.
- New family function `formatPslLiteral(literal: PslLiteral): string`: `string` → `"` + escaped text + `"` using the existing `escapePslString` rules (moved to the family if it lives in the target today); `number` and `boolean` → `text`.
- Delete `formatLiteralValue`, `quoteString`, `escapeString` from `default-mapping.ts`.
- Delete the per-codec formatter table in `psl-literals.ts` (`PslDefaultValueFormat`, `formatPslValue`, `formatNumber`, `formatFloat`, `formatInteger`, `plainNumeral`, and the table that maps codec IDs to them) and the `printer-config.ts` option that carries it. `infer-model-blocks.ts` passes the column's codec to `mapDefault` instead.
- The list-literal printing path in `infer-model-blocks.ts` (the one that prints `@default([...])` from `resolvedDefault`) uses the same `formatPslLiteral` per element.

### B7. Prisma 7 source

Files: [`contract-prisma7/src/defaults.ts`](../../../../packages/2-sql/2-authoring/contract-prisma7/src/defaults.ts), [`contract-prisma7/src/target-binding.ts`](../../../../packages/2-sql/2-authoring/contract-prisma7/src/target-binding.ts), [`postgres/src/core/prisma7-binding.ts`](../../../../packages/3-targets/3-targets/postgres/src/core/prisma7-binding.ts).

- `Prisma7LiteralDefaultForm` loses the `{ kind: 'json' }` member. `literalDefaultForm` in the Postgres binding no longer returns it for `json`/`jsonb`; those columns take the codec path like every other column. The `sqlExpression` member stays for `bytea` and the temporal types (project spec D11).
- `scalarValue`, `elementValue`, `numberValue`, `rejectedNumberReason`, `WHOLE_NUMBER_SCALARS`, and `WHOLE_NUMBER_TEXT` are replaced by: build a `PslLiteral` from the expression (string → `{ kind: 'string', text: value() }`; number → `{ kind: 'number', text: token.text }`; boolean → boolean), call `codecLookup.get(codecId).decodePsl(literal)`, and turn a thrown error into `PSL.PRISMA7_UNKNOWN_DEFAULT` with message `Field "<Model>.<field>": @default(<source>) is not a value of <codecId>: <error message>`. The enum-member path (identifier → `enumMembers.get`) is unchanged. The `PRISMA7_JSON_NULL_DEFAULT_UNSUPPORTED` diagnostic stays and fires when the decoded value is `null` on a JSON-typed column.
- The Prisma 7 rule that `Int` and `BigInt` defaults must be whole numbers is now the codec's rule: `pg/int4@1` and `pg/int8@1` `decodePsl` reject `1.5`. The fixture expectations that quote the old message text are updated to the codec's message.

### B8. ADR 184 amendment

Add a section "Amendment — PSL literal methods live on `Codec`" to [ADR 184](../../../../docs/architecture%20docs/adrs/ADR%20184%20-%20Codec-owned%20value%20serialization.md): `encodePsl` and `decodePsl` are required members of the `Codec` interface and abstract on `CodecImpl`; the `PslLiteralCodec` interface sketched in the ADR is not a separate entity and never was, it is the consumer's view of the same codec (dependency inversion); the "single interface with all boundaries" alternative is no longer rejected for PSL; the `PslLiteral` shape and the one rule from B3 with its named exceptions; DDL methods remain future work with a pointer to [`deferred.md`](../../deferred.md) item 3. Update the `docs/reference/codec-authoring-guide.md` to list six methods and show a JSON-valued and a string-valued example. Update the ADR index summary line.

### B9. Docs

- `contract-psl/README.md`: one paragraph on literal defaults: the written form is whatever the column's codec accepts; JSON columns take a string holding JSON text; numbers are read exactly as written.
- `docs/reference/error-reference.md`: add `PSL_INVALID_DEFAULT_LITERAL`; update the Prisma 7 messages that changed.

## Tests (written first; each named test must fail before its implementation lands)

Framework (`framework-components/test`):
- `PslLiteral` type test; `CodecImpl` subclass without the methods fails to compile (`test-d`).

Per pack, a table test that for every codec the pack registers, `decodePsl(encodePsl(v))` equals `v` for at least one sample value per codec, and `decodePsl` of a wrong-kind literal throws with a message naming the codec. Packs: Postgres target, SQLite target, relational-core, pgvector, postgis, arktype-json, Mongo codec package.

Interpreter (`contract-psl/test/interpreter.defaults.test.ts`), each case asserting the whole default object:
- `Jsonb @default("{}")` → literal `{}` (object); `Json @default("[1, 2]")` → `[1, 2]`; `Json @default("null")` → literal `null` (allowed in Prisma 8 authoring); `BigInt @default(9007199254740993)` → exact; `Decimal @default(1.50)` → `"1.50"`; `Float @default("NaN")`; `Float @default(1.5)`; `Int @default(1.5)` → `PSL_INVALID_DEFAULT_LITERAL` with the codec's message; `Int @default("1")` → `PSL_INVALID_DEFAULT_LITERAL`; `String @default("a\"b")` → `a"b`; `Boolean @default(true)`; `Int[] @default([1, 2])`; `Int[] @default([1, "x"])` → diagnostic naming the element.
- The existing `preserves raw dbgenerated defaults for timestamp and json columns` test is unchanged (slice C rewrites it).

Printer (`9-family/test/psl-contract-infer/default-mapping.test.ts`, `postgres/test/psl-infer/print-psl/print-psl.defaults-and-types.test.ts`):
- every case above printed back to the same source text; a `pg/float8@1` value `NaN` prints `"NaN"`; a `pg/int8@1` value beyond 2^53 prints every digit; a jsonb object prints `"{\"a\":1}"` with escapes.

Prisma 7 source (`contract-prisma7/test`):
- existing `defaults` fixture green with updated messages; `jsonLiteral Json @default("{\"a\":1}")` lowers through the codec; `Int @default(1.5)` rejected with the codec's message; `json-null-default` fixture unchanged.

Journeys:
- `test/integration/test/cli-journeys/infer-roundtrip-fidelity.e2e.test.ts`: the jsonb default case now asserts that emit succeeds without the workaround and that infer prints `@default("{}")`; delete the comment that says it is "left broken".
- New integration test: the Outcome schema emits, `db init` succeeds, `db verify --schema-only --strict` reports nothing, and a row read through the client returns the defaults with their decoded types.

## Definition of done

- All tests above green; `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm fixtures:check`, `pnpm lint:deps`, `pnpm lint:docs`, root typecheck green.
- `git grep -n "numberLiteralDefault\|PslDefaultValueFormat\|formatLiteralValue" -- packages` returns nothing.
- `git grep -n "kind: 'json'" -- packages/2-sql/2-authoring/contract-prisma7 packages/3-targets/3-targets/postgres/src/core/prisma7-binding.ts` returns nothing.
- Every existing fixture's `contract.json` is byte-identical (`pnpm fixtures:check`); the JSON form of values does not change.
- ADR 184 amendment and codec guide update merged with the PR.

## Halt conditions

- A codec's JSON form is a string but its natural PSL form must be a number, or the reverse. Report the codec; do not add a per-codec branch outside that codec.
- A consumer other than the interpreter, the printer, and the Prisma 7 source depends on the deleted formatter table. Report it.
- The Mongo codec package cannot depend on `PslLiteral` without a layering violation. Report; do not duplicate the type.

## Repository rules that apply

`CLAUDE.md`; `.agents/rules/running-tests.mdc`; `.agents/rules/git-staging.mdc`; `.agents/rules/no-bare-casts.mdc`; `.agents/rules/contract-default-values.mdc`; `.agents/rules/storage-type-hooks.mdc`; `.agents/rules/prefer-assertions-over-defensive-checks.mdc`; `.agents/rules/omit-should-in-tests.mdc`; `docs/reference/codec-authoring-guide.md`.
