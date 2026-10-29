# ADR 279 — Convenience types choose an explicit type from their arguments

**Status:** Accepted
**Builds on:** [ADR 241 — Scalar types use the authoring type-constructor channel](ADR%20241%20-%20Scalar%20types%20use%20the%20authoring%20type-constructor%20channel.md), [ADR 254 — Data types and casts](ADR%20254%20-%20Data%20types%20and%20casts.md), [ADR 257 — Scalar types are named after the target on every surface](ADR%20257%20-%20Scalar%20types%20are%20named%20after%20the%20target%20on%20every%20surface.md)
**Amends:** [ADR 275 — Client generators are field attributes, and a type alias is expanded into each column](ADR%20275%20-%20Client%20generators%20are%20field%20attributes%2C%20and%20a%20type%20alias%20is%20expanded%20into%20each%20column.md)

## At a glance

```prisma
model Order {
  id        Int      @id
  paidAt    DateTime                      // exactly TimestamptzJsDate(3)
  settledAt DateTime(as: temporal)        // exactly TimestamptzTemporal
  legacyAt  DateTime(storage: timestamp)  // exactly TimestampJsDate(3)
  shipBy    Date                          // exactly DateString
  exactAt   TimestamptzTemporal(6)        // an explicit type, written directly
}
```

`TimestamptzJsDate(3)` says everything about a field's type: the database stores it in a `timestamptz(3)` column, and the application reads it as a JavaScript `Date`. `DateTime` is a shorter way to write a type like that. With no arguments, `paidAt DateTime` means exactly `paidAt TimestamptzJsDate(3)`. Its argument `as:` picks a different value for the application to read, and `storage:` a different database type, and each combination means exactly one type of the first kind. The contract records only that type, so `contract.json` is the same whichever way the field was written.

## Decision

A target or an extension can declare two kinds of type for PSL and the TypeScript builder.

- **An explicit type** fixes everything: it names one codec, the code that converts between one database type and one kind of application value. Its name says both, in the database's words: `TimestamptzJsDate` is a `timestamptz` read as a `Date`.
- **A convenience type** is named for what a field means in the application, such as `DateTime` or `Date`. It names no codec. Its arguments pick one of the same target's explicit types from a table, and every argument has a default, so the name alone is a working type.

Five rules follow:

1. **A convenience call means exactly the explicit type it picks.** The contract stores that explicit type, so the contract, the migration planner, `db verify` and the runtime never see a convenience type.
2. **Its defaults need no setup.** The type a convenience name gives with no arguments works on any JavaScript runtime with nothing installed.
3. **Every explicit choice stays available,** as an argument of the convenience type or by writing the explicit type itself.
4. **A combination the table does not list is refused,** at the argument that makes it invalid.
5. **Tools that write a schema write the convenience type** wherever one gives the column's explicit type, with only the arguments that differ from the defaults.

The first convenience types are PostgreSQL's `DateTime`, `Date`, `Time` and `Duration`, described below. Convenience types for other scalars or other targets use the same mechanism and are decided on their own.

## Why

Prisma 7 gave each kind of field one type name, such as `DateTime`, and read every field of that type as the same kind of value. That was easy to learn, but for dates it was wrong: a `Date` is a moment in time, so it is the wrong value for a calendar date. A birthday created at local midnight on a machine east of UTC is stored as the day before, because that midnight is still the previous day in UTC.

Prisma 8 names each type after what the database stores and what the application reads (ADR 257). That makes every choice visible and correct, but a database type that can be read as three kinds of value has three names, and nothing says which to start with. PostgreSQL's date and time types alone have more than a dozen. A user writing a model thinks "this field is when the order was paid", not "a `timestamptz` column read as a `Temporal.Instant`".

Prisma 8's approach is to give explicit, predictable controls first and to build convenience on top of them. The client facades are an example: `postgres({ contract, url })` builds the runtime, adapter and driver a user could otherwise create and connect by hand. Convenience types do the same for field types: one name per concept, with a default that works, over explicit types that stay available.

## How it works

### Explicit types

An explicit type is a type constructor. It names one codec and fills the codec's parameters from its arguments:

```ts
TimestamptzTemporal: {
  kind: 'typeConstructor',
  args: [{ kind: 'value', dataType: PG_SIZE_TYPE, name: 'precision', optional: true }],
  output: {
    codecId: 'pg/timestamptz-temporal@1',
    typeParams: { precision: { kind: 'arg', index: 0 } },
  },
},
```

Its name is the database type, plus a suffix naming the application value when the database type has more than one codec: `TimestamptzJsDate`, `TimestamptzTemporal` and `TimestamptzString` are three readings of `timestamptz`. Every such reading carries a suffix, so no explicit type takes a bare name that looks like the obvious choice. Bare concept names are left for convenience types.

### Convenience types

A convenience type is declared as a **type choice**. It lists its arguments and a table whose rows each name an explicit type of the same target:

```ts
DateTime: {
  kind: 'typeChoice',
  args: [
    { kind: 'option', name: 'as', values: ['jsDate', 'temporal', 'string'], default: 'jsDate', optional: true },
    { kind: 'option', name: 'storage', values: ['timestamptz', 'timestamp'], default: 'timestamptz', optional: true },
    { kind: 'value', dataType: PG_SIZE_TYPE, name: 'precision', optional: true },
  ],
  choices: [
    { when: { as: 'jsDate', storage: 'timestamptz' }, type: 'TimestamptzJsDate', defaults: { precision: 3 } },
    { when: { as: 'temporal', storage: 'timestamptz' }, type: 'TimestamptzTemporal' },
    { when: { as: 'string', storage: 'timestamptz' }, type: 'TimestamptzString' },
    { when: { as: 'jsDate', storage: 'timestamp' }, type: 'TimestampJsDate', defaults: { precision: 3 } },
    { when: { as: 'temporal', storage: 'timestamp' }, type: 'TimestampInstant' },
    { when: { as: 'string', storage: 'timestamp' }, type: 'TimestampString' },
  ],
},
```

There are two kinds of argument:
- **Options** pick the row. Each has a fixed set of values, written as bare names, and a default. By convention `as:` picks the value the application reads and `storage:` the database type that stores it.
- **Other arguments**, such as `precision`, are handed to the explicit type the row names.

A call is resolved in three steps:
1. Fill in the default of every option the call leaves out. A call with no arguments is the default row.
2. Find the row for that combination of option values.
3. Build the explicit type the row names with the other arguments. A row may give a default for an argument the call leaves out, as `precision: 3` above.

The result is exactly what writing that explicit type would give.

Arguments are written by name or in the order they are declared. A call is refused at the argument that makes it invalid, and the message lists what that argument accepts:
- a value an option does not list, such as `Date(as: jsDate)`;
- a combination with no row, such as `Time(as: temporal, storage: timetz)`;
- an argument the chosen explicit type does not take, such as `Date(precision: 3)`.

A type choice is checked when the target's types are loaded. It is refused if it names an explicit type the target does not declare, has two rows for one combination, lists a value or default its option does not declare, gives a row default for an argument the chosen type does not take, or hands on an argument whose data type differs from the chosen type's.

In a TypeScript contract, a convenience type's helper takes its arguments as one object, `type.DateTime({ as: 'string', precision: 6 })`. It has one overload per row, so a call is typed as the explicit type it picks, and a combination with no row does not compile.

### Everything that needs a field's codec sees the explicit type

Each place that needs a field's codec resolves the field's call first, including a call inside a type alias declared in a `types {}` block: the PSL interpreter, the `@default` value check, the `@onCreate`/`@onUpdate` generator lookup, the Prisma 7 schema reader and the language server. So `DateTime @onCreate(now())` gets the `now()` generator for `TimestamptzJsDate`, and `DateTime(as: temporal) @onCreate(now())` the one for `TimestamptzTemporal`.

### What the tools write

`contract infer` reads a database and `contract print` reads a contract, and neither knows which kind of type the user wrote. Both write a convenience call wherever one gives the column's explicit type, and the explicit type otherwise:
1. For each database type, one explicit type is marked `inferred`: the one its convenience default gives. Infer and the Prisma 7 schema reader pick that type for a column. If that type cannot read the column's own default, such as `infinity` for a `Date`, infer picks the first row, in the order the convenience type declares its rows, with the same storage whose type can, so it does not write a field whose default fails to read where some row reads it. The rows' order is therefore infer's order of preference. Infer reads only the default, not the rows, so a column whose rows hold such a value is still written with the default type.
2. To write the call for an explicit type, the tools find the row that names it, build the arguments from the row, and drop those equal to the defaults.
3. They resolve the call again and keep it only if it gives the same codec and parameters.

Arguments are always written by name. So the schema the tools write is the one a user would write.

## The PostgreSQL date and time types

PostgreSQL's date and time types are the first to get convenience types.

### The explicit types

| Database type | `Date` | Temporal | String | Other |
| --- | --- | --- | --- | --- |
| `timestamptz` | `TimestamptzJsDate` | `TimestamptzTemporal` (`Temporal.Instant`) | `TimestamptzString` | |
| `timestamp` | `TimestampJsDate` | `TimestampTemporal` (`Temporal.PlainDateTime`), `TimestampInstant` (`Temporal.Instant`) | `TimestampString` | |
| `date` | | `DateTemporal` (`Temporal.PlainDate`) | `DateString` | |
| `time` | | `TimeTemporal` (`Temporal.PlainTime`) | `TimeString` | |
| `timetz` | | | `Timetz` | |
| `interval` | | | `IntervalString` (an ISO 8601 duration) | `IntervalParts` (`{ months, days, micros }`) |

`timetz` has one codec, so its explicit type has no suffix. `TimestampJsDate` and `TimestampInstant` read and write a `timestamp` column as UTC, so it holds the same moment in time a `timestamptz` would; `timestamp` is the column Prisma 7's `DateTime` creates. `TimestampInstant` names its Temporal type because `timestamp` has two Temporal codecs.

### The convenience types

| Convenience type | `as` | `storage` | With no arguments |
| --- | --- | --- | --- |
| `DateTime` | `jsDate`, `temporal`, `string` | `timestamptz`, `timestamp` | `TimestamptzJsDate(3)` |
| `Date` | `string`, `temporal` | `date` | `DateString` |
| `Time` | `string`, `temporal` | `time`, `timetz` (with `string` only) | `TimeString` |
| `Duration` | `string`, `parts` | `interval` | `IntervalString` |

The `as` values repeat the explicit types' suffixes, so `DateTime(as: temporal)` and `TimestamptzTemporal` read as the same thing.

The defaults are the right value for each concept, with nothing to install:
- **`DateTime` reads a JavaScript `Date`.** It is the right value for a moment in time, it works everywhere, and it is what Prisma 7 gave. A `Date` holds milliseconds, so the default precision is 3; `as: temporal` or `as: string` keeps microseconds.
- **`Date`, `Time` and `Duration` read ISO 8601 strings,** such as `"2024-02-29"`. JavaScript has no built-in calendar date, time of day or duration, and a `Date` would bring back the wrong-day bug. The text is the stored form ADR 254 defines, the same on every server.

A Temporal value is opt-in. The Temporal codecs take their TypeScript types from `temporal-spec`, a package of declarations with no runtime code, so no polyfill reaches an application that does not choose one.

Three combinations are left out:
- **A `Date` for a calendar date or a time of day,** which would depend on the time zone of the machine that made it.
- **`Temporal.PlainTime` on a `timetz` column,** which would drop the stored offset.
- **`Temporal.PlainDateTime`,** a date and time with no time zone, which is rarely what an application means. It stays available as the explicit type `TimestampTemporal`, and `DateTime(as: temporal, storage: timestamp)` reads a `Temporal.Instant` instead.

### What the tools write for them

| Database column | Written as | Explicit type |
| --- | --- | --- |
| `timestamptz(3)` | `DateTime` | `TimestamptzJsDate(3)` |
| `timestamptz`, no declared precision | `DateTime(precision: 6)` | `TimestamptzJsDate(6)` |
| `timestamp(3)` | `DateTime(storage: timestamp)` | `TimestampJsDate(3)` |
| `date` | `Date` | `DateString` |
| `time(0)` | `Time(precision: 0)` | `TimeString(0)` |
| `timetz` | `Time(storage: timetz)` | `Timetz` |
| `interval` | `Duration` | `IntervalString` |
| a `timestamp` read as `Temporal.PlainDateTime` | `TimestampTemporal` | `TimestampTemporal` |

PostgreSQL stores microseconds whether a precision of 6 is declared or omitted, so comparing columns treats an omitted precision as 6 (ADR 254). That is why a column with no declared precision can be written as `DateTime(precision: 6)` and still verify clean.

The Prisma 7 schema reader picks the same types: Prisma 7's `DateTime` becomes `TimestampJsDate(3)`, written `DateTime(storage: timestamp)`, so an adopted application reads `Date` values as it did; `@db.Timestamptz(p)`, `@db.Date`, `@db.Time(p)` and `@db.Timetz(p)` become `DateTime(precision: p)`, `Date`, `Time(precision: p)` and `Time(storage: timetz, precision: p)`. `prisma orm init` writes `createdAt DateTime @default(now()) @onCreate(now())` and `updatedAt temporal.UpdatedAt`.

### Created-at and updated-at

The PostgreSQL target ships two type aliases (ADR 275), in the namespace `temporal` that holds its time aliases: `temporal.CreatedAt` is `DateTime @onCreate(now())` and `temporal.UpdatedAt` is `DateTime @onCreate(now()) @onUpdate(now())`. A shipped alias takes no arguments, so a user who wants another value writes the attributes on the call, such as `DateTime(as: string) @onCreate(now()) @onUpdate(now())`. `now()` picks its generator from the field's codec, so it writes the value that codec expects.

## Consequences

- A user can write a field's type by what it means and get a working field, without knowing the database's types or which libraries a value needs. A user who needs a particular database type or value says so with an argument, or writes the explicit type.
- The contract and everything that reads it see only explicit types, so nothing below PSL and the TypeScript builder changes.
- A type constructor still names exactly one codec (ADR 254). A type choice is a second kind of type declaration, which resolves to a type constructor.
- Every explicit type of a database type with several codecs carries a suffix for its value (ADR 257); bare concept names belong to convenience types.
- The `temporal.*` aliases (ADR 275) are built on `DateTime` and need no variants for other values.
- The editor's hover on a convenience call names the explicit type that call is, such as `DateTime(as: temporal)` is exactly `TimestamptzTemporal`, and lists the explicit type each combination gives.

## Not decided here

- **Other targets.** A convenience name must mean the same thing on every target. SQLite, MySQL and MongoDB each already use one of these names for an explicit type (SQLite's and MySQL's `DateTime`, MongoDB's `Date`, which is a moment in time), so each needs its own decision.
- **Other scalars,** for example an `Int` whose `storage:` picks `Int2`, `Int4` or `Int8`.

## Alternatives considered

**Only one kind of type, named after the application's meaning.** Every field would be written `DateTime`, `Date` and so on, refined by arguments, and the database-named types would go. That reverses ADR 257 and leaves arguments as the only way to state a type exactly.

**Keep only the explicit types and document which to choose.** Nothing new to learn, but no default: every user must understand every choice before writing a first field.

**One codec per concept, with the database type as a parameter.** A codec converts values of exactly one data type (ADR 254); a codec whose data type depends on a parameter breaks that. Picking among existing codecs gives the same schema.

**A type constructor whose codec is a select over option arguments** (ADR 246). A select has no default case and no way to refuse a combination, so a bare `DateTime` would resolve to nothing.

**Type aliases with arguments.** An alias attaches attributes such as `@onCreate` to one fixed type (ADR 275); picking which type a field has is a different job.

**Options named `value:` and `column:`, or `jsType:` and `dbType:`.** "Value" already means a data type's stored value (ADR 254), and `column:` is a SQL word where a convenience name must mean the same on every target. `jsType:` and `dbType:` are exact but read as jargon. `as:` reads as a user would say it, "a `DateTime` read as Temporal", and `storage:` is the contract's own word for how a field maps to the database.

**Leave the Temporal explicit types unsuffixed.** Fewer renames, but `Timestamptz` would look like the neutral choice while reading one particular kind of value, and the explicit types would follow two naming patterns.

**Name the date and time convenience types after the Temporal API: `Instant`, `PlainDate`, `PlainTime`.** Exact, but a library's vocabulary; a user modelling an application thinks "a birthday" or "when the order was paid".

**A Prisma-owned value for calendar dates, times and durations, or a branded string.** A class is one more date API, does not survive JSON, and duplicates Temporal. A branded string forces every write through a helper or a cast and catches nothing the codec doesn't.

**Infer the string types for columns whose values have more digits than a `Date` holds.** Nothing is lost, but the schema would differ from what a user would write for the same model; infer takes the default, which reads those values with the extra digits dropped. A default the type cannot read at all is different: the row would fail to read, so infer picks a type that reads it.
