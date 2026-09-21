# ADR 254 — Data types for values in PSL

Status: **Accepted**

## Decision

PSL values have **data types**. A data type is a named kind of value that a family, a target, or an extension registers. A written literal maps to a data type by its syntax; a receiver of a value, a column through its codec or a function parameter, declares by id which data types it accepts and converts them itself. Nothing central computes which types convert into which.

```prisma
model Account {
  id      Int      @id @default(autoincrement())
  name    String   @default("anonymous")
  small   SmallInt @default(100)
  balance BigInt   @default(100000000000000099)
  price   Decimal  @default(1.50)
  ratio   Float    @default(NaN)
  active  Boolean  @default(true)
  meta    Jsonb    @default(json`{ "plan": "free", "seats": 1 }`)
  scores  Int[]    @default([1, 2])
  status  Status   @default(ACTIVE)
  token   String   @default(nanoid(8))
  expires DateTime @default(sql`(now() + '3 days'::interval)`)
}
```

Reading that model: `"anonymous"` is a value of `sql/string@1`; `100` is `sql/i8@1` and `100000000000000099` is `sql/i64@1`, classified by their digits; `1.50` is `sql/decimal@1`; `NaN` is `sql/float@1`; `` json`...` `` is `sql/json@1`, named by its tag; `[1, 2]` is a list whose elements are `sql/i8@1`; `ACTIVE` is a reference to a member of `Status`, not a literal; `8` inside `nanoid(8)` is `sql/i8@1` delivered to the function's size parameter; `` sql`...` `` is an expression in the database's language, which no data type reads.

This ADR replaces the PSL half of [ADR 184](ADR%20184%20-%20Codec-owned%20value%20serialization.md). Its JSON half stands: the contract stores a literal default in the column codec's canonical JSON form.

## Terms

- A **data type** is a named kind of value with an id, a written form, and a canonical JSON representation.
- A **representation** is one encoding of a value: PSL literal text, the JSON form in `contract.json`, the wire form the driver exchanges, the in-memory JS value, a SQL expression.
- A **codec** transforms between representations of one data type, the type its column stores. Its descriptor is that type's static description: traits, the database types it binds to, its parameters, and the data types it accepts.
- A **receiver** is anything that takes a value: a column through its codec, a function parameter, and later an operator operand or a check-constraint slot.
- PSL has three **expression kinds**: a literal, a reference, and a call.

## Data types

A data type is a declaration:

```ts
interface DataType {
  readonly id: DataTypeId;
  readonly written: WrittenForm;
  read(text: string): ReadResult;
  write(value: JsonValue): string;
  readonly documentation: string;
}

type WrittenForm =
  | { readonly kind: 'number' }
  | { readonly kind: 'string' }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'tag'; readonly tag: string };
```

- `id` follows the codec convention, `<owner>/<name>@<version>`: `sql/i32@1`, `sql/json@1`, `postgis/geometry@1`. A data type is referenced from the same places a codec is, descriptors, function signatures, diagnostics, and it is owned and versioned the same way. `DataTypeId` is a branded string. An id that no contributor registered is an assembly error.
- `written` says how a literal of the type is spelled: plain number syntax, a plain quoted string, `true`/`false`, or a tag followed by a string in any of PSL's quote styles, whose body is canonicalised per [ADR 129](ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md).
- `read` turns literal text into the type's canonical JSON value, or refuses it with a reason. `write` turns a canonical value back into literal text.

**Registration.** A pack contributes data types through the control stack, in the contribution that already carries its default functions: `ControlMutationDefaults.dataTypes`. Assembly merges every contributor's declarations and refuses two declarations of one id, two types claiming one tag, and two types claiming one plain syntax kind. The tag dictionary is not a second registry; it is the registered types whose written form is a tag. The `sql` tag is the one entry that names no data type: it is a lowering tag, whose body is an expression in the database's language, and it lowers to the contract's expression representation. It stays a lowering tag until a codec can convert that representation (the DDL half of ADR 184).

**The list type.** `sql/list@1` is the type of a PSL list. Its values are JSON arrays; each element is read with its own type. A receiver that accepts lists names the element types it takes: `{ id: 'sql/list@1', of: ['sql/i8@1', 'sql/i16@1', ...] }`. A list is accepted when every element's type is in `of`. A nested list is refused.

**Ownership.** The framework owns the mechanism: the declaration shape, the registry, assembly, dispatch, and a shared implementation of the number classifier that a family may adopt. It owns no types. The SQL family registers the numeric, string, boolean, JSON and list types, and both SQL targets contribute that set, as they contribute the `sql` tag. Mongo registers a number vocabulary that suits it. No type spans families, and nothing in the framework relates one family's types to another's.

### The SQL family's types

| Id | Written as | Canonical JSON value |
|---|---|---|
| `sql/string@1` | `"..."` | the text |
| `sql/boolean@1` | `true`, `false` | the boolean |
| `sql/i8@1`, `sql/i16@1`, `sql/i32@1` | a whole number within 8, 16, 32 bits | a JSON number |
| `sql/i64@1` | a whole number within 64 bits | digit text |
| `sql/bigint@1` | any larger whole number | digit text |
| `sql/decimal@1` | a number with a fraction | decimal text |
| `sql/float@1` | `NaN`, `Infinity`, `-Infinity` | the word |
| `sql/json@1` | `` json`...` `` | the parsed document |
| `sql/list@1` | `[a, b, ...]` | an array of the elements' values |

Digit text drops leading zeros and the sign of zero and keeps trailing zeros: `007` reads as `7`, `-0` as `0`, `-007.50` as `-7.50`. `i64`, `bigint` and `decimal` carry digits as text because a JSON number rounds past 2^53 and drops a trailing zero. A written finite number is exact, so every number with a fraction is `decimal`; only the three IEEE words are `float`. `json` refuses a document containing a number that parses to a non-finite value.

## Written forms

The parser hands the interpreter a written literal with its syntax kind and span:

```ts
type WrittenLiteral =
  | { kind: 'number'; text: string; span: SourceSpan }
  | { kind: 'string'; text: string; span: SourceSpan }
  | { kind: 'boolean'; value: boolean; span: SourceSpan }
  | { kind: 'tag'; tag: string; body: string; span: SourceSpan }
  | { kind: 'list'; elements: readonly WrittenLiteral[]; span: SourceSpan };
```

Mapping it to a data type:

- A plain string maps to the registered type whose written form is `string`; a plain boolean to the type whose form is `boolean`.
- A plain number maps through the family's **classifier**, a function the family registers with its number types. The SQL family's rule is PostgreSQL's rule for literals: a whole number takes the narrowest of `i8`, `i16`, `i32`, `i64` that holds it, else `bigint`; a number with a fraction is `decimal`; the three words are `float`. The classifier exists so that a value is never rounded through a JavaScript number before its receiver sees it.
- A tag maps to the registered type whose tag it is. An unregistered tag is `PSL_UNKNOWN_DEFAULT_LITERAL_TAG`, and the message lists the registered tags. A tag may name a type that also has a plain form, so `` i8`8` `` and `8` are the same value.
- A list maps to `sql/list@1`, its elements mapped by the same rules.

The type's `read` then produces a **typed value**, `{ type: DataTypeId, value: JsonValue }`. Text the type refuses is `PSL_INVALID_DEFAULT_LITERAL`; a JSON body that does not parse is `PSL_INVALID_JSON_LITERAL`. Both point at the literal, or at the element inside a list.

## Receivers

A receiver declares `accepts: readonly DataTypeRef[]`, where a ref is an id or a list ref with its element ids. The declaration is the receiver's own statement of what it can convert into its type. It is made by the owner of the receiving type, because only the owner knows what its database or extension can take; this is how PostgreSQL's `pg_cast` works, declared per type by the type's owner. There is no central assignability rule.

**A codec descriptor** declares `accepts` next to `traits` and `targetTypes`:

```ts
class PgInt4Descriptor extends PostgresCodecDescriptor<void> {
  override readonly accepts = sqlIntegerTypesUpTo('sql/i32@1');
}

class PgVectorDescriptor extends PostgresCodecDescriptor<VectorParams> {
  override readonly accepts = [{ id: 'sql/list@1', of: [...sqlIntegerTypesUpTo('sql/i64@1'), 'sql/bigint@1', 'sql/decimal@1'] }];
}
```

Conversion happens in the codec's existing `decodeJson`, which accepts the canonical value of every type in `accepts` as well as the codec's stored form. `pg/int8@1` accepts `i8` to `i64`, so its `decodeJson` reads a JSON number and digit text. `pg/numeric@1` accepts the integers, `decimal` and `float`, and reads a number as canonical decimal text. No codec gains a method. Checks that depend on parameters run in the codec instance built with the column's parameters: `vector(3)` refuses four elements, `numeric(10,2)` refuses a third decimal place. A limit of the stored representation is also the codec's to refuse: `sqlite/real@1` accepts `float` and refuses `NaN` in `decodeJson`, because SQLite cannot store it. A codec that declares nothing takes no literal value; its columns take `sql` only.

**A function parameter** declares `accepts` the same way. `nanoid`'s size parameter accepts `sql/i8@1`; the function converts and range-checks its own arguments. This replaces the parser's argument kinds in function signatures, so a function argument and a column default are checked by one rule.

**The column-default receiver** is the family: it accepts the column codec's `accepts` plus the `sql` lowering tag.

## Expression kinds

- **Literal.** Mapped to a typed value, checked against the receiver's `accepts`, converted by the receiver. A type the receiver does not accept is `PSL_DEFAULT_TYPE_INCOMPATIBLE`: `Field "Account.count": pg/int4@1 does not accept sql/i64@1; it accepts sql/i8@1, sql/i16@1, sql/i32@1`, with the element index when the value is inside a list.
- **Reference.** An identifier resolves through the symbol table to a declaration, and its value is the declaration's, of the declaration's type. An enum member resolves to the member declared in its `enum` block, and the check is scope: the member must belong to this column's enum. No classification and no `accepts` apply.
- **Call.** A registered function; each argument is an expression delivered to a parameter, which is a receiver. The call's result is what the function registry returns today, a storage default or an execution default.

## Reading a default

1. The parser yields a literal, a reference, or a call, with spans.
2. A reference resolves; a call dispatches to its function; a `sql` tag lowers. Any other literal maps to a typed value through the registry and the classifier.
3. The typed value's type is checked against the codec's `accepts`; for a list literal on a scalar column, each element's type against the list ref's `of`; for a list column, each element against the element codec.
4. The codec instance for the column's parameters runs `decodeJson`. A throw is reported at the literal with the codec's message.
5. The decoded value is stored. The contract builder re-encodes it through `encodeJson`, so the contract holds the codec's canonical JSON form. The contract's two default shapes, a JSON value and an expression, do not change.

The reader for the earlier Prisma schema language ([ADR 253](ADR%20253%20-%20PSL%20red-root%20source%20ownership.md) is about its provenance; [ADR 252](ADR%20252%20-%20An%20earlier%20Prisma%20version's%20schema%20is%20a%20contract%20source.md) makes it a contract source) runs the same steps from its own syntax: its quoted JSON on a JSON column is `sql/json@1`'s `read`, its numbers go through the classifier, and its `Bytes` and `DateTime` stay on the expression path until a codec converts that representation. The TypeScript builder is not a text source: it hands `encodeJson` a JS value that TypeScript has typed.

## Printing

`contract infer` inverts the mapping. For a stored literal value: classify the JSON value to a type by the same rules (a number or digit text through the classifier, a string as `string`, a boolean, an object as `json`, an array as `list` or `json` by what the codec accepts); confirm the codec accepts that type; call the type's `write`; run the text back through the codec's `decodeJson` to prove it reads; print it in the type's written form, plain or tagged. Any step that fails takes the raw-expression fallback, so infer never prints a schema emit cannot read. The printer obtains the column's codec from the type binding emit uses; where layering forbids that import, it restates the binding with a test that pins agreement.

## Extending the set of types

A pack that owns a type it wants writable in PSL registers one declaration: id, tag, `read`, `write`, documentation. Its codec lists the id in `accepts`, and its `decodeJson` reads the canonical value. Nothing in the interpreter, the printer, the language server, or the other readers changes.

## Responsibilities

| Owner | Owns |
|---|---|
| PSL parser | Literal, reference and call nodes; spans; canonical tag bodies |
| Framework | The `DataType` declaration, the registry, assembly, dispatch, the shared classifier implementation |
| Family | Its data types and classifier; the `sql` lowering tag; the column-default receiver |
| Data type | Reading its literal text into its canonical value and writing it back |
| Receiver (codec descriptor, function parameter) | The ids it accepts; the conversion; parameter-dependent checks in the instance |
| Contract | The JSON form and the expression form, unchanged from ADR 184 |

## Alternatives considered

- **Codec methods that receive PSL text** (`encodePsl`/`decodePsl`, ADR 184's sketch). Rejected: every codec becomes coupled to PSL's tokenizer and escaping, and there is no compatibility check before a decode fails.
- **A central assignability system**, where the framework decides which types convert into which. Rejected: databases and extensions define their own types and their own coercions, and the framework cannot know them. The receiver's declaration is the only honest place for that knowledge.
- **One `number` type converted per codec.** Rejected: `100000000000000099` written plainly must not round, and each numeric codec would carry the same conversion code.
- **The column decides a plain number's type.** Rejected: one syntax would not name one type, and a size error would surface inside a codec instead of as a type the receiver does not accept.
- **Types as a closed union in the framework.** Rejected: an extension cannot add one, and the framework would own a vocabulary that belongs to families.
- **Enum members as string literals.** Rejected: a member name is a reference to a declaration, resolved in scope like a field name; making it a value would need a type for "identifier".
- **`pg/vector@1` accepting `sql/json@1`.** Rejected: it matches on storage shape; a vector is a list of numbers.

## Not decided here

Whether the temporal, bytes and interval types get their own tags and stop accepting `sql/string@1`; when a codec converts the `sql` representation; Mongo's number vocabulary.

## Related

- [ADR 184 — Codec-owned value serialization](ADR%20184%20-%20Codec-owned%20value%20serialization.md): the JSON half stands; this ADR replaces the PSL half.
- [ADR 129 — Tagged literals](ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md): the tag syntax and canonical body; this ADR makes a tag the written form of a data type, with `sql` the one lowering tag.
- [ADR 252 — An earlier Prisma version's schema is a contract source](ADR%20252%20-%20An%20earlier%20Prisma%20version's%20schema%20is%20a%20contract%20source.md): a second text source that maps its syntax to the same types.
- [ADR 167 — Typed default literal pipeline and extensibility](ADR%20167%20-%20Typed%20default%20literal%20pipeline%20and%20extensibility.md): historical context.
