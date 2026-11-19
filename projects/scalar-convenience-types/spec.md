# Convenience types for the scalars that are not dates or times

Linear: TML-3715 (PostgreSQL, done), TML-3789 (PostgreSQL `Json`), TML-3790 (SQLite, MySQL and MongoDB).

## Summary

```prisma
// PostgreSQL
model Event {
  id      Int     @id            // exactly Int4
  name    String                 // exactly Text
  payload Json                   // exactly PlainJson: a json column
  fast    Json(storage: jsonb)   // exactly Jsonb: a jsonb column
}

// MongoDB
model Event {
  id      ObjectId @id @map("_id")
  visits  Int                    // exactly Int32
  total   BigInt(as: number)     // exactly Int64Number
  payload Json                   // exactly PlainJson: a JSON value stored as BSON
}
```

`Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` and `Json` name what a field means in the application. On every target each is a convenience type: its `storage` and `as` arguments choose one explicit type, and the contract stores only that explicit type. An explicit type names one codec and is named after what stores it.

The mechanism is the type choice of ADR 279. It lives in the framework domain and does not change.

## State

| Part | State |
| --- | --- |
| PostgreSQL `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` | Merged, prisma/orm#30942. Recorded in ADR 316. |
| PostgreSQL `Json`, and `sql.Varchar` | Merged, prisma/orm#31065. Recorded in ADR 316. |
| MongoDB | Merged, prisma/orm#31067. Recorded in ADR 322. |
| SQLite | Merged, prisma/orm#31086. Recorded in ADR 322. |
| MySQL | Built, not merged. Recorded in ADR 322. |

## Rules that hold on every target

These come from ADR 279, ADR 315 and ADR 316. They are listed here because every table below follows them.

1. A convenience name is a concept, not a representation. Its options are the same on every target; the values of `storage` and `as`, and the defaults, are each target's own.
2. Every convenience type has a `storage` option, even where a target has one storage for it. It has an `as` option only where some target reads the concept as more than one kind of value. Today only `BigInt` does.
3. A bare convenience name gives the codec that name gave before, so no existing schema or contract changes.
4. An explicit type is named after the database type that stores it, plus a suffix for the application value where that database type is read by more than one codec of its data type (PostgreSQL `Int8BigInt` and `Int8Number`). A type with a data type of its own, which a column of another type stores, is named after that data type where the database has no column type for it, as ADR 315's rule 5 names `DateString`.
5. An explicit name that disappears stays for one release line as a deprecated alias that warns `PSL_DEPRECATED_SCALAR_NAME` and emits the same contract.
6. Tools that write PSL write the convenience call, with only the arguments that differ from the defaults. Only PostgreSQL has such tools (`contract infer`, `contract print`, the Prisma 7 reader). On the other targets the same fact is tested directly: for each explicit type, `findAuthoringTypeChoiceCall` returns the convenience call its table shows.
7. A convenience type and an explicit type cannot share a name: a type choice row names its explicit type in the same namespace. Where rule 4, or ADR 315's rule for a concept the database has no column type for, would give a convenience name, the explicit type takes, in this order: (a) the database's own second name for the type, where it has one (MySQL `INT4`, `NUMERIC`, `BOOL`); (b) the value suffix of ADR 315 rule 5, where that gives a meaningful name (SQLite `DecimalString`); (c) a name recorded as an exception. The exceptions are `PlainJson` on all four targets, MongoDB's `BsonString` and SQLite's `IntegerBoolean`. `JsonJson`, `StringString` and `BooleanBoolean` say nothing, which is why the suffix was not used for them; `IntegerBoolean` is named after its column type plus its value, as SQLite's other `integer` types are.

## PostgreSQL `Json`

| Convenience type | `storage` | Becomes | Codec | Column |
| --- | --- | --- | --- | --- |
| `Json(storage?)` | `json` (default) | `PlainJson` | `pg/json@1` | `json` |
| | `jsonb` | `Jsonb` | `pg/jsonb@1` | `jsonb` |

- **`Json` still means a `json` column.** `Json` is the exact name of a PostgreSQL type, so it must not mean a different one. A user who wants `jsonb` writes `Json(storage: jsonb)` or `Jsonb`.
- **No schema or contract changes.** A field written `Json` keeps codec `pg/json@1`. There is no migration and no upgrade step for PSL schemas.
- **`PlainJson` is the explicit name of the `json` type,** an exception under rule 7(c). ADR 316 and ADR 257 record rule 7 as written above, with the list of exceptions. Users meet `PlainJson` in hover text, in the type reference, and in one message: the refusal of `@db.Json` says to write `PlainJson`, because that message always names the explicit type (as `@db.Integer` names `Int4`). `contract infer` and `contract print` never write it.
- **`Jsonb` stays** as the explicit type of the `jsonb` column, unchanged.
- **Tools.** A `json` column is written `Json`. A `jsonb` column is written `Json(storage: jsonb)`, where the tools wrote `Jsonb` before. The Prisma 7 reader writes Prisma 7's `Json`, which was `jsonb`, as `Json(storage: jsonb)`, and `@db.Json` as `Json`.
- **TypeScript.** `type.Json()` and `type.Json({ storage: 'jsonb' })` are typed as the explicit type they choose. The column helper `jsonColumn` becomes `plainJsonColumn`, with no alias, as ADR 316 did for `int8Column`. That rename gets an upgrade instruction whose detection pattern matches the import from the PostgreSQL packages, because SQLite exports a `jsonColumn` too. Its test includes a SQLite file that is not matched.
- **The removed `json()` preset.** Its refusal says to write `Jsonb` today. It says `Json(storage: jsonb)` in PSL and `type.Json({ storage: 'jsonb' })` in TypeScript, as the other hints name convenience types.
- **Docs.** `docs/reference/scalar-types.md` and the `prisma-8` skill say what a `json` column cannot do (no equality filter, no index, no unique constraint) and that `Json(storage: jsonb)` can.

Areas this slice changes, from the footprint of prisma/orm#30942:

- Declarations: `type-constructors.ts` (the `inferred` mark moves from `Json` to `PlainJson` and stays on `Jsonb`; the stale comment at line 86 goes), the type choice, the column helper export.
- Expected output only, no code change: the printer and infer tests (`postgres/1-target/test/psl-infer`, `test/psl-print`, `test/integration/test/psl-print`, `psl-infer`, `cli-journeys`), `prisma7-type-map.test.ts` (the renamed-native-types map gains `Json: 'PlainJson'`), fill-value messages (a `json` column is named `Json`, a `jsonb` column `Jsonb`; add a test).
- Fixtures: `Json` fields are not touched. `Jsonb` fields in `packages/3-extensions/supabase/src/contract/contract.prisma` are rewritten by hand to `Json(storage: jsonb)`. The two fixtures and three READMEs that use `jsonColumn`.
- Docs: `docs/reference/scalar-types.md`, `docs/reference/error-reference.md`, the READMEs of `contract-psl`, `contract-ts` (and its `API.md`) and `postgres/1-target`, the `prisma-8` skill, ADR 316, ADR 257, ADR 279 ("Not decided here"), `ADR-INDEX.md`.

Out of scope here: clearer errors where a `json` field hits one of those limits. It gets its own ticket. An earlier warning for a bare `Json` (prisma/orm#30085) was rejected, so the ticket covers errors at the point of failure only.

## SQLite

SQLite's column types are `text`, `integer`, `real` and `blob`. An explicit type is named after the SQLite column type that stores it: `Text`, `Real` and `Blob`. `integer` is read by more than one codec of its data type, so those types carry the value too: `IntegerNumber` and `IntegerBigInt`. A type with a data type of its own, which a `text` column stores, is named after that data type, as ADR 315 and rule 7 give it: `DecimalString`, `PlainJson` and the date and time types. `IntegerBoolean` is the exception that rule 7(c) records: `sqlite/boolean` is a data type of its own, which an `integer` column stores, and its name takes the form of the other `integer` types.

| Convenience type | `as` | `storage` | Becomes | Codec | Name today |
| --- | --- | --- | --- | --- | --- |
| `Int(storage?)` | | `integer` | `IntegerNumber` | `sqlite/integer@1` | `Int` |
| `BigInt(as?, storage?)` | `bigint` (default) | `integer` | `IntegerBigInt` | `sqlite/bigint@1` | `BigInt` |
| | `number` | `integer` | `IntegerNumber` | `sqlite/integer@1` | |
| `Float(storage?)` | | `real` | `Real` | `sqlite/real@1` | `Float` |
| `Decimal(storage?)` | | `text` | `DecimalString` | new, `sqlite/decimal@1` | `Decimal`, as `sqlite/text@1` |
| `String(storage?)` | | `text` | `Text` | `sqlite/text@1` | `String` |
| `Boolean(storage?)` | | `integer` | `IntegerBoolean` | new, `sqlite/boolean@1` | none |
| `Bytes(storage?)` | | `blob` | `Blob` | `sqlite/blob@1` | `Bytes` |
| `Json(storage?)` | | `text` | `PlainJson` | `sqlite/json@1` | `Json` |

- **`Decimal` gets its own data type, `sqlite/decimal`, stored as text.** Today it is the same codec as `String`, so nothing in the contract says the column holds a decimal, and a new required `Decimal` field is filled with `''`. This is TML-3562, which this slice closes. It is the one place where rule 3 is broken: the contract of every SQLite project with a `Decimal` field changes, with an upgrade instruction. The stored text does not change, so no data moves. The slice must show this: a CLI journey test on a project signed with the old contract checks that `migration plan` produces no table rebuild and what `db verify` reports. A fixture with a `Decimal` field is added before the change so the contract difference is visible.
- **What `sqlite/decimal@1` does.** It refuses to write text that is not a decimal. Reading text that is not a decimal (such as the `''` an earlier fill wrote) raises a decode error that names the column; the upgrade instruction says how to find such rows. A new required field is filled with `'0'`. It allows equality filters only: text compares by characters, so ordering and aggregates are not offered.
- **`DecimalString` is named after its data type, not its column.** SQLite has no decimal column type, so the name follows ADR 315's rule for that case, as `DateString` and `DurationString` do. `Boolean`'s explicit type is the exception rule 7(c) records instead: rule 7(b) would give `BooleanBoolean`, so it takes the form of the other `integer` types, `IntegerBoolean`, a name that says what is stored. The same form would give a decimal `TextString`, which is what `Text` already is.
- **`Boolean` is new on SQLite,** with its own data type `sqlite/boolean`, stored as `integer` 0 or 1, which is what SQLite's own `TRUE` and `FALSE` are. The codec writes 0 or 1, because `node:sqlite` does not bind booleans. It reads 0 as `false` and 1 as `true` from a number, bigint or text, and raises a decode error for any other value. `@default(true)` renders as `1`.
- **`BigInt(as: number)` and `Int` are the same explicit type.** `sqlite/integer@1` and `sqlite/bigintnumber@1` both store an `integer` and read a `number`. They did not check alike: `sqlite/bigintnumber@1` refused a value outside the safe-integer range or not an integer on write and on read, while `sqlite/integer@1` wrote any number as it was and read a number from a row without checking it. The slice makes `sqlite/integer@1` check as `sqlite/bigintnumber@1` does, so a `BigIntNumber` field keeps its checks; every `Int` field gets them too, with its own upgrade instruction (`sqlite-integer-safe-range`). Both read a `bigint` from the driver, which hands one over for an integer outside the safe range, and refuse it. `BigIntNumber` becomes a deprecated alias of `IntegerNumber`. This is the second place rule 3 is broken: a field written `BigIntNumber` changes codec id from `sqlite/bigintnumber@1` to `sqlite/integer@1` on the next emit, with no column change. It shares the `Decimal` upgrade instruction and journey test. The codec `sqlite/bigintnumber@1` itself stays, because aggregates return it.
- **The SQLite driver reads every integer exactly.** It prepares each statement with `setReadBigInts(true)` and hands a value within the safe range to the codec as a `number` and one outside it as a `bigint`. Before, `node:sqlite` threw a `RangeError` that named no column for a stored integer outside the safe range, before any codec ran, and left the statement open, so the read lock stayed. Now `BigInt` reads the full 64-bit range in a row, and `Int` and `BigInt(as: number)` raise `RUNTIME.DECODE_FAILED` naming the column, in a row and through an include. The driver resets the statement when a read stops part-way, and `insertId` is exact past the safe range.
- **`Int` is declared before `BigInt`,** so the convenience call for `IntegerNumber` is `Int`. A test fixes this. It is an exception to ADR 316's "each explicit type has one convenience call", recorded in the new ADR.
- **Column helpers are named after the explicit type they give,** as ADR 316 requires: `integerColumn`, `bigintColumn` and `jsonColumn` are renamed to match `IntegerNumber`, `IntegerBigInt` and `PlainJson`, helpers are added for `DecimalString` and `IntegerBoolean`, and each rename gets an upgrade instruction.

## MySQL

Of the scalars here, MySQL has authorable codecs for `int` (`mysql/int@1`), `bigint` (`mysql/bigint@1`), `text` (`mysql/text@1`), `varchar` (`sql/varchar@1`) and `char` (`sql/char@1`). Two more exist but only type aggregate results, with no authoring name and no catalog text: `mysql/bigintnumber@1` (the data type `mysql/bigint`) and `mysql/double@1` (the data type `mysql/double`, which claims no `double` column the catalog reports). This slice gives those two their authoring names and catalog texts. Every other row below needs a new codec, as the date and time project added MySQL's date and time codecs (ADR 315). The defaults are the columns Prisma 7 created for the same names; the probe below confirms them from memory, not from a document.

Where MySQL has a second name for a column type and PostgreSQL's explicit type already uses it, MySQL uses the same explicit name. The `storage` values are the names MySQL reports (`int`, `double`, `decimal`, `tinyint`), so on MySQL a `storage` value and its explicit name differ. The new ADR says so.

| Convenience type | `as` | `storage` | Becomes | Column | MySQL also calls it | Codec |
| --- | --- | --- | --- | --- | --- | --- |
| `Int(storage?)` | | `int` | `Int4` | `int` | `INT4` | `mysql/int@1` |
| `BigInt(as?, storage?)` | `bigint` (default) | `bigint` | `Int8BigInt` | `bigint` | `INT8` | `mysql/bigint@1` |
| | `number` | `bigint` | `Int8Number` | `bigint` | `INT8` | `mysql/bigintnumber@1`, gains an authoring name |
| `Float(storage?)` | | `double` (default) | `Float8` | `double` | `FLOAT8` | `mysql/double@1`, gains an authoring name and the catalog text `double` |
| | | `float` (deferred, see Decided) | `Float4` | `float` | `FLOAT4` | not in this slice |
| `Decimal(storage?, precision?, scale?)` | | `decimal` | `NumericString`, precision 65 and scale 30 unless written | `decimal(p,s)` | `NUMERIC` | new, `mysql/decimal@1` |
| `String(storage?, length?)` | | `varchar` (default) | `Varchar`, length 191 unless written | `varchar(n)` | | `sql/varchar@1` |
| | | `text` | `Text` | `text` | | `mysql/text@1` |
| `Boolean(storage?)` | | `tinyint` | `Bool` | `tinyint(1)` | `BOOL` | new, `mysql/boolean@1` |
| `Bytes(storage?)` | | `longblob` | `Longblob` | `longblob` | | new, `mysql/longblob@1` |
| `Json(storage?)` | | `json` | `PlainJson` | `json` | | new, `mysql/json@1` |

- **New codec ids follow MySQL's existing ones,** which are named after their data types (`mysql/int@1`, `mysql/bigint@1`): `mysql/decimal@1`, `mysql/boolean@1`, `mysql/longblob@1`, `mysql/json@1`. A data type is not always the type MySQL reports: `mysql/boolean` is stored in a `tinyint(1)`. So `NumericString` and `Bool` do not share a token with their codec ids. `Bool`'s data type claims `tinyint(1)` only, so other `tinyint` widths stay free for a later integer type.
- **A bare `Decimal` is `decimal(65,30)`,** the column Prisma 7 created. MySQL's own default, `decimal(10,0)`, holds no fraction digits.
- **MySQL gains top-level `Varchar` and `Text` explicit types,** because a type choice row can only name a type at its own level, not `sql.Varchar`.
- **Wire behaviour is probed, not assumed.** The driver is the `mariadb` package using the text protocol, with parameters written into the SQL, so each codec receives text or bytes. The probe results below record, for each column type on both servers, the value on the wire in each direction, how the server types a parameter, catalog text, defaults, operations, values inside an include's JSON, and aggregates.
- **MariaDB shares these declarations.** Its `JSON` is another name for `longtext COLLATE utf8mb4_bin` with a column-level check `json_valid(col)` named after the column. The probe shows the catalog tells that apart from a plain `longtext`, so `Json` can verify on MariaDB if the MariaDB catalog reader reads `information_schema.check_constraints`, which no MySQL or MariaDB catalog query reads today. See "Decisions the probe forces".
- The slice extends `examples/prisma-8-demo-mysql`, as the MySQL project requires of every slice.

- MySQL's migration planner does not change a column's type yet, so changing a field between these types is refused by `migration plan`, as for the date and time types.

### Probe results (MySQL 8.4 and MariaDB 10.11)

Probed 2026-11-19 against MySQL 8.4.13 and MariaDB 10.11.19 through the driver package's own `mysqlConnectionOptions` (with `typeCast: readTextOrBytes` and the session setup), `statementFor` (which runs `bindValue`) and the `mariadb` package's text protocol, with `time_zone = '+00:00'`. The script is `wip/mysql-probe/probe.ts` and the raw output `wip/mysql-probe/results.md`; neither is committed. "Both" means both servers gave the same result.

**1. Read wire value.** Every column but `longblob` reaches the codec as a JavaScript string; `longblob` as a `Uint8Array`; SQL `NULL` as `null`.

| Column | Wire value |
| --- | --- |
| `int` | Decimal text. Both. |
| `bigint` | Decimal text, exact over the whole signed 64-bit range (`"9223372036854775807"`, `"9007199254740993"`). Both. |
| `float` | Text rounded to 6 significant digits: `123456789` reads `"123457000"`, `0.123456789` reads `"0.123457"`, `16777217` and the exact float `16777216` both read `"16777200"`. So a row read of a `float` is lossy. `CAST(v AS DOUBLE)` or `v + 0` gives the exact value (`0.10000000149011612`, `16777216`). Negative zero reads `"-0"` on MySQL and `"0"` on MariaDB. |
| `double` | Shortest round-trip text: `"0.1"`, `"0.30000000000000004"`, `"1e308"`, `"5e-324"`, `"9.007199254740992e15"`, `"0.0000001"`. `Number(text)` gives the stored double. Negative zero as for `float`. |
| `decimal(p,s)` | Text padded to the scale: `'1.50'` in `decimal(65,30)` reads `"1.500000000000000000000000000000"`; all 65 digits kept. `-0.0` reads `"0.000…"` (no negative zero). Both. |
| `varchar(191)`, `text` | The text, trailing spaces kept, 4-byte characters kept. Both. |
| `tinyint(1)` | Decimal text of whatever is stored: `0`, `1`, `2`, `-1`, `127` are all stored and read back as written; `TRUE` and `FALSE` are `1` and `0`. Nothing stops a value other than 0 or 1. Both. |
| `longblob` | The bytes, including empty and non-UTF-8 (`0xc328`). Both. |
| `json` | MySQL: normalised JSON text: keys sorted, duplicate keys collapsed to the last, spaces after `:` and `,`, `1e2` read as `100.0`, a non-integer past double precision rounded to a double (`123456789012345678901234567890.123456789` reads `1.2345678901234566e29`); integers up to 64-bit kept (`12345678901234567890`). MariaDB: the text exactly as written, duplicate keys and whitespace included. JSON `null` reads the string `"null"`; SQL `NULL` reads `null`. Both. |

**2. Write.** The `mariadb` package writes a number or bigint as `${value}` (so `1e21` goes as `1e+21`), a boolean as `true`/`false`, a string quoted and escaped, a Buffer as `_BINARY '…'`; `bindValue` turns a `Uint8Array` into a Buffer and refuses `NaN`, `±Infinity` and a bigint outside signed 64 bits.

| Case | Observed |
| --- | --- |
| How the server types a parameter | Number `1` → `int`; `0.1` and `1.5` → `decimal(2,1)` (an exact decimal literal); `1e21` and `1e-7` → `double`; bigint → `bigint`; string → `varchar`; boolean → `int`; bytes → `varbinary`. Both. |
| `NaN`, `Infinity` | Refused by `bindValue`. The strings `'NaN'` and `'Infinity'` are refused by both servers in strict mode; `1e309` is a parse error; `1e39` into `float` is out of range. |
| `float` | A JS number is stored as the nearest float. `f = ?` with the same number `0.1` matches no row (both): the parameter is compared as a double. `f = CAST(? AS FLOAT)` matches (both). |
| `double` | Every finite JS number round-trips exactly, `5e-324` and `1e308` included. `d = ?` with a number matches exactly. Both. |
| `decimal(p,s)` | A string round-trips exactly within `(p,s)`. More fraction digits than the scale are rounded half up with only a note (`'1.005'` → `1.01` in `decimal(10,2)`); too many integer digits is an error. A decimal string past 64 bits cannot be sent as a bigint (`bindValue` refuses it), so the codec must send text. Both. |
| Decimal comparisons | `v = ?`, `v > ?` with a string parameter compare exactly on both. `v IN (?, ?)` with string parameters compares as a double on both: stored `0.100000000000000000000000000001` matches `IN ('0.1', '99')`. `v BETWEEN ? AND ?` is exact on MySQL and compares as a double on MariaDB. Any expression such as `v = ? + 0` compares as a double. `CAST(? AS DECIMAL(65,30))` is exact in every form, but rounds a string with more than 30 fraction digits and, in a `SELECT`, clamps one with more than 35 integer digits to `99…9.99…9` with only a warning. |
| `bigint` beside an expression | `COALESCE(v, 0) = '9007199254740992'` is true for a stored `9007199254740993` on MySQL (compared as a double) and false on MariaDB. A bigint parameter compares exactly on both. This confirms why `mysql/bigint@1` sends a bigint, not text. |
| `tinyint(1)` | `true`, `false`, `2` and `'1'` are stored as written; `'true'` is refused. Both. |
| `longblob` | Bytes round-trip exactly; a string is stored as its UTF-8 bytes. Both. |
| `json` | A plain string parameter stores the JSON value on both (`INSERT … VALUES (?)`). Invalid JSON is refused: MySQL error 3140, MariaDB a check constraint failure. A bytes parameter is refused by MySQL (error 3144, binary character set) and stored by MariaDB. `CAST(? AS JSON)` works on MySQL and is a syntax error on MariaDB. `JSON_EXTRACT(?, '$')` works on both. JSON `null` is stored as a JSON value (`JSON_TYPE` = `NULL`, `IS NULL` false); SQL `NULL` is SQL `NULL`. |

**3. Catalog text** (`information_schema.columns`).

| Written | MySQL `DATA_TYPE` / `COLUMN_TYPE` | MariaDB `DATA_TYPE` / `COLUMN_TYPE` | Other columns |
| --- | --- | --- | --- |
| `int` | `int` / `int` | `int` / `int(11)` | precision 10, scale 0 |
| `bigint` | `bigint` / `bigint` | `bigint` / `bigint(20)` | precision 19, scale 0 |
| `float` | `float` / `float` | same | precision 12, scale `NULL` |
| `double`, `real` | `double` / `double` | same | precision 22, scale `NULL` |
| `decimal(65,30)`, `decimal(10,2)`, `numeric(10,2)` | `decimal` / `decimal(65,30)`, `decimal(10,2)` | same | precision and scale as written; a bare `decimal` is `decimal(10,0)` |
| `varchar(191)` | `varchar` / `varchar(191)` | same | length 191 |
| `text` | `text` / `text` | same | length 65535 |
| `tinyint(1)`, `bool`, `boolean` | `tinyint` / `tinyint(1)` (width kept, with deprecation warning 1681 on create) | `tinyint` / `tinyint(1)` | precision 3 |
| `tinyint`, `tinyint(4)` | `tinyint` / `tinyint` | `tinyint` / `tinyint(4)` | |
| `tinyint(1) unsigned` | `tinyint` / `tinyint unsigned` (width dropped) | `tinyint` / `tinyint(1) unsigned` | |
| `longblob` | `longblob` / `longblob` | same | length 4294967295 |
| `json` | `json` / `json`, collation `NULL` | `longtext` / `longtext`, collation `utf8mb4_bin` | MariaDB adds `CHECK (json_valid(\`col\`))` |

On MariaDB a `json` column has a row in `information_schema.check_constraints` with `CONSTRAINT_NAME` = the column name, `LEVEL` = `Column` and `CHECK_CLAUSE` = ``json_valid(`col`)``, and `SHOW CREATE TABLE` prints ``longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin … CHECK (json_valid(`col`))``. A plain `longtext` has no such check and the table's collation (`utf8mb4_general_ci` by default). A user-written ``longtext COLLATE utf8mb4_bin CHECK (json_valid(col))`` is indistinguishable from `json` in the catalog and in `SHOW CREATE TABLE`; it is the same column. A table-level check on the same expression has `LEVEL` = `Table` and its own name. On MySQL the `json` type is its own `DATA_TYPE`, and the result-set metadata reports `JSON` (on MariaDB, `BLOB` with collation 224).

**4. Defaults.**

| Column | MySQL | MariaDB |
| --- | --- | --- |
| `int`, `bigint`, `float`, `double` | `DEFAULT 5` reads `5`, no `EXTRA`. `DEFAULT (5)` reads `5` with `EXTRA` = `DEFAULT_GENERATED`. `DEFAULT 1.5e-7` on `double` reads `0.00000015`. | Same text, never `DEFAULT_GENERATED`. |
| `decimal(p,s)` | `DEFAULT 1.5` and `DEFAULT '1.5'` both read `1.500000000000000000000000000000` (padded to the scale). `DEFAULT 1.005` in `decimal(10,2)` reads `1.01`, with a note. | Same. |
| `varchar(n)` | `DEFAULT 'it''s'` reads `it's`. `DEFAULT ('x')` reads `_utf8mb4\'x\'` with `DEFAULT_GENERATED`. | Reads quoted: `'it''s'`, `'x'`. |
| `text` | Only the expression form: `DEFAULT 'x'` is refused ("BLOB, TEXT, GEOMETRY or JSON column can't have a default value"); `DEFAULT ('x')` reads `_utf8mb4\'x\'` with `DEFAULT_GENERATED`. | Both forms accepted; reads `'x'`. |
| `tinyint(1)` | `DEFAULT 1`, `TRUE`, `b'1'` all read `1`; `FALSE` reads `0`. | Same. |
| `longblob` | Only the expression form: `DEFAULT (X'00FF')` reads `0x00ff`; `DEFAULT ('abc')` reads `_utf8mb4\'abc\'`; both with `DEFAULT_GENERATED`. | Both forms accepted; reads `X'00ff'` and `'abc'`. |
| `json` | Only the expression form: `DEFAULT ('{"a": 1}')` reads `_utf8mb4\'{"a": 1}\'` and the row gets `{"a": 1}`; `DEFAULT (JSON_OBJECT('a', 1))` reads `json_object(_utf8mb4\'a\',1)`; `DEFAULT (CAST('…' AS JSON))` reads `cast(… as json)`. All `DEFAULT_GENERATED`. | `DEFAULT '{"a":1}'` and `DEFAULT ('{"a": 1}')` both accepted and read quoted, `'{"a":1}'`. `CAST(… AS JSON)` is a syntax error. |

The MySQL default normalizer already reads `_utf8mb4\'…\'`. It does not read MySQL's `0x00ff`, and the MariaDB catalog conversion treats MariaDB's `X'00ff'` as a function default (it adds `DEFAULT_GENERATED`), so a `Bytes` default needs both forms read.

**5. Operations.**

| Column | Primary key / unique without a prefix length | Equality and ordering |
| --- | --- | --- |
| `int`, `bigint`, `double`, `decimal`, `varchar(191)`, `tinyint(1)` | Both allowed, both servers. | Exact, given the parameter forms in question 2. |
| `float` | Both allowed. | Ordering works; equality with a number parameter never matches unless it is `CAST(? AS FLOAT)`. |
| `text`, `longblob` | Primary key refused on both (error 1170). Unique refused on MySQL; allowed on MariaDB (a hash-based long unique). | `longblob` compares and orders bytewise on both (empty < `00` < `0000` < `41` < `61` < `FF`). `varchar` and `text` compare case-insensitively on both; trailing spaces are ignored on MariaDB (`utf8mb4_general_ci`, a PAD SPACE collation) and significant on MySQL (`utf8mb4_0900_ai_ci`, NO PAD). |
| `json` | MySQL: neither (error 3152, JSON is indexed only through generated columns). MariaDB: primary key refused, unique allowed. | MySQL: `v = ?` with a string compares the JSON value with a JSON string, so an object never matches; `v = CAST(? AS JSON)` compares JSON values (key order ignored, `1` = `1.0`); ordering is MySQL's JSON order. `JSON_EQUALS` does not exist. MariaDB: `v = ?` compares the stored text, so key order and spacing matter; `JSON_EQUALS(v, ?)` compares values but, in a `WHERE`, also matched the SQL `NULL` row (it returns `NULL` for that row in a select list), so it needs `v IS NOT NULL AND`. |
| `tinyint(1)` with 0, 1, 2, -1 stored | | `v = TRUE`, `v = ?` with `true` and `v = 1` match only `1`; `WHERE v` and `v IS TRUE` match `1`, `2` and `-1`. Both. |

**6. Values inside an include's JSON.** MySQL builds includes with `JSON_OBJECT` and `JSON_ARRAYAGG`, and ordered arrays with `JSON_EXTRACT(JSON_ARRAY(x), '$[0]')`; all three gave the same values. MariaDB loads includes with one query per relation, so its column is for information.

| Column | MySQL, bare column | MariaDB, bare column | Lossless projection |
| --- | --- | --- | --- |
| `int` | JSON number | same | the column |
| `bigint` | JSON number, all digits (`9223372036854775807`), which `JSON.parse` rounds past 2^53 | same | `CAST(v AS CHAR)`, as today |
| `float` | The exact double expansion (`0.10000000149011612`, `16777216.0`), which differs from the row read (`0.1`) | 6 significant digits, as the row read | `CAST(v AS CHAR)` gives the row read's text; `CAST(v AS DOUBLE)` gives the exact value |
| `double` | Shortest round-trip number; negative zero as `-0.0` | same, negative zero as `0` | the column |
| `decimal` | JSON number with every digit and the scale's zeros (`1.500000000000000000000000000000`), which `JSON.parse` rounds | same | `CAST(v AS CHAR)` |
| `varchar`, `text` | JSON string | same | the column |
| `tinyint(1)` | JSON number as stored (`2` stays `2`) | same | the column, or `v <> 0` for JSON `true`/`false` (`NULL` stays `null`) |
| `longblob` | The string `"base64:type251:AP8="` | Raw bytes inside the string, not valid UTF-8; the whole document comes back as bytes | `TO_BASE64(v)` gives plain base64 on both |
| `json` | Nested as a JSON document, normalised as in question 1 | Nested as a document, verbatim | the column on both |

**7. Aggregates.**

| Input | `SUM` | `AVG` | `MIN` / `MAX` |
| --- | --- | --- | --- |
| `int` | `decimal(32,0)` | `decimal(14,4)` (`2.3333`) | `int` |
| `bigint` | `decimal(41,0)`, exact past 64 bits (`9232379236109516801`) | `decimal(23,4)` | `bigint` |
| `float` | `double` with float noise (`0.1 + 0.2` = `0.30000000447034836`) | `double` | `float`, read as 6 significant digits |
| `double` | `double` | `double` | `double` |
| `decimal(65,30)` | `decimal(65,30)`, exact | MySQL `decimal(65,30)` (`0.133333333333333333333333333334`); MariaDB `decimal(65,34)` (`0.1333333333333333333333333333336667`) | `decimal(65,30)` |
| `decimal(10,2)` | `decimal(32,2)` | `decimal(14,6)` | `decimal(10,2)` |

Every result reaches the codec as text. `CAST(SUM(v) AS DOUBLE) / COUNT(v)`, the form `avg` over integers uses, gives a `double` for every input.

**8. Where MariaDB differs from MySQL.**

- `json` is `longtext COLLATE utf8mb4_bin` with a column check `json_valid(col)`; the catalog reports `longtext`.
- JSON is stored and read verbatim (key order, whitespace, duplicate keys); MySQL normalises it.
- `CAST(… AS JSON)` is a syntax error. `JSON_COMPACT`, `JSON_EQUALS` and `JSON_QUERY` exist (MySQL has none of them). `JSON_EQUALS` in a `WHERE` matched a SQL `NULL` row.
- A bytes parameter is accepted into a `json` column; MySQL refuses it.
- `v = ?` on a `json` column compares text, not JSON values.
- Integer `COLUMN_TYPE` keeps the display width (`int(11)`, `bigint(20)`, `tinyint(4)`, `tinyint(1) unsigned`).
- `text`, `longblob` and `json` take a literal default, and defaults read back quoted (`'x'`, `X'00ff'`); MySQL requires the expression form and reads `_utf8mb4\'x\'` and `0x00ff`. No `DEFAULT_GENERATED` flag.
- `text`, `longblob` and `json` can carry a unique index.
- Negative zero in `float` and `double` reads `0`; MySQL reads `-0`.
- `decimal BETWEEN ? AND ?` with string parameters compares as a double; MySQL compares exactly.
- A `bigint` expression compared with a string parameter compares exactly; MySQL compares as a double.
- `AVG` over `decimal(65,30)` has scale 34; MySQL 30.
- Default table collation `utf8mb4_general_ci` (PAD SPACE); MySQL `utf8mb4_0900_ai_ci` (NO PAD).
- In JSON, `float` is printed with 6 significant digits and `longblob` as raw bytes.

**9. Prisma ORM 7's MySQL columns.** From memory of Prisma ORM 7's MySQL connector, not checked against a document: `Int` → `int`, `BigInt` → `bigint`, `Float` → `double`, `Decimal` → `decimal(65,30)`, `String` → `varchar(191)`, `Boolean` → `tinyint(1)`, `Bytes` → `longblob`, `Json` → `json`. The table above matches. On MariaDB the same `json` becomes `longtext` with the check, as question 3 shows.

#### Decisions the probe forces

1. **How a decimal parameter is compared.** `IN` (both servers), `BETWEEN` (MariaDB) and any expression compare a string parameter as a double; only a column compared directly with `=`, `<` or `>` is exact. Options: write every `mysql/decimal@1` parameter as `CAST(?N AS DECIMAL(65,30))`, which needs the MySQL renderer to let a codec wrap its parameter, as it already lets a codec wrap its include projection; or offer only `=` and ordering against a column and refuse `in`. Recommendation: the cast, with the codec refusing text that has more than 35 integer digits or 30 fraction digits, so the cast never rounds or clamps.
2. **Whether `Float(storage: float)` is in this slice.** A row read of a `float` is rounded to 6 significant digits, an include on MySQL gives the exact double expansion instead, and equality with a number parameter never matches. Making it exact needs `CAST(v AS DOUBLE)` on every read and `CAST(? AS FLOAT)` on every parameter, and the renderer has no hook for the first. Options: build those hooks; ship `Float4` with 6-digit reads, no equality, and an include that reads differently; or leave `storage: float` out. Recommendation: leave it out of this slice and record it as deferred; the default `Float` is `double`, which is exact.
3. **What a `Boolean` reads for a `tinyint(1)` that holds 2 or -1.** MySQL stores them, `WHERE v` treats them as true, but `v = TRUE` and a `true` parameter match only 1. Options: a decode error for anything but 0 or 1, as SQLite's `IntegerBoolean`; or any non-zero is `true`. Recommendation: the decode error, so a row never reads `true` while failing `= true`, and so the shared boolean value logic serves both targets. The include projection stays the bare column (a JSON number), not `v <> 0`, so the codec checks it the same way.
4. **What `Json` filters offer.** MySQL compares JSON values only through `CAST(? AS JSON)`; MariaDB compares text, and its `JSON_EQUALS` needs a `NULL` guard. Neither can index a `json` column on MySQL. Options: no equality or ordering traits on `Json`, as PostgreSQL's `json` has none; or equality through a per-server form. Recommendation: no equality or ordering, matching PostgreSQL's `PlainJson`. Writes use a plain string parameter, which both servers store as JSON.
5. **How `Json` verifies on MariaDB.** The catalog reports `longtext`; only the column check `json_valid(col)` (and the `utf8mb4_bin` collation) marks it as JSON. Options: the MariaDB catalog reader reads `information_schema.check_constraints` and reports a `longtext` column with its column-level `json_valid` check as `json`; or `Json` is refused on MariaDB. Recommendation: read the check. It is reliable, and the one column it cannot tell apart is a hand-written `longtext COLLATE utf8mb4_bin CHECK (json_valid(col))`, which is the same column.
6. **How a default on `text`, `longblob` and `json` is written.** MySQL accepts only `DEFAULT (literal)`; MariaDB accepts both. Recommendation: write the expression form on both servers, and read back all four reported forms (`_utf8mb4\'…\'` and `0x…` on MySQL, `'…'` and `X'…'` on MariaDB) as the literal.
7. **What a `Decimal` value looks like when read.** The server pads to the column's scale (`1.50` in `decimal(65,30)` reads `1.500000000000000000000000000000`), and rounds a written value with more fraction digits than the scale, with only a note. Options: hand the padded text to the application, or strip trailing zeros. Recommendation: hand over the text as the server prints it, as PostgreSQL's `numeric(p,s)` does (from memory), and let the server round on write as PostgreSQL does.
8. **How `Bytes` is projected into an include.** MySQL writes a blob into JSON as `"base64:type251:…"`. Recommendation: project `TO_BASE64(v)`, which gives plain base64 on both servers, and decode base64 in the codec.

#### Decided (2026-11-19)

Each recommendation above is taken. Where it needed a choice of mechanism:

1. **Decimal parameters are cast.** The MySQL target's own codec descriptor (`MysqlCodecDescriptor`) gains a method that writes a parameter's placeholder into SQL, as it already has one for the include projection. The MySQL renderer calls it wherever it writes a parameter; the default returns the placeholder unchanged. `mysql/decimal@1` returns `CAST(?N AS DECIMAL(65,30))`. Nothing outside the MySQL target changes. After review (2026-11-19) the method takes the parameter as an AST expression and the codec reference, as the include projection hook does, and is named `wrapParameter`; the decimal cast follows the column, `DECIMAL(65, s)` with `s` = min(30, 65 − (precision − scale)), so every value a column holds can be written and filtered. PostgreSQL decides its casts in its adapter from the data type, not from the codec.
2. **`Float(storage: float)` and `Float4` are left out.** `Float` takes `storage: double` only. A `float` column cannot be read exactly from a row without a per-codec wrapper around a selected column, which no target has, and that is a change to how every select is rendered, not to this slice. TML-3890 records it. The table above keeps the row, marked deferred.
3. **`Bool` refuses a stored value other than 0 or 1** with a decode error that names the column, using the shared boolean code SQLite uses.
4. **`PlainJson` has no equality or ordering.**
5. **MariaDB reads `information_schema.check_constraints`** and reports a `longtext` column with a column-level `json_valid` check as its `json` data type. MariaDB needs no data type entries of its own: its catalog reader reports a `longtext` with that check as `json`, and already reported a signed `tinyint(1)` as MySQL does, so MySQL's `mysql/json` and `mysql/boolean` claim both.
6. **Defaults on `text`, `longblob` and `json` are written as `DEFAULT (literal)`** on both servers, and all four reported forms read back as the literal.
7. **A `Decimal` reads as the server prints it,** padded to the column's scale. The codec refuses to write text with more digits before or after the point than its parameter cast holds (35 and 30 for a column with at most 35 digits before the point), so the cast never rounds or clamps silently; a value with more fraction digits than a narrower column's scale is rounded by the server, as on PostgreSQL.
8. **`Longblob` is projected into an include as `TO_BASE64(v)`.**

## MongoDB

MongoDB's explicit types are already named after BSON types, so most rows only add the convenience type. The `storage` values are BSON's own type names, as `storage: date` and `storage: string` already are for the date and time types. The one exception is `bson` for `Json`, which means "whichever BSON value fits". It does not mean the explicit type `Bson`, which accepts any BSON value; the docs say so.

| Convenience type | `as` | `storage` | Becomes | Codec | Change |
| --- | --- | --- | --- | --- | --- |
| `Int(storage?)` | | `int` | `Int32` | `mongo/int32@1` | `Int` stops being a deprecated alias |
| `BigInt(as?, storage?)` | `bigint` (default) | `long` | `Int64BigInt` | `mongo/int64@1` | explicit `Int64` renamed |
| | `number` | `long` | `Int64Number` | `mongo/int64Number@1` | |
| `Float(storage?)` | | `double` | `Double` | `mongo/double@1` | `Float` stops being a deprecated alias |
| `Decimal(storage?)` | | `decimal` | `Decimal128` | `mongo/decimal128@1` | new |
| `Boolean(storage?)` | | `bool` | `Bool` | `mongo/bool@1` | `Boolean` stops being a deprecated alias |
| `Bytes(storage?)` | | `binData` | `Binary` | `mongo/binary@1` | new |
| `String(storage?)` | | `string` | `BsonString` | `mongo/string@1` | explicit `String` renamed |
| `Json(storage?)` | | `bson` | `PlainJson` | `mongo/json@1` | explicit `Json` renamed |

- **`Json` has one storage, `bson`.** MongoDB stores a JSON value as whichever BSON value fits it, which is its idiomatic form. A JSON string storage would need a new codec and is not part of this project.
- **`Int`, `Float` and `Boolean` stop warning.** Today they warn and point to `Int32`, `Double` and `Bool`. As convenience types they are the names a user is meant to write. Their codecs do not change.
- **`Int64` becomes `Int64BigInt`,** with `Int64` kept for one release line as a deprecated alias in PSL. In a TypeScript contract `type.Int64()` is removed at once, because the MongoDB builder gives a deprecated name no helper (ADR 257, amended 2026-10-30). An upgrade instruction with a detection pattern covers it.
- **Texts that name the old types are corrected:** `removedMongoFieldPresets` (points to `Int64`) and `EARLIER_MONGO_SCALAR_NAMES` (says `BigInt`, `Bytes` and `Decimal` are not MongoDB types). ADR 257 is amended: `Int`, `Float` and `Boolean` have `type.*` helpers again. BSON's `long` has two codecs, so both carry a suffix for the value they read, as PostgreSQL's `Int8BigInt` and `Int8Number` do.
- **`BsonString` is the name MongoDB's C# and Java drivers give the type.** The explicit `String` and `Json` need no deprecated alias: the bare convenience names give the same codecs.
- **The deprecation warning fires wherever a deprecated name is written,** as the SQL family's does: with or without arguments, in a field, a value object member or a `types {}` alias. Today MongoDB's does not fire for a name written with parentheses (`interpreter.ts:963`) or for the base of a `types {}` alias (`type-aliases.ts:209`). The warner is widened inside the MongoDB family; it is a second copy of the SQL family's, because a shared home would be the framework. Tests: one per place (bare, with parentheses, value object member, alias); `Int`, `Float` and `Boolean` warn in none; `types { X = String }` and `types { X = Int }` still resolve.
- The Prisma 6 schema reader keeps its bindings; it names codecs, not PSL names.

## Code the targets share

The new codecs repeat value logic across targets: decimal text on PostgreSQL, MySQL, MongoDB and now SQLite; a boolean read from an integer on SQLite and MySQL; the check that a value is plain JSON on all four. ADR 314 says where such code goes: value logic that depends on no database and no family lives in `@internal/type-implementations`, and codec classes, errors and SQL stay in the target or the family.

Each slice that adds a codec applies that rule, and records what it found:

- Decimal text handling moves into `@internal/type-implementations` in the SQLite slice, where its third user appears. PostgreSQL and MongoDB move to it in that slice, so the MySQL slice edits no released target's codecs. This is TML-3782. The framework's own decimal code stays where it is.
- The boolean-from-integer logic goes into the shared package in the SQLite slice; MySQL is its second user.
- The plain-JSON check is TML-3783. Today it lives in the MongoDB target. The MySQL slice extracts it as value logic that returns the failure as data, and uses it in MongoDB and MySQL. PostgreSQL and SQLite JSON codecs do not refuse a non-JSON value today and are left unchanged; ADR 257's sentence about the check's home is corrected.
- A codec class that two SQL targets need goes in the SQL family beside `SqlTextCodec` and the others in `relational-core/src/ast/sql-codecs.ts`, as ADR 314 says.

## The SQL family's `sql.String(n)` and `sql.Char(n)`

`sql.String(n)` is a `varchar(n)` column on every SQL target. It now shares a name with the `String` convenience type and means something else. It is renamed `sql.Varchar(n)`, and `sql.String` stays for one release line as a deprecated alias. `sql.Char(n)` keeps its name, so the namespace ends as `sql.Varchar(n)` and `sql.Char(n)`.

The rename is built in the PostgreSQL `Json` slice, because PostgreSQL is the released target it affects. That slice amends ADR 316, which says `sql.String(n)` stays. Tests under `packages/1-framework` that mention `sql.String(` are left on the deprecated name. Criteria: `sql.String(n)` warns and emits the same contract on all three SQL targets, and no tool writes it.

## Names

Will accepted every explicit name and `storage` value in the tables above on 2026-11-17. No name is open.

## Scope

In scope: the type declarations of the four targets, their tests, the `inferred` marks, fixtures and examples, `docs/reference/scalar-types.md`, the `prisma-8` skill references, upgrade instructions for every rename, and the ADRs: ADR 316 gains PostgreSQL `Json`, and a new ADR records the shared rules and the other targets' tables as ADR 315 did for the date and time types. The MongoDB slice starts that ADR; the SQLite and MySQL slices add their tables.

Also in scope, because main is wrong today: main has two ADRs numbered 316. The one from prisma/orm#30956 (an extension pack's extension is found through the search path) merged second and takes the next free number, chosen from main and open pull requests at the time the slice is pushed. The renumbering is its own commit.

Out of scope:

- The type choice mechanism, and anything else under `packages/1-framework`.
- A MongoDB JSON string storage. The codecs SQLite and MySQL lack are in scope.
- Convenience types for single-concept types such as `Uuid`, `ObjectId`, `Vector` and `Bson`.
- Clearer errors for `json` limits on PostgreSQL.

## Acceptance criteria

- [ ] On each target, each row of its table resolves to its explicit type in PSL and in a TypeScript contract.
- [ ] On each target, a schema written with the convenience types and one written with the explicit types emit the same `contract.json`.
- [ ] Existing fixtures and examples emit byte-identical `contract.json` files, except SQLite fields written `Decimal` or `BigIntNumber`. `pnpm fixtures:check` shows no difference at all in the PostgreSQL, MongoDB and MySQL slices.
- [ ] On PostgreSQL, `contract infer` and `contract print` write the convenience calls, and the print round-trip tests pass. On the other targets, each explicit type's convenience call is tested directly, and MySQL's `inferred` marks name one explicit type per column type (`Int8BigInt` for `bigint`).
- [ ] Each removed explicit name is a deprecated alias that warns and emits the same contract, except SQLite `BigIntNumber`. MongoDB's `Int`, `Float` and `Boolean` no longer warn.
- [ ] PostgreSQL `Json`: `Json`, `Json(storage: json)` and `PlainJson` emit the same column; `Json(storage: jsonb)` and `Jsonb` emit the same column; `Json` works as a list, as a `types {}` alias base and with a JSON `@default`; `type.Json()` is typed `pg/json@1` and `type.Json({ storage: 'jsonb' })` `pg/jsonb@1`; `type.Json({ storage: 'text' })` and `type.Json({ as: 'string' })` do not compile; `contract infer` reads a live `json` and `jsonb` column; a Prisma 7 `Json` and `Json @db.Json` read as `Json(storage: jsonb)` and `Json`.
- [ ] Each limit the docs state for `json` (no equality filter, no index, no unique constraint) is checked against the code or a test before it is written.
- [ ] `pnpm check:upgrade-coverage`, `pnpm lint:ratchets` and `pnpm lint:deps` pass in every slice.
- [ ] Every rename a user must act on has an upgrade instruction with a detection pattern.
- [ ] `docs/reference/scalar-types.md` and the ADRs describe the final names.
- [ ] No source file under `packages/1-framework` changes.
