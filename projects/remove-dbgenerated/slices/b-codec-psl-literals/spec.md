# Slice B — Literal types for column defaults

**Project:** [Remove `dbgenerated`](../../spec.md). **Design:** [ADR 254](../../../../docs/architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md), amended by this slice as B10 records. **Linear:** not yet created. **Branch:** `worktree/literal-types-column-defaults-852235` off `main`. **Shape:** one PR. **Depends on:** slice A, merged. **Input:** [`brief.md`](brief.md), which is unvalidated design input from another agent; every claim in it was verified against the code before this spec was written, and the corrections are listed under "Corrections to the brief".

## Outcome

Every literal column default has a literal type. A codec descriptor names the literal types its columns accept, as names only. A contract source turns its syntax into a literal of a type, the interpreter checks that type against the column's codec by membership, the codec's `decodeJson` converts the literal's value, and the printer runs the same path backwards. No codec gains a method. No per-type code remains in the interpreter or the printer.

After this slice, all of the following are true:

```prisma
model Account {
  id       Int        @id
  name     String     @default("anonymous")
  small    SmallInt   @default(100)
  count    Int        @default(100000)
  balance  BigInt     @default(100000000000000099)
  price    Decimal    @default(1.50)
  ratio    Float      @default(NaN)
  active   Boolean    @default(true)
  meta     Jsonb      @default(json`{ "plan": "free", "seats": 1 }`)
  scores   Int[]      @default([1, 2])
  docs     Jsonb[]    @default([json`{}`, json`[]`])
  embed    pgvector.Vector(3) @default([0.1, 0.2, 0.3])
  expires  DateTime   @default(sql`(now() + '3 days'::interval)`)
}
```

Every one of those emits, migrates onto a dev database, verifies clean, reads back through the client with its decoded type, and `contract infer` prints them back in the same forms. These are errors, each pointing at the literal:

```prisma
count  Int     @default(100000000000000099)  // pg/int4@1 is not compatible with a bigint literal; it accepts i8, i16, i32 literals
count  Int     @default(1.5)                 // pg/int4@1 is not compatible with a decimal literal; ...
meta   Jsonb   @default("{}")                // pg/jsonb@1 is not compatible with a string literal; it accepts json literals
price  Decimal @default("1.50")              // pg/numeric@1 is not compatible with a string literal; ...
meta   Jsonb   @default(json`{ plan }`)      // PSL_INVALID_JSON_LITERAL
embed  pgvector.Vector(3) @default([1, 2])            // PSL_INVALID_DEFAULT_LITERAL, with the vector codec's length message
scores Int[]   @default([1, "x"])            // incompatible, reported at the second element
```

## Decisions from the shaping discussion (2026-09-18)

These settle ADR 254's open question and are written into the ADR by B10.

1. **A written number's literal type comes from its own size and precision, never from the column.** The literal types for numbers are `i8`, `i16`, `i32`, `i64`, `bigint`, `decimal` and `float`. A number gets the smallest type that holds it. `42` is `i8` on every column; `100000000000000099` is `i64`; `1.50` is `decimal`; `NaN` is `float`. Reason: one syntax then names one type, the compatibility check is a lookup with no trial decoding, and a size error is reported as an incompatibility before anything is decoded.
2. **A codec names every type it accepts, and coercion between those types' value shapes is the codec's job, inside its existing `decodeJson`.** `pg/int8@1` names `i8` to `i64`, so its `decodeJson` accepts a JSON number as well as the digit text it stores. No new codec method; the declaration stays a list of names. Reason: the value shape a literal type produces is fixed by the type, and the codecs that store a different shape are the ones that know how to convert it.
3. **A vector default is a list, not a JSON document.** The brief gave `pg/vector@1` the `json` type because `json` was the only type producing an array. That matches on storage shape, which is the mistake `Jsonb @default("{}")` makes. Instead a declaration may name a list of element types, `{ list: [...] }`, and a PSL list on a non-list column writes a list literal. Serhii asked for `@default([1, 2, 3])` on a vector column and this gives it. This shape was proposed in the discussion and not objected to; it is open to review in the PR.

## Amendments made during the build

These supersede the sections below where they differ.

- **`writeLiteral` returns the complete literal source.** `text` is the whole written literal, including the tag and fence for `json` (`` json`{"a":1}` ``); `tag` is kept so a caller can tell a tagged literal apart. The printer prints `@default(<text>)`. (Dispatch 1.)
- **No quote-fence fallback when printing `json`.** A quote-fenced tagged literal resolves the full PSL string escapes, while a backtick fence resolves only `` \` `` and `\\`, so switching fences changes what a JSON body containing `\n` reads back as. The printer always uses the backtick fence and escapes backticks and backslashes. (Dispatch 1.)
- **A nested list is refused with reason `invalid-number`** and the message "A list literal cannot contain another list."; it maps to `PSL_INVALID_DEFAULT_LITERAL`. A list literal's `type.list` is the element types in first-seen order, deduplicated, so an empty list is compatible with every `{ list }` declaration. `describeDeclarations` joins scalar and list parts with " and ". `integerLiteralTypesUpTo('bigint')` is allowed. (Dispatch 1.)
- **`writeLiteral` writes a list literal itself** against a `{ list }` declaration (a scalar column such as `vector(3)`); the printer writes a list column's elements one by one against the element codec's scalar declarations. Two different paths. (Dispatch 1, for dispatch 5.)

- **`readLiteral` refuses with `{ ok: false; reason; message; elementIndex }`**, where `elementIndex` is a required key typed `number | undefined` and names the failing element of a list literal so the interpreter can report at that element's span. The tag-entry union has a type predicate, `isDefaultLiteralTagLoweringEntry`, exported from `exports/control.ts`; `jsonDefaultLiteralTagEntry` and `LiteralTypeName` are exported from `exports/codec.ts` only. (Dispatch 1, round 2.)
- **`CodecDescriptorImpl.literalTypes` stays `readonly`**, typed `readonly LiteralTypeDeclaration[] | undefined` so the target adapters can forward a wrapped descriptor's declaration. (Dispatch 2 review.)

- **`Jsonb @default([1, 2])` is an incompatibility, not a JSON array.** A PSL list reads as a list literal, and `pg/jsonb@1` names only `json`, so the membership rule refuses it; the JSON array is written `` json`[1, 2]` ``. The Tests section's "harmless consequence" line is withdrawn. (Dispatch 3.)
- **`100000000000000099` is an `i64` literal**, so the Outcome's first error reads `pg/int4@1 is not compatible with an i64 literal; it accepts i8, i16, i32 literals`. Messages choose the article ("an i64", "a string"). (Dispatch 3.)
- **Diagnostics inside a list are reported at the `@default(...)` attribute span** and name the failing element in the message (`Field "N.scores" at element 2: ...`), because the attribute-spec layer carries no span for string, number and boolean arguments. Reporting at the element's own span needs the parser's argument types to carry spans and is handed to the editor-tooling brief (project decision D14). (Dispatch 3.)
- **A column bound to a value set (`pg.enum(Ref)`) keeps the member-name path**: a string default on such a column is checked against the value set and never against `literalTypes`. (Dispatch 3.)
- **A lowering tag (`sql`) inside a list literal is `PSL_INVALID_DEFAULT_LITERAL`** with a message saying the tag produces a default of its own. (Dispatch 3.)
- **The Prisma 7 reader keeps a private copy of the old number-through-codec helper until dispatch 4 replaces it** with B5. (Dispatch 3.)

- **The printer falls back when the codec would refuse what it wrote.** Before printing a literal, the Postgres printer passes the written value back through the column codec's `decodeJson`; a refusal (for example a temporal `infinity` sentinel, which `decodeTemporalText` rejects) takes the raw-default fallback as on `main`. Infer never prints a schema that emit cannot read. (Dispatch 5 review.)
- **The Postgres printer restates the type-name-to-codec binding** in `psl-infer/infer-default-codec.ts`, because the emit-side binding lives in the adapter, which depends on the target. Two tests keep it honest: one in the adapter asserts entry-by-entry agreement with the authoring type tables, one in the target asserts every printed type name is covered. (Dispatch 5.)
- **Temporal defaults print as string literals** (`Date @default("2024-01-01")`) rather than `dbgenerated`; verify compares them through `parseTemporal` on both sides and the planner renders them quoted, so the round trip holds. The upgrade instructions mention the changed infer output. (Dispatch 5.)

- **A column's codec is materialised with the column's `typeParams` wherever a default passes through it**: the interpreter (B4), the contract builder's `encodeJson` re-encode, and the Postgres DDL renderer. The last two used the param-less representative and so could not encode or render a `vector(3)` default. (Dispatch 6.)
- **The e2e journey's raw SQL default is written in the form Postgres reports** (`(now() + '3 days'::interval)`), because strict verification compares raw expressions; the Outcome snippet is updated. Pre-existing raw-SQL behaviour, not a literal-type matter. (Dispatch 6.)
- **The TypeScript builder cannot express a `BigInt` default beyond 2^53 or a non-finite `Float` default**, so those two forms are covered by the e2e journey and not by the parity pair. Recorded as a follow-up in the plan's open items. (Dispatch 6.)

- **A contract that stores digit text for a `sqlite/integer@1` default now renders `DEFAULT 0` rather than `DEFAULT '0'`**, because the SQLite DDL renderer decodes through the codec before rendering and the codec now reads digit text as a number. Authoring a string on an integer column was never legitimate; the upgrade instructions record the change. (Dispatch 6 review.)

## Corrections to the brief

Verified against the code on 2026-09-18. Where the brief and this spec differ, this spec wins.

- **`NaN`, `Infinity` and `-Infinity` print unquoted.** The PSL tokenizer reads them as number tokens (`tokenizer.ts`, `KEYWORD_NUMBERS`). The brief said to print them as a quoted string, which would read back as a `string` literal and be refused by every float codec.
- **`pg/enum@1` names no literal type.** Enum defaults are bare member names and never reach the codec (`enumDefaultArms` in `sql-attribute-specs.ts`), so naming `string` would be inert and would contradict ADR 254. The brief said `string`.
- **Mongo has seven codecs, not nine.** `mongo/array@1` and `mongo/document@1` do not exist. The seven (`mongo/objectId@1`, `mongo/string@1`, `mongo/double@1`, `mongo/int32@1`, `mongo/bool@1`, `mongo/date@1`, `mongo/vector@1`) name nothing, as the brief said.
- **`pg/float4@1` and `pg/float8@1` do no validation in `decodeJson` on `main`** (a blind cast), and their `encodeJson` turns `NaN` into JSON `null`. The closed branch's float fix is needed and is B2's job.
- **`sqlite/real@1`, `sql/float@1` and `pg/float@1` refuse non-finite values in `decodeJson`.** Confirmed. They therefore do not name `float`, so `Real @default(NaN)` on SQLite is an incompatibility diagnostic rather than a decode failure. The brief had them name `float`.
- **No allowlist exists for contributed diagnostic codes.** `ContributedPslDiagnosticCode` is the open type `` `PSL_${string}` ``; the new codes are declared as constants in `contract-psl` and need no framework edit.
- **`number-literal-default.ts` has no test file of its own.** Its behaviour is covered by `contract-psl/test/interpreter.number-defaults.test.ts` and `test/integration/test/number-defaults/psl-number-defaults.integration.test.ts`, both of which change in this slice.
- **The `@default` argument arms do not need merging.** `str()`, `numLiteral()` and `bool()` already yield the written scalar with its syntax kind (`string`, `{ text }`, `boolean`). Keeping them leaves the language server's `true`/`false` completion untouched. The brief said to replace them with one arm.
- **`build-contract.ts` re-encodes every literal default through `encodeJson`** (`encodeViaCodec`), so the interpreter stores the decoded value and the contract receives the canonical JSON form. The brief's step 6 ("store the default as it is stored today") is right; this records why the contract stays canonical.
- **`pg/text-array@1` is contract-free only** (`contract-free/columns.ts`); no PSL type binds it. Confirmed.
- **`CodecLookup.get(codecId)` cannot give a length-aware vector codec**; `control-stack.ts` builds the representative with empty params. The interpreter materialises the column's codec from the descriptor and the column's `typeParams` (B4).
- **The closed branch's float fix lives in `codecs.ts` and `codec-helpers.ts`**, not `codec-helpers.ts` alone.

## Design

### B1. Literal types in the framework

File: new `packages/1-framework/1-core/framework-components/src/shared/literal-types.ts`, exported through `src/exports/codec.ts`.

```ts
export type LiteralTypeName =
  | 'string' | 'boolean' | 'i8' | 'i16' | 'i32' | 'i64' | 'bigint' | 'decimal' | 'float' | 'json';

export type LiteralTypeDeclaration = LiteralTypeName | { readonly list: readonly LiteralTypeName[] };

export type Literal =
  | { readonly type: LiteralTypeName; readonly value: JsonValue }
  | { readonly type: { readonly list: readonly LiteralTypeName[] }; readonly value: readonly JsonValue[] };
```

A written literal, independent of the source language:

```ts
export type WrittenLiteral =
  | { readonly kind: 'string'; readonly text: string }   // escapes already resolved by the source
  | { readonly kind: 'number'; readonly text: string }   // digits exactly as written
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'json'; readonly text: string }     // the body of a json tag, or Prisma 7's quoted JSON
  | { readonly kind: 'list'; readonly elements: readonly WrittenLiteral[] };
```

Functions:

- `readLiteral(written): { ok: true; literal: Literal } | { ok: false; reason: 'invalid-json' | 'invalid-number'; message: string }`. Classifies and produces the value. A `list` reads each element; a nested list is `invalid-number`-style refusal with its own message (PSL cannot write one anyway).
- `isCompatible(literal, declarations: readonly LiteralTypeDeclaration[]): boolean`. A scalar literal's type must appear by name. A list literal needs a `{ list }` declaration whose element names include every element's type.
- `describeDeclarations(declarations): string` for messages: `i8, i16, i32 literals`, `a list of i8, ... literals`, or `no literal defaults`.
- `writeLiteral(value: JsonValue, declarations): { text: string; tag?: LiteralTypeName } | undefined`. Tries the declarations in order; the first type whose `write` accepts the value wins. Used by the printer (B6).

The types, their value shapes, and the rules:

| Literal type | Written as | Value produced | Reading rules | Writing rules |
|---|---|---|---|---|
| `string` | a string scalar | the text | | `"..."` with PSL escapes |
| `boolean` | `true` / `false` | the boolean | | `true` / `false` |
| `i8` | whole number in [-128, 127] | JSON number | leading zeros and the sign of zero dropped | digits |
| `i16` | whole number in [-32768, 32767] not `i8` | JSON number | same | digits |
| `i32` | whole number in [-2^31, 2^31-1] not smaller | JSON number | same | digits |
| `i64` | whole number in [-2^63, 2^63-1] not smaller | digit text | same; text because a JSON number rounds past 2^53 | digits |
| `bigint` | any larger whole number | digit text | same | digits |
| `decimal` | a number with a fraction | decimal text | trailing zeros kept; leading zeros and the sign of zero dropped, so `007.50` is `7.50` and `-0.0` is `0.0` (the `canonicalDecimalText` logic from `number-literal-default.ts`, moved here) | the text |
| `float` | `NaN`, `Infinity`, `-Infinity` | that text | | that text, unquoted |
| `json` | a `json` tag body | the parsed JSON value | parsed once; a parse failure is `invalid-json` with the parser's message | `JSON.stringify(value)` inside a `json` tag, backtick fence, switching to the quote fence when the text contains a backtick |

Classification is by the number's text alone using `BigInt` comparison; no literal type converts through a JavaScript number except `i8`, `i16` and `i32`, whose values are exact. The tokenizer admits no exponent and no leading `+`, so the number regexes are `^-?\d+$` and `^-?\d+\.\d+$` plus the three words.

`write` for a numeric type accepts a JSON number or numeric text, classifies it, and prints it only when the classification is that type. A finite JSON number prints plainly with no exponent (the existing `plainNumeral` logic from the Postgres printer moves here). So a stored `pg/int8@1` text `"42"` prints `42` through `i8`, and a stored `pg/float8@1` number `1.5` prints `1.5` through `decimal`.

Provide `integerLiteralTypesUpTo(name)` returning the chain `['i8', ...]` up to and including `name`, so descriptors do not spell the chain out.

### B2. Codec descriptors name their literal types; codecs coerce

Add `readonly literalTypes?: readonly LiteralTypeDeclaration[]` to `CodecDescriptor` and `CodecDescriptorImpl` (`codec-descriptor.ts`). Optional; a codec that names none accepts no literal defaults. Mongo's `mongoCodec({...})` factory does not gain the option.

The inventory. Every production codec appears exactly once.

| Codec ids | `literalTypes` |
|---|---|
| `pg/text@1`, `pg/char@1`, `pg/varchar@1`, `pg/uuid@1`, `pg/inet@1`, `pg/bit@1`, `pg/varbit@1`, `pg/timetz@1`, `pg/interval@1`, `pg/bytea@1`, `pg/date-string@1`, `pg/time-string@1`, `pg/timestamp-string@1`, `pg/timestamptz-string@1`, `pg/date-temporal@1`, `pg/time-temporal@1`, `pg/timestamp-temporal@1`, `pg/timestamptz-temporal@1`, `pg/timestamptz-date@1`, `sqlite/text@1`, `sqlite/blob@1`, `sqlite/datetime@1`, `sql/text@1`, `sql/char@1`, `sql/varchar@1`, `pg/geometry@1` | `['string']` |
| `pg/bool@1` | `['boolean']` |
| `pg/int2@1` | `i8` to `i16` |
| `pg/int4@1`, `pg/int@1`, `sql/int@1` | `i8` to `i32` |
| `pg/int8@1`, `pg/int8number@1`, `sqlite/integer@1`, `sqlite/bigint@1`, `sqlite/bigintnumber@1` | `i8` to `i64` |
| `pg/unboundedint@1` | `i8` to `i64`, `bigint` |
| `pg/float@1`, `sql/float@1`, `sqlite/real@1` | `i8` to `i64`, `bigint`, `decimal` |
| `pg/float4@1`, `pg/float8@1`, `pg/numeric@1` | `i8` to `i64`, `bigint`, `decimal`, `float` |
| `pg/json@1`, `pg/jsonb@1`, `sqlite/json@1`, `arktype/json@1` | `['json']` |
| `pg/vector@1` | `[{ list: ['i8', 'i16', 'i32', 'i64', 'bigint', 'decimal'] }]` |
| `pg/enum@1`, `pg/text-array@1`, the seven Mongo codecs | none |

Coercion. Each codec's `decodeJson` accepts the value shape of every type it names, in addition to its own JSON form, and refuses the rest with its existing error code:

- `pg/int8@1`, `sqlite/bigint@1`, `pg/unboundedint@1`: a whole JSON number as well as digit text.
- `pg/int8number@1`, `sqlite/bigintnumber@1`, `sqlite/integer@1`: digit text as well as a number; text past `Number.MAX_SAFE_INTEGER` is refused with a message naming the codec's limit. `sqlite/integer@1` gains that check for numbers too, since it has none today.
- `pg/numeric@1`: a JSON number, stored as its canonical decimal text.
- `pg/float4@1`, `pg/float8@1`: digit or decimal text, and the three non-finite words. Their JSON form for a non-finite value becomes the word as text, and `encode`/`decode` carry it on the wire the same way (the closed branch's float fix, `pgFloatEncode`, `pgFloatEncodeJson`, `pgFloatDecodeJson`, without its `encodePsl`/`decodePsl`).
- `pg/float@1`, `sql/float@1`, `sqlite/real@1`: digit or decimal text; non-finite still refused.
- `pg/vector@1`: elements may be digit or decimal text.
- Every other codec is unchanged.

Per pack, one test asserts the full inventory: it walks the pack's registered descriptors and compares each `codecId` to `literalTypes` against a table, and fails on a codec missing from the table. Packs: Postgres target, SQLite target, relational-core, pgvector, postgis, arktype-json, Mongo adapter.

### B3. The `json` tag

`ControlDefaultLiteralTagEntry` in `mutation-default-types.ts` becomes a union: the existing lowering entry (`usage`, `documentation`, `lower`) for `sql`, and a literal-type entry (`usage`, `documentation`, `literalType: LiteralTypeName`) for `json`. The framework exports `jsonDefaultLiteralTagEntry()` from the same place as the literal types. Postgres (`6-adapters/postgres/src/core/control-mutation-defaults.ts`) and SQLite register `json` with no prefixed alias. The `contract-psl` fixture registry gains it. Assembly is unchanged.

### B4. The PSL interpreter

Files: `contract-psl/src/sql-attribute-specs.ts`, `psl-column-resolution.ts`, `psl-field-resolution.ts` as needed.

Arms. `scalarDefaultArms` keeps `str()`, `numLiteral()`, `bool()`, the function arms and the tag arm. Two changes: the non-list case also gains `list(literal())` so a scalar column can take a list literal; and the list element `oneOf` gains the tag arm, so `Jsonb[] @default([json`{}`])` parses. Enum arms are unchanged.

Resolution of a literal default, in `lowerDefaultForField`:

1. A tagged literal: look up the registry entry. A lowering entry lowers as today (`sql`). A literal-type entry yields `{ kind: 'json', text: body }` as the written literal (the only literal-type tag today; the code is generic over `literalType`).
2. A string, number, boolean or list value yields the matching `WrittenLiteral`; a list element that is a tagged literal is handled as in step 1 within the list.
3. `readLiteral`. `invalid-json` is `PSL_INVALID_JSON_LITERAL`; any other refusal is `PSL_INVALID_DEFAULT_LITERAL`. Both at the literal's span (the element's span inside a list).
4. The descriptor is `codecLookup.descriptorFor(codecId)`; absent `descriptorFor` or a missing descriptor is an `InternalError`, because the column was resolved from it. For a list column the element literals are checked one by one against the element codec's scalar declarations (as today); for a scalar column the whole literal is checked. Incompatible is `PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE`: `Field "Account.count": pg/int4@1 is not compatible with a bigint literal; it accepts i8, i16, i32 literals`. A list literal on a scalar column whose codec names no list: `... is not compatible with a list literal; ...`.
5. The codec instance is `materializeCodec(descriptor, { codecId, typeParams: columnDescriptor.typeParams }, ctx)` so a `vector(3)` column checks its length. `decodeJson` on the value (per element for a list column). A throw is `PSL_INVALID_DEFAULT_LITERAL` carrying the codec's message.
6. Store the decoded value as today; `build-contract.ts` re-encodes it through `encodeJson`.

Delete `number-literal-default.ts` and its export from `exports/resolution.ts`. The three diagnostic codes are constants in `contract-psl`.

### B5. The Prisma 7 reader

Files: `contract-prisma7/src/defaults.ts`, `target-binding.ts`; `postgres/src/core/prisma7-binding.ts`.

The reader builds a `WrittenLiteral` from its own syntax: a string literal is `string`, except that when the binding's `literalDefaultForm` is `json` it is `{ kind: 'json', text }`; a number is `number`; a boolean is `boolean`; a list is `list`. Then steps 3 to 6 of B4 with the same helpers (shared through the `contract-psl` resolution export, where `lowerPrisma7Default` already imports from). Diagnostics keep the code `PSL.PRISMA7_UNKNOWN_DEFAULT`, with the reason text from the literal type, the incompatibility message, or the codec.

Deleted: `WHOLE_NUMBER_SCALARS`, `WHOLE_NUMBER_TEXT`, `rejectedNumberReason`, `numberValue`, and the `JSON.parse` in `elementValue`. Unchanged: the `sqlExpression` form for `Bytes` and `DateTime` (project decision D11), and `PSL.PRISMA7_JSON_NULL_DEFAULT_UNSUPPORTED`, which fires before the literal is read.

### B6. The printer

Files: `9-family/src/core/psl-contract-infer/default-mapping.ts`; `postgres/src/core/psl-infer/`.

`mapDefault(columnDefault, options)` gains `options.literalTypes: readonly LiteralTypeDeclaration[]`. For a literal default it calls `writeLiteral(value, literalTypes)` and prints `@default(<text>)`, or `` @default(<tag>`<text>`) `` when a tag is returned, or for a list value on a list column `@default([<each element written against the scalar declarations>])`. When `writeLiteral` returns `undefined`, the result is what `main` does for an inexpressible default (the function fallback, `dbgenerated` until slice C). `formatLiteralValue` is deleted. This is the `mapDefault(columnDefault, { codec })` seam the project plan lists for slice C, with `literalTypes` in place of `codec`; the plan is updated.

The Postgres printer needs the descriptor for each printed column. It resolves the printed PSL type name to a descriptor through the same type resolution `contract emit` uses, so the two cannot disagree; if that resolution cannot be called from infer, the closed branch's `infer-default-codec.ts` map is acceptable only with a test that asserts it agrees with the emit-side type map for every printed type name. Enum columns keep their member-name path. Deleted: `PslDefaultValueFormat`, `pslDefaultValueFormat`, `formatPslValue`, `formatPslListLiteralValue`, `formatNumber`, `formatFloat`, `formatInteger`, `formatDecimalText`, `noLiteral`, `DEFAULT_VALUE_FORMATS`.

### B7. Behaviour that changes for existing schemas

- `Jsonb @default("{}")` becomes `` Jsonb @default(json`{}`) ``.
- `Decimal @default("1.50")` becomes `Decimal @default(1.50)`.
- `Float @default("NaN")` becomes `Float @default(NaN)`.
- Any quoted value on a column whose codec does not name `string`.

Unchanged: enum member defaults; list syntax on list columns; `` Json @default(json`null`) `` stores JSON null.

### B8. Docs and upgrade instructions

- `docs/reference/error-reference.md`: `PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE`, `PSL_INVALID_DEFAULT_LITERAL`, `PSL_INVALID_JSON_LITERAL`, in the neighbours' form; the Prisma 7 message wording where it changed.
- `docs/reference/codec-authoring-guide.md`: a section on `literalTypes` with one scalar and one list example, and the coercion rule.
- `contract-psl/README.md`: one paragraph replacing the word "literals" in the `@default` list.
- `upgrade-instructions/pending/literal-types-column-defaults/app/instructions.md` (the three forms in B7, with detection on `*.prisma`) and `.../extension/instructions.md` (descriptors name `literalTypes`; `decodeJson` accepts every named shape), per the `record-upgrade-instructions` skill.

### B9. Reused from the closed branch

By hand, from `origin/remove-dbgenerated-codec-psl-literals`: the e2e test `test/integration/test/cli-journeys/codec-psl-literal-defaults.e2e.test.ts`, with its schema rewritten to the Outcome forms and a vector column added; the jsonb case in `infer-roundtrip-fidelity.e2e.test.ts`; the float fix (B2); the decimal canonicalisation cases as tests. Nothing that adds `encodePsl`, `decodePsl`, `PslLiteral`, or the `literal()` combinator.

### B10. ADR 254 amendment

ADR 254 is on the unmerged branch of PR 30334 and merged into this branch. This PR edits it: the open question is closed with decisions 1 to 3 above; the literal-types table gains the numeric types by size; "Codecs declare compatible literal types" gains the list declaration and the coercion rule; the enum and non-finite float details in "Settled details" are corrected. The project spec's D9 and D10 gain a one-line amendment note pointing here, and the plan's slice C seam is updated (B6).

## Tests (written first; each named test must fail before its implementation lands)

Framework (`framework-components/test/literal-types.test.ts`):
- classification table: `0`, `-0`, `007` → `i8` value `7`; `127`/`128` boundary; `32767`/`32768`; `2147483647`/`2147483648`; `9007199254740993` → `i64` text; `9223372036854775807`/`9223372036854775808` → `i64`/`bigint`; `1.50` → `decimal` `"1.50"`; `-007.50` → `"-7.50"`; `-0.0` → `"0.0"`; `NaN`, `Infinity`, `-Infinity` → `float`.
- `json`: object, array, `null`, invalid text → `invalid-json` with a message.
- `isCompatible`: scalar in and out of a declaration; list against `{ list }`; list against scalars only; nested list refused.
- `writeLiteral`: each type round-trips its own value; number `1.5` against `i8..i32, decimal` → `1.5`; text `"42"` against `i8..` → `42`; `1e21`-magnitude number prints without exponent; non-finite prints unquoted; JSON value prints as a `json` tag, quote fence when the text has a backtick; `undefined` when nothing matches.
- `describeDeclarations` wording.

Descriptor (`framework-components/test/codec.types.test-d.ts`): `literalTypes` is optional and typed as the declaration union.

Per pack inventory test (B2), seven files, one per pack.

Codec coercion (`postgres/test`, `sqlite/test`, `relational-core/test`, `pgvector/test`): for each codec in B2's coercion list, `decodeJson` accepts each named shape and refuses the rest; float4/float8 non-finite round-trip through `encodeJson`/`decodeJson` and `encode`/`decode`; `sqlite/integer@1` refuses `2**53 + 1`.

Registry (`6-adapters/postgres/test/control-mutation-defaults.test.ts`, SQLite equivalent): tag registry holds `sql`, `pg.sql` (or `sqlite.sql`) and `json`; `json` names literal type `json`.

Interpreter (`contract-psl/test/interpreter.defaults.literal-types.test.ts`, replacing `interpreter.number-defaults.test.ts`), whole default object asserted:
- every Outcome column above; each error case above with its code and span; `Int @default("1")` incompatible; `Float @default(1)` → `1`; `Real @default(NaN)` on a codec without `float` → incompatible; `BigInt @default(42)` → the decoded bigint, and the emitted contract holds `"42"`; `Decimal @default(42)` → `"42"`; `Jsonb @default([1, 2])` → JSON array (harmless consequence of the list arm; recorded); vector length mismatch → `PSL_INVALID_DEFAULT_LITERAL` with the codec's message; missing `descriptorFor` → `InternalError`.
- `interpreter.defaults.tagged-literal.test.ts`: `json` tag cases incl. `json\`null\``, invalid JSON, `json` on an `Int` column → incompatible, `json` inside a list on `Jsonb[]`.
- language server `completion-provider.test.ts:766` stays green unchanged.

Prisma 7 (`contract-prisma7/test/defaults.test.ts`): `Int @default(1.5)` and `Int @default(100000000000000099)` → `PRISMA7_UNKNOWN_DEFAULT` with the incompatibility reason; `Json @default("{\"a\":1}")` lowers through the codec; `Decimal @default(1.5)` → `"1.5"`; `json-null-default` fixture unchanged; `Bytes`/`DateTime` unchanged.

Printer (`9-family/test/psl-contract-infer/default-mapping.test.ts`, `postgres/test/psl-infer/print-psl/*`): every Outcome column printed back to the same text; `pg/int8@1` beyond 2^53 prints every digit; `pg/float8@1` `NaN` prints `NaN`; jsonb object prints as a `json` tag; vector prints as a list; a codec naming nothing falls back as on `main`; the type-name resolution agrees with emit for every printed type.

Journeys: the e2e test from B9 against a real database; the `infer-roundtrip-fidelity` jsonb case; `test/integration/test/number-defaults/psl-number-defaults.integration.test.ts` updated to descriptors with `literalTypes`; a parity pair `test/integration/test/authoring/parity/default-literal-types/` whose PSL and TypeScript emit identical contracts.

## Definition of done

- All tests above green; `pnpm typecheck`, `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:docs`, `pnpm lint:throws`, `pnpm fixtures:check` (no contract file changed), `pnpm check:upgrade-coverage --mode pr` green.
- `git grep -n "numberLiteralDefault\|PslDefaultValueFormat\|formatPslValue\|formatPslListLiteralValue\|formatLiteralValue\|encodePsl\|decodePsl" -- packages` returns nothing.
- Seven per-pack inventory tests exist and fail on an undeclared codec.
- ADR 254, the project spec D9/D10 note, and the plan's B6 seam updated in the PR.
- One PR against `main`, description per the `create-pr` skill, no Linear prefix, and the checklist says why.

## Halt conditions

- A codec's `decodeJson` cannot accept a named shape without changing what `contract.json` stores. Report; do not add a per-codec branch in the interpreter.
- The Postgres printer cannot reach the emit-side type resolution and the hand map cannot be tested against it. Report the seam.
- A contract source other than PSL and the Prisma 7 reader reads literal defaults. Report it.
- The `{ list }` declaration cannot express what a codec needs (for example a fixed element type per position). Report; do not add functions to the declaration.

## Repository rules that apply

`CLAUDE.md`; `.agents/rules/running-tests.mdc`; `.agents/rules/git-staging.mdc`; `.agents/rules/no-bare-casts.mdc`; `.agents/rules/contract-default-values.mdc`; `.agents/rules/storage-type-hooks.mdc`; `.agents/rules/prefer-assertions-over-defensive-checks.mdc`; `.agents/rules/omit-should-in-tests.mdc`; `.agents/rules/non-vacuous-verification.mdc`; the `psl-ast-layers` and `no-bare-casts` skills; `docs/reference/codec-authoring-guide.md`.
