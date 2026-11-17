---
from: "8.0.0-rc.18"
to: "8.0.0-rc.19"
changes:
  - id: stored-contracts-drop-nocheck
    summary: |
      A stored SQL contract that has a `noCheck` key on a column no longer loads. Before any other step of this change, run `scripts/remove-nocheck/remove-nocheck.ts` from the project root, then run `prisma db sign` against every database. Sign a database that has not applied every migration with `prisma db sign --contract <the last migration it applied>`, and migrate it once each `ops.json` is written again. The script removes the key from every stored contract, migration snapshots and the emitted `contract.json` included. A list whose element check was waived becomes a list whose elements may be null, which is what the database allows. The script also writes each PostgreSQL default in the form this release stores (`postgres-defaults-stored-in-another-spelling`). It refreshes every hash and reference that changes.
    detection:
      glob: "**/*.json"
      matches:
        - '"noCheck"\s*:'
    script: ./scripts/remove-nocheck/remove-nocheck.ts
  - id: psl-nocheck-removed
    summary: |
      The PSL attribute `@noCheck` no longer exists, and writing it is an unknown-attribute error. Replace `T[] @noCheck(elementNotNull)` with `T?[]`, delete `@noCheck(membership)`, and replace a bare `@noCheck` with both. Re-emit the contract. Where you deleted a membership waiver, the next migration adds the membership check. The detection matches PSL files that use the attribute.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@noCheck\b'
  - id: ts-nocheck-method-removed
    summary: |
      The TypeScript field builder no longer has a `noCheck()` method. Replace `.many().noCheck('elementNotNull')` with `.many({ elementsNullable: true })`, delete `.noCheck('membership')`, and replace a bare `.noCheck()` with both. Re-emit the contract. Where you deleted a membership waiver, the next migration adds the membership check. The detection matches TypeScript files that call the method.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.noCheck\('
  - id: prisma7-lists-allow-null-elements
    summary: |
      A contract read from a Prisma 7 `schema.prisma` now types the elements of every list as `T | null`, because Prisma 7 creates no check against null elements, and its storage hash changes. Run `stored-contracts-drop-nocheck` first. Otherwise, re-emit the contract and then run `prisma db sign` against every database. A database Prisma 7 built still matches the contract with no migration. The detection matches a Prisma 7 schema file, one without the `// use prisma-8` directive, with a list of a scalar type, or with any list when the same file declares an enum; check whether such a list is of an enum, and check a list of an enum declared in another file of the schema yourself.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?!\s*// *use +(?:prisma-8|prisma-next) *(?!\S))[\s\S]*\n[ \t]*\w+[ \t]+(?:String|Int|BigInt|Float|Decimal|Boolean|DateTime|Json|Bytes)\[\]'
        - '(?<![\s\S])(?!\s*// *use +(?:prisma-8|prisma-next) *(?!\S))(?=[\s\S]*\benum[ \t]+\w+[ \t]*\{)[\s\S]*\n[ \t]*\w+[ \t]+\w+\[\]'
  - id: supabase-contract-lists-allow-null-elements
    summary: |
      The `@prisma/orm-extension-supabase` contract now declares its four `text[]` columns as lists whose elements may be null, so code that reads them gets `string | null` elements, and the Supabase space's storage hash changes. Run `prisma db sign` against every database after upgrading.
    detection:
      glob: "**/package.json"
      matches:
        - '"@prisma/orm-extension-supabase"'
  - id: sqlite-contracts-name-datetime-and-json-data-types
    summary: |
      On SQLite, a column whose codec is `sqlite/datetime@1` or `sqlite/json@1` names its own data type (`sqlite/datetime`, `sqlite/json`) instead of `sqlite/text`, and a datetime default or enum value is stored with exactly three fraction digits (`2024-01-01T00:00:00.000Z`). Run the colocated script on the project: it rewrites every SQLite contract and migration snapshot, renames the snapshot directories to the new storage hashes, and rewrites the migrations, refs, `migration.ts` files and `contract.d.ts` files that name them. The CLI refuses the old contract; the application keeps running on it, so upgrade before the next `db migrate`.
    detection:
      glob: "**/*.json"
      matches:
        - '"codecId"\s*:\s*"sqlite/(?:datetime|json)@1"\s*,\s*"dataType"\s*:\s*"sqlite/text"'
    script: ./scripts/data-type-values/data-type-values.ts
  - id: date-time-interval-and-bytes-defaults-use-tags
    summary: |
      A date, time, interval or bytes default is written with its type's tag instead of a quoted string: `@default(timestamptz`2024-01-01T00:00:00Z`)` on PostgreSQL, `@default(datetime`2024-01-01T00:00:00Z`)` on SQLite, and `@default(bytea`\x0102`)` for bytes on PostgreSQL and `@default(blob`0102`)` on SQLite. `contract emit` refuses the quoted form and names the tag to write. The detection matches Prisma 8 schema files, those with the `// use prisma-8` directive, with a quoted default that looks like a date or an interval, or that sits on a date, time, interval or bytes column. It skips a quoted time such as `"12:30"` on a column whose type is a type alias, because a `String` default can look the same; `contract emit` names such a default.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])\s*// *use +(?:prisma-8|prisma-next) *(?!\S)[\s\S]*@default\(\s*"(?:[+-]?\d{4,6}-\d{2}-\d{2}|-?P(?:\d|T\d)|[+-]?infinity")'
        - '(?<![\s\S])\s*// *use +(?:prisma-8|prisma-next) *(?!\S)[\s\S]*\b(?:DateTime|Date|Time|Timetz|Timestamp|Timestamptz|Interval)\b[^\n]*@default\(\s*"'
        - '(?<![\s\S])\s*// *use +(?:prisma-8|prisma-next) *(?!\S)[\s\S]*\bBytes\??[^\n]*@default\(\s*"'
  - id: postgres-defaults-stored-in-another-spelling
    summary: |
      The CLI refuses a PostgreSQL contract that an earlier release emitted when it stores a default in another spelling than its column's parameters give, for example `"1.5"` on `numeric(10,2)`, or a date or time default written as earlier releases stored it. Migration snapshots store such defaults too, and the CLI refuses to plan from them. Run `scripts/remove-nocheck/remove-nocheck.ts` (`stored-contracts-drop-nocheck`): it writes each stored default in the new form, migration snapshots included, and refreshes every hash that changes. Then run `prisma contract emit`, then `prisma db sign`.
    script: ./scripts/remove-nocheck/remove-nocheck.ts
  - id: prisma7-datetime-default-finer-than-column
    summary: |
      A project that reads a Prisma 7 schema: a `DateTime` default with more fraction digits than its column holds is now refused instead of rounded. Write the value PostgreSQL stores, which the message names. The detection matches a quoted default with more fraction digits than the precision of its `@db.Timestamp`, `@db.Timestamptz`, `@db.Time` or `@db.Timetz` type, or with more than 3 on a field without a `@db` type.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?:^|\n)(?![^\n]*@db\.)[^\n]*@default\(\s*"\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}\.\d{4,}'
        - '(?:^|\n)(?=[^\n]*@db\.(?:Timestamp|Timestamptz|Time|Timetz)\(\s*0\s*\))[^\n]*@default\(\s*"[^"\n]*:\d{2}\.\d{1,}'
        - '(?:^|\n)(?=[^\n]*@db\.(?:Timestamp|Timestamptz|Time|Timetz)\(\s*1\s*\))[^\n]*@default\(\s*"[^"\n]*:\d{2}\.\d{2,}'
        - '(?:^|\n)(?=[^\n]*@db\.(?:Timestamp|Timestamptz|Time|Timetz)\(\s*2\s*\))[^\n]*@default\(\s*"[^"\n]*:\d{2}\.\d{3,}'
        - '(?:^|\n)(?=[^\n]*@db\.(?:Timestamp|Timestamptz|Time|Timetz)\(\s*3\s*\))[^\n]*@default\(\s*"[^"\n]*:\d{2}\.\d{4,}'
        - '(?:^|\n)(?=[^\n]*@db\.(?:Timestamp|Timestamptz|Time|Timetz)\(\s*4\s*\))[^\n]*@default\(\s*"[^"\n]*:\d{2}\.\d{5,}'
        - '(?:^|\n)(?=[^\n]*@db\.(?:Timestamp|Timestamptz|Time|Timetz)\(\s*5\s*\))[^\n]*@default\(\s*"[^"\n]*:\d{2}\.\d{6,}'
  - id: stored-values-a-column-type-does-not-hold
    summary: |
      Reading a value its column's type does not hold now throws `RUNTIME.DECODE_FAILED`, in a plain read and in an include alike: text or bytes in a SQLite INTEGER or REAL column, text or a number in a SQLite BLOB column, and a multi-dimensional array in a PostgreSQL `text[]` column read with `pg/text-array@1`.
  - id: sqlite-datetime-without-offset-read-as-utc
    summary: |
      A SQLite `DateTime` row holding date and time text without a UTC offset, such as `2024-01-01 12:00:00`, is now read as UTC, as SQLite's own date and time functions read it, instead of in the time zone of the machine running the query. Prisma never writes such text; another tool may.
  - id: text-array-min-max-return-arrays
    summary: |
      `min` and `max` of a `pg/text-array@1` column return an array of strings, as a row of the column does, instead of the array's text (`{a,b}`).
  - id: sign-databases-after-data-type-values
    summary: |
      The upgrade changes the storage hash of every SQLite contract with a datetime or JSON column, and of every PostgreSQL contract you emit again. Run `prisma db sign` against every database before deploying the application built with the new contract. Sign a database that has not applied every migration with `prisma db sign --contract <the last migration it applied>`.
  - id: client-functions-move-from-default-to-on-create
    summary: |
      `@default` now sets a database default only. `@default(uuid())`, `@default(cuid(2))`, `@default(ulid())` and `@default(nanoid())`, with any arguments, are refused with `PSL_GENERATOR_IN_DEFAULT`. Write `@onCreate(uuid())` and so on instead. Run `scripts/default-generators-to-on-create/rewrite-default-generators.mjs` with every `.prisma` file of the project as arguments, including the schema copies in migration directories; it rewrites the Prisma 8 ones and leaves the others unchanged. The contract does not change, so there is nothing to re-emit, sign or migrate. The detection matches Prisma 8 schema files, those with the `// use prisma-8` directive, that write one of these functions in `@default`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])\s*// *use +(?:prisma-8|prisma-next) *(?!\S)[\s\S]*@default\(\s*(?:uuid|cuid|ulid|nanoid)\s*\('
    script: ./scripts/default-generators-to-on-create/rewrite-default-generators.mjs
  - id: contract-print-writes-generator-attributes
    summary: |
      `contract print` now writes every generated value as `@onCreate(fn())` or `@onUpdate(fn())` after the column type, instead of a `temporal.*` or `id.*` field preset call or `@default(uuid())`. A printed file reads back as the same contract, with the same hashes. It also writes columns it refused before: a value generated on update, and a generated value beside a database default. Nothing to do unless you compare printed files with saved copies.
  - id: prisma7-default-function-arguments-checked
    summary: |
      The reader for a Prisma 7 schema checks the arguments of `uuid`, `cuid` and `nanoid` as Prisma 8 does. An argument the function does not take, such as `uuid(5)`, `cuid(1)`, `nanoid(1)` or `nanoid(1000)`, is refused with `PSL.PRISMA7_UNKNOWN_DEFAULT` and the function's message, where it used to be read as something else (`uuid(5)` as a version 4 UUID, `cuid(1)` as `cuid(2)`). A named argument, such as `nanoid(size: 8)`, is refused too, and so is a number written with a fraction, such as `uuid(4.0)` or `nanoid(8.0)`, which is not an integer value. Write the argument positionally, as a whole number, inside the function's range: `uuid(4)`, `nanoid(8)`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\buuid\(\s*(?![47]\s*\))[^\s)]'
        - '\bcuid\(\s*(?!2\s*\))[^\s)]'
        - '\bnanoid\(\s*(?:[01]\s*\)|\d{4,}|[3-9]\d\d|2[6-9]\d|25[6-9]|[^)]*[.:]|[-"''])'
  - id: generator-function-argument-diagnostics
    summary: |
      In Prisma 8 PSL, an argument of `uuid`, `cuid` or `nanoid` the function does not take is reported with the code `PSL_INVALID_GENERATOR_ARGUMENT` instead of `PSL_INVALID_ATTRIBUTE_SYNTAX`, and with the function's message, such as `uuid: version must be 4 or 7, got 5`. A missing or extra argument names the callee `Generator function "<name>"` instead of `Attribute "<name>"`, and `Default function "<name>"` for `now` and `autoincrement` in `@default`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,json}"
      matches:
        - 'Expected one of: 4 \| 7'
        - 'Expected an integer between 2 and 255'
        - 'Attribute \\?"(?:uuid|cuid|nanoid|ulid|ksuid|now|autoincrement)\\?"'
  - id: generator-function-argument-with-fraction
    summary: |
      A generator function argument written with a fraction, such as `nanoid(8.0)`, `uuid(4.0)`, `uuid(7.0)` or `cuid(2.0)`, is refused with `PSL_VALUE_TYPE_INCOMPATIBLE`, because a number with a fraction is not an integer value. It used to be read as the whole number. Write `nanoid(8)`, `uuid(4)`, `uuid(7)` or `cuid(2)`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(?:uuid|cuid|nanoid)\(\s*\d+\.\d'
  - id: generator-fits-column
    summary: |
      A generator is refused on a Postgres column too short for what it writes, such as `Char(5) @onCreate(nanoid())` (a Nano ID is 21 characters), `VarChar(5) @onCreate(uuid())`, or a bare `Char`, which holds one character. The message names both lengths: `Field "Row.value": nanoid() writes 21 characters, which does not fit a column of 5 characters.` The code is `PSL_GENERATOR_NOT_APPLICABLE` in Prisma 8 PSL, `PSL.PRISMA7_GENERATOR_REFUSED` for a Prisma 7 `@default(...)`, and `CONTRACT.DEFAULT_INVALID` in a TypeScript contract. Such a column used to fail at the first insert. SQLite does not limit the length, so it takes any of them. Widen the column, or for `nanoid` pass a size that fits.
  - id: discriminator-must-be-text
    summary: |
      A SQL `@@discriminator` field that is not text is refused with the message `must be text, such as String, but is "<type>"` instead of `must be of type String, but is "<type>"`. A discriminator may now also be a `Char(n)` or `VarChar(n)` column on Postgres, or a `sql.String(n)` column on SQLite. A `@@base` value is checked against the column's type, so on Postgres a value longer than a `VarChar(n)` column holds is refused; SQLite does not limit the length, so it takes any value. Mongo's message is unchanged.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,json}"
      matches:
        - '(?<![\s\S])(?![\s\S]*[Mm]ongo)[\s\S]*must be of type String'
  - id: string-timestamp-presets-write-text
    summary: |
      The `temporal.*String` presets on Postgres (`timestampString`, `timestamptzString`, `createdAtString`, `updatedAtString`), and every `@updatedAt` field a `prisma7Schema(...)` contract reads, now fill the column with text from a new generator instead of a `Date`. Re-emit the contract with `prisma contract emit`. Only the execution hash changes, so the database needs no migration and no `db sign`. The detection matches a schema or contract source that uses one of these presets or `@updatedAt`.
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      matches:
        - 'temporal\.(?:timestamp|timestamptz|createdAt|updatedAt)String\('
        - '@updatedAt\b'
  - id: string-timestamp-codecs-take-text-only
    summary: |
      The Postgres `pg/timestamp-string@1` and `pg/timestamptz-string@1` codecs, behind `TimestampString(p)` and `TimestamptzString(p)`, now refuse a value that is not text with `RUNTIME.ENCODE_FAILED`. Before, a `Date` that reached them at runtime was converted. The ORM types were already `string`, so code that compiled still compiles. Code that passes a `Date` through a cast or from JavaScript now fails at runtime; write the text instead, such as `date.toISOString()`. A direct call of the codec's `encode` with a `Date` is now a type error.
  - id: type-constructor-arguments-are-values
    summary: |
      A type-constructor argument is read as a value of a data type, as an attribute argument is. A quoted number, such as `VarChar("255")`, `VarChar(length: "255")` or `Timestamp("3")`, is refused with `PSL_VALUE_TYPE_INCOMPATIBLE` (`Expected a number; write 255`); write the number without quotes. On Postgres a whole number written with a fraction, such as `VarChar(255.0)`, is refused too (`Expected a number that pg/int4 can hold; got pg/numeric`); write `255`. A number its type cannot hold, such as `VarChar(3000000000)` or `Timestamp(2.5)`, is refused at the argument. The same applies to a field preset's precision, such as `temporal.timestamp("3")`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![@\w])(?:[a-z]\w*\.)?[A-Z]\w*\((?:[^()"]*[,:])?\s*"[+-]?\d'
        - '(?<![@\w])(?:[a-z]\w*\.)?[A-Z]\w*\((?:[^()"]*[,:])?\s*[+-]?\d+\.0+\s*[,)]'
        - '(?<![\w$])temporal\.\w+\((?:[^()"]*[,:])?\s*"[+-]?\d'
        - '(?<![\w$])temporal\.\w+\((?:[^()"]*[,:])?\s*[+-]?\d+\.0+\s*[,)]'
  - id: more-codecs-refused-for-enums
    summary: |
      An enum typed by `pg/jsonb@1`, `pg/timetz@1`, `pg/enum@1`, `arktype/json@1`, `pg/vector@1` or `pg/geometry@1` is now refused: `defineContract` from the Postgres package refuses its `enumType` with `CONTRACT.ENUM_INVALID`, and PSL refuses its `@@type` with `PSL_EXTENSION_INVALID_VALUE`. A jsonb enum's CHECK constraint failed to apply: it lists a string member as text PostgreSQL reads as JSON, and a number member as a number it cannot compare with `jsonb`. A query reads a timetz value as the text PostgreSQL prints, such as "12:34:56+02", so a value read back did not equal a member stored as "12:34:56+02:00". A `pg/enum@1` codec types a native enum's column; declare a native enum instead. Replace any other refused enum with a text enum.
    detection:
      glob: "**/*.{prisma,ts,tsx,mts,cts}"
      matches:
        - '@@type\(\s*"(?:pg/(?:jsonb|timetz|enum|vector|geometry)|arktype/json)@1"\s*\)'
        - '(?<![\s\S])(?![\s\S]*GENERATED FILE - DO NOT EDIT)(?=[\s\S]*\benumType\()[\s\S]*?(?:[''"`](?:pg/(?:jsonb|timetz|enum|vector|geometry)|arktype/json)@1[''"`]|\b(?:timetzColumn|jsonbColumn|arktypeJson|geometryColumn)\b|\b(?:vector|geometry)\()'
  - id: psl-enum-members-read-by-the-cast-rule
    summary: |
      A PSL enum member is now read as a written value of the enum codec's data type, as a `@default` is. A quoted member is text, so it is refused with `PSL_VALUE_TYPE_INCOMPATIBLE` on a codec whose data type has no cast from text, such as `pg/numeric@1`, `pg/int8@1`, the float, date and time codecs, `sqlite/bigint@1`, `sqlite/datetime@1` and `sqlite/json@1`; the message says what to write, worded as the same value refused as a `@default`. Write a number unquoted (`Half = 0.5`, `Low = 1`, `Nan = NaN`, `Infinite = Infinity`), a date or time with its tag (`` Launch = date`2024-01-01` ``, `` Launch = timestamptz`2024-01-01T00:00:00Z` ``), and a `sqlite/json@1` member with the `json` tag (`` Low = json`"low"` ``). A member refused for its type now reports `PSL_VALUE_TYPE_INCOMPATIBLE` instead of `PSL_EXTENSION_INVALID_VALUE`: `Low = 1` under `pg/text@1` keeps its message, `Expected a quoted string`, and `Low = "low"` under `pg/int4@1` now says `Expected a number` in place of the codec's own reason. The stored members do not change, so the contract does not either. A member written in TypeScript, an application value, is unchanged, and so is MongoDB PSL.
    detection:
      glob: "**/*.prisma"
      matches:
        - 'enum\s+\w+\s*\{(?=[^{}]*@@type\(\s*"(?!(?:pg/(?:text|char|varchar|uuid|inet|bit|varbit)|sql/(?:text|char|varchar)|sqlite/text|mongo/[\w-]+)@1")[^"]+"\s*\))[^{}]*=\s*"'
  - id: enum-members-compare-by-their-data-type
    summary: |
      An enum typed by `pg/numeric@1`, `pg/interval@1` or `mongo/decimal128@1` now compares values as its data type does, as PostgreSQL's CHECK constraint already did: `db.enums.<namespace>.<Enum>.has()`, `nameOf()` and `ordinalOf()` find `0.50` as the numeric member `0.5`, and `PT24H` as the interval member `P1D`. Two members that are one value in different forms, such as `0.5` and `0.50`, or `P1D` and `PT24H`, are now refused as duplicates: `CONTRACT.ENUM_INVALID` from `defineContract`, and `PSL_ENUM_DUPLICATE_MEMBER_VALUE` from PSL. Such an enum's members, and a column typed by it, are typed as the codec's type, such as `string` for `pg/numeric@1`, because a read can return a member in another form. This holds both in the emitted `contract.d.ts` and in the types `defineContract` infers. A `mongo/decimal128@1` enum is refused when the contract is built, because a collection validator cannot list BSON decimals, so for it only the types changed.
    detection:
      glob: "**/*.{prisma,ts,tsx,mts,cts}"
      matches:
        - '@@type\(\s*"(?:pg/(?:numeric|interval)|mongo/decimal128)@1"\s*\)'
        - '(?<![\s\S])(?![\s\S]*GENERATED FILE - DO NOT EDIT)(?=[\s\S]*\benumType\()[\s\S]*?(?:[''"`](?:pg/(?:numeric|interval)|mongo/decimal128)@1[''"`]|\b(?:numericColumn|intervalColumn)\()'
  - id: enum-columns-typed-by-member-literals
    summary: |
      A column typed by an enum whose codec is `pg/uuid@1`, `pg/inet@1`, `pg/bit@1`, `pg/varbit@1`, `pg/date-string@1`, `pg/time-string@1`, `sql/char@1`, `sql/varchar@1`, `sql/text@1`, `sql/int@1` or `sql/float@1` on Postgres, or `sqlite/text@1`, `sqlite/integer@1`, `sqlite/real@1`, `sqlite/bigint@1`, `sqlite/json@1`, `sql/char@1`, `sql/varchar@1`, `sql/int@1` or `sql/float@1` on SQLite, is now typed in the emitted `contract.d.ts` as the union of its members' values, as a `pg/text@1` or `pg/int4@1` enum column already was, instead of the codec's whole type. Re-emit the contract. Code that writes a value that is not a member to such a column, or compares a value read from it with one, no longer typechecks; use a member, such as `db.enums.public.Host.members.Loopback`.
  - id: db-schema-json-names-type-text
    summary: |
      `prisma db schema --json` names each column's type field `typeText` instead of `nativeType`, holding the type as introspection reads it from the database (`integer`, `timestamp(3) with time zone`), and no longer has `resolvedNativeType`. The tree output of `prisma db schema` shows the same text, such as `integer` where it showed `int4`.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs,sh,json}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\bdb schema\b)[\s\S]*\bnativeType\b'
  - id: default-invalid-meta-type-text
    summary: |
      `CONTRACT.DEFAULT_INVALID`, raised when an `autoincrement()` default sits on a Postgres column whose type is not a `SERIAL` type, carries the column's type in `meta.typeText` instead of `meta.nativeType`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\bDEFAULT_INVALID\b)[\s\S]*\bnativeType\b'
  - id: client-takes-contract-value
    summary: |
      Every client and static entry takes the contract only as a value, `{ contract }`. The `contractJson` option is removed, so `postgres<Contract>({ contractJson, url })` no longer compiles, and the client infers its contract type from the value, so the call needs no type argument. Turn the emitted JSON into a typed value once with `contractFromJson<Contract>(contractJson)` from the facade's `/static` entry (`@prisma/orm-postgres/static`, `@prisma/orm-sqlite/static`, `@prisma/orm-mongo/static`; Supabase uses the Postgres one), export it from the module that creates the client, and pass `{ contract }`. This applies to `postgres()`, `postgresServerless()`, `sqlite()`, `supabase()`, `mongo()`, `postgresStatic()`, `sqliteStatic()`, `mongoStatic()` and `mongoQuery()`. A `migration.ts` that builds a client from `contractJson`, for example for a data transform, fails to load until it is moved too, so move it before you run it again. The colocated script moves source files; move test files by hand.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\w$.])(?:postgres|postgresServerless|sqlite|supabase|mongo|postgresStatic|sqliteStatic|mongoStatic|mongoQuery)(?:<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>)?\(\s*\{(?:(?:[^{}]|\{[^{}]*\})*?,)?\s*contractJson\s*[,}:]'
        - '(?<![\s\S])(?:(?!import\s+[\w$]+\s*(?:,\s*\{[^{}]*\}\s*)?from\s*[''"]@prisma/orm-(?:(?:postgres|sqlite|mongo)/(?:runtime|serverless|static|query-builder)|extension-supabase/runtime)[''"])[\s\S])*import\s+([\w$]+)\s*(?:,\s*\{[^{}]*\}\s*)?from\s*[''"]@prisma/orm-(?:(?:postgres|sqlite|mongo)/(?:runtime|serverless|static|query-builder)|extension-supabase/runtime)[''"][\s\S]*(?<![\w$.])\1(?:<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>)?\(\s*\{(?:(?:[^{}]|\{[^{}]*\})*?,)?\s*contractJson\s*[,}:]'
        - '(?<![\s\S])(?:(?!import\s*(?:[\w$]+\s*,\s*)?\{[^{}]*\b(?:default|supabase|mongoQuery|postgresStatic|sqliteStatic|mongoStatic)\s+as\s+[\w$]+[^{}]*\}\s*from\s*[''"]@prisma/orm-(?:(?:postgres|sqlite|mongo)/(?:runtime|serverless|static|query-builder)|extension-supabase/runtime)[''"])[\s\S])*import\s*(?:[\w$]+\s*,\s*)?\{[^{}]*\b(?:default|supabase|mongoQuery|postgresStatic|sqliteStatic|mongoStatic)\s+as\s+([\w$]+)[^{}]*\}\s*from\s*[''"]@prisma/orm-(?:(?:postgres|sqlite|mongo)/(?:runtime|serverless|static|query-builder)|extension-supabase/runtime)[''"][\s\S]*(?<![\w$.])\1(?:<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>)?\(\s*\{(?:(?:[^{}]|\{[^{}]*\})*?,)?\s*contractJson\s*[,}:]'
    script: ./scripts/client-takes-contract-value/contract-from-json.ts
  - id: collections-on-the-client
    summary: |
      Not a breaking change. Every SQL client takes your custom collection classes as an option, `collections`, and uses them on `db.orm`, on the ORM of every transaction (`tx.orm`), on every connection a serverless client opens, and on every Supabase role-bound client: `postgres({ contract, url, collections: { Post: PostCollection } })`, then `db.orm.public.Post.published()`. Code that builds its own ORM client with `orm({ runtime, context, collections })` to reach its classes still works; replace it with the option and use the client's ORM. The detection matches a call to `orm({ ... })`, or to `orm` imported under another name, that passes `collections`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\w$.])orm\s*(?:<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>)?\(\s*\{(?:(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*?,)?\s*collections\s*[,}:]'
        - '(?<![\s\S])(?:(?!import\s*\{[^{}]*\borm\s+as\s+[\w$]+[^{}]*\}\s*from\s*[''\"][^''\"]+[''\"])[\s\S])*import\s*\{[^{}]*\borm\s+as\s+([\w$]+)[^{}]*\}\s*from\s*[''\"][^''\"]+[''\"][\s\S]*(?<![\w$.])\1\s*(?:<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>)?\(\s*\{(?:(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*?,)?\s*collections\s*[,}:]'
  - id: client-query-and-to-sql
    summary: |
      Additive for code that only uses these types. Every SQL client gets `query(plan)` and `execute(plan)`, with the types a transaction's have, and `toSql(plan)`, which returns `{ sql, params }` with no database. A serverless connection gets `query` and `execute` too; the serverless client, `postgresStatic()`, `sqliteStatic()` and every transaction get `toSql`. `postgres()`, `postgresServerless()`, `sqlite()` and `supabase()` take `mode: 'strict' | 'permissive'`. `supabase()` creates its pool on the first query instead of when it is called. Application code can move from `db.runtime().query(plan)` to `db.query(plan)`; code that builds its own object of one of the changed types, such as a test double, must add the new members. The detection matches a file that imports one of the changed types from a Prisma package, calls `runtime().query(` or `runtime().execute(`, or reads the renamed error details or the old message texts.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - 'import\s*(?:type\s*)?(?:[\w$]+\s*,\s*)?\{[^}]*(?<![\w$])(?:PostgresClient|PostgresServerlessClient|PostgresServerlessConnection|PostgresStaticContext|PostgresStaticMembers|SqliteClient|SqliteStaticContext|RoleBoundDb|ServiceRoleDb|SupabaseInternalDb|PostgresTransactionContext|SqliteTransactionContext)(?![\w$])[^}]*\}\s*from\s*[''"]@prisma/orm-'
        - '\.runtime\(\)\s*\.(?:query|execute)\('
        - '(?<![\w$])(?:runtimeTarget|runtimeStorageHash)\s*:|\.(?:runtimeTarget|runtimeStorageHash)\b|[''"](?:runtimeTarget|runtimeStorageHash)[''"]'
        - 'Ad-hoc execute received a bind-site slot|Plan target does not match runtime target|Plan storage hash does not match runtime contract'
  - id: orm-collection-member-using-reserved
    summary: |
      Every ORM collection has a `using` member, which holds the collection methods packages contribute for the model, such as `db.orm.public.Post.using.post_search(q)` for a Postgres full-text index. A custom collection class that declares its own member named `using` no longer compiles; rename that member. The detection matches a file that extends `Collection` and declares a class member named `using`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\bextends\s+Collection\b)[\s\S]*[\n{;][ \t]*(?:(?:public|private|protected|override|readonly|async|declare|static|accessor)[ \t]+)*(?:(?:(?:get|set)[ \t]+)?using[ \t]*[?!]?[ \t]*[(<]|using[ \t]*[?!]?[ \t]*=(?![=>])|using[ \t]*[?!]?[ \t]*:[^\n]*[^,\s][ \t]*(?:\n|$))'
  - id: orm-annotations-on-the-call
    summary: |
      Every SQL ORM terminal method runs as one `orm-call` activity, and the annotations a `configure` callback records live on that activity. The statements the call sends carry none, so a middleware that reads an ORM annotation from a statement plan (`handle.read(plan)` or `plan.meta.annotations`) in `beforeEncode`, `intercept.onQuery`, `onRow` or `activityStarted` of a statement finds nothing. Read it from the call instead: in `activityStarted(activity)`, `if (activity.kind === 'orm-call') handle.read(activity)`. The detection matches a file with a middleware hook, not a MongoDB one, that reads an annotation from something other than the activity, or reads `meta.annotations`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?![\s\S]*(?:familyId:\s*[''"]mongo[''"]|\bMongoMiddleware\b))(?=[\s\S]*\b(?:beforeEncode|beforeCompile|onQuery|onExecute|onRow|activityStarted)\b)[\s\S]*\.read\(\s*(?!activity\b)[\w$]+(?:\.[\w$]+)*\s*\)'
        - '(?<![\s\S])(?![\s\S]*(?:familyId:\s*[''"]mongo[''"]|\bMongoMiddleware\b))(?=[\s\S]*\b(?:beforeEncode|beforeCompile|onQuery|onExecute|onRow|activityStarted)\b)[\s\S]*\bmeta\.annotations\b'
  - id: cached-orm-reads-key-on-the-call
    summary: |
      The cache middleware caches an annotated ORM read as a whole: a hit sends no statement. Without a `key`, the read is keyed by the call's content hash, and the `deriveKey` option applies only to annotated SQL builder queries. Where a `deriveKey` added a prefix (for example a tenant) to ORM reads, pass that prefix in `cacheAnnotation({ key })` on those reads. If your `deriveKey` separates tenants or users, ORM reads are no longer separated: until each annotated ORM read has a tenant-prefixed `key`, one tenant's cached ORM read can be served to another. Statement middleware such as a slow-query log sees no statement for a cache hit of an ORM read.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bderiveKey\b(?!FromContentHash)'
  - id: cache-store-holds-cached-values
    summary: |
      A cache store holds `CachedValue`, `{ kind: 'statement-rows', rows } | { kind: 'call-result', result }`, not `CachedRows`. Type a custom store as `CacheStore<TMeta, CachedValue>` (or `CacheStore<TMeta>`), and make `get` give back a value equivalent to the one `set` was given, `kind` included. An ORM call's result holds decoded values such as `Date`, `bigint`, Temporal values and extension class instances, so a store that serializes needs a serializer that rebuilds them; `JSON.stringify` throws on a `bigint` and turns a `Date` into a string. `createInMemoryCacheStore` takes only the meta type now and always holds `CachedValue`: drop its second type argument. The detection matches a file that names `CachedRows`, or imports from the cache package and names `CacheStore` or `CacheEntry` but not `CachedValue`, or passes `createInMemoryCacheStore` a second type argument.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bCachedRows\b'
        - 'createInMemoryCacheStore<[^>(]*,'
        - '(?<![\s\S])(?![\s\S]*\bCachedValue\b)(?=[\s\S]*[''"](?:@prisma/orm-extension-middleware-cache|@internal/middleware-cache)[''"])[\s\S]*(?<![\w$])(?:CacheStore|CacheEntry)(?![\w$])'
  - id: orm-needs-a-runtime-queryable
    summary: |
      Pass `orm()` a runtime, connection or transaction from the SQL runtime itself, or `db.runtime()`. A hand-built object that copies only `query` and `execute` (for example `orm({ context, runtime: { query(plan) { return runtime.query(plan); }, execute(plan) { return runtime.execute(plan); } } })`) has no activity source, so every terminal method on it now fails with `ORM.ACTIVITY_SOURCE_MISSING`: `all()` and the other streaming terminals throw when called, and the others reject. If you need the wrapper, keep the original's `[activitySource]` member on it; the symbol `activitySource` is exported from `@prisma/orm-postgres/family-runtime` (`@prisma/orm-sqlite/family-runtime` on SQLite).
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'runtime:\s*\{[^}]*?\b(?:query|execute)\s*[(:]'
  - id: close-lets-open-orm-calls-finish
    summary: |
      On a client that closes at once (`postgres({ contract, url })`, `sqlite()`, `supabase()`), an ORM call that resolves to one value, such as `first()`, `create()`, `include(...).create()` or a nested create, starts when it is called, and `close()` waits for it, so one left pending at `close()` now completes instead of rejecting: a `create()` used to reject with "Runtime is closed", and `include(...).create()` and a nested create with "Postgres client is closed". A streaming read such as `all()` starts when it is read; read after `close()`, it rejects with "Postgres client is closed" instead of "Runtime is closed". Update code or tests that expect the old outcome.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'Runtime is closed|Postgres client is closed'
  - id: typescript-contract-include-row-types
    summary: |
      A contract built with `defineContract` from TypeScript now types each relation with its target model, namespace and cardinality, as an emitted `contract.d.ts` does. Rows from `include(...)`, which were typed `unknown` and always as an array, now have the target model's field types: a has-many or many-to-many relation is an array, a belongs-to relation is one row (or `null` when optional), and a has-one relation is one row or `null`. A cast on an included value that disagrees with this type now fails to typecheck. The detection matches a file that imports `defineContract` from a SQL contract builder; the change matters only where code queries through the contract it builds without an emitted `contract.d.ts`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bimport\s*\{[^}]*\bdefineContract\b[^}]*\}\s*from\s*[''"]@prisma/orm-(?:postgres|sqlite|family-sql/contract-ts)/contract-builder[''"]'
  - id: typescript-contract-aggregates-and-operations
    summary: |
      A contract built with `defineContract` now carries the aggregate types and query operation types of its target, adapter and extensions, and the capabilities of its adapter, in its type and in its value. `count`, `sum`, `max` and the other aggregates, inside `aggregate(...)` and inside include refinements, are typed; field operations such as `ilike` and capability-gated methods such as `distinctOn` and `forUpdate` are available in the types; `contract.capabilities.postgres.distinctOn` is `true` at run time. Casts that dispatched aggregates by name can be removed. The detection matches casts of the aggregate builder to a record of functions.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'as\s+Record<string,\s*\(field\?:\s*string\)'
        - 'AggregateSpec\[string\]'
  - id: typescript-contract-parameterized-output-types
    summary: |
      A contract built with `defineContract` now types a column with type parameters as an emitted `contract.d.ts` does: `varchar(50)` reads as `Varchar<50>`, `numeric(10, 2)` as `Numeric<10, 2>`, `char(36)` as `Char<36>`, and the same for `bit`, `varbit`, `timetz`, `interval`, the string time and timestamp codecs, and pgvector's `Vector<N>`. The field presets read as the column they create: `field.id.uuidv4String()`, `field.id.uuidv7String()` and `field.uuidString()` as `Char<36>`, `field.ulid()` as `Char<26>`, `field.nanoid()` as `Char<21>` or the given size, `field.cuid2()` as `Char<24>`, `field.ksuid()` as `Char<27>`; so does a field written as `field.generated(uuidv4())` or with another id generator. These types are branded strings, so reading them as `string` still works, and filters and writes take plain strings (see `orm-filters-and-writes-take-input-types`). A type assertion or annotation that expects plain `string` for such a field when reading it must change. The detection matches the presets, column helpers and generators that carry type parameters.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bfield\.(id\.)?(uuidv4String|uuidv7String|uuidString|ulid|nanoid|cuid2|ksuid)\('
        - '\bfield\.temporal\.(timestampString|timestamptzString)\(\s*\d'
        - '\b(charColumn|varcharColumn|numericColumn|bitColumn|varbitColumn|timetzColumn|intervalColumn|timeStringColumn)\(\s*\d'
        - '\btype\.(?:sql\.String|pgvector\.Vector)\(\s*\d'
        - '(?<![\s\S])(?=[\s\S]*\bimport\s*(?:type\s*)?\{[^}]*\bvector\b[^}]*\}\s*from\s*[''"]@prisma/orm-extension-pgvector/column-types[''"])[\s\S]*(?<![\w$.''"`])vector\(\s*\d'
        - '\bfield\.generated\('
  - id: orm-filters-and-writes-take-input-types
    summary: |
      ORM filters and writes take each field's input type instead of its read type, for emitted contracts and for contracts built with `defineContract`: the `where` shorthand, field predicates (`eq`, `in`, `gt` and the rest), `whereUnique`, `create`, `createAll`, `update`, `updateAll`, `upsert` and nested writes. A field read as `Char<36>`, `Varchar<255>` or `Numeric<10, 2>` now accepts a plain string in these positions, so casts such as `'abc' as Char<36>` there are no longer needed. A `CodecField` fragment checks values against the codec's input type, as the model's own fields do. The detection matches casts to the branded string types.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'as\s+(unknown\s+as\s+)?(Char|Varchar|Numeric|Bit|VarBit|Timetz|Interval|TimeString|TimestampString|TimestamptzString)<'
  - id: typescript-contract-index-references
    summary: |
      A contract built with `defineContract` now types each table's indexes as an emitted `contract.d.ts` does: the indexes `.sql({ indexes })` declares, under the `name:` or `map:` they were given or their default `<table>_<columns>_idx` name, and the backing indexes the build derives for foreign keys. In `where` and `orderBy` callbacks, `indexes.<name>` offers exactly these names, so a misspelt index name fails to typecheck instead of failing at run time, and `fns.fullTextMatches(indexes.<name>, query)` and `fns.fullTextRank(...)` now typecheck for a `fullTextIndex`. The detection matches a file that imports `defineContract` from a SQL contract builder; the change matters only where code queries through the contract it builds without an emitted `contract.d.ts`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bimport\s*\{[^}]*\bdefineContract\b[^}]*\}\s*from\s*[''"]@prisma/orm-(?:postgres|sqlite|family-sql/contract-ts)/contract-builder[''"]'
  - id: typescript-contract-storage-and-domain-types
    summary: |
      A contract built with `defineContract` now types its unique constraints with their columns, so `whereUnique` accepts only the fields of the primary key or of one unique constraint, as with an emitted contract; it no longer accepts any record. `db.enums` lists only the enums the contract declares; a contract without enums no longer offers an accessor under any name. A many-to-many relation whose target has no primary key types its junction columns from the target's unique key. The detection matches a file that imports `defineContract` from a SQL contract builder; the change matters only where code queries through the contract it builds without an emitted `contract.d.ts`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bimport\s*\{[^}]*\bdefineContract\b[^}]*\}\s*from\s*[''"]@prisma/orm-(?:postgres|sqlite|family-sql/contract-ts)/contract-builder[''"]'
  - id: typescript-contract-enums-in-domain
    summary: |
      The type of a contract built with `defineContract` carries its enums as an emitted `contract.d.ts` does: in the domain namespace's `enum` and `enumMemberTypes`, and in the storage namespace's `valueSet`. The type-only `enumAccessors` key is gone. `db.enums` reads its accessors from `enumMemberTypes` for both kinds of contract, so its types are the emitted ones: `has(value)` takes any value and narrows it to the enum's values, and `nameOf` and `ordinalOf` take the enum's values as before. An `enumType` keeps its codec id as a literal, so its fields gain their codec's query methods, such as `eq`, `ilike`, `gt` and `asc`. Code that read `enumAccessors` from the contract's type should use `NamespacedEnums<typeof contract>` from `@prisma/orm-framework/contract/enum-accessor`, or `db.enums`. The detection matches reads of `enumAccessors`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'enumAccessors'
  - id: emitted-contract-types-from-generics
    summary: |
      `prisma contract emit` now writes the field and storage column type maps of a SQL contract (`FieldOutputTypes`, `FieldInputTypes`, `StorageColumnTypes`, `StorageColumnInputTypes`) as generics applied to the contract's own shape, the ones a contract built with `defineContract` uses, with only the types a codec computes at emit time written out (`FieldTypeOverrides`, `ColumnTypeOverrides`). A column with type parameters is typed through the pack's type function (`ParameterizedOutputTypeFunctions`) instead of a named type such as `Char<24>`; it resolves to the same type. `Models` members index `FieldOutputTypes`. The types do not change; re-emit to update the committed `contract.d.ts`. The extension metadata in `contract.json` changes too: a pack's codec types name their `parameterizedOutputTypes` instead of `typeImports` such as `Vector`. Migration snapshots keep the form they were written in and need no change. The detection matches a SQL `contract.d.ts` emitted before this change; Mongo contracts never have `StorageColumnTypes`. It also matches the `contract.d.ts` of each migration snapshot (`migrations/snapshots/<hash>/`); leave those as they are.
    detection:
      glob: "**/contract.d.ts"
      matches:
        - 'export type StorageColumnTypes = \{'
  - id: emitted-field-types-from-shared-generic
    summary: |
      `prisma contract emit` now writes `FieldOutputTypes` and `FieldInputTypes` of every contract, Mongo and SQL, as `FieldTypesFromDomain` from the contract types entry (`@prisma/orm-mongo/contract/types`, `@prisma/orm-postgres/contract/types`, `@prisma/orm-sqlite/contract/types`) applied to the contract's own shape, and each `<Name>Output` and `<Name>Input` value object type as an entry of `ValueObjectTypesFromDomain`. A Mongo vector field with a length is typed through the target's type function instead of the written-out `Vector<N>`. The types do not change; re-emit every `contract.d.ts`. A SQL `contract.d.ts` written by a development build after 8.0.0-rc.18 imports `FieldTypesFromDomain` from the family contract types entry, which no longer exports it, so it does not compile until it is re-emitted. The detection matches a `contract.d.ts` that writes its field types out, as one emitted by 8.0.0-rc.18 does, and a SQL one that imports the generic from the family entry. It also matches the `contract.d.ts` of each migration snapshot (`migrations/snapshots/<hash>/`), which no command emits again; leave those as they are.
    detection:
      glob: "**/contract.d.ts"
      matches:
        - 'export type FieldOutputTypes = \{'
        - 'FieldTypesFromDomain,\s+RelationKeys,'
  - id: value-object-enum-fields-narrow
    summary: |
      An enum field inside a value object (a composite type in PSL) now reads and writes the members of its enum, in an emitted `contract.d.ts` and in a contract built with `defineContract`, as an enum field of a model does. Before, the emitted contract typed it as its codec's type, such as `string`. A value object field whose codec renders its own type text, such as `arktype/json@1`, has that type, as before this change. Code that assigns an arbitrary string to such a field now fails to typecheck. Re-emit `contract.d.ts`. The detection matches PSL sources that declare both an enum and a composite type, so check whether a field of the composite type has the enum's type (an enum in another file of a multi-file schema is not found), and TypeScript value objects whose fields include an enum field, also in the factory form of `defineContract` with renamed helpers.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=(?:[\s\S]*\n)?enum[ \t]+\w+\s*\{)(?:[\s\S]*\n)?[ \t]*type[ \t]+\w+\s*\{'
        - '(?:\bvalueObject|\bvalueObject\s*:\s*(\w+)[\s\S]*?\b\1)\(\s*[''"][^''"]+[''"]\s*,\s*\{\s*fields:\s*\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\.namedType\('
  - id: mongo-contracts-record-stored-field-names
    summary: |
      A MongoDB contract keys each model's fields by their names in the schema and records the key each is stored under in `model.storage.fields`, as a SQL contract records each field's column. `id ObjectId @id @map("_id")` is the field `id`, stored as `_id`; it used to be the field `_id`. A contract without `storage.fields` is rejected with `CONTRACT.VALIDATION_FAILED`. Run `prisma contract emit`, then run the colocated script, which rewrites the contract snapshots under `migrations/snapshots/` and any other MongoDB contract in the old form. Storage hashes do not change, so no migration is needed and database markers stay valid.
    detection:
      glob: "**/*.json"
      matches:
        - '"storage"\s*:\s*\{\s*(?:"collection"\s*:\s*"[^"]*"\s*)?\}'
        - '"storage"\s*:\s*\{\s*"collection"\s*:\s*"[^"]*"\s*,\s*"relations"'
    script: ./scripts/mongo-field-storage-names/mongo-field-storage-names.ts
  - id: mongo-orm-uses-field-names
    summary: |
      The MongoDB ORM names every field by its name in the schema: a field declared `id ObjectId @id @map("_id")` is `user.id` in rows and `where({ id })`, `select('id')`, `orderBy({ id: 1 })` and create, update and upsert data, where it was `_id`. Passing a stored name such as `_id` fails with `ORM.FIELD_UNKNOWN`, and a row no longer carries a key that no field stores. The pipeline builder (`db.query`) works on documents and keeps naming stored names (`_id`). This applies only to a project with a MongoDB contract; skip it otherwise. The detection matches code that reads or names `_id`, outside generated `contract.d.ts` files, contract sources and `migration.ts`; a match in pipeline code needs no change. It cannot find other fields with `@map`; the type checker finds them after you re-emit.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\s\S])(?![\s\S]*(?:GENERATED FILE - DO NOT EDIT|\bdefineContract\b|\bextends\s+Migration\b))[\s\S]*\._id\b'
        - '(?<![\s\S])(?![\s\S]*(?:GENERATED FILE - DO NOT EDIT|\bdefineContract\b|\bextends\s+Migration\b))[\s\S]*(?<![\w$])_id\s*[:,}]'
        - '(?<![\s\S])(?![\s\S]*(?:GENERATED FILE - DO NOT EDIT|\bdefineContract\b|\bextends\s+Migration\b))[\s\S]*\.(?:select|orderBy|include|where|distinct)\([^)]*[''"]_id[''"]'
        - '(?<![\s\S])(?![\s\S]*(?:GENERATED FILE - DO NOT EDIT|\bdefineContract\b|\bextends\s+Migration\b))[\s\S]*\b(?:Omit|Pick)<[^>]*[''"]_id[''"]'
  - id: mongo-statements-name-fields
    summary: |
      A MongoDB `--rename` or `--delete` statement names a field by its name in the schema, as on SQL: `id @map("_id")` is `User.id`, where it was `User._id`. A rename that keeps the stored name, such as `--rename User.name:User.title` with both stored as `display_name`, plans nothing; a field whose `@map` changes while its name stays is asked about as a removal, as a column is on SQL; to keep its values, write `renameField(...)` into the planned `migration.ts`.
    detection:
      glob: "**/*.{sh,json,yml,yaml,ts,mts,cts,js,mjs,cjs,md}"
      matches:
        - '--(?:rename|delete)[ =][^\s]*\._id\b'
  - id: mongo-composite-field-map-refused
    summary: |
      MongoDB PSL refuses `@map` on a field of a composite type (`type Address { street String @map("st") }`) with `PSL_MONGO_TYPE_FIELD_MAP_UNSUPPORTED`. It used to be ignored silently, so the field was stored under its own name all along: remove `@map`, or rename the field to the name it is stored under.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\w$])type\s+\w+\s*\{[^}]*@map\('
  - id: mongo-typescript-stored-field-names
    summary: |
      The MongoDB TypeScript builder names a field's stored name with `.mongo({ field })`, as the SQL builder names a column with `.sql({ column })`: `id: field.objectId().mongo({ field: '_id' })`. Relations, the discriminator and indexes name fields; the builder writes stored names into indexes, validators and execution defaults. A field without it is stored under its own name, so `_id: field.objectId()` keeps working unchanged. Two fields stored under one name fail with `CONTRACT.NAME_DUPLICATE`, and `.mongo({ field })` on a field of a value object fails with `CONTRACT.ARGUMENT_INVALID`.
  - id: mongo-define-contract-readonly-rows
    summary: |
      A Mongo contract built with `defineContract` now types its fields with the same generic as an emitted `contract.d.ts`. Lists read and write as `readonly T[]` instead of `T[]`, value object fields are `readonly`, and a vector field with a `length` type parameter reads as `Vector<N>` instead of `readonly number[]`. `field.vector()` without type parameters no longer types the field's `typeParams` as `Record<string, unknown>`; its contract type has no `typeParams`, as the built value has none. A type annotation that expects a mutable array or mutable value object from a row must change to the readonly form, or copy the value first. The detection matches Mongo `defineContract` sources with lists, value objects or vectors.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*orm-(?:mongo|family-mongo/contract-ts)/contract-builder)[\s\S]*(\.many\(|\.valueObject\(|\.vector\()'
  - id: mongo-define-contract-factory-field-types
    summary: |
      `defineContract(scaffold, factory)` from `@prisma/orm-mongo/contract-builder` typed every codec, and so every field, row and create input, as `never`, because the scaffold's forbidden `family` and `target` keys made the whole definition type `never`. The contract type now leaves them out, so fields have their codec types. Code that compiled only because a field was `never`, such as assigning a row field to an unrelated type, now fails to typecheck. The detection matches the factory form of the Mongo `defineContract`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*orm-(?:mongo|family-mongo/contract-ts)/contract-builder)[\s\S]*defineContract\(\s*(?:\w+|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})\s*,\s*(?:\(|function\b|\w+\s*=>)'
  - id: mongo-update-accessors-take-input-types
    summary: |
      In Mongo ORM updates, the field accessor's `set`, `push`, `pull` and `addToSet` take each field's input type from the contract, including fields reached by a dot path into a value object. `u.role.set(...)` on an enum field takes only its members, a list field takes a readonly list, and a vector field takes `readonly number[]`, which a `Vector<N>` satisfies. Code that passed a value outside an enum now fails to typecheck. A list of numbers no longer offers `inc` and `mul`, which only a single number takes. The detection matches update callbacks, `(u) => [...]`, that call one of these methods on a field of their argument, by name or by a dot path such as `u('home.kind')`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:\(\s*)?(?<![\w$])(\w+)\s*\)?\s*=>\s*\[[^\]]*?\b\1(?:\.\w+|\(\s*[''"][^''"]+[''"]\s*\))+\.(?:set|push|pull|addToSet|inc|mul)\('
  - id: mongo-typescript-contract-validator
    summary: |
      A MongoDB contract written in TypeScript with `defineContract` now gets the same closed collection validator as a PSL contract, and its storage hash changes once. `defineContract` refuses what a validator cannot describe: a field whose codec has no MongoDB data type, a model whose `_id` field can hold an array, a regular expression, undefined or null, an enum a validator cannot list, and an embed relation to a model with variants. MongoDB does not check existing documents when a validator is added, so find and fix the documents the validator would refuse, then apply it with `prisma db update`, or with `prisma migration plan` and `prisma db migrate`. Writing an enum in a TypeScript contract to avoid the validator, as the rc.17 notes advised, no longer works.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '@prisma/orm-(?:mongo/contract-builder|family-mongo/contract-ts/contract-builder)'
  - id: mongo-shared-collection-validator
    summary: |
      A MongoDB collection that stores several models that are not variants of one base, such as two PSL models with the same `@@map`, now gets a validator that accepts a document of any of them. Before, the validator described only the last model and refused the other models' documents. Re-emit the contract and apply the new validator with `prisma db update`, or with `prisma migration plan` and `prisma db migrate`.
  - id: mongo-recursive-value-objects-emit
    summary: |
      A PSL MongoDB contract with a composite type that contains itself, such as a navigation item with a list of child items, now emits. Before, `prisma contract emit` failed with `Maximum call stack size exceeded`. The collection validator checks the type in full down to where it repeats, and accepts any object there.
  - id: control-client-apply-takes-invocation
    summary: |
      `dbInit`, `dbUpdate` and `migrate` on a control client take a required `invocation` option: `{ cwd, configPath, dbGiven }`, where the commands an error's advice prints are run from, the `--config` they repeat, and whether they repeat `--db`. Pass `{ cwd: process.cwd(), configPath: undefined, dbGiven: false }` when nothing is run from a terminal. Their failures are now `CliStructuredError`s, so `DbInitFailure`, `DbUpdateFailure` and `MigrateFailure` are gone from `control-api`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\.(?:dbInit|dbUpdate|migrate)\(\s*\{'
        - '\b(?:DbInitFailure|DbUpdateFailure|MigrateFailure)(?:Code)?\b'
  - id: runner-failures-report-own-codes
    summary: |
      A failed migration apply reports the runner's own code, such as `MIGRATION.SCHEMA_VERIFY_FAILED`, `MIGRATION.PRECHECK_FAILED`, `MIGRATION.POSTCHECK_FAILED` or `MIGRATION.EXECUTION_FAILED`, instead of `MIGRATION.RUNNER_FAILED` with `meta.runnerErrorCode`. `MIGRATION.RUNNER_FAILED` no longer exists. The facts move into typed `meta` keys: a failed schema check lists its issues in `meta.schemaIssues` (was `meta.issues`), and a failed check is `meta.failedCheck` (`operationId`, `phase`, `description`; was `operationId`, `phase`, `stepDescription`).
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs,sh}"
      matches:
        - 'MIGRATION\.RUNNER_FAILED|\brunnerErrorCode\b'
  - id: setdefault-operation-class-derived
    summary: |
      On PostgreSQL, `this.setDefault` in `migration.ts` no longer takes `operationClass`. The operation is widening when the migration's start contract gives the column a default, and additive otherwise. `migration plan` no longer writes `operationClass` into the call. A `migration.ts` that passes it no longer type-checks; delete the option.
    detection:
      glob: "**/migration.ts"
      matches:
        - '\bsetDefault\(\{(?:(?!\bthis\.|\brawSql\s*\()[\s\S])*?\boperationClass\s*:'
  - id: setdefault-has-no-postcheck
    summary: |
      On PostgreSQL, a `setDefault` operation no longer checks afterwards that the column has a default, so the runner no longer skips it when the column already has a different default. A package planned by 8.0.0-rc.15 or a later release before this one whose `migration.ts` has a hand-written `setDefault` that changes an existing default still carries the old check in `ops.json`; write its `ops.json` again before you apply it.
    detection:
      glob: "**/ops.json"
      matches:
        - 'verify column \\"(?:[^"\\]|\\.)*?\\" has a default'
  - id: postgres-postcheck-create-table
    summary: |
      On PostgreSQL, the check that runs after `createTable` checks that the relation is a table, not a view, sequence or index of the same name. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "create table \\"(?:[^"\\]|\\.)*?\\""(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify table \\"(?:[^"\\]|\\.)*?\\" exists",\s*"sql": "SELECT \(?to_regclass\('
  - id: postgres-postcheck-add-column
    summary: |
      On PostgreSQL, the check that runs after `addColumn` checks the column's type, and that it is NOT NULL when the column is declared NOT NULL. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "verify column \\"(?:[^"\\]|\\.)*?\\" exists",[^{}]*\}\s*\]'
  - id: postgres-postcheck-add-column-with-temporary-default
    summary: |
      On PostgreSQL, the check that runs after `addColumnWithTemporaryDefault` checks the column's type. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - 'has no default after temporary default removal",[^{}]*\}\s*\]'
  - id: postgres-postcheck-add-required-column-to-empty-table
    summary: |
      On PostgreSQL, the check that runs after `addRequiredColumnToEmptyTable` checks the column's type. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "verify column \\"(?:[^"\\]|\\.)*?\\" exists",[^{}]*\},\s*\{\s*"description": "verify column \\"(?:[^"\\]|\\.)*?\\" is NOT NULL",[^{}]*\}\s*\]'
  - id: postgres-postcheck-create-index
    summary: |
      On PostgreSQL, the check that runs after `createIndex` checks that the relation is an index on the planned table, with the planned uniqueness, access method and columns in order, and with an expression and a predicate only where the call has them. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "create index \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify index \\"(?:[^"\\]|\\.)*?\\" exists",'
  - id: postgres-postcheck-rename-index
    summary: |
      On PostgreSQL, the check that runs after `renameIndex` also checks that no index has the old name any more. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "rename index \\"(?:[^"\\]|\\.)*?\\" to \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify index \\"(?:[^"\\]|\\.)*?\\" exists",[^{}]*\}\s*\]'
  - id: postgres-postcheck-add-primary-key
    summary: |
      On PostgreSQL, the check that runs after `addPrimaryKey` checks that the constraint is a primary key on the planned columns in order. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "verify primary key \\"(?:[^"\\]|\\.)*?\\" exists"'
  - id: postgres-postcheck-add-unique
    summary: |
      On PostgreSQL, the check that runs after `addUnique` checks that the constraint is a unique constraint on the planned columns in order. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "add unique constraint \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify constraint \\"(?:[^"\\]|\\.)*?\\" exists",'
  - id: postgres-postcheck-add-foreign-key
    summary: |
      On PostgreSQL, the check that runs after `addForeignKey` checks the constraint's columns, referenced table and columns in order, and its delete and update actions. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "verify FK \\"(?:[^"\\]|\\.)*?\\" exists"'
  - id: postgres-postcheck-add-check-constraint
    summary: |
      On PostgreSQL, the check that runs after `addCheckConstraint` checks that the constraint is a check constraint. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "add check constraint \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify constraint \\"(?:[^"\\]|\\.)*?\\" exists",'
  - id: postgres-postcheck-rename-constraint
    summary: |
      On PostgreSQL, the check that runs after `renameConstraint` also checks that no constraint has the old name any more. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "rename (?:primary key|unique constraint|foreign key|check constraint) \\"(?:[^"\\]|\\.)*?\\" to \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify constraint \\"(?:[^"\\]|\\.)*?\\" exists",[^{}]*\}\s*\]'
  - id: postgres-postcheck-create-rls-policy
    summary: |
      On PostgreSQL, the check that runs after `createRlsPolicy` checks the policy's command, roles and whether it is permissive. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "create RLS policy \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify RLS policy \\"(?:[^"\\]|\\.)*?\\" exists",'
  - id: postgres-postcheck-rename-rls-policy
    summary: |
      On PostgreSQL, the check that runs after `renameRlsPolicy` also checks that no policy has the old name any more; its precheck now also refuses a policy that already has the new name. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "rename RLS policy \\"(?:[^"\\]|\\.)*?\\" to \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify RLS policy \\"(?:[^"\\]|\\.)*?\\" exists",[^{}]*\}\s*\]'
  - id: postgres-postcheck-autoincrement-default
    summary: |
      On PostgreSQL, the check that runs after `setDefault` with `autoincrement()` also checks that the column owns the sequence of the planned name and that the sequence has the column's integer width. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - 'takes its default from an attached sequence",[^{}]*\}\s*\]'
  - id: postgres-autoincrement-sequence-follows-column-type
    summary: |
      On PostgreSQL, changing the integer type of an `autoincrement()` column now also changes the sequence the column owns to the new width, and checks both afterwards. Before, a column widened from `int4` to `int8` kept an `integer` sequence, which stops at 2147483647. An `ops.json` written before this change has an `alterColumnType` without the sequence step, and an `alter type of "<column>"` step that does not name the new type; run `migration.ts` again for each migration that is not applied yet. For a database where such a migration is already applied, run `ALTER SEQUENCE … AS bigint` on the sequence `pg_get_serial_sequence` names yourself.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "alter type of \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify column \\"(?:[^"\\]|\\.)*?\\" has type \\"(?:smallint|integer|bigint)\\""'
  - id: postgres-alter-column-type-unchanged-refused
    summary: |
      On PostgreSQL, `this.alterColumnType` with `using` now refuses, with `MIGRATION.ALTER_COLUMN_TYPE_USING_WITHOUT_TYPE_CHANGE`, a column the start contract, after the earlier renames in the migration, already gives the new type. Its check compares only the type, so the runner skipped the conversion. Write the conversion as a `dataTransform`.
    detection:
      glob: "**/migration.ts"
      matches:
        - '\balterColumnType\(\{(?:(?!\bthis\.)[\s\S])*?\busing\s*:'
  - id: sqlite-postchecks-check-full-definition
    summary: |
      On SQLite, the checks that let the runner skip an operation whose effect is already in place now check the whole definition. `createTable` checks every column's name, type, nullability and primary key position; `addColumn` checks the column's type and nullability; `createIndex` checks the index's table, ordered columns and uniqueness; `recreateTable` checks foreign key actions and `autoincrement()`. An `ops.json` written by an earlier release still carries the old checks; write it again before you apply it.
    detection:
      glob: "**/ops.json"
      matches:
        - '(?<![\s\S])(?![\s\S]*has exactly its columns)[\s\S]*"description":\s*"verify table \\"(?:[^"\\]|\\.)*\\" exists",\s*"sql":\s*"(?:[^"\\]|\\.)*sqlite_master'
        - '(?<![\s\S])(?![\s\S]*\\" has type )[\s\S]*"description":\s*"verify column \\"(?:[^"\\]|\\.)*\\" exists",\s*"sql":\s*"(?:[^"\\]|\\.)*pragma_table_info'
        - '(?<![\s\S])(?![\s\S]*\\" covers \()[\s\S]*"description":\s*"verify index \\"(?:[^"\\]|\\.)*\\" exists",\s*"sql":\s*"(?:[^"\\]|\\.)*sqlite_master'
        - 'pragma_foreign_key_list\(''(?:[^''\\]|\\.)*''\) f WHERE f\.\\"table\\" = ''(?:[^''\\]|\\.)*'' GROUP BY'
  - id: mongo-postchecks-check-full-definition
    summary: |
      On MongoDB, the checks that let the runner skip an operation whose effect is already in place now check the whole definition. `createIndex` checks every index option the planner tells indexes apart by, not only the keys and `unique: true`. `collMod` with a validator that is not only a `$jsonSchema` compares the whole validator. An `ops.json` written by an earlier release still carries the old checks; write it again before you apply it.
    detection:
      glob: "**/ops.json"
      matches:
        - '(?<![\s\S])(?![\s\S]*"field":\s*"sparse")[\s\S]*"description":\s*"index exists on '
        - '(?<![\s\S])(?![\s\S]*"field":\s*"options\.validator)[\s\S]*"description":\s*"validator applied on '
  - id: contract-artifacts-restamp
    summary: |
      An extension that writes its own package version into the contracts it emits, such as the Supabase extension, now writes 8.0.0-rc.19. Run `contract emit` once after upgrading so the emitted `contract.json` and `contract.d.ts` match the installed extension.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.18"'
---

# 8.0.0-rc.18 → 8.0.0-rc.19 — User upgrade instructions

## Order of the steps

Several changes in this release rewrite stored contracts and change storage hashes. Do the steps in this order, and skip a step that does not apply to the project:

1. Commit your work, so every script's changes can be reviewed and undone with git. Then upgrade the Prisma packages.
2. Rewrite the stored contracts, from the project root: first `scripts/remove-nocheck/remove-nocheck.ts` (`stored-contracts-drop-nocheck`), then `scripts/data-type-values/data-type-values.ts` (`sqlite-contracts-name-datetime-and-json-data-types`). Each script leaves a project it does not apply to unchanged and says so.
3. If either script changed a storage hash, run `prisma db sign` against every database. Sign a database that has not applied every migration with `--contract <the last migration it applied>`, as `stored-contracts-drop-nocheck` describes, and migrate it in step 8.
4. Change the contract source as the entries below say. `scripts/default-generators-to-on-create/rewrite-default-generators.mjs` rewrites `@default(uuid())` and the other client generators in Prisma 8 schema files (`client-functions-move-from-default-to-on-create`).
5. Run `prisma contract emit`. In a MongoDB project, then run `scripts/mongo-field-storage-names/mongo-field-storage-names.ts` (`mongo-contracts-record-stored-field-names`).
6. Change the application code and every `migration.ts`. `scripts/client-takes-contract-value/contract-from-json.ts` moves each client to a contract value (`client-takes-contract-value`); a `migration.ts` that builds a client from `contractJson` fails to load on this release until it is moved. In `migration.ts`, also delete `operationClass` from `setDefault` (`setdefault-operation-class-derived`) and rewrite an `alterColumnType` that `postgres-alter-column-type-unchanged-refused` refuses.
7. For each migration that is not applied yet, write its `ops.json` again when a postcheck entry at the end of this guide matches it: run its `migration.ts` (`node migration.ts`). Do this before any database applies the migration, or it applies with the old checks.
8. Bring each database to the new contract: sign it where an entry says the database does not change (`sign-databases-after-data-type-values`, `prisma7-lists-allow-null-elements`, `supabase-contract-lists-allow-null-elements`), and plan and apply a migration where an entry says one is needed.

The script paths are relative to the directory that holds this guide, which the commands below call `<guide>`.

## Generated checks can no longer be waived

Prisma 8 adds a check to a list column of a managed table so that its elements cannot be null, and a check to an enum-typed column so that it holds only the enum's values. `@noCheck` in PSL and `.noCheck()` in TypeScript used to skip these checks while the field kept its non-null element type. The client type then said the elements could not be null while the database accepted null. Both are removed.

Do the steps in this order: rewrite the stored contracts and sign the databases (`stored-contracts-drop-nocheck`), then change the contract source (`psl-nocheck-removed`, `ts-nocheck-method-removed`), then re-emit. Plan and apply a migration in step 8 of "Order of the steps", after each `ops.json` is written again.

### `stored-contracts-drop-nocheck`

Migration snapshots, the emitted `contract.json` and any other stored contract written by an earlier release may have a `noCheck` key on a column. This release refuses such a contract and says to re-emit it or run this script. A historical snapshot cannot be re-emitted from today's source, so run the script. Do this before any other step of this change, and commit your work first so the script's changes can be reviewed and undone with git. Run it from the project root:

```sh
node <guide>/scripts/remove-nocheck/remove-nocheck.ts
```

`<guide>` is the directory that holds this guide. Node 24 or later runs the TypeScript script directly; it needs no `tsx`. The script reads and writes files only and needs no database. It rewrites every `*.json` file under the root that is a SQL contract, whatever its name, skipping `node_modules`, `dist`, `build` and every directory whose name starts with a dot, such as `.git`, `.agents` or `.claude`. It follows links to files and directories, also outside the root; commit or back up the files there too. That includes a test fixture of an old contract: if you keep one on purpose, restore it with git afterwards. A copy of the project under a directory whose name starts with a dot, such as a worktree under `.claude/worktrees/`, is left alone: run the script in that copy separately. The script takes the project root and one option, `--default`, described below; any other option, a malformed `--default` or a root that is not a directory makes it print its usage and exit 1.

In each contract it removes the `noCheck` key from every column. Where the key waived the element check of a list, it also makes the column, the field that maps it and their types in `contract.d.ts`, the row types such as `ReadonlyArray<CodecTypes['pg/text@1']['output'] | null>` included, lists whose elements may be null. That is what the database allows, and it is what the source says after `psl-nocheck-removed` or `ts-nocheck-method-removed`. The script does not change which checks a contract declares: an enum column whose membership check was waived still has none until you migrate.

In each PostgreSQL contract it also writes each literal default in the form this release stores, for example `"1.5"` on `numeric(10,2)` as `"1.50"` (`postgres-defaults-stored-in-another-spelling`). The script carries this release's rules for each PostgreSQL built-in data type and for the extension data types `postgis/geometry` and `pgvector/vector`, so its result does not depend on the installed packages. A geometry default is written as the upper-case little-endian HEXEWKB PostGIS prints, whatever case and byte order it had. It leaves a default of any other data type as it is.

The storage hash changes, so the script renames each changed snapshot directory to its new hash. It rewrites every `migration.json`, ref, `migration.ts` and `contract.d.ts` that names an old hash, and gives each changed migration a new `migrationHash`. When it finishes, it prints how many files it rewrote, how many snapshot directories it renamed, and each storage hash it replaced (`<old> -> <new>`). A project with no `noCheck` key and no default in another form is left unchanged, and the script says so.

It changes no file and exits 1 in four cases, and names the file:

- a `contract.json`, `migration.json` or ref is not valid JSON, or the `ops.json` of a migration whose hashes change is not;
- a contract's stored storage hash, or the name of its snapshot directory, does not match its content. Restore that file from version control, or re-emit it, and run the script again;
- a renamed snapshot directory already exists with different content;
- this release refuses a PostgreSQL default: it is not a value of its column's type, for example a time with more fraction digits than its column holds, a `pgvector/vector` element that `real` cannot hold exactly, or a `postgis/geometry` in another SRID than its column's; or a list column's default is not a list. The script names the column. Do not edit the stored file: that breaks its storage hash, and the next run refuses it. Instead choose the value the database stores, and run the script again with that value as JSON, for example `--default 'public.product.opensAt="12:34:00.123457"'`. The script stores it in every stored contract where that column's default is refused, migration snapshots included, checks it by the same rules and refreshes the hashes. It stops when the value is refused too, or when a `--default` names a column whose default it does not refuse. Then change the default in the contract source to the same value, so that `prisma contract emit` writes it.

If it stops partway, for example on a full disk, it says so; run it again to finish.

Each database's marker still holds the old storage hash, so `prisma db verify` and `prisma db migrate` refuse it until you sign it. The database itself does not change. Run `prisma db sign` against every database (development, staging, production) right after the script:

```sh
prisma db sign --db "$DATABASE_URL"
```

`db sign` checks the database against the rewritten contract and writes the new hash to its marker.

A plain `prisma db sign` checks the database against the emitted contract, so it signs only a database that has applied every migration. A database that has not, such as production while the latest migrations wait for review, is refused: `db sign` says its schema does not satisfy the contract, and `prisma db migrate` stops with `MIGRATION.MARKER_MISMATCH`, because the marker holds an old hash that no migration names any more. Sign such a database with the contract of the last migration it applied:

```sh
prisma db sign --contract <the last migration it applied> --db "$DATABASE_URL"
```

Then apply the other migrations with `prisma db migrate` in step 8 of "Order of the steps", after step 7 has written their `ops.json` again.

`--contract` takes the migration's directory name, such as `20260917T0818_add_post_expires_at`, or the new hash that migration goes to. To find it, run `prisma migration status` against the database. It prints the start of the old hash the marker holds: `Database marker <hash> is not in the on-disk migration graph`. The error of `prisma db migrate` prints the whole hash: `The database's marker names <hash>`, or `DB marker is <hash>` before 8.0.0-rc.21. Recover with `db sign --contract` as this section says, not with the error's next actions: the marker is outside the migration graph only because the upgrade gave the migrations new hashes. Find the line of the script's `<old> -> <new>` list whose old hash is that one. The new hash on that line is the one to sign with, and the migration that goes to it is the last one the database applied.

The script also gives each rewritten migration a new hash, and the database's migration history keeps the old ones. After the upgrade, `prisma migration status` therefore no longer marks the migrations applied before it as applied, although it still reports the database as up to date. Nothing else is affected: `prisma db migrate` runs none of them again, `prisma db verify` passes, and migrations you plan and apply after the upgrade are marked as usual.

### `psl-nocheck-removed`

Write a list whose elements may be null as `T?[]`:

```prisma
// Before
tags String[] @noCheck(elementNotNull)

// After
tags String?[]
```

The element type gains `| null`, so code that reads the list must handle null elements. The database does not change: neither form has a check. If you ran `stored-contracts-drop-nocheck`, re-emitting gives the contract the script wrote, so there is nothing to sign or migrate. If you did not, re-emit and then run `prisma db sign` against every database.

If you want the check instead, delete the attribute and keep `T[]`. Re-emit, then, in step 8 of "Order of the steps", run `prisma migration plan` and `prisma db migrate`, or `prisma db update` in a project without migrations. The migration adds the check. Applying it fails if a stored list already holds a null element, so fix those rows first.

Delete `@noCheck(membership)`. Re-emit, then plan and apply a migration the same way, in step 8. The migration adds the membership check to the enum column. Applying it fails if a stored value is not one of the enum's values, so fix those rows first.

A bare `@noCheck` waived every check the column had. Apply both rules above: a list column becomes `T?[]`, and an enum column loses the attribute.

### `ts-nocheck-method-removed`

The same rules apply to the TypeScript builder:

```ts
// Before
tags: field.text().many().noCheck('elementNotNull'),
role: field.column(roleColumn).noCheck('membership'),

// After
tags: field.text().many({ elementsNullable: true }),
role: field.column(roleColumn),
```

`.many({ elementsNullable: true })` leaves the database as it is and types each element as `T | null`. Deleting `.noCheck('membership')` makes the next migration add the membership check. Re-emit and then sign or migrate as `psl-nocheck-removed` says.

### `prisma7-lists-allow-null-elements`

A Prisma 7 database has no check on its list columns, so it accepts null elements. The Prisma 7 reader now says so: a `String[]` field reads as a list of `string | null`. Fix the type errors where code assumed non-null elements.

The contract's storage hash changes. If your project stores a contract an earlier release emitted, run `stored-contracts-drop-nocheck` first: after it and `prisma db sign`, re-emitting with `prisma contract emit` gives the same contract, and there is nothing more to do. Otherwise, re-emit the contract and then run `prisma db sign` against every database that was signed before.

A database Prisma 7 built matches the new contract with no migration. A project that hands over from Prisma 7 for the first time with this release verifies with `prisma db verify` after `prisma db sign`, as before. A database that was already signed fails `prisma db verify` with `CONTRACT.MARKER_MISMATCH` until you sign it again.

### `supabase-contract-lists-allow-null-elements`

The `@prisma/orm-extension-supabase` contract now declares four `text[]` columns as lists whose elements may be null, because the Supabase database has no check against null elements in them:

- `auth.custom_oauth_providers.acceptable_client_ids` (`CustomOauthProviders.acceptableClientIds`)
- `auth.custom_oauth_providers.scopes` (`CustomOauthProviders.scopes`)
- `storage.buckets.allowed_mime_types` (`StorageBucket.allowedMimeTypes`)
- `storage.objects.path_tokens` (`StorageObject.pathTokens`)

Code that reads these fields now gets `string | null` elements. The Supabase space's storage hash changes from `cb23216599e58b222c1fe7d880105d8f166c8490935cec5ed539dbe77847d679` to `292489649ae6d6928de98a32b544bd9caf6b7d49718c10fe2720b83545a4b5a2`.

A contract that composes the Supabase space references it by id, so your own `contract.json` and `contract.d.ts` do not change. What changes is the signature: a database that was signed against the previous Supabase contract no longer matches the new hash, so run `prisma db sign` against it after upgrading. The Supabase database itself does not change.

## Stored values follow their column's data type

### `sqlite-contracts-name-datetime-and-json-data-types`

A SQLite contract stores the data type of each column. This release gives datetime and JSON values their own data types, and stores a datetime as `toISOString()` writes it, with exactly three fraction digits. A contract emitted by the previous release still names `sqlite/text`, so the CLI of this release refuses it: every command that reads the contract (`migration plan`, `db migrate`, `db verify` and others) fails with `CONTRACT.VALIDATION_FAILED`:

```text
storage.namespaces.__unbound__.entries.table.events.columns.at: codec sqlite/datetime@1 represents sqlite/datetime, not sqlite/text
```

The application does not refuse it: built with this release, it keeps running on the old contract until you upgrade. So do the upgrade below before the next `db migrate`, or any other CLI command, against the project.

Commit your work first, so the script's changes can be reviewed and undone with git. Then run the script from the project root:

```sh
node <guide>/scripts/data-type-values/data-type-values.ts
```

Node 24 or later runs the TypeScript script directly; it needs no `tsx`. It reads and writes files only and needs no database. It rewrites every `*.json` file under the root that parses as a SQLite contract in the previous release's form, skipping `node_modules`, `dist`, `build` and every directory whose name starts with a dot, such as `.git`, `.agents` or `.claude`, and follows links to files and directories, also outside the root; commit or back up the files there too. That includes a test fixture of a contract in the previous release's form: if you keep such a fixture on purpose, restore it with git afterwards (`git restore <file>`), or keep it outside the project root. In each contract it changes:

- the `dataType` of each column and named type whose codec is `sqlite/datetime@1` or `sqlite/json@1`, from `sqlite/text` to `sqlite/datetime` or `sqlite/json`;
- each literal default of a `sqlite/datetime@1` column, and each value of an enum typed by `sqlite/datetime@1`, to three fraction digits: `"2024-01-01T00:00:00Z"` becomes `"2024-01-01T00:00:00.000Z"`, and `"2024-01-01T00:00:00.5Z"` becomes `"2024-01-01T00:00:00.500Z"`. A JSON default keeps its value.

It then writes the storage hash each contract now has, renames the contract's snapshot directory under `migrations/snapshots/` to that hash, and replaces the old hash in every `migration.json` (recomputing its `migrationHash`), every ref under `refs/`, every `migration.ts` and every `contract.d.ts`. The planned SQL does not change: SQLite stores the same text in the column default.

When it finishes, it prints how many files it rewrote and how many snapshot directories it renamed, and each storage hash it replaced (`<old> -> <new>`). A project already in the new form is left unchanged, and the script says so. If it finds no SQLite contract under the root, it says so and changes nothing; that is the expected result in a PostgreSQL or MongoDB project. In a SQLite project, check that you ran it from the project root. It prints `<file>: stored hash did not recompute; rehashed from content` for a contract whose stored hash does not match its content, and rewrites it anyway. It changes no file and exits 1 when a `contract.json`, `migration.json` or ref is not valid JSON, when the `ops.json` of a migration whose hashes change is not valid JSON, or when a renamed snapshot directory already exists with different content. An option or a project root that is not a directory makes it print its usage and exit 1.

If the script stops on an error partway, for example on a full disk, it prints the error and `the upgrade stopped partway, run the script again to finish it`, and exits 1. Run it again: it finishes the upgrade and removes its own temporary files (ending in `.data-type-values-tmp`).

Run your formatter afterwards. The script writes each `contract.json` as `contract emit` does and replaces text in `contract.d.ts` without reformatting it, so a file your formatter keeps in another layout, or the line wrapping of `contract.d.ts`, can differ from what your formatter produces.

### `date-time-interval-and-bytes-defaults-use-tags`

This applies to Prisma 8 schemas. A Prisma 7 schema read with `prisma7Schema(...)` keeps its quoted defaults; see `prisma7-datetime-default-finer-than-column`. A default of a date, time, interval or bytes column is written with the tag of the column's type, as a JSON default already is. `contract emit` refuses a quoted string and shows the tag to write:

```text
Field "Event.at": Expected timestamptz`...`; write timestamptz`2024-01-01T00:00:00Z`
```

```prisma
// before
model Event {
  id      Int       @id
  at      DateTime  @default("2024-01-01T00:00:00Z")
  local   Timestamp @default("2024-01-01 12:34:56.500")
  day     Date      @default("2024-03-15")
  clock   Time      @default("12:34")
  zoned   Timetz    @default("12:34:56+02")
  span    Interval  @default("P1D")
  payload Bytes     @default("AQID")
}

// after
model Event {
  id      Int       @id
  at      DateTime  @default(timestamptz`2024-01-01T00:00:00Z`)
  local   Timestamp @default(timestamp`2024-01-01 12:34:56.500`)
  day     Date      @default(date`2024-03-15`)
  clock   Time      @default(time`12:34`)
  zoned   Timetz    @default(timetz`12:34:56+02`)
  span    Interval  @default(interval`P1D`)
  payload Bytes     @default(bytea`\x010203`)
}
```

The tag is named after the column's PostgreSQL type: `timestamptz` for `DateTime`, `timestamp`, `date`, `time`, `timetz` and `interval` for the types of those names, and `bytea` for `Bytes`. A date or time tag takes the text you wrote. A `bytea` tag takes the bytes as hexadecimal after `\x`, not base64: `"AQID"` is the bytes 01 02 03, so write `bytea`\x010203``. For bytes, the message depends on what you quoted. A quoted hex string gets the full rewrite (`Expected bytea`...`; write bytea`\x010203``). A quoted base64 string gets a message naming only the tag (`Expected bytea`...``), because `contract emit` cannot tell base64 from hex text; convert the bytes to hex yourself.

On SQLite, a `DateTime` default uses the `datetime` tag, and a `Bytes` default the `blob` tag, whose body is the hex digits the quoted string held before. A quoted string on a SQLite `Bytes` column was read as hex; it is now refused, naming the `blob` tag:

```prisma
// before
createdAt DateTime @default("2024-01-01T00:00:00Z")
payload   Bytes    @default("68656c6c6f")

// after
createdAt DateTime @default(datetime`2024-01-01T00:00:00Z`)
payload   Bytes    @default(blob`68656c6c6f`)
```

The stored value is the same as before, so emitting the schema after the rewrite gives the contract the script above writes.

### `postgres-defaults-stored-in-another-spelling`

A stored default is now a value of its column's type, written in the one spelling the type and its parameters give. A PostgreSQL contract that an earlier release emitted can store a default in another spelling. The CLI of this release refuses such a contract: every command that reads it (`migration plan`, `db init`, `db verify`, `migration check` and others) fails with `CONTRACT.VALIDATION_FAILED`. The application does not refuse it, and keeps running on it until you emit the contract again; do that before the next `db migrate`. The CLI's message names the column, the stored value and the spelling the type expects:

```text
Namespace "public", table "product", column "price": the default "1.5" is not a value of pg/numeric: pg/numeric JSON value must be "1.50", the spelling its parameters give this value
```

The cases are:

- a number default spelled without its scale, such as `"1.5"` on `numeric(10,2)`, which is now `"1.50"`;
- a `char` default padded with spaces, which is now stored without them;
- a time default with more fraction digits than its column's precision;
- a date or time default in a spelling earlier releases stored: an instant with `.000Z` (`"2024-01-01T00:00:00.000Z"` is now `"2024-01-01T00:00:00Z"`), an offset such as `+01:00` on a `timestamptz` (now converted to `Z`), a time without seconds (`"12:34"` is now `"12:34:00"`), or a space instead of `T` between date and time;
- a `postgis/geometry` default in lower-case or big-endian HEXEWKB, which is now upper-case little-endian HEXEWKB, as PostGIS prints it, or a geometry whose SRID is not its column's;
- a `pgvector/vector` default with an element that `real` cannot hold exactly, such as `0.123456789`, which the database stores as `0.12345679`.

Migration snapshots store defaults too. `migration plan`, `migration check` and every other command that reads a snapshot refuse an old one the same way, and name it (`Predecessor contract at migrations/snapshots/<hash>/contract.json failed to deserialize: ...`). A snapshot cannot be emitted again, so `scripts/remove-nocheck/remove-nocheck.ts` rewrites it (`stored-contracts-drop-nocheck`). It writes each default of every stored PostgreSQL contract in the form this release stores, renames each changed snapshot directory to its new storage hash, and rewrites every migration, ref, `migration.ts` and `contract.d.ts` that names an old hash. A snapshot rewritten this way has the storage hash `contract emit` gives the same schema, so `migration plan` plans nothing for this change. If a default is not a value of its column's type at all, for example a time with more fraction digits than its column holds, the script changes no file, names the file and column, and exits 1. Run it again with `--default` and the value the database stores, as `stored-contracts-drop-nocheck` describes; do not edit the stored file.

Then run `prisma contract emit`, which writes the default in the new spelling, then `prisma db sign` (`sign-databases-after-data-type-values`). Two kinds of default in the schema need rewriting first, or `contract emit` refuses them:

- a quoted date, time, interval or bytes default, which is written with its tag (`date-time-interval-and-bytes-defaults-use-tags`);
- a default with more fraction digits or more scale than its column holds, on a `time`, `timestamp`, `timestamptz`, `interval` or `numeric` column. Earlier releases let PostgreSQL round it; write the rounded value instead. For example, `Timestamptz(3) @default(timestamptz`2024-01-01T00:00:00.1234Z`)` is refused with:

  ```text
  Field "Event.at": pg/timestamptz JSON value must be a value with at most 3 fraction digits of a second, which precision 3 holds without rounding
  ```

  Write `timestamptz`2024-01-01T00:00:00.123Z``. A `Numeric(10, 2)` default of `1.234` is refused the same way (`pg/numeric JSON value must be a decimal string that numeric(10, 2) stores without rounding`); write `1.23`.

### `prisma7-datetime-default-finer-than-column`

This applies to a project whose contract source is a Prisma 7 schema. Prisma 7 let PostgreSQL round a `DateTime` default with more fraction digits than its column holds. This release refuses it, so the contract stores the value the database holds. A plain `DateTime` is `timestamp(3)`, which holds three fraction digits:

```text
Field "Event.at": @default holds "2024-01-02T03:04:05.1234Z", with 4 digits after the decimal point, but the column holds 3. PostgreSQL stores it as "2024-01-02T03:04:05.123Z"; write that instead.
```

Write the value the message names:

```prisma
// before
at DateTime @default("2024-01-02T03:04:05.1234Z")

// after
at DateTime @default("2024-01-02T03:04:05.123Z")
```

Then run `prisma contract emit` and `prisma db sign`.

### `stored-values-a-column-type-does-not-hold`

A codec now reads each value a query returns with one method, `fromWire`, in a plain read and in an include alike, and refuses a value its column's type does not hold. A query that returned such a value before now throws `RUNTIME.DECODE_FAILED`:

| Column | Value | Message |
| --- | --- | --- |
| SQLite `INTEGER` (`sqlite/integer@1`, `sql/int@1`) | text that is not a number, or bytes | `sqlite/integer@1 wire value must be an integer or its decimal text` |
| SQLite `REAL` (`sqlite/real@1`, `sql/float@1`) | text other than `Infinity` and `-Infinity`, or bytes | `sqlite/real@1 wire value must be a number, or the text Infinity or -Infinity` |
| SQLite `BLOB` (`sqlite/blob@1`) | text or a number | `sqlite/blob@1 wire value must be bytes, or the array of their hex text an include carries` |
| PostgreSQL `text[]` (`pg/text-array@1`) | an array of two or more dimensions | `pg/text-array@1 reads a one-dimensional text[], and {{a},{b}} has more dimensions` |

SQLite stores any value in any column of a table that is not `STRICT`, so these values come from writes outside the application. Find them, for example with `SELECT id FROM t WHERE typeof(col) NOT IN ('integer', 'null')`, and correct them, or read the column with a codec of the type it holds.

### `sqlite-datetime-without-offset-read-as-utc`

A SQLite `DateTime` column (`sqlite/datetime@1`) can hold date and time text without a UTC offset, such as `2024-01-01 12:00:00` or `2024-01-01`, when another tool wrote it: `CURRENT_TIMESTAMP` in SQL, or a client library that writes local text. Prisma writes `toISOString()` text, which ends in `Z`, so a row Prisma wrote reads as before.

Such a row is now read as UTC, as SQLite's `datetime()` and `strftime()` read it. Before, it was read in the time zone of the machine running the query, so the same row gave a different `Date` on a server in UTC and on one in another zone. A date alone is read as its midnight in UTC. Every value that was read before is still read; only the instant of text without an offset changes, and it changes only on a machine not set to UTC.

If such text was written meaning local time, rewrite it with its offset, or as UTC. To find these rows:

```sql
SELECT id, created_at FROM "Event"
WHERE typeof(created_at) = 'text'
  AND created_at NOT LIKE '%Z'
  AND created_at NOT GLOB '*[+-][0-9][0-9]:[0-9][0-9]';
```

### `text-array-min-max-return-arrays`

`min` and `max` of a column whose codec is `pg/text-array@1` return what a row of the column returns, an array of strings, where they returned the text PostgreSQL prints for the array: `['c']` instead of `'{c}'`. Code that parsed that text reads the array directly.

### `sign-databases-after-data-type-values`

The upgrade gives every SQLite contract with a datetime or JSON column a new storage hash, and so does `prisma contract emit` for a PostgreSQL contract it rewrites. Each database's marker still holds the old hash, so until you sign it `prisma db migrate` refuses to run with `MIGRATION.MARKER_MISMATCH` and `prisma db verify` exits with code 4 and `CONTRACT.MARKER_MISMATCH`. Run `prisma db sign` against every database (development, staging, production) before you deploy the application built with the new contract:

```sh
prisma contract emit
prisma db sign --db "$DATABASE_URL"
```

A database that has not applied every migration is refused by a plain `prisma db sign`. Sign it with `prisma db sign --contract <the last migration it applied>`, then migrate it, as `stored-contracts-drop-nocheck` describes. `data-type-values.ts` prints its `<old> -> <new>` list in the same form.

## Client generators are written `@onCreate(...)` and `@onUpdate(...)`

Prisma 8 PSL now says who writes a value. `@default(...)` is a database default: the database fills the column when an insert leaves it out. `@onCreate(fn())` and `@onUpdate(fn())` are values the client generates, on create and on every update. A function resolves for the column's codec, so `uuid()` works on `String`, `VarChar(n)`, `Char(n)` and `Uuid`, and `now()` gives each date and time type the value its codec takes.

```prisma
// Before
model Post {
  id        String   @id @default(uuid(7))
  slug      String   @default(nanoid(12))
  createdAt DateTime @default(now())
}

// After
model Post {
  id        String   @id @onCreate(uuid(7))
  slug      String   @onCreate(nanoid(12))
  createdAt DateTime @default(now())
}
```

`@default(now())` and `@default(autoincrement())` do not change. A column may have both: `createdAt DateTime @default(now()) @onCreate(now())` makes the client write its time on create and leaves the database default for other inserts.

### `client-functions-move-from-default-to-on-create`

Commit your work first, so the change can be reviewed and undone with git. Run the script from the project root with every `.prisma` file git tracks as arguments:

```sh
git ls-files -z '*.prisma' | xargs -0 node <guide>/scripts/default-generators-to-on-create/rewrite-default-generators.mjs
```

`<guide>` is the directory that holds this guide. Pass every file, not only the schema `contract emit` reads: a migration directory can hold a copy of the schema, such as `migrations/app/<migration>/intermediate.prisma` or a `contract.prisma` beside a migration, and the CLI reads those too. The script reads and rewrites only the files it is given, and with no file it prints its usage and exits 1. For each one it prints how many calls it rewrote, or that it left the file unchanged. It rewrites every `@default(uuid(...))`, `@default(cuid(...))`, `@default(ulid())` and `@default(nanoid(...))` to `@onCreate(...)`, keeping the call exactly as written, spaces included, and changes nothing else. It leaves string literals and `//` comments unchanged and does not count them, so rewrite a commented-out field yourself if you want it in step.

A Prisma 7 `schema.prisma` that your config reads with `prisma7Schema(...)` keeps `@default(uuid())`, and the Prisma 7 reader turns it into the same generator. Passing it is safe: the script rewrites only a file that has the `// use prisma-8` directive (or the older `// use prisma-next`), read by the same rule `contract emit` uses. It leaves every other file unchanged and prints a line for it, so a Prisma 7 schema split across files is safe even when a file holds only models.

The contract does not change: `@onCreate(uuid())` lowers to the generator `@default(uuid())` lowered to, so `prisma contract emit` writes the same `contract.json` and hashes, and nothing needs to be signed or migrated.

In a TypeScript contract, `field.generated(...)` keeps working for now. Its replacement is `.onCreate(...)` with a call from `gen`, which this release adds:

```ts
import { field, gen } from '@prisma/orm-postgres/contract-builder';

const id = field.column(textColumn).id().onCreate(gen.uuid(7));
const updatedAt = field.column(timestamptzColumn).onCreate(gen.now()).onUpdate(gen.now());
```

### `contract-print-writes-generator-attributes`

`contract print` writes each generated column as its type followed by the generator attributes. A `temporal.timestamptz(3, onCreate: now, onUpdate: now)` field prints as `Timestamptz(3) @onCreate(now()) @onUpdate(now())`, and `@default(uuid())` prints as `@onCreate(uuid())`. Both read back as the same contract.

## Generator arguments are checked, and a generated value must fit its column

### `prisma7-default-function-arguments-checked`

A Prisma 7 schema the reader used to accept with a changed meaning is now refused:

```prisma
// Before: read as a version 4 UUID, a CUID2 identifier, and a 1-character Nano ID
id    String @id @default(uuid(5))
code  String @default(cuid(1))
short String @default(nanoid(1))
named String @default(nanoid(size: 8))
whole String @default(uuid(4.0))

// After: write what the generator makes
id    String @id @default(uuid(4))
code  String @default(cuid(2))
short String @default(nanoid(2))
named String @default(nanoid(8))
whole String @default(uuid(4))
```

Each refusal is `PSL.PRISMA7_UNKNOWN_DEFAULT`, reported at the argument, with the function's message: `Field "User.id": uuid: version must be 4 or 7, got 5`. `cuid()` with no argument still reads as `cuid(2)`. Pick the value that keeps what your application stores today: `uuid(5)` made version 4 UUIDs, `cuid(1)` made CUID2 identifiers.

### `generator-function-argument-diagnostics`

Code or tests that match the diagnostics of a Prisma 8 schema read the new code and messages:

```ts
// Before
expect(diagnostic).toMatchObject({ code: 'PSL_INVALID_ATTRIBUTE_SYNTAX', message: 'Expected one of: 4 | 7' });

// After
expect(diagnostic).toMatchObject({
  code: 'PSL_INVALID_GENERATOR_ARGUMENT',
  message: 'uuid: version must be 4 or 7, got 5',
});
```

The messages are `uuid: version must be 4 or 7, got <n>`, `cuid: version must be 2, got <n>` and `nanoid: size must be between 2 and 255, got <n>`. An argument that is not written as a whole number, such as `nanoid(8.5)` or `nanoid("8")`, is `PSL_VALUE_TYPE_INCOMPATIBLE`, as for any value of the integer type.

### `generator-function-argument-with-fraction`

```prisma
// Before: read as nanoid(8) and uuid(7)
slug String @default(nanoid(8.0))
id   String @id @default(uuid(7.0))

// After
slug String @onCreate(nanoid(8))
id   String @id @onCreate(uuid(7))
```

### `generator-fits-column`

```prisma
// Before: emitted, then on Postgres every insert failed with "value too long"
code Char(5) @default(nanoid())

// After
code Char(21) @onCreate(nanoid())
code Char(5)  @onCreate(nanoid(5))
```

The lengths are: `uuid` 36, `ksuid` 27, `ulid` 26, `cuid(2)` 24, `nanoid()` 21 and `nanoid(n)` n. A column's length is read in its type's normal form, so a bare `Char` is `Char(1)` and a bare `VarChar` has no limit.

### `discriminator-must-be-text`

This applies to SQL schemas only; a Mongo schema's discriminator message is unchanged.

```ts
// Before
'Discriminator field "type" on model "Task" must be of type String, but is "Int"'

// After
'Discriminator field "type" on model "Task" must be text, such as String, but is "Int"'
```

## Re-emit contracts that use a string timestamp preset

This is `string-timestamp-presets-write-text`.

On Postgres, a field written `temporal.timestampString(3, onCreate: now, onUpdate: now)`, `temporal.updatedAtString()` or another `temporal.*String` preset is filled by a generator that writes text, such as `2024-01-02 03:04:05.678` or `2024-01-02 03:04:05.678+00`. Before, it was filled by `timestampNow`, which produced a `Date`. A Prisma 7 schema read through `prisma7Schema(...)` gets the same preset for each `@updatedAt` field.

The generator's id is in the execution section of `contract.json`, so the execution hash changes. Run `prisma contract emit` again and commit the new `contract.json` and `contract.d.ts`. The storage hash does not change, and the database marker holds only the storage and profile hashes, so there is no migration to plan and no need to run `prisma db sign`.

## A string timestamp column takes text, not a `Date`

This is `string-timestamp-codecs-take-text-only`.

`TimestampString(p)` and `TimestamptzString(p)` columns take and return text, and the ORM types for them were already `string`, so code that compiled before still compiles. What changes is at runtime: their codecs used to convert a `Date` that reached them, and now they refuse it with `RUNTIME.ENCODE_FAILED`. A `Date` reaches them only through a cast, from JavaScript, or from a contract emitted before this change, whose generator still produced a `Date`, so re-emit the contract first.

```ts
// Before: compiles only through a cast, and was converted at runtime
await db.orm.public.Post.create({ title: 'Hello', publishedAt: new Date() as unknown as string });

// After
await db.orm.public.Post.create({ title: 'Hello', publishedAt: new Date().toISOString() });
```

A direct call of the codec's `encode` with a `Date` is now a type error as well.

To work with `Date` values, you can change the column to `TimestamptzJsDate(p)` (`temporal.timestamptzJsDate(...)` as a preset). That changes the column type to `timestamptz`, so it needs a migration: plan and apply one with `prisma migration plan` and `prisma db migrate` in step 8 of "Order of the steps", and check how existing `timestamp` values convert, because Postgres reads them in the session's time zone.

## Type-constructor arguments are values of data types

### `type-constructor-arguments-are-values`

Write each number argument of a type constructor as a number, positional or named. `VarChar("255")` becomes `VarChar(255)`, `VarChar(length: "255")` becomes `VarChar(length: 255)`, and `Numeric("10", "2")` becomes `Numeric(10, 2)`.

A length, precision, scale or SRID on Postgres is a 32-bit integer, so a number written with a fraction is refused, even when the fraction is zero: `VarChar(255.0)` becomes `VarChar(255)`, and `Timestamptz(3.0)` becomes `Timestamptz(3)`. A number larger than 2147483647 is refused too; write the value the column needs.

On SQLite, the length of `sql.String` is a value of `sqlite/real`, so `sql.String(2.0)` is accepted and gives the length `2`. Write `sql.String(2)` anyway, so the schema reads the same on every target. The detection matches `sql.String(2.0)` on every target for this reason. A SQLite length is at most 2147483647, SQLite's largest string length.

## Enums refuse more codecs and read members as values of their data type

### `more-codecs-refused-for-enums`

`defineContract` refuses an enum typed by one of these codecs, for example:

```text
CONTRACT.ENUM_INVALID: enumType("Payload"): an enum cannot use the codec pg/jsonb@1. A CHECK lists a string member as SQL text, which PostgreSQL reads as the JSON text of a document rather than as a string, and a number member as a number, which PostgreSQL cannot compare with jsonb, so no CHECK can compare a value with the members. No enum can use a jsonb codec; use a text enum instead.
```

PSL refuses an enum block with `@@type` naming one of these codecs with the same reason, as `PSL_EXTENSION_INVALID_VALUE`.

1. For a `pg/enum@1` enum, declare a native enum: a `native_enum` block in PSL, or `nativeEnum` in TypeScript.
2. For any other refused enum, type it with `pg/text@1`: change the `@@type` in PSL, or pass `{ codecId: 'pg/text@1' }` (or `textColumn`) to `enumType` in TypeScript. Write each member as text.
3. Re-emit the contract. The enum's columns change type, and with them the storage hash. Plan and apply a migration, which changes each column's type.

The TypeScript detection matches a file that calls `enumType(` and names one of these codecs or their column helpers anywhere, even on a column that is not an enum. Check only the enums.

### `psl-enum-members-read-by-the-cast-rule`

`contract emit` refuses a quoted member on a codec whose data type has no cast from text:

```text
enum "Ratio" member "Half": Expected a number; write 0.5
```

Rewrite each refused member as the message says, then emit the contract again. The stored members are the same, so the storage hash does not change and no migration is needed.

```prisma
// before
enum Ratio {
  @@type("pg/numeric@1")
  Half  = "0.5"
  Whole = "1.50"
}

// after
enum Ratio {
  @@type("pg/numeric@1")
  Half  = 0.5
  Whole = 1.50
}
```

### `enum-members-compare-by-their-data-type`

1. If the contract build refuses two members as one value, such as `enum "Ratio": members "Half" and "Halves" store "0.5" and "0.50", which the database holds equal`, remove one of them. The database already held them equal, so a row could never tell them apart.
2. Re-emit the contract.
3. Typecheck the project. Code that reads such an enum column as a member literal type, such as `'0.5' | '1.50'`, now reads the codec's type; compare the value with a member through `db.enums.<namespace>.<Enum>.has()` or `nameOf()`, which find `0.50` as `0.5`.

The TypeScript detection matches a file that calls `enumType(` and names one of these codecs or `numericColumn(` or `intervalColumn(` anywhere, even on a column that is not an enum. Check only the enums.

### `enum-columns-typed-by-member-literals`

Re-emit the contract. Then typecheck the project. Where a write to an enum column, or a comparison with a value read from one, no longer typechecks, the value is not a member; use a member instead. A test that writes a non-member on purpose, to see the CHECK constraint refuse it, can write that value `as never`.

## Column types are named as the database prints them

### `db-schema-json-names-type-text`

A script that reads column types from `prisma db schema --json` reads `typeText`:

```sh
# Before
prisma db schema --json | jq '.schema.tables[].columns[].nativeType'

# After
prisma db schema --json | jq '.schema.tables[].columns[].typeText'
```

The value is the type as introspection reads it from the database: on Postgres the text `format_type` prints (`integer`, `character varying(20)`), not the short names (`int4`, `varchar(20)`) earlier releases printed. It differs from what the database prints in three cases:

- On SQLite, the declared type is lower-cased: a column declared `VARCHAR(255)` reads `varchar(255)`.
- On Postgres, an enum is named as a contract names it: `My Mood` where `format_type` prints `"My Mood"`, and `app.status` for an enum outside `public`.
- On Postgres, a type in a schema that is not on the search path keeps its schema, as `format_type` prints it: `extensions.vector(3)` for a pgvector column when the `extensions` schema is not on the search path, and `vector(3)` when it is.

### `default-invalid-meta-type-text`

Code that reads the column's type from a `CONTRACT.DEFAULT_INVALID` error reads `meta.typeText`:

```ts
// Before
if (error.code === 'CONTRACT.DEFAULT_INVALID') console.log(error.meta.nativeType);

// After
if (error.code === 'CONTRACT.DEFAULT_INVALID') console.log(error.meta.typeText);
```

## A client takes a typed contract value

A client no longer takes `contractJson`, and it needs no type argument. The emitted JSON becomes a typed value in one call, and every client infers its contract type from that value:

```ts
// Before
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({ contractJson, url: process.env['DATABASE_URL']! });

// After
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

export const db = postgres({ contract, url: process.env['DATABASE_URL']! });
```

A contract value is validated once, however many clients are built from it. A contract written in TypeScript with `defineContract` is already a value: keep passing it as `{ contract }`.

### Run the script

Run `node <guide>/scripts/client-takes-contract-value/contract-from-json.ts <project root>`. The script reads source files with the TypeScript compiler from the project's `typescript` package; if the project has none, it changes nothing, says so and exits 1. It skips `node_modules`, `dist`, `build` and every directory whose name starts with a dot, such as `.git`, `.agents` or `.claude`; move a client in such a directory by hand. In each source file that passes `contractJson` to a client, static entry or `mongoQuery`, it:

- adds `import { contractFromJson } from '<facade>/static';`, or adds `contractFromJson` to an existing import of that entry, in the file's quote, semicolon and line-ending style;
- declares `export const contract = contractFromJson<Contract>(contractJson);` after the imports. In a module with a default export, such as a Worker entry, it declares `const contract` without `export` and prints a note: a Worker treats every named export of its entry module as an entrypoint, so a module that needs the value gets it from a separate module (see step 3 below);
- removes the type argument from the call and replaces the `contractJson` property with `contract`;
- where the call's result is destructured with `contract` in it, as in a `migration.ts` (`const { sql: db, contract } = postgres<End>({ contractJson: endContract })`), removes `contract` from the destructuring, because the declared value is that contract: `const { sql: db } = postgres({ contract })`.

It prints each file it moved. It prints to stderr, with the reason, each file that passes `contractJson` but that it did not move, and then exits 1: a test file, a file that already has another binding named `contract` (rename that binding and run the script again), a file whose clients use different contracts, a file whose `contractJson` value uses a binding the file declares after its imports, a file whose `contractJson` value uses a parameter or local binding of the function that creates the client (pass `contract: contractFromJson<Contract>(<value>)` to that call instead; the message gives the exact text), and a call it cannot read. Move those by hand in the same way.

### Then, by hand

1. **Tests and other modules.** Where a test or another module builds a client or static entry from `contractJson`, import the exported `contract` from the module that creates the client instead of calling `contractFromJson` again:

   ```ts
   // Before
   const db = postgres<Contract>({ contractJson, url });

   // After
   import { contract } from '../src/prisma/db';

   const db = postgres({ contract, url });
   ```

2. **`migration.ts` files.** The script moves a `migration.ts` that builds a client over a contract snapshot, such as `const { sql: db, contract } = postgres<End>({ contractJson: endContract })` for a data transform. Move by hand only a `migration.ts` the script refuses, with the text its message gives. Move every such file, so that `node migration.ts` still runs when you write its `ops.json` again (step 7 of the order above). `prisma db migrate` applies `ops.json` and does not load `migration.ts`, so an applied migration keeps working either way.

3. **Browser modules.** If a module that browser code imports (for example a file a `'use client'` component imports, to read `enums`) also needs the contract, it must not import the module that creates the client, because that module loads the database driver. Move the declaration into a module that imports no driver, and import it from both:

   ```ts
   // src/contract-value.ts
   import { contractFromJson } from '@prisma/orm-mongo/static';
   import type { Contract } from './contract';
   import contractJson from './contract.json' with { type: 'json' };

   export const contract = contractFromJson<Contract>(contractJson);
   ```

   ```ts
   // src/db.ts
   import mongo from '@prisma/orm-mongo/runtime';
   import { contract } from './contract-value';

   // src/enums.ts
   import mongoStatic from '@prisma/orm-mongo/static';
   import { contract } from './contract-value';

   export const enums = mongoStatic({ contract }).enums;
   ```

4. **Several clients from one contract**, such as two serverless clients in a Worker, take the same `contract` value; the script already gives a file one value for all its clients.

5. **Types.** The option types `PostgresOptionsWithContract`, `PostgresOptionsWithContractJson`, `PostgresServerlessOptionsWithContract`, `PostgresServerlessOptionsWithContractJson`, `SqliteOptionsWithContract`, `SqliteOptionsWithContractJson`, `MongoOptionsWithContract`, `MongoOptionsWithContractJson`, `SupabaseOptionsWithContract` and `SupabaseOptionsWithContractJson` are removed. Use `PostgresOptions<Contract>`, `PostgresServerlessOptions<Contract>`, `SqliteOptions<Contract>`, `MongoOptions<Contract>` or `SupabaseOptions<Contract>`.

6. **Docs and comments** in the project that show `postgres<Contract>({ contractJson })` or another client called with `contractJson`: rewrite them to the new form.

## Custom collection classes go on the client

This is `collections-on-the-client`.

`postgres()`, `postgresServerless()`, `sqlite()` and `supabase()` take an option, `collections`, with the same type `orm({ collections })` takes. The client types are inferred from it, and the classes reach every ORM the client offers:

```ts
// Before
import { orm } from '@prisma/orm-postgres/orm-client';
import { db } from './prisma/db';

export const posts = orm({
  runtime: db.runtime(),
  context: db.context,
  collections: { Post: PostCollection },
}).public.Post;

// After, in the module that creates the client
export const db = postgres({ contract, url, collections: { Post: PostCollection } });

await db.orm.public.Post.published().all();
await db.transaction(async (tx) => tx.orm.public.Post.published().forUpdate().all());
```

1. Pass the classes as `collections` where the client is created. If the module that defines the classes imports the client's module, import only the `Contract` type there (`import type { Contract } from './contract.d'`), so the two modules do not import each other.
2. Delete the hand-built ORM client (for example a `createOrmClient(runtime)` helper) and every `orm({ runtime, context, collections })` that only existed to reach the classes. Use `db.orm` instead. On SQLite, `db.orm` is the model collections themselves: `db.orm.Post`.
3. A function that took a `runtime` only to build an ORM no longer needs it. Inside a transaction, pass `tx.orm`, which has the classes too.
4. On a serverless client, the classes are on every connection: `await using db = await postgres.connect({ url }); db.orm.public.Post.published()`.
5. On Supabase, the classes are on `asUser`, `asAnon` and `asServiceRole` clients. Supabase's internal `.supabase` ORM does not take them.

A type written with only the contract, such as `PostgresClient<Contract>`, still describes a client without classes and accepts a client created with them. To name a client with classes, give the second type parameter: `PostgresClient<Contract, { Post: typeof PostCollection }>`.

## A client runs plans and renders SQL

This is `client-query-and-to-sql`.

Every SQL client now runs a plan itself and renders the SQL a plan would send:

```ts
const plan = db.sql.public.post.select('id', 'title').limit(10).build();
console.log(db.toSql(plan)); // { sql: 'SELECT … LIMIT 10', params: [] }
for await (const row of db.query(plan)) console.log(row);
await db.execute(db.raw.sql`UPDATE post SET pinned = false`.affectedCount().build());
```

`db.query(plan)` and `db.execute(plan)` behave as `db.runtime().query(plan)` and `db.runtime().execute(plan)` do, and have the types `tx.query` and `tx.execute` have. Replace `db.runtime().query(` with `db.query(` and `db.runtime().execute(` with `db.execute(`. Keep `db.runtime()` where the code needs `connection()`, `close()` or `telemetry()`. On Supabase, call them on a role-bound client, as before.

`toSql(plan)` needs only the adapter and the contract, so it works with no database. `params` are the plan's values before codecs encode them. Middleware rewrites (`beforeCompile`) are not applied. A plan with `prepare` bind sites throws `RUNTIME.PREPARE_BIND_ON_ADHOC`, and a plan built for another contract throws `PLAN.HASH_MISMATCH`, as running it would.

The message of `RUNTIME.PREPARE_BIND_ON_ADHOC` changed; its code did not. Code that matches the old message text ("Ad-hoc execute received a bind-site slot") must match the code instead. The details of `PLAN.TARGET_MISMATCH` and `PLAN.HASH_MISMATCH` rename `runtimeTarget` to `contractTarget` and `runtimeStorageHash` to `contractStorageHash`, and their messages changed; match the codes.

Code that only reads these types needs no change. Code that creates an object of one of them, for example a test double typed `PostgresClient<Contract>`, must add the new members:

| Type | New members |
| --- | --- |
| `PostgresClient`, `PostgresServerlessConnection` (`@prisma/orm-postgres/runtime`, `/serverless`) | `query`, `execute`, `toSql` |
| `PostgresServerlessClient`, `PostgresStaticContext`, `PostgresStaticMembers` | `toSql` |
| `PostgresQueryMembers` | `query`, `execute`, `toSql` |
| `SqliteClient` (`@prisma/orm-sqlite/runtime`) | `query`, `execute`, `toSql` |
| `SqliteStaticContext` | `toSql` |
| `SqliteQueryMembers` | `query`, `execute`, `toSql` |
| `PostgresTransactionContext`, `SqliteTransactionContext`, `SupabaseTransactionContext` | `toSql` |
| `RoleBoundDb`, `ServiceRoleDb` (`@prisma/orm-extension-supabase/runtime`) | `toSql`; `query` and `execute` now take the plan type every SQL client shares |
| `SupabaseInternalDb` (the service role's `supabase` member) | `toSql`, over the Supabase contract |
| `SqliteStaticMembers` (`@prisma/orm-sqlite/runtime`) | new: the static context plus `stack`, which `SqliteClient` now extends |

`supabase()` no longer creates its `pg.Pool`, driver or runtimes when it is called. It creates them on the first query, so creating a client with a URL opens nothing. It is still `async` and still requires `jwtSecret` or `jwksUrl`. `close()` now ends only a pool the client created from `url`; a `pg.Pool` passed in with the `pg` option stays open, as with `postgres()`, and the caller ends it.

The new `mode` option, typed `RuntimeMode`, is `'strict'` by default, which is how every client ran before. Under `'permissive'`, a `budgets()` violation whose severity is `'warn'` goes to `log.warn` and the query runs.

## `using` is a member of every collection

This is `orm-collection-member-using-reserved`.

A collection's `using` member holds the collection methods that packages contribute for the model. The Postgres target contributes one for each full-text index, so `db.orm.public.Post.using.post_search(q)` filters to the posts that match `q` and orders them by relevance, and pgvector contributes one for each vector field, such as `db.orm.public.Post.using.embedding_nearest(v)`.

A custom collection class registered with `orm({ collections })` can no longer declare its own `using`, whether as a method, a getter or a property. TypeScript refuses it because the base class defines `using` as an accessor. Rename the member, and its callers:

```ts
// Before
class PostCollection extends Collection<Contract, 'Post'> {
  using(tag: string) {
    return this.where({ tag });
  }
}

// After
class PostCollection extends Collection<Contract, 'Post'> {
  withTag(tag: string) {
    return this.where({ tag });
  }
}
```

## ORM calls are activities

This section covers `orm-annotations-on-the-call`, `cached-orm-reads-key-on-the-call`, `cache-store-holds-cached-values`, `orm-needs-a-runtime-queryable` and `close-lets-open-orm-calls-finish`. Their summaries above say what to do for the entries that have no section of their own.

Each SQL ORM terminal method is one `orm-call` activity. Its statements, its own transaction and the read-back after a nested write are its children, and the user's annotations are on it, not on the statements.

### Read ORM annotations from the call

Before:

```ts
const audit: SqlMiddleware = {
  name: 'audit',
  familyId: 'sql',
  async beforeEncode(plan) {
    const actor = auditAnnotation.read(plan);
    if (actor) log(actor);
  },
};
```

After:

```ts
const audit: SqlMiddleware = {
  name: 'audit',
  familyId: 'sql',
  async activityStarted(activity) {
    if (activity.kind !== 'orm-call') return;
    const actor = auditAnnotation.read(activity);
    if (actor) log(actor);
  },
};
```

A middleware that must also see annotated SQL builder queries keeps its statement path: those queries are statement activities and carry their annotations on the plan as before.

### Custom cache stores

Change the value type from `CachedRows` to `CachedValue`:

```ts
import type { CachedValue, CacheStore } from '@prisma/orm-extension-middleware-cache';

const store: CacheStore<unknown, CachedValue> = {
  // get, set and unset as before; value is now { kind: 'statement-rows', rows } or { kind: 'call-result', result }
};
```

## A TypeScript contract has the same types as an emitted one

This section covers `typescript-contract-include-row-types`, `typescript-contract-aggregates-and-operations`, `typescript-contract-parameterized-output-types`, `orm-filters-and-writes-take-input-types`, `typescript-contract-index-references`, `typescript-contract-storage-and-domain-types`, `emitted-contract-types-from-generics` and `typescript-contract-enums-in-domain`.

This applies to a contract built with `defineContract` from TypeScript, used without an emitted `contract.d.ts`. Its types now match what `prisma contract emit` would write for it. One change, filters and writes taking input types, applies to emitted contracts too.

### Included rows have precise types

The ORM typed every included relation as an array of `unknown` rows. It now reads each relation's target model and cardinality from the contract:

| Relation | Included value |
| --- | --- |
| `rel.hasMany`, `rel.manyToMany` | An array of the target model's rows |
| `rel.belongsTo` | One row, or the row or `null` when the relation is optional or any `from` field is optional |
| `rel.hasOne` | The row or `null` |

A cast that agrees with the new type still typechecks and can be removed. A cast that disagrees now fails to typecheck, and shows a real mismatch. A to-one relation was never an array at runtime, so fix the code that read it as one:

```diff
  const post = await db.orm.Post.include('author').first();
- const author = (post?.author as User[])[0];
+ const author = post?.author;
```

Include refinements now see the target model's fields, so `where`, `select` and `orderBy` inside them need no cast.

A relation to a model in another contract space keeps the general type, as before.

### Aggregates, operations and capabilities are typed

Aggregates, field operations and adapter capabilities were missing from the types, so code dispatched aggregates by name through a cast. Call them directly:

```diff
- const stats = await db.orm.Post.aggregate((aggregate) => {
-   const dynamic = aggregate as Record<string, (field?: string) => AggregateSpec[string]>;
-   return { total: dynamic['sum']!('views') };
- });
+ const stats = await db.orm.Post.aggregate((aggregate) => ({ total: aggregate.sum('views') }));
```

The same holds for reducers inside `include(...)`, such as `posts.count()`. The aggregates come from the aggregate descriptors of the target, the adapter and every extension, as `prisma contract emit` collects them. Aggregates contributed only by the execution stack, not by a pack in the contract, are still not in the contract's types and still need the cast.

The contract's `capabilities` now include the adapter's in its value as well as in its type, and record only enabled capabilities, as an emitted `contract.json` does. Code that read `contract.capabilities` before an execution context existed now sees the adapter's capabilities.

### Columns with type parameters keep them

A field whose column has type parameters now has the parameterized output type. This includes the field presets:

```ts
const contract = defineContract({}, ({ field, model, type }) => ({
  models: {
    Reading: model('Reading', {
      fields: { id: field.id.uuidv4String(), label: field.column(type.sql.String(50)) },
    }),
  },
}));
// row.id: Char<36> (was string)
// row.label: Varchar<50> (was string)
```

`Varchar<N>`, `Char<N>`, `Numeric<P, S>` and the others are branded strings exported from `@prisma/orm-postgres/contract-builder` and `@prisma/orm-postgres/target/codec-types`, so code that reads them as `string` keeps working. Update a type assertion or an annotation that expects plain `string` for such a value read from a row to the branded type, or widen the value with `String(value)`.

### Filters and writes take plain strings

For emitted contracts and contracts built with `defineContract`, the ORM types filters and writes with each field's input type. A field read as `Char<36>` takes a plain `string` in `where`, in field predicates, in `whereUnique`, and in `create`, `update` and `upsert`. Remove the casts that made a plain string fit:

```diff
- await db.orm.User.where({ id: idFromRequest as Char<36> }).first();
- await db.orm.User.create({ id: '123e4567-e89b-12d3-a456-426614174000' as Char<36>, email });
+ await db.orm.User.where({ id: idFromRequest }).first();
+ await db.orm.User.create({ id: '123e4567-e89b-12d3-a456-426614174000', email });
```

A field whose codec accepts more forms on input than it returns on output, such as a temporal codec that takes a string or a `Date`, now accepts those forms in filters too. A `CodecField` fragment checks values against the codec's input type, as the model's own fields do.

### Index references name the declared indexes

In a `where` or `orderBy` callback, `indexes` now has one entry per index of the model's table, as with an emitted contract: an index from `.sql({ indexes })` under its `name:` or `map:`, or under `<table>_<columns>_idx` when it has neither, and the backing index of a foreign key under `<table>_<columns>_idx`. Before, any name typechecked and a full-text index could not be passed to `fullTextMatches` or `fullTextRank`. A name that is not an index of the table now fails to typecheck:

```ts
db.orm.public.Document.where((_doc, { fns, indexes }) =>
  fns.fullTextMatches(indexes.documents_search, websearchToTsquery(query)),
);
```

The backing index of a foreign key is left out, in the build and in the type, when a key or a plain index on the same columns already serves it, or when the foreign key or the contract's `foreignKeyDefaults` sets `index: false`. A partial or typed index on those columns does not serve it. The build shortens a backing-index name to 54 bytes, and the type does the same. If that name has a character outside ASCII, the type cannot count its bytes and leaves the index out; give the foreign key's columns a declared index with `name:` to read it.

### Unique criteria, enums and junction columns

`whereUnique` on a contract built with `defineContract` now accepts only the fields of the primary key or of one unique constraint, from `.unique()` fields and the `uniques` attribute. Before, any record typechecked. A criterion that named a field outside every unique key now fails to typecheck; it failed at run time before.

`db.enums` lists only the enums the contract declares. A contract without enums offered an accessor under any name before.

A many-to-many relation whose target has no primary key now types its junction's target columns from the target's unique key, as the build does.

### Exporting a contract with declaration emit

An application that exports a contract built with `defineContract` and builds with `declaration: true` no longer gets TS2742, TS4023 or TS4094 errors when the contract uses pgvector, PostGIS or ParadeDB, or a field preset. Remove type annotations or workarounds added only to make declaration emit pass, such as an `import type {} from '@prisma/orm-extension-postgis/geojson'` line.

### Emitted contract types use the same generics

Re-run `prisma contract emit` and commit the new `contract.d.ts`. Leave the `contract.d.ts` files in migration snapshots as they are. The file now types fields and storage columns with the generics a contract built with `defineContract` uses, and writes out only the types a codec computes when emitting, such as the literal union of an enum's values. A column with type parameters reads as before, for example `Char<24>`, through `ParameterizedOutputTypeFunctions`. No code needs to change. The next section, `emitted-field-types-from-shared-generic`, covers the same re-emit for MongoDB contracts.

### Enums of a TypeScript contract

A contract built with `defineContract` no longer has an `enumAccessors` key in its type. Read enum accessors from `db.enums`, or name their type with `NamespacedEnums<typeof contract>`:

```diff
- type Accessors = (typeof contract)['enumAccessors'];
+ type Accessors = NamespacedEnums<typeof contract>['public'];
```

`db.enums.<namespace>.<Enum>.has(value)` now takes any value and narrows it to the enum's values, as it does for an emitted contract.

An `enumType` keeps its codec id as a literal type, as the emitted contract does, so a field typed by it now has its codec's query methods: `where((i) => i.role.eq('admin'))`, `i.role.ilike('ad%')`, `i.priority.gt(1)` and `orderBy((i) => i.priority.asc())` compile where they failed before with "Property 'eq' does not exist". Remove the casts or raw SQL that worked around this.

## Emitted field types name the shared generic; Mongo `defineContract` rows match emitted ones

This section covers `emitted-field-types-from-shared-generic`, `mongo-define-contract-readonly-rows`, `mongo-define-contract-factory-field-types`, `value-object-enum-fields-narrow` and `mongo-update-accessors-take-input-types`. Their summaries above say what changes for each.

Re-emit every contract with `prisma contract emit`, and leave the `contract.d.ts` files in migration snapshots as they are. The committed `contract.d.ts` changes form, not meaning: `FieldOutputTypes`, `FieldInputTypes` and the value object types are now applications of `FieldTypesFromDomain` and `ValueObjectTypesFromDomain`, with only the types a codec computes at emit time written out in `FieldTypeOverrides`. A SQL `contract.d.ts` written by a development build after 8.0.0-rc.18 imports `FieldTypesFromDomain` from the family contract types entry, which no longer exports it; it fails to compile until you re-emit it. This is the same re-emit as `emitted-contract-types-from-generics`.

For a Mongo contract written with `defineContract`, rows now have the types an emitted contract gives:

```ts
// before
const tags: string[] = user.tags;
// after: lists are readonly, as in an emitted contract
const tags: readonly string[] = user.tags;
const copy: string[] = [...user.tags];
```

A vector field with a length, such as `field.vector({ typeParams: { length: 3 } })`, reads as `Vector<3>`, which is still a `readonly number[]`.

## MongoDB fields keep their own names

### `mongo-contracts-record-stored-field-names`

For this schema:

```prisma
model User {
  id          ObjectId @id @map("_id")
  displayName String   @map("display_name")

  @@map("users")
}
```

the model's entry in `contract.json` changes like this:

```diff
 "User": {
   "fields": {
-    "_id": { ... },
-    "display_name": { ... }
+    "id": { ... },
+    "displayName": { ... }
   },
   "relations": {},
-  "storage": { "collection": "users" }
+  "storage": {
+    "collection": "users",
+    "fields": { "displayName": { "field": "display_name" }, "id": { "field": "_id" } }
+  }
 }
```

Relations name fields too: `"on": { "localFields": ["authorId"], "targetFields": ["id"] }`, where they named `_id`. So does a base model's `discriminator`. Indexes, validators and `execution` keep naming stored names, so neither the storage hash nor the execution hash changes. The documents in the database do not change.

1. Commit your work first, so the changes can be reviewed and undone with git.
2. Run `prisma contract emit` and commit the regenerated `contract.json` and `contract.d.ts`.
3. Run the colocated script from the project root:

   ```sh
   node <guide>/scripts/mongo-field-storage-names/mongo-field-storage-names.ts
   ```

   Node 24 or later runs the TypeScript script directly. It reads and writes files only. It rewrites every `*.json` file under the root that is a MongoDB contract with a model whose `storage` has no `fields`, skipping `node_modules`, `dist`, `build`, every directory whose name starts with a dot, such as `.git`, `.agents` or `.claude`, and every link it cannot follow, and the `contract.d.ts` next to it (`<name>.d.ts` next to `<name>.json`). These are the contract snapshots under `migrations/snapshots/<hash>/`, which no command regenerates, and any other contract you keep in the old form, such as a test fixture; if you keep one on purpose, restore it with git afterwards. A contract that step 2 emitted is already in the new form and is left alone. The script prints each file it rewrote, or that nothing changed.

   A snapshot cannot be rebuilt as a re-emit would write it, because the old contract does not say what the schema called the field (`_id` could have been `id @map("_id")` or `_id`). So the script keeps every field's name and records it as stored under that name, which is what the old contract meant: `"_id"` stays the field `_id`, stored as `_id`. The snapshot directory names stay as they are. Planning from such a snapshot to the re-emitted contract plans nothing and asks nothing, because the planner compares stored names.

   The script edits the type of `storage` in each `contract.d.ts` in place, on one line; run your formatter afterwards. If it cannot find a model's storage type in a `contract.d.ts`, it says so and exits 1; add the type by hand there: for each model, `readonly fields: { readonly <field>: { readonly field: '<field>' }; ... }` inside `readonly storage: { ... }`, or `readonly fields: Record<string, never>` for a model without fields.

To rewrite a file by hand instead: in each model under `domain.namespaces.<namespace>.models`, add `"fields": { "<field>": { "field": "<field>" } }` to `storage`, one entry for each key of the model's `fields`, and the matching type in `contract.d.ts`. Change nothing else.

### `mongo-orm-uses-field-names`

ORM code names fields by their names in the schema:

```ts
// before
const user = await db.orm.users.create({ name: 'Alice' });
await db.orm.users.where({ _id: user._id }).update({ name: 'Ada' });
const posts = await db.orm.posts.where({ authorId: user._id }).include('author').all();

// after
const user = await db.orm.users.create({ name: 'Alice' });
await db.orm.users.where({ id: user.id }).update({ name: 'Ada' });
const posts = await db.orm.posts.where({ authorId: user.id }).include('author').all();
```

The same holds for every field with `@map`: `firstName String @map("first_name")` is `firstName` in the ORM, where it was `first_name`, and for the fields of a raw filter expression passed to `where`, such as `MongoFieldFilter.eq('id', ...)`. A type that picks or omits `_id` from `FieldInputTypes` or `FieldOutputTypes` names the field instead, for example `Omit<FieldInputTypes['__unbound__']['User'], 'id'>`. The type checker finds most places: run it after you re-emit.

The pipeline builder reads documents, so it names stored names, and its rows have them: `db.query.from('users').match((f) => f._id.eq(id))` and `foreign._id` in a lookup stay as they are. Code that hands a pipeline row to code that expects an ORM row renames the stored names, for example `({ _id, ...rest }) => ({ ...rest, id: _id })`.

### `mongo-statements-name-fields`

```sh
# before
prisma migration plan --name tidy --rename User._id:User.userId
# after
prisma migration plan --name tidy --rename User.id:User.userId
```

A statement that renames the field stored as `_id` to a field still stored as `_id` plans nothing; one that would change `_id` is refused, as before.

The first migration you plan after running the script starts from a rewritten snapshot, which names each field by its stored name (see `mongo-contracts-record-stored-field-names`). A statement in that migration names the old field by its stored name, and the new field by its name in the schema. For a schema that had `name String @map("display_name")` and now has `title String`, which renames the stored field to `title`:

```sh
# the first migration after the upgrade
prisma migration plan --name rename-title --rename User.display_name:User.title
# every later migration
prisma migration plan --name rename-headline --rename User.title:User.headline
```

Data-loss questions in that first migration name the old fields by their stored names too. A field that keeps its stored name needs no statement at all: planning from the rewritten snapshot to the re-emitted contract compares stored names and plans nothing for it.

### `mongo-composite-field-map-refused`

Remove `@map` from the field of the composite type, or rename the field to the name in `@map`. Either way the stored documents do not change: the field was always stored under its own name.

### `mongo-typescript-stored-field-names`

To read the document id as `id` in a TypeScript contract, as a PSL contract does, store it under `_id`:

```ts
// before
const User = model('User', {
  collection: 'users',
  fields: { _id: field.objectId(), name: field.string() },
});
const Post = model('Post', {
  collection: 'posts',
  fields: { _id: field.objectId(), authorId: field.objectId() },
  relations: { author: rel.belongsTo(User, { from: 'authorId', to: User.ref('_id') }) },
});

// after
const User = model('User', {
  collection: 'users',
  fields: { id: field.objectId().mongo({ field: '_id' }), name: field.string() },
});
const Post = model('Post', {
  collection: 'posts',
  fields: { id: field.objectId().mongo({ field: '_id' }), authorId: field.objectId() },
  relations: { author: rel.belongsTo(User, { from: 'authorId', to: User.ref('id') }) },
});
```

This is optional, and it does not change the storage hash. Code that reads the field then follows `mongo-orm-uses-field-names`.

## TypeScript MongoDB contracts get collection validators

### `mongo-typescript-contract-validator`

#### What changes

Before, a MongoDB contract written in TypeScript had no collection validators, so MongoDB accepted any document shape. Now each collection whose control policy is `managed`, the default, gets the validator the same schema gets in PSL: a closed `$jsonSchema` validator with `validationLevel: strict` and `validationAction: error`. It refuses a field the model does not declare, a missing required field, and a value of the wrong BSON type. A `field.vector()` field is validated as an array. The contract's storage hash changes once, because it now includes the validators.

#### What `defineContract` now refuses

Building the contract fails with one of these errors. Change the contract until it builds.

- A field whose codec has no MongoDB data type:
  `Model "Place" field "location" uses codec "geo/point@1", which no pack in the contract provides, so its BSON type is unknown and the contract cannot describe the field.`
  List the extension that provides the codec in `extensions` in `defineContract`.
- A model whose `_id` field (the field stored as `_id`; see `mongo-typescript-stored-field-names`) can hold an array, a regular expression, undefined or null, such as `_id: field.objectId().many()`, `_id: field.string().optional()`, `_id: field.json()`, `_id: field.vector()` or `_id: field.bson()`:
  `Model "User" field "_id" can hold BSON type array or null (codec "mongo/json@1"). An _id cannot be an array, a regular expression, undefined or null: MongoDB refuses the first three, and every document has an _id.`
  Give the `_id` field a required, single-valued type. Its validator requires `_id` with the field's BSON type, so a string, int, date, bytes or document `_id` is kept as it is. A model that leaves `_id` out gets a validator that requires an `objectId` `_id`, which MongoDB adds to every document inserted without one. A model whose `_id` is not stored as an ObjectId must give its `_id` on every create: without one, MongoDB adds an ObjectId `_id`, which the validator refuses.
- An enum a validator cannot list:
  `enumType("Level") codec "mongo/int64@1" stores BSON type long, which a collection validator cannot list as an enum value. Use a codec whose BSON type is string, int, double, bool, object or array.`
  A member whose stored value is not of that type is refused too: `enumType("Ratio") member "All" is stored as "1", which a collection validator cannot list as a double. A member of a double enum must be a finite number.`
- An embed relation to a model with variants:
  `Relation "Owner.task" embeds model "Task", which has variants. The ORM reads and writes only the base fields of an embedded model, so an embedded model cannot have variants.`

The rc.17 upgrade notes advised writing an enum over a codec such as `mongo/int64@1` or `mongo/date@1` in a TypeScript contract, which had no validator. That no longer works: give the enum a codec whose BSON type is string, int, double, bool, object or array.

#### The risk: documents already stored

MongoDB does not check existing documents when a validator is added. After it is added, every insert, and every update to a document, must produce a valid document. A stored document that does not match the validator can no longer be updated, and writes from other applications that add fields outside the contract fail.

To keep a collection without a validator, for example because other applications write fields the contract does not declare, give its model a control policy other than `managed`. With `controlPolicy: 'observed'`, Prisma creates and changes nothing in that collection, so it adds no validator, and `prisma db verify` reports the collection's differences from the contract as warnings:

```ts
const Event = model('Event', {
  collection: 'events',
  controlPolicy: 'observed',
  fields: { _id: field.objectId(), name: field.string() },
});
```

`defaultControlPolicy: 'observed'` in `defineContract` does the same for every collection. Such a collection is not created by Prisma either, so create it yourself.

#### Steps

1. Run `prisma contract emit`. Each `managed` collection in `contract.json` gains a `validator`, and `storage.storageHash` changes.
2. List the documents each validator would refuse. In `mongosh`, connected to your database, run this from the directory of the emitted `contract.json` (change the path if it is elsewhere):

   ```js
   const contract = JSON.parse(require('fs').readFileSync('contract.json', 'utf8'));
   for (const namespace of Object.values(contract.storage.namespaces)) {
     for (const [name, collection] of Object.entries(namespace.entries.collection ?? {})) {
       if (collection.validator === undefined) continue;
       const refused = db
         .getCollection(name)
         .find({ $nor: [{ $jsonSchema: collection.validator.jsonSchema }] })
         .toArray();
       print(name, refused.length, refused);
     }
   }
   ```

3. Fix each listed document so it matches its model, or move it to another collection. Run step 2 again until every collection lists 0 documents.
4. Apply the validators: run `prisma db update`, or run `prisma migration plan` from the migration the database is at (`--from <its directory name>` if the project has no `db` ref) followed by `prisma db migrate`. The plan has one `widening` operation per collection, `validator.<collection>.add`, which adds its validator.
5. Run `prisma db verify`. It reports no problems.

## A collection that stores several models accepts each model's documents

### `mongo-shared-collection-validator`

If two or more models map to one collection without being variants of one base model, the collection's validator is now one `anyOf` with a branch per model. Before, it described only one of the models, so inserting or updating a document of another model failed with `Document failed validation`.

Run `prisma contract emit`. The collection's `validator` in `contract.json` and `storage.storageHash` change. Then apply the validator with `prisma db update`, or with `prisma migration plan` followed by `prisma db migrate`.

No discriminator tells these models' documents apart, so `prisma migration plan` and `prisma db update` refuse to rename or remove a field of one of them when another model in the collection stores the same field: the change would reach that model's documents too. Renaming the field to the same new name in every model that stores it, in one plan, is planned as one rename. Move the models to separate collections, or carry out the change in a `dataTransform` operation of a `migration.ts`, with a filter that selects only the documents to change.

Every collection validator now requires `_id`, in each branch. A model that declares a field stored as `_id` gets that field's BSON type, so a PSL model may now declare `id String @id @map("_id")` or any other single type. A model that declares none gets an `objectId` `_id`, because MongoDB adds one to every document inserted without it, so a MongoDB model in PSL may leave out its `@id` field. A field stored as `_id` cannot hold an array, a regular expression, undefined or null, so it cannot be a list, optional, `Json` or `Bson`. A PSL contract that built before still builds.

## A MongoDB composite type that contains itself now emits

### `mongo-recursive-value-objects-emit`

No change to your code is needed. If you removed a self-referencing composite type to make `prisma contract emit` work, you can now write it:

```prisma
type NavItem {
  label    String
  children NavItem[]
}
```

The validator for the collection that holds it requires the fields of the first `NavItem` level and refuses any other field there. It accepts any object inside `children`, because a MongoDB `$jsonSchema` validator cannot describe a type at every depth of itself. Apply the contract as usual, with `prisma db update` or with `prisma migration plan` and `prisma db migrate`.

## Migration apply failures report the runner's own code

This section covers `control-client-apply-takes-invocation` and `runner-failures-report-own-codes`.

### The control client's apply operations take the invocation

`dbInit`, `dbUpdate` and `migrate` write advice that names commands to run, and that advice needs to know where it will be run from. Pass it as `invocation`:

```ts
// Before
await control.dbUpdate({ contract, mode: 'apply', migrationsDir: 'migrations', answerQuestions });

// After
await control.dbUpdate({
  contract,
  mode: 'apply',
  migrationsDir: 'migrations',
  answerQuestions,
  invocation: { cwd: process.cwd(), configPath: undefined, dbGiven: false },
});
```

Add the same `invocation` to every `dbInit`, `dbUpdate` and `migrate` call. Set `configPath` to the config path your tool passes to `prisma`, and `dbGiven` to `true` when it passes `--db`.

A failure of these three operations is a `CliStructuredError`. Replace any use of `DbInitFailure`, `DbUpdateFailure`, `MigrateFailure` or their code types with `CliStructuredError`, and branch on `failure.code`, a dotted code such as `MIGRATION.PLANNING_FAILED`, instead of `'PLANNING_FAILED'`, `'RUNNER_FAILED'` or `'MIGRATION_PATH_NOT_FOUND'`.

The failure's fields change too:

| Before | After |
| --- | --- |
| `failure.summary` | `failure.message` |
| `failure.code === 'PLANNING_FAILED'`, `failure.conflicts` | `failure.code === 'MIGRATION.PLANNING_FAILED'`, `failure.meta.conflicts` |
| `failure.warnings` on a failed `dbInit` or `dbUpdate`, and `value.warnings` on a successful one | the `onPlannerWarnings(warnings)` option, called once per run when planning raised warnings, whether the apply then succeeds or fails |
| `failure.rowsWithoutValue`, `failure.failedTypeChange` | the runner's facts in `failure.meta`: `rowsWithoutValue` and `failedTypeChange`, and `schemaIssues` and `failedCheck` when the runner found them. A field in them is a subject object, not text such as `"User.age"` |
| `failure.failedMigration`, `failure.databaseStorageHash` | removed; the advice in `failure.fix` names the migration directory and the `--from` hash |

In `--json` output, `db init` and `db update` print the planner's warnings of a failed apply as `warn` messages before the error, instead of in the error's `meta.plannerWarnings`.

### Match the runner's code, not `MIGRATION.RUNNER_FAILED`

Code that reads `prisma db migrate`, `db init` or `db update` output with `--json`, or a control client's failure, and matches `MIGRATION.RUNNER_FAILED` or `meta.runnerErrorCode`, now matches the code itself:

```ts
// Before
if (error.code === 'MIGRATION.RUNNER_FAILED' && error.meta.runnerErrorCode === 'MIGRATION.SCHEMA_VERIFY_FAILED') {
  report(error.meta.issues);
}

// After
if (error.code === 'MIGRATION.SCHEMA_VERIFY_FAILED') {
  report(error.meta.schemaIssues);
}
```

A check that matched `MIGRATION.RUNNER_FAILED` alone, meaning "the apply failed", matches every code the runner reports: `MIGRATION.SCHEMA_VERIFY_FAILED`, `MIGRATION.PRECHECK_FAILED`, `MIGRATION.POSTCHECK_FAILED`, `MIGRATION.EXECUTION_FAILED`, `MIGRATION.POLICY_VIOLATION`, `MIGRATION.MARKER_ORIGIN_MISMATCH`, `MIGRATION.MARKER_CAS_FAILURE`, `MIGRATION.DESTINATION_CONTRACT_MISMATCH`, `MIGRATION.FOREIGN_KEY_VIOLATION` and, on MongoDB, `MIGRATION.DATA_TRANSFORM_CHECK_NOT_READ_ONLY`. `db init` and `db update` also report an extension space they cannot plan as `MIGRATION.PATH_UNREACHABLE` or `MIGRATION.NO_INVARIANT_PATH`, with `meta.spaceId`.

Read the facts from these `meta` keys:

| Before | After |
| --- | --- |
| `meta.issues` | `meta.schemaIssues` |
| `meta.operationId`, `meta.phase`, `meta.stepDescription` of a failed check | `meta.failedCheck.operationId`, `meta.failedCheck.phase`, `meta.failedCheck.description` |
| `meta.runnerErrorCode` | `code` |

`meta.failingSpace` is unchanged. `MIGRATION.PATH_UNREACHABLE` for a database with no marker now has `'empty'`, the empty contract's hash, in `meta.fromHash`, where it had `'<empty>'`. A failure also carries `meta.failedTypeChange` and `meta.rowsWithoutValue` when the runner found them.

## `setDefault` derives its operation class and has no postcheck

### `setdefault-operation-class-derived`

`this.setDefault` on the PostgreSQL `Migration` class used to take `operationClass`, and `migration plan` wrote `operationClass: 'widening'` when a migration changed an existing default. The option is gone. The method reads the migration's start contract: the operation is widening when the start contract gives the column a default, and additive otherwise, including in a migration with no start contract. Delete the option:

```typescript
// before
this.setDefault({ schema: 'public', table: 'user', column: col('role', 'text', { default: lit('member'), codecRef: { codecId: 'pg/text@1' } }), operationClass: 'widening' })
// after
this.setDefault({ schema: 'public', table: 'user', column: col('role', 'text', { default: lit('member'), codecRef: { codecId: 'pg/text@1' } }) })
```

`node migration.ts` does not check types, so a file that still passes `operationClass` runs and ignores it. An applied migration needs nothing: `prisma db migrate` applies `ops.json`.

### `setdefault-has-no-postcheck`

A `setDefault` operation checked afterwards that the column has a default. The old default passes that check, and the runner skips an operation whose check already passes before it runs. From 8.0.0-rc.15 until this release, only an additive `setDefault` carried the check, and a hand-written `this.setDefault` was additive unless it passed `operationClass: 'widening'`. Such a call on a column that already had a different default was skipped, and `prisma db migrate` then failed with `MIGRATION.SCHEMA_VERIFY_FAILED`. A `setDefault` operation now carries no check afterwards; the final schema verification compares the default's value, and setting a default twice changes nothing.

A matched `ops.json` needs action only when its migration is not applied yet and a hand-written `setDefault` in its `migration.ts` changes a default the column already has. Write its `ops.json` again before you apply it: run its `migration.ts` (`node migration.ts`), or delete the package and run `prisma migration plan` again. A package the planner wrote for a column with no default, and an applied migration, need nothing.

## PostgreSQL postchecks check the full definition

The runner runs an operation's postchecks before the operation. When they all hold, it records the operation as already applied and skips it. Several PostgreSQL operations checked only that an object with the planned name exists, so a database holding an index, constraint, policy, table or column of that name but another definition skipped the operation, and the run failed later or left the object as it was. Each of these operations now checks the object's definition in the catalog: kind, table, columns in order, types, referenced table and actions, access method, command and roles. It never compares text that PostgreSQL prints in its own form, such as expressions, predicates, check and policy bodies, or defaults. Renames now also check that the old name is gone.

### The `postgres-postcheck-*` entries

A matched `ops.json` needs action only when its migration is not applied yet. Write its `ops.json` again before you apply it: run its `migration.ts` (`node migration.ts`), or delete the package and run `prisma migration plan` again. An applied migration needs nothing; its operations do not run again. Each detection matches the old check of one operation.

### `postgres-alter-column-type-unchanged-refused`

`this.alterColumnType({ schema, table, column, type, using })` to the type the migration's start contract, after its earlier renames, already gives the column, used to build an operation whose check, the column's type, already held, so the runner skipped it and `using` never ran. `migration.ts` now refuses the call. Write the conversion as a `dataTransform`, which checks the rows themselves:

```typescript
// before
this.alterColumnType({ schema: 'public', table: 'user', column: 'email', type: 'text', using: 'lower(email)' })
// after
this.dataTransform(endContract, 'Lower-case user emails', {
  check: () => /* a query for the users whose email is not lower-case */,
  run: () => /* an update that lower-cases those emails */,
})
```

A matched `migration.ts` needs action only when the call converts a column to the type the start contract already gives it.

## The sequence of an `autoincrement()` column follows the column's type

An `autoincrement()` column takes its values from a sequence it owns. `ALTER COLUMN … TYPE` does not change that sequence, so a column widened from `int4` to `int8` kept a sequence `AS integer`, and inserts failed once it reached 2147483647. An `alterColumnType` on such a column, planned or hand-written in `migration.ts`, now also runs `ALTER SEQUENCE … AS <new width>`. It first refuses, before any step, when the sequence has already handed out a value past a narrower width. Its postcheck asks for both the column type and the sequence width. A column whose `nextval(...)` default reads a sequence it does not own changes type as before, and that sequence is left alone.

### `postgres-autoincrement-sequence-follows-column-type`

The detection matches every integer `alterColumnType` written before this change, and none written after it; only those on an `autoincrement()` column need action.

- Migration not applied yet: write its `ops.json` again before you apply it. Run its `migration.ts` (`node migration.ts`), or delete the package and run `prisma migration plan` again.
- Migration already applied: the sequence still has the old width. Change it to the column's width, for example `ALTER SEQUENCE "public"."user_id_seq" AS bigint`. `pg_get_serial_sequence('"public"."user"', 'id')` names the sequence.

## SQLite postchecks check the whole definition

### `sqlite-postchecks-check-full-definition`

The runner checks an operation's postchecks before it runs the operation, and skips the operation when they already hold. Some SQLite postchecks held for a different state:

- `createTable` checked only that a table of that name exists, whatever its columns.
- `addColumn` checked only that a column of that name exists, whatever its type or nullability.
- `createIndex` checked only that an index of that name exists, whatever its table or columns.
- `recreateTable` did not check foreign key actions (`onDelete`, `onUpdate`) or `autoincrement()`. A migration that changed only those was skipped, and `prisma db migrate` then failed with `MIGRATION.SCHEMA_VERIFY_FAILED`.

Each of these postchecks now checks the whole definition, so the runner skips an operation only when its full effect is in place.

The checks are written into `ops.json` when the migration package is written. A matched `ops.json` needs action only when its migration is not applied yet. Write its `ops.json` again before you apply it: run its `migration.ts` (`node migration.ts`), or delete the package and run `prisma migration plan` again. An applied migration needs nothing. A `recreateTable` written for an `autoincrement()` change has no text to detect; write it again as well when its migration is not applied yet.

## MongoDB postchecks check the whole definition

### `mongo-postchecks-check-full-definition`

The runner checks an operation's postchecks before it runs the operation, and skips the operation when they already hold. MongoDB has no transaction, so a run that fails part way relies on this skip when it runs again. Two MongoDB postchecks held for a different state:

- `createIndex` checked only the index keys, and `unique: true` when the index is unique. An index on the same keys with other options, such as `sparse`, a TTL, a partial filter, a collation, a wildcard projection, or other text weights or languages, passed the check, so the operation was skipped. It now checks `unique` and `sparse` both ways, `expireAfterSeconds`, `partialFilterExpression`, `wildcardProjection`, the collation fields the call gives (MongoDB fills in the others) or no collation when it gives none, and a text index's fields, `weights`, `default_language` and `language_override`.
- `collMod` with a validator that is not only a `$jsonSchema`, such as `{ status: { $in: [...] } }`, checked only the collection's validation level and action. It now compares the whole validator.

The checks are written into `ops.json` when the migration package is written. A matched `ops.json` needs action only when its migration is not applied yet. Write its `ops.json` again before you apply it: run its `migration.ts` (`node migration.ts`), or delete the package and run `prisma migration plan` again. An applied migration needs nothing.

## `contract-artifacts-restamp`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. This entry accounts for the extension's embedded `version` moving to `8.0.0-rc.19`; any other difference in the emitted files comes from an earlier entry in this guide.
