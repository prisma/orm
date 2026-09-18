# ADR 253 — Literal types for column defaults

Status: **Proposed**

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

- `"anonymous"`, `9007199254740993`, `1.50`, and `true` are plain PSL scalars. They write a `string` literal, a `bigint` literal, a `decimal` literal, and a `boolean` literal.
- `` json`...` `` is a tagged literal, the syntax [ADR 129](ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md) defines: a tag followed by a string. The tag `json` names the literal type, and the string holds the JSON document. In backticks it needs no escaping and may span several lines.
- `` sql`now() + interval '3 days'` `` is also a tagged literal, but `sql` does not name a literal type. It writes a raw SQL expression, which becomes a function default the database evaluates. No codec is consulted.

Each literal type produces exactly the value shape the codecs that name it already accept in `decodeJson`, so a codec needs no new methods. Writing `` @default(json`{}`) `` on an `Int` column is an error that says `pg/int4@1` is compatible with `int` literals.

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

A single `number` literal type would have to be converted per codec, which puts conversion code on every numeric codec. Instead the literal types are cut where those representations are cut: `int`, `bigint`, and `decimal` are separate literal types, each producing what its codecs already accept. The declaration is then a list of names, and the rules for whole numbers, decimal canonicalisation, and digit preservation are written once, in the literal type, rather than once per codec.

## The literal types

A literal type defines what its value is, how a written literal is read into that value, and how a stored value is written back. It is defined in the framework, so a codec descriptor in any family can name it.

| Literal type | Value it produces | Named by |
|---|---|---|
| `string` | The text, with escapes resolved | Text, uuid, bit and varbit, enum-backed text, bytes as base64, geometry as hex, intervals, timestamps and dates as their text form |
| `boolean` | `true` or `false` | Boolean codecs |
| `int` | A JSON number, whole. A fraction is refused | `pg/int4@1`, `pg/int2@1`, `pg/int8number@1`, `sqlite/integer@1`, `sql/int@1` |
| `float` | A JSON number, or the text `NaN`, `Infinity`, or `-Infinity` | `pg/float4@1`, `pg/float8@1`, `sqlite/real@1`, `sql/float@1` |
| `bigint` | The digits as text, so every digit survives | `pg/int8@1`, `pg/unboundedint@1`, `sqlite/bigint@1` |
| `decimal` | Decimal text. Trailing zeros are kept, leading zeros and the sign of zero are removed | `pg/numeric@1` |
| `json` | A JSON value | `pg/json@1`, `pg/jsonb@1`, `sqlite/json@1`, `pg/vector@1`, `arktype/json@1` |

Two rules keep the values faithful. A number is never converted to a JavaScript number unless its literal type says so, because converting `9007199254740993` rounds it and converting `1.50` drops the trailing zero a `numeric` column keeps. And a `json` literal's body is parsed as JSON once, by the literal type, so codecs receive the JSON value rather than text they must parse.

`sqlite/real@1` and `sql/float@1` refuse `NaN` and the infinities, as they already do for JSON values. The `float` literal type carries them, and those codecs reject them when they decode.

## Writing a literal in PSL

PSL has two ways to write a literal, and both produce the same literal.

**Plain scalars** write `string`, `boolean`, and the numeric literal types, and need no tag.

**Tagged literals** write any literal type, including ones with no plain scalar. A tagged literal is a tag followed by a string in any of PSL's three quote characters; its escapes and the canonical body (line endings normalised, the common indentation removed) are those of [ADR 129](ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md). Tags are registered in `ControlMutationDefaults.defaultLiteralTagRegistry`, whose entry for a tag says which literal type it writes, and they follow ADR 129's prefixing rules. Each SQL target registers the `json` tag, with no prefixed alias. A tag that no pack in the contract's stack registers is `PSL_UNKNOWN_DEFAULT_LITERAL_TAG`, and the message lists the registered tags.

The `sql` tag is the one tag that does not write a literal type. Its body is a SQL expression, not a value of the column's type, so it lowers to a function default (`{ kind: 'function', expression }`) on any column, and no codec compatibility applies.

The syntax tree keeps exactly what the author wrote. The formatter and the language server work from the tree; only the interpreter turns scalars and tagged literals into literals.

## Codecs declare compatible literal types

A codec descriptor names the literal types its columns are compatible with. This is static metadata, next to `traits` and `targetTypes` on `CodecDescriptor`: it depends only on the codec id, never on a particular column's parameters. It carries no functions, because the literal type produces the value the codec's `decodeJson` already accepts.

```ts
class PgJsonbDescriptor extends PostgresCodecDescriptor<void> {
  override readonly literalTypes = ['json'] as const;
}

class PgInt4Descriptor extends PostgresCodecDescriptor<void> {
  override readonly literalTypes = ['int'] as const;
}
```

The declaration is optional. A codec that names no literal type accepts no literal defaults, and its columns take raw SQL defaults only.

The codec instance keeps the checks that depend on column parameters. The interpreter passes the literal type's value to the codec's existing `decodeJson`, so a `vector(3)` column given a four-element `json` literal is refused there, with the vector codec's own message.

## Reading a default

Each step has one owner.

1. **PSL parser.** Parses the `@default(...)` argument into a scalar or a tagged literal node, recording the source span.
2. **Interpreter.** Determines the literal's type: a tagged literal takes the type its tag writes; a plain scalar takes the type the column's codec declares for that scalar, which the open question below concerns. A `sql` tagged literal becomes a function default and stops here.
3. **Compatibility.** If the literal's type is not one the column's codec declares, the interpreter reports an error at the literal naming the codec and its compatible literal types.
4. **Literal type.** The literal type reads the written text into its value, refusing text it cannot read, such as a fraction written for an `int` literal.
5. **Codec instance.** `decodeJson` checks the value against the column. A value it refuses is reported at the literal with the codec's message.
6. **Contract.** The default is stored as `{ kind: 'literal', value }` in the codec's JSON form, like every literal default.

Other text-based contract sources follow the same steps from their own syntax. The reader for the earlier Prisma schema language ([ADR 252](ADR%20252%20-%20An%20earlier%20Prisma%20version's%20schema%20is%20a%20contract%20source.md)) turns that language's defaults into literals of a type and checks them against the same declarations. The TypeScript contract builder is not a text source: `.default(value)` passes a value of the codec's own type, and TypeScript's types do the compatibility check.

## Printing a default

`contract infer` runs the steps in reverse for each introspected literal default:

1. The target reads the database's default into the codec's JSON form.
2. The printer takes the literal type the column's codec declares and asks it to write that value.
3. A literal type with a plain scalar prints as that scalar. Any other prints as a tagged literal with the tag that writes it.
4. When the codec names no literal type, or the literal type cannot write the value, the printer writes the database's expression as a `sql` tagged literal. Infer never drops a default.

A printed schema therefore reads back to the same contract, because printing and reading pass through the same literal type.

## Responsibilities

| Layer | Owns |
|---|---|
| PSL parser | Scalars and tagged literal nodes, spans, canonicalisation of tagged bodies |
| Tag registry | Which literal type each tag writes; which tag writes raw SQL |
| Literal types | The value each literal holds, reading a written literal into it, and writing a stored value back |
| Interpreter and other text sources | Mapping their syntax to literals; reporting incompatibility at the literal |
| Codec descriptor | The names of the compatible literal types |
| Codec instance | `decodeJson` checks that depend on column parameters |
| Contract | The JSON form, unchanged from [ADR 184](ADR%20184%20-%20Codec-owned%20value%20serialization.md) |

## Open question: how a plain scalar picks its literal type

**Not settled, and this ADR is not implemented for the numeric literal types until it is.**

A PSL number scalar is written the same way everywhere, but under this design the literal type it produces depends on the column: `42` is an `int` literal on an `Int` column, a `bigint` literal on a `BigInt` column, and a `decimal` literal on a `Decimal` column. The column's codec decides, by what it declares, and that declaration is also the compatibility statement.

That follows from cutting the literal types where the stored representations are cut, but it means one syntax does not name one literal type. Three answers are open: accept it as written here; give each numeric literal type a tag so a written literal always names its own type; or return to a single `number` literal type whose conversion each codec owns, at the cost described above.

## Settled details

- **The declaration is optional**, and Mongo codecs name nothing, because no Mongo contract source reads defaults from text.
- **A JSON column is not compatible with a `string` literal.** `Jsonb @default("{}")` is an error that asks for `` json`{}` ``. The reader for the earlier Prisma schema language turns that language's quoted JSON into a `json` literal itself.
- **A decimal column is not compatible with a `string` literal.** `Decimal @default("1.50")` is an error, and the default is written `1.50`.
- **`NaN`, `Infinity`, and `-Infinity` are `float` literals**, because the PSL tokenizer reads them as numbers. The integer literal types refuse them.
- **JSON null is a value.** `` Json @default(json`null`) `` stores JSON null.
- **Enum columns are unchanged.** Their default is a bare member name, and enum codecs name no literal types.
- **List columns keep PSL's list syntax.** Each element is a literal checked against the element codec's declaration, so `` Jsonb[] @default([json`{}`, json`[]`]) `` is valid and `Int[] @default([1, "x"])` is refused at its second element.
- **Diagnostics.** A literal whose type the codec does not declare is `PSL_DEFAULT_LITERAL_TYPE_INCOMPATIBLE`. Text a literal type cannot read, and a value a codec refuses, are `PSL_INVALID_DEFAULT_LITERAL` with the reason. A `json` body that is not valid JSON is `PSL_INVALID_JSON_LITERAL`. Each diagnostic points at the literal.

## Alternatives considered

### Codec methods that receive the parser's classification

Codecs gain `encodePsl(value)` and `decodePsl(literal)`, where the literal is `{ kind: 'string' | 'number' | 'boolean', text }` produced by the PSL parser. This is close to the interface ADR 184 sketched.

Rejected. The input to every codec becomes the PSL tokenizer's view of the source, which couples codecs to PSL. A JSON document can only arrive as a string with its quotes escaped. And there is still no compatibility check: a codec discovers that a literal is not for it by failing to decode it.

### One `number` literal type, converted per codec

A single `number` literal type carries the digits as text, and each numeric codec declares a read function to its own JSON form and a write function back.

Rejected, and reconsidered in the open question above. Every numeric codec carries conversion code that duplicates what its `decodeJson` already does, and the rules for whole numbers, decimal canonicalisation, and digit preservation are written once per codec instead of once per literal type.

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
