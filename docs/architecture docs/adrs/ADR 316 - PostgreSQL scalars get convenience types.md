# ADR 316 — PostgreSQL scalars get convenience types

**Status:** Accepted
**Amended (2026-11-06):** `Json` becomes a convenience type that stores `jsonb` by default, and the explicit type for a `json` column is renamed `PlainJson`. See "`Json`" below.
**Amends:** [ADR 257 — Scalar types are named after the target on every surface](ADR%20257%20-%20Scalar%20types%20are%20named%20after%20the%20target%20on%20every%20surface.md), [ADR 279 — Convenience types choose an explicit type from their arguments](ADR%20279%20-%20Convenience%20types%20choose%20an%20explicit%20type%20from%20their%20arguments.md)

## At a glance

```prisma
model Account {
  id      Int                                  @id // exactly Int4
  visits  Int(storage: int2)                        // exactly Int2
  balance BigInt                                    // exactly Int8BigInt
  rank    BigInt(as: number)                        // exactly Int8Number
  price   Decimal(precision: 10, scale: 2)          // exactly NumericString(10, 2)
  name    String                                    // exactly Text
  code    String(storage: varchar, length: 12)      // exactly Varchar(12)
  ratio   Float                                     // exactly Float8
  active  Boolean                                   // exactly Bool
  avatar  Bytes                                     // exactly Bytea
  payload Json                                      // exactly Jsonb
  raw     Json(storage: json)                       // exactly PlainJson
}
```

`Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` and `Json` are names for what a field means. On PostgreSQL each is a convenience type, as `DateTime` is: its arguments choose one explicit type, and the contract stores only that type. The explicit types are named after the database type, so `Int(storage: int2)` and `Int2` emit the same contract.

## Decision

PostgreSQL's integer, decimal, floating-point, text, boolean, binary and JSON types get convenience types, built with the type choice mechanism of ADR 279. Every option is optional and has a default, so the bare name is a working type. An argument that is not an option is passed on to the explicit type the row names. Positional arguments fill the arguments in their declared order, and the options come first, so `Decimal(10, 2)` sets `storage` to `10` and is refused at `storage`. Precision, scale and length are therefore written by name, such as `Decimal(precision: 10, scale: 2)`.

| Convenience type | `as` | `storage` | Becomes |
| --- | --- | --- | --- |
| `Int(storage?)` | | `int4` (default) | `Int4` |
| | | `int2` | `Int2` |
| `BigInt(as?, storage?)` | `bigint` (default) | `int8` (default) | `Int8BigInt` |
| | `number` | `int8` | `Int8Number` |
| | `bigint` | `numeric` | `NumericBigInt` |
| `Float(storage?)` | | `float8` (default) | `Float8` |
| | | `float4` | `Float4` |
| `Decimal(storage?, precision?, scale?)` | | `numeric` (default) | `NumericString` |
| `String(storage?, length?)` | | `text` (default) | `Text` |
| | | `varchar` | `Varchar` |
| | | `char` | `Char` |
| `Boolean(storage?)` | | `bool` (default) | `Bool` |
| `Bytes(storage?)` | | `bytea` (default) | `Bytea` |
| `Json(storage?)` | | `jsonb` (default) | `Jsonb` |
| | | `json` | `PlainJson` |

Every convenience type has a `storage` option, even where PostgreSQL has one storage for it, as `Date(storage: date)` already does under ADR 279. A convenience type then has the same options on every target, and a target adds a storage value without changing them. The values of `storage` and `as` are each target's own, as [ADR 315](ADR%20315%20-%20Each%20target%20declares%20the%20convenience%20date%20and%20time%20types%20over%20its%20own%20explicit%20types.md) decided for the date and time types.

The PSL name of an explicit type is the database type, plus a suffix naming the application value where the database type has more than one codec. This amends ADR 257's token rule, which derived the name from the codec id. Codec ids are frozen identifiers and are not renamed, so they need not match the PSL name: `Int8BigInt` is `pg/int8@1` and `NumericBigInt` is `pg/unboundedint@1`. Internal symbols named after a codec, such as `PG_UNBOUNDED_INT_CODEC_ID`, keep their names too.

| Explicit type | Codec id | Database type | Application value |
| --- | --- | --- | --- |
| `Int2` | `pg/int2@1` | `int2` | `number` |
| `Int4` | `pg/int4@1` | `int4` | `number` |
| `Int8BigInt` | `pg/int8@1` | `int8` | `bigint` |
| `Int8Number` | `pg/int8number@1` | `int8` | `number` in the safe-integer range |
| `NumericString(p?, s?)` | `pg/numeric@1` | `numeric` | `string`, decimal text |
| `NumericBigInt` | `pg/unboundedint@1` | `numeric` | `bigint` |
| `Float4` | `pg/float4@1` | `float4` | `number` |
| `Float8` | `pg/float8@1` | `float8` | `number` |
| `Text` | `pg/text@1` | `text` | `string` |
| `Varchar(n?)` | `sql/varchar@1` | `character varying` | `string` |
| `Char(n?)` | `sql/char@1` | `character` | `string` |
| `Bool` | `pg/bool@1` | `bool` | `boolean` |
| `Bytea` | `pg/bytea@1` | `bytea` | `Uint8Array` |
| `Jsonb` | `pg/jsonb@1` | `jsonb` | `JsonValue` |
| `PlainJson` | `pg/json@1` | `json` | `JsonValue` |

The explicit names that disappear, `SmallInt`, `BigIntNumber`, `Numeric`, `UnboundedInt`, `Real`, `VarChar` and `VarBit`, stay for one release line as deprecated aliases of `Int2`, `Int8Number`, `NumericString`, `NumericBigInt`, `Float4`, `Varchar` and `Varbit`, under ADR 257's rule. `VarBit` is renamed only to follow the naming rule above, as `VarChar` is: the database type is `varbit`. The names that become convenience types need no alias: at their defaults they give the codec they gave before, so no existing schema or contract changes. `Json` is the exception, described below.

A TypeScript column helper is named after the explicit type it gives: `int8Column` becomes `int8BigIntColumn`, `numericColumn` becomes `numericStringColumn` and `jsonColumn` becomes `plainJsonColumn`. The other helpers, such as `int2Column`, `textColumn` and `varcharColumn`, already match.

The family's `sql.String(n)` and `sql.Char(n)` stay as they are: they are family-wide explicit types for `varchar` and `char` with a required length, shared with SQLite and MySQL. `sql.String(12)` is `Varchar(12)`, not the `String` convenience type. They are reconsidered with the other targets in TML-3790.

Types that already name one concept keep a single explicit name and get no convenience type: `Uuid`, `Inet`, `Bit`, `Varbit`, `Xml`, `Oid`, `Money`, `citext.Citext` and `pg.enum(...)`.

### `Json`

`Json` is a convenience type with one option, `storage`: `jsonb`, the default, chooses `Jsonb`, and `json` chooses `PlainJson`. It has no `as` option, because both codecs read a `JsonValue`. Before this amendment `Json` was the explicit type for a `json` column, so a field written `Json` now stores `jsonb`. A Prisma 7 schema is not affected: Prisma 7's `Json` was already `jsonb`, and `Json @db.Json` reads as `PlainJson`.

**Naming.** The rule above gives `Json` for `pg/json@1`, which the convenience type takes, and no application-value suffix separates it from `jsonb`, because both read a `JsonValue`. When a database type's only codec would take the convenience name, and no application-value suffix separates it from a sibling type, the explicit type takes a qualifier that names it by contrast with that sibling. `PlainJson` is plain `json`, as opposed to `jsonb`. This departs on purpose from "named after the database type": PostgreSQL has no type called "plain json". `Plain` here does not mean what it means in Temporal names such as `Temporal.PlainDate`, so the type's documentation says "plain `json`, not `jsonb`". A name in the `pg` namespace, such as `pg.Json`, is not possible: a type choice row names a type constructor at its own level of the namespace.

**An exception to ADR 257's alias rule.** ADR 257 keeps a renamed name as a deprecated alias for one release line, so that a rename never changes a contract silently. Here the name `Json` stays and the codec it gives changes, which that rule exists to prevent. It is also the second change to `Json` in the release-candidate line: an earlier upgrade bound `Json` from `jsonb` to `json`. No deprecation is possible: the type choice mechanism has no deprecation mark, and every option must have a default, so a warning on a bare `Json` or a required `storage` argument would need a change to the framework. A warning on every `Json` field would also fire on the name users should write. Three checks catch the change instead: `contract emit` writes a new storage hash, `db verify` reports the column, and the migration planner classes `json` to `jsonb` as a destructive type change and asks the data-loss question before it alters the column. A user who wants no change writes `Json(storage: json)` or `PlainJson`.

## Why

A name such as `Int` should mean "an integer", not "a PostgreSQL `int4`". ADR 257 names every explicit type after what the database stores, and ADR 279 adds names for application concepts on top, so a user writes what a field means and gets a working default. Applying both to the other scalars removes the last place where a concept name such as `String` was also the name of one column type.

The concepts are the ones other data tools use. Every tool that names concepts rather than column types has separate names for an integer and a big integer (SQLAlchemy `Integer` and `BigInteger`, Django `IntegerField` and `BigIntegerField`, Rails `:integer` and `:bigint`, Prisma 7 `Int` and `BigInt`), so `Int` covers integers within 32 bits and `BigInt` integers that may exceed them. Drizzle (`mode: 'bigint'`), MikroORM (`new DecimalType('number')`) and SQLAlchemy (`asdecimal=False`) choose the application value with an option, as `as:` does.

A convenience type has an `as` option only where some target offers more than one application value for it, and then it has the option on every target, even with one value, as SQLite's `Duration` has `as: string` ([ADR 315](ADR%20315%20-%20Each%20target%20declares%20the%20convenience%20date%20and%20time%20types%20over%20its%20own%20explicit%20types.md)). Among these types, today only `BigInt` has one. `Int8Number` is reached only through `BigInt(as: number)`, so each explicit type has one convenience call. Adding an application value later, such as a decimal library value for `Decimal`, adds an option and rows without renaming anything.

## How it works

### Declarations

The PostgreSQL target declares the explicit types as type constructors and the convenience types as type choices, in the same `type` namespace, so PSL and the TypeScript builder's `type.*` see the same names:

```ts
BigInt: {
  kind: 'typeChoice',
  args: [
    { kind: 'option', name: 'as', values: ['bigint', 'number'], default: 'bigint', optional: true },
    { kind: 'option', name: 'storage', values: ['int8', 'numeric'], default: 'int8', optional: true },
  ],
  choices: [
    { when: { as: 'bigint', storage: 'int8' }, type: 'Int8BigInt' },
    { when: { as: 'number', storage: 'int8' }, type: 'Int8Number' },
    { when: { as: 'bigint', storage: 'numeric' }, type: 'NumericBigInt' },
  ],
},
```

A deprecated alias is the same type constructor as its replacement with `deprecated: { replacement }` and no `inferred` mark. When no marked constructor produces a column's codec, `contract print` takes the first constructor that does, and it leaves out constructors marked `deprecated`. So print never writes an alias, wherever the aliases are declared.

### Two refusals the mechanism gives

The type choice mechanism is not changed, so two of its rules shape these types:

- **An option's default does not depend on another option.** `BigInt(as: number)` works because the default storage, `int8`, has a `number` row. `BigInt(storage: numeric, as: number)` is refused at `storage`, because no row stores a `number` as `numeric`.
- **An argument the chosen type does not take is refused.** `String(length: 12)` chooses `Text`, which takes no length, so it is refused, and the message names the type the call chose. The user writes `String(storage: varchar, length: 12)`.

### Deprecated names warn in SQL schemas

The SQL family's PSL interpreter reports `PSL_DEPRECATED_SCALAR_NAME` wherever a constructor marked deprecated is written, as ADR 257 states: with or without arguments, as the type of a field, a value object member or a `types {}` alias. It goes through the contract source's warning channel. `contract emit` prints the warning and still emits; the language server shows it.

The warning names the explicit replacement, such as `use "Int2"` for `SmallInt`, because that is the exact replacement for the old name. The convenience call `Int(storage: int2)` is the form the tools write. Both emit the same contract.

### Deprecated names in TypeScript

The aliases are in the same `type` namespace, so `type.SmallInt()`, `type.VarChar(64)`, `type.VarBit(16)` and the others still compile in a TypeScript contract and give the same type. Nothing warns where they are called. They are removed in the same release as the PSL aliases.

### The tools

For each database type, the explicit type marked `inferred` is the one the convenience default gives: `Int8BigInt` for `int8`, `NumericString` for `numeric`, `Text` for `text`. `contract infer`, `contract print` and the Prisma 7 schema reader then write the convenience call with only the arguments that differ from the defaults, as ADR 279 describes:

| Database column | Written as |
| --- | --- |
| `int2` | `Int(storage: int2)` |
| `int8` | `BigInt` |
| `int8`, read as a `number` | `BigInt(as: number)` |
| `numeric(10,2)` | `Decimal(precision: 10, scale: 2)` |
| `numeric`, read as a `bigint` | `BigInt(storage: numeric)` |
| `float4` | `Float(storage: float4)` |
| `varchar(12)` | `String(storage: varchar, length: 12)` |
| `character(3)` | `String(storage: char, length: 3)` |
| `jsonb` | `Json` |
| `json` | `Json(storage: json)` |

## Consequences

- A user writes `Int`, `String` or `Decimal` and gets the usual column, as before. A different column or application value is an argument, and the explicit type says exactly what a column is.
- Existing schemas and contracts do not change, except fields written `Json`. A schema that names a deprecated alias emits the same contract and warns.
- `contract infer` and `contract print` write different text for some columns, such as `Int(storage: int2)` where they wrote `SmallInt`. The contract they describe is the same.
- In a TypeScript contract, `type.Int()`, `type.BigInt({ as: 'number' })` and so on are typed as the explicit type they choose, and a combination with no row does not compile.
- A field written `Json` changes from `json` to `jsonb`. The migration planner asks before it alters the column, because `jsonb` drops duplicate keys, normalizes whitespace and key order, and refuses the `\u0000` escape that `json` accepts.
- SQLite, MySQL and MongoDB use some of these names for explicit types today. They get the same convenience types over their own explicit types in a later change, decided on its own, as [ADR 315](ADR%20315%20-%20Each%20target%20declares%20the%20convenience%20date%20and%20time%20types%20over%20its%20own%20explicit%20types.md) did for the date and time types.
- This ADR's `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` and `Json` are concepts, not representations, as in [ADR 315](ADR%20315%20-%20Each%20target%20declares%20the%20convenience%20date%20and%20time%20types%20over%20its%20own%20explicit%20types.md). SQLite's `Int` today is an explicit type: SQLite's `integer`, read as a `number`. Under ADR 315 an explicit type does not take a convenience name, so TML-3790 must rename it and declare SQLite's `Int` as a convenience type over it. That SQLite stores the integer in 64 bits is SQLite's representation and does not change the concept.
- SQLite's `Json` (`sqlite/json@1`, stored as `text`) and MongoDB's `Json` (`mongo/json@1`) are explicit types with a convenience name, against ADR 315's rule that an explicit type does not take one. TML-3790 renames them and declares `Json` as a convenience type over them, with a `storage` option. The naming clause in "`Json`" above does not name them: each is the only JSON codec on its target, so there is no sibling type to name it by contrast with. TML-3790 decides their names on its own. MySQL has no `Json` type, and gets one there. SQLite's `jsonColumn` follows its explicit type's new name.

## Alternatives considered

**Keep `Int`, `String` and the others as explicit types, and add only the missing names.** No renames, but a concept name would keep meaning one column type, and `Int` on PostgreSQL would differ from `Int` as a concept on other targets. The suffix rule of ADR 279 already reserves bare concept names for convenience types.

**One `Int` convenience type covering `int2`, `int4` and `int8`.** Fewer names, but every surveyed tool separates an integer from a big integer, and an `int8` read as a `number` would sit beside one read as a `bigint` under one name, so the default application value would depend on the storage chosen.

**An `as` option on every convenience type.** It would let every name grow application values without a new option later. An `as` option appears only where some target has a choice of application value, because adding one later renames nothing. `storage` differs: it is on every convenience type so the options are the same on every target, as the Decision says.

**`Json` defaults to `storage: json`.** No contract would change and ADR 257 would need no exception. It was rejected because the concept's default should be the column users want by default, and for JSON that is `jsonb`: it can be indexed and compared, and `json` cannot. Most surveyed tools that name concepts default JSON to `jsonb` (Prisma 7, Django, Ecto, MikroORM, Hibernate, Gel). The contract change and the exception to ADR 257 follow from this choice, and the three checks described in "`Json`" catch it.

**`JsonText` as the name of the `json` type.** It reads as JSON kept in a text column, which is what SQLite's `Json` is. PostgreSQL's `json` is its own data type that validates its input, so the name would describe the wrong thing.

**`pg.Json` as the name of the `json` type.** Not possible without a framework change, as "`Json`" explains.

**Remove the old explicit names at once.** ADR 279 did this for the date and time types before the release candidate. These names are in released schemas, so ADR 257's one-release-line alias rule applies.
