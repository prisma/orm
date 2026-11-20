# How MySQL and MariaDB store, report and compare scalar columns

These are measurements, not documentation. They were taken on 2026-11-19 against MySQL 8.4.13 and MariaDB 10.11.19, through the MySQL driver package's own connection options and statement builder and the `mariadb` package's text protocol, with `time_zone = '+00:00'`. "Both" means both servers gave the same result.

The MySQL and MariaDB scalar types are built on these facts. [ADR 322](../architecture%20docs/adrs/ADR%20322%20-%20Each%20target%20declares%20the%20scalar%20convenience%20types%20over%20its%20own%20explicit%20types.md) records the decisions taken from them. Measure again before relying on a row for another server version.

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

**5. Operations.**

| Column | Primary key / unique without a prefix length | Equality and ordering |
| --- | --- | --- |
| `int`, `bigint`, `double`, `decimal`, `varchar(191)`, `tinyint(1)` | Both allowed, both servers. | Exact, given the parameter forms in section 2. |
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
| `json` | Nested as a JSON document, normalised as in section 1 | Nested as a document, verbatim | the column on both |

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

The result type of `SUM` over a decimal, measured again on 2026-11-19 on both servers with `CREATE TABLE … AS SELECT SUM(…)`, without and with `GROUP BY`, gave the same on both: `decimal(10,2)` → `decimal(32,2)`, `decimal(40,30)` → `decimal(62,30)`, a bare `decimal` → `decimal(32,0)`, `decimal(43,0)` → `decimal(65,0)`, `decimal(44,2)` → `decimal(65,2)`, `decimal(65,0)` → `decimal(65,0)`, `decimal(65,30)` → `decimal(65,30)`. That is `decimal(min(65, p + 22), s)`.

A total that needs more than 65 digits, measured the same day with rows of 65 nines in a `decimal(65,0)` and of `99…9.99…9` in a `decimal(65,30)`: without `GROUP BY`, or in a correlated subquery per parent, both servers return the exact 66-digit total. With `GROUP BY`, with or without `HAVING`, both return the largest value of the type, `99…9` or `-99…9`. `SELECT @@warning_count` after each is 0 on both servers, and `SHOW WARNINGS` is empty. `CREATE TABLE … AS SELECT` of such a total fails with error 1264, out of range. The server caps it when it groups the rows through a temporary table, which depends on the query plan: `EXPLAIN` shows `Using temporary` for `GROUP BY` on a column without an index, capped on both, and an index scan with no temporary table for a column with an index, exact on both. Through the ORM on the live servers: `aggregate` with a `where` is exact on both; `groupBy` is capped on both on a column without an index, and on a column with one it is exact when the server reads the groups from the index and capped when it chooses a temporary table (seen on MySQL when the query also filters on the primary key); an include's `sum` is exact on MySQL, and on MariaDB exact for one parent and capped for several.

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

**9. Prisma ORM 7's MySQL columns.** From memory of Prisma ORM 7's MySQL connector, not checked against a document: `Int` → `int`, `BigInt` → `bigint`, `Float` → `double`, `Decimal` → `decimal(65,30)`, `String` → `varchar(191)`, `Boolean` → `tinyint(1)`, `Bytes` → `longblob`, `Json` → `json`. These are the columns a bare convenience type gives on MySQL. On MariaDB the same `json` becomes `longtext` with the check, as section 3 shows.
