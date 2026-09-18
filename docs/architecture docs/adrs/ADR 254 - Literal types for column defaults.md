# ADR 254 — Literal types for column defaults

Status: **Accepted**

## Decision

Every literal column default has a **literal type**. A codec declares the literal types its columns are compatible with, by name and nothing more. PSL is one way of writing a literal of a given type, and a codec never sees PSL syntax.

```prisma
model Account {
  id      Int      @id
  name    String   @default("anonymous")
  balance BigInt   @default(9007199254740993)
  price   Decimal  @default(1.50)
  active  Boolean  @default(true)
  meta    Jsonb    @default(json`{ "plan": "free", "seats": 1 }`)
  expires DateTime @default(sql`now() + interval '3 days'`)
}
```

Reading that model:

- `"anonymous"`, `9007199254740993`, `1.50`, and `true` are plain PSL scalars. They write a `string` literal, an `i64` literal (the smallest whole-number type that holds those digits), a `decimal` literal, and a `boolean` literal.
- `` json`...` `` is a tagged literal, the syntax [ADR 129](ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md) defines: a tag followed by a string. The tag `json` names the literal type, and the string holds the JSON document. In backticks it needs no escaping and may span several lines.
- `` sql`now() + interval '3 days'` `` is also a tagged literal, but `sql` does not name a literal type. It writes a raw SQL expression, which becomes a function default the database evaluates. No codec is consulted.

Each literal type fixes the value shape it produces, and a codec that stores a different shape converts inside the `decodeJson` it already has, so a codec needs no new methods. Writing `` @default(json`{}`) `` on an `Int` column is an error: `pg/int4@1 is not compatible with a json literal; it accepts i8, i16, i32 literals`.

This ADR replaces the PSL half of [ADR 184](ADR%20184%20-%20Codec-owned%20value%20serialization.md), which sketched `encodePsl` and `decodePsl` methods on codecs. The JSON half of ADR 184 is unchanged.

## Why literal types

### A codec cannot be asked "is this literal yours?" without a type to answer about

In SQL a codec can represent almost anything: a number, a document, a geometry, a vector, a timestamp. When a schema writes a default, something has to decide whether the written value suits the column. If the only information available is the characters the author typed, the codec has to try to read them and report failure by throwing. That makes compatibility a side effect of decoding, and the error the author sees is whatever the codec happened to throw.

A literal type turns the question into a lookup. The literal says what kind of value it is. The codec says which kinds it accepts. A mismatch is reported before anything is decoded, with a message that names the codec and the literal types it accepts.

### A codec should not depend on PSL

Codecs live below every authoring surface. PSL is one surface; the schema language of earlier Prisma versions, read by the contract source in [ADR 252](ADR%20252%20-%20An%20earlier%20Prisma%20version's%20schema%20is%20a%20contract%20source.md), is another. If a codec received PSL text, or the PSL parser's idea of what a token is, every codec would be coupled to PSL's quoting, escaping, and tokenizer rules. A change to PSL syntax would become a change to every codec.

With literal types, each authoring surface maps its own syntax to literals, and codecs only ever receive a literal of a type they declared. PSL can gain new tags without any codec changing.

### The literal types are cut where the stored representations are cut

The contract stores a literal default in the column codec's JSON form ([ADR 184](ADR%20184%20-%20Codec-owned%20value%20serialization.md)). Codecs that hold numbers do not share one JSON form:

| Column | Codec | Written | Stored in `contract.json` |
|---|---|---|---|
| `Int` | `pg/int4@1` | `42` | `42` |
| `BigInt` | `pg/int8@1` | `9007199254740993` | `"9007199254740993"` |
| `Decimal` | `pg/numeric@1` | `1.50` | `"1.50"` |

A single `number` literal type would have to be converted per codec, which puts conversion code on every numeric codec. Instead the literal types are cut where those representations are cut, and the whole-number types are cut again by width — `i8`, `i16`, `i32`, `i64`, then `bigint` — so that a number too large for its column is a type the column does not accept rather than a value it fails to decode. The declaration is then a list of names, and the rules for whole numbers, decimal canonicalisation, and digit preservation are written once, in the literal type, rather than once per codec.

## The literal types

A literal type defines what its value is, how a written literal is read into that value, and how a stored value is written back. It is defined in the framework, so a codec descriptor in any family can name it.

| Literal type | Written as | Value it produces | Named by |
|---|---|---|---|
| `string` | A string scalar | The text, with escapes resolved | Text, uuid, inet, bit and varbit, bytes as base64, geometry as hex, intervals, timestamps and dates as their text form |
| `boolean` | `true` / `false` | `true` or `false` | Boolean codecs |
| `i8` | A whole number in [-128, 127] | A JSON number | Every integer codec |
| `i16` | A whole number in [-32768, 32767] not already `i8` | A JSON number | `pg/int2@1` and wider |
| `i32` | A whole number in the signed 32-bit range not already smaller | A JSON number | `pg/int4@1`, `pg/int@1`, `sql/int@1` and wider |
| `i64` | A whole number in the signed 64-bit range not already smaller | The digits as text, because a JSON number rounds past 2^53 | `pg/int8@1`, `pg/int8number@1`, `sqlite/integer@1`, `sqlite/bigint@1`, `sqlite/bigintnumber@1` and wider |
| `bigint` | Any larger whole number | The digits as text | `pg/unboundedint@1`, and every codec over `numeric` or a float |
| `decimal` | A number with a fraction | Decimal text. Trailing zeros are kept, leading zeros and the sign of zero are removed | `pg/numeric@1`, `pg/float4@1`, `pg/float8@1`, `pg/float@1`, `sql/float@1`, `sqlite/real@1` |
| `float` | `NaN`, `Infinity`, `-Infinity` | That text | `pg/numeric@1`, `pg/float4@1`, `pg/float8@1` |
| `json` | A `json` tag body | The parsed JSON value | `pg/json@1`, `pg/jsonb@1`, `sqlite/json@1`, `arktype/json@1` |

A declaration may also name **a list of element types**, `{ list: [...] }`, which is how a column that is not a list takes a PSL list: `pg/vector@1` names a list of the whole-number and `decimal` types, so a vector column takes `@default([0.1, 0.2, 0.3])`.

Two rules keep the values faithful. A number is never converted to a JavaScript number unless its literal type says so, because converting `9007199254740993` rounds it and converting `1.50` drops the trailing zero a `numeric` column keeps. And a `json` literal's body is parsed as JSON once, by the literal type, so codecs receive the JSON value rather than text they must parse.

## Writing a literal in PSL

PSL has two ways to write a literal, and both produce the same literal.

**Plain scalars** write `string`, `boolean`, and the numeric literal types, and need no tag.

**Tagged literals** write any literal type, including ones with no plain scalar. A tagged literal is a tag followed by a string in any of PSL's three quote characters; its escapes and the canonical body (line endings normalised, the common indentation removed) are those of [ADR 129](ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md). Tags are registered in `ControlMutationDefaults.defaultLiteralTagRegistry`, whose entry for a tag says which literal type it writes, and they follow ADR 129's prefixing rules. Each SQL target registers the `json` tag, with no prefixed alias. A tag that no pack in the contract's stack registers is `PSL_UNKNOWN_DEFAULT_LITERAL_TAG`, and the message lists the registered tags.

The `sql` tag is the one tag that does not write a literal type. Its body is a SQL expression, not a value of the column's type, so it lowers to a function default (`{ kind: 'function', expression }`) on any column, and no codec compatibility applies.

The syntax tree keeps exactly what the author wrote. The formatter and the language server work from the tree; only the interpreter turns scalars and tagged literals into literals.

## Codecs declare compatible literal types

A codec descriptor names the literal types its columns are compatible with. This is static metadata, next to `traits` and `targetTypes` on `CodecDescriptor`: it depends only on the codec id, never on a particular column's parameters. It carries no functions — a declaration is a list of names, and turning a named type's value into the codec's own form is work `decodeJson` already does.

```ts
class PgJsonbDescriptor extends PostgresCodecDescriptor<void> {
  override readonly literalTypes = ['json'] as const;
}

class PgInt4Descriptor extends PostgresCodecDescriptor<void> {
  override readonly literalTypes = integerLiteralTypesUpTo('i32');
}

class PgVectorDescriptor extends PostgresCodecDescriptor<VectorParams> {
  override readonly literalTypes = [
    { list: [...integerLiteralTypesUpTo('i64'), 'bigint', 'decimal'] },
  ] as const;
}
```

`integerLiteralTypesUpTo(name)` gives the chain from `i8` up to and including `name`, so a descriptor does not spell it out.

The declaration is optional. A codec that names no literal type accepts no literal defaults, and its columns take raw SQL defaults only.

**A codec converts between the shapes it names and its own stored form, inside its existing `decodeJson`.** The literal type fixes the shape of the value it produces, and a codec that stores a different shape is the one that knows how to convert: `pg/int8@1` stores digit text and names `i8` to `i64`, so its `decodeJson` accepts a whole JSON number as well as the text. No codec gains a method, and no contract source branches per codec.

The codec instance keeps the checks that depend on column parameters. The interpreter builds the codec from the descriptor with the column's own `typeParams` and passes the literal type's value to `decodeJson`, so a `vector(3)` column given two elements is refused there, with the vector codec's own message.

## Reading a default

Each step has one owner.

1. **PSL parser.** Parses the `@default(...)` argument into a scalar or a tagged literal node, recording the source span.
2. **Interpreter.** Turns the node into a written literal, independent of the source language: the text of a string, the digits of a number as written, a boolean, the body of a tag, or a list of those. A `sql` tagged literal becomes a function default and stops here.
3. **Literal types.** Reading the written literal gives its type and its value together: a number's type comes from its own size and precision, a tag's from the type its tag names. Text no literal type reads — a number with an exponent, a `json` body that is not a JSON document — is refused here.
4. **Compatibility.** If the literal's type is not one the column's codec declares, the interpreter reports an error naming the codec, the literal's type, and the types the codec accepts. Nothing has been decoded.
5. **Codec instance.** `decodeJson` converts the literal type's value into the codec's own form and checks it against the column. A value it refuses is reported with the codec's message.
6. **Contract.** The default is stored as `{ kind: 'literal', value }` in the codec's JSON form, like every literal default.

Other text-based contract sources follow the same steps from their own syntax. The reader for the earlier Prisma schema language ([ADR 252](ADR%20252%20-%20An%20earlier%20Prisma%20version's%20schema%20is%20a%20contract%20source.md)) turns that language's defaults into literals of a type and checks them against the same declarations. The TypeScript contract builder is not a text source: `.default(value)` passes a value of the codec's own type, and TypeScript's types do the compatibility check.

## Printing a default

`contract infer` runs the steps in reverse for each introspected literal default:

1. The target reads the database's default into the codec's JSON form.
2. The printer takes the literal type the column's codec declares and asks it to write that value.
3. A literal type with a plain scalar prints as that scalar. Any other prints as a tagged literal with the tag that writes it. A `json` body always uses the backtick fence, escaping backslashes and backticks: a quote-fenced tagged literal resolves the full PSL string escapes, so switching fences would change what a body containing `\n` reads back as.
4. **The printer passes what it wrote back through the column's codec's `decodeJson`** before printing it. A literal type says what a value is written as, not that the codec accepts every value of that shape — the temporal codecs name `string` but refuse `infinity`, which PostgreSQL stores and reports verbatim.
5. When the codec names no literal type, the literal type cannot write the value, or the codec does not read it back, the printer writes the database's expression as a raw SQL default instead. Infer never drops a default.

A printed schema therefore reads back to the same contract, because printing and reading pass through the same literal type.

The printer needs the codec bound to each PSL type name it prints. That binding lives in the adapter's authoring type namespaces, which sit above the target package the printer is in, so the target restates it for the type names it prints and a test in the adapter fails if the two disagree — the same shape as any other restated invariant, with the check that keeps it honest.

## Responsibilities

| Layer | Owns |
|---|---|
| PSL parser | Scalars and tagged literal nodes, spans, canonicalisation of tagged bodies |
| Tag registry | Which literal type each tag writes; which tag writes raw SQL |
| Literal types | The value each literal holds, reading a written literal into it, and writing a stored value back |
| Interpreter and other text sources | Mapping their syntax to written literals; wording the refusals in their own diagnostics |
| Codec descriptor | The names of the compatible literal types |
| Codec instance | `decodeJson`: converting each named type's value shape into the codec's own form, and the checks that depend on column parameters |
| Contract | The JSON form, unchanged from [ADR 184](ADR%20184%20-%20Codec-owned%20value%20serialization.md) |

## How a plain scalar picks its literal type

**Settled: from the number itself, never from the column.**

A written number's literal type comes from its own size and precision. `42` is an `i8` on every column, `100000000000000099` an `i64`, `1.50` a `decimal`, `NaN` a `float`. The whole-number types are cut by width — `i8`, `i16`, `i32`, `i64`, then `bigint` for anything larger — and a number takes the smallest type that holds it, decided by comparing its digits as a `BigInt`, so no classification passes through a JavaScript number.

One syntax then names one literal type, the compatibility check is a lookup with no trial decoding, and a value too large for its column is reported as an incompatibility before anything is decoded: `Int @default(100000000000000099)` says `pg/int4@1 is not compatible with an i64 literal; it accepts i8, i16, i32 literals`.

This is why a codec names a *chain* of types rather than one: `pg/int4@1` names `i8` to `i32`, `pg/int8@1` names `i8` to `i64`. The cost is that a codec whose stored shape differs from a named type's shape converts between them, which the section above makes its job.

## Settled details

- **The declaration is optional**, and Mongo codecs name nothing, because no Mongo contract source reads defaults from text.
- **A JSON column is not compatible with a `string` literal.** `Jsonb @default("{}")` is an error that asks for `` json`{}` ``. The reader for the earlier Prisma schema language turns that language's quoted JSON into a `json` literal itself.
- **A decimal column is not compatible with a `string` literal.** `Decimal @default("1.50")` is an error, and the default is written `1.50`.
- **`NaN`, `Infinity`, and `-Infinity` are `float` literals**, because the PSL tokenizer reads them as numbers, and they are written and printed bare — a quoted `"NaN"` is a `string` literal, which no numeric codec accepts. The integer literal types refuse them.
- **`sqlite/real@1`, `sql/float@1` and `pg/float@1` do not name `float`**, because their `decodeJson` refuses non-finite values. `Real @default(NaN)` on SQLite is therefore an incompatibility reported at the attribute, not a decode failure at emit.
- **JSON null is a value.** `` Json @default(json`null`) `` stores JSON null.
- **Enum columns are unchanged.** Their default is a bare member name, and enum codecs name no literal types.
- **List columns keep PSL's list syntax.** Each element is a literal checked against the element codec's declaration, so `` Jsonb[] @default([json`{}`, json`[]`]) `` is valid and `Int[] @default([1, "x"])` is refused, naming the second element.
- **A list literal on a scalar column needs a `{ list }` declaration.** `` Jsonb @default([1, 2]) `` is an incompatibility, because `pg/jsonb@1` names only `json`; the JSON array is written `` json`[1, 2]` ``. A vector column accepts one because `pg/vector@1` names a list of element types.
- **A diagnostic inside a list names the failing element in its message** (`Field "N.scores" at element 2: ...`) and is reported at the `@default(...)` attribute, because the attribute-spec layer carries no span for a string, number or boolean argument.
- **Diagnostics.** A literal whose type the codec does not declare is `PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE`. Text a literal type cannot read, and a value a codec refuses, are `PSL_INVALID_DEFAULT_LITERAL` with the reason. A `json` body that is not valid JSON is `PSL_INVALID_JSON_LITERAL`. Each diagnostic points at the literal.

## Alternatives considered

### Codec methods that receive the parser's classification

Codecs gain `encodePsl(value)` and `decodePsl(literal)`, where the literal is `{ kind: 'string' | 'number' | 'boolean', text }` produced by the PSL parser. This is close to the interface ADR 184 sketched.

Rejected. The input to every codec becomes the PSL tokenizer's view of the source, which couples codecs to PSL. A JSON document can only arrive as a string with its quotes escaped. And there is still no compatibility check: a codec discovers that a literal is not for it by failing to decode it.

### One `number` literal type, converted per codec

A single `number` literal type carries the digits as text, and each numeric codec declares a read function to its own JSON form and a write function back.

Rejected. Every numeric codec carries conversion code that duplicates what its `decodeJson` already does, and the rules for whole numbers, decimal canonicalisation, and digit preservation are written once per codec instead of once per literal type.

### Codecs receive the raw argument text

Whatever is written between `@default(` and `)` goes to the column codec as text, and the codec parses it.

Rejected. The parser would need an unparsed argument form that exists for `@default` alone, and the formatter and language server would need to understand it. Every codec would reimplement PSL quoting and escaping. And a bare word such as `ACTIVE` could be an enum member or a string the codec reads, with nothing to tell them apart.

### Try each JSON form until the codec accepts one

A number literal is offered to the codec as a JSON number first, then as text, and the first form `decodeJson` accepts wins.

Rejected. Compatibility is again discovered by failure, a value that two forms both decode is ambiguous, and the error the author sees comes from the last attempt rather than from the actual mismatch.

### A separate registry of PSL converters keyed by codec id

The PSL conversions live in a registry beside the codecs, as ADR 184's `PslLiteralCodec` interface suggested.

Rejected. The codec descriptor is already the codec-id-keyed home for a codec's static metadata. A second registry would hold the same kind of information in a second place and could drift from the codecs it describes.

## Related

- [ADR 184 — Codec-owned value serialization](ADR%20184%20-%20Codec-owned%20value%20serialization.md): codecs own the JSON form of values. Its JSON half stands; this ADR replaces its PSL half.
- [ADR 129 — Tagged literals carry raw SQL and other pack-owned text in PSL](ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md): the tagged literal syntax, the canonical body, and tag registration. This ADR adds that a tag writes either a literal of a literal type or, for `sql`, a raw SQL expression.
- [ADR 252 — An earlier Prisma version's schema is a contract source](ADR%20252%20-%20An%20earlier%20Prisma%20version's%20schema%20is%20a%20contract%20source.md): a second text contract source that maps its own syntax to literals.
- [ADR 167 — Typed default literal pipeline and extensibility](ADR%20167%20-%20Typed%20default%20literal%20pipeline%20and%20extensibility.md): historical context for typed literal defaults.
