---
changes:
  - id: ts-numeric-inet-enum-members-written-as-postgres-prints
    summary: |
      `defineContract` from the Postgres package now refuses a `pg/numeric@1` enum member written with a leading zero or as negative zero, such as "01.5" or "-0", and a `pg/inet@1` member Postgres prints differently, such as "10.0.0.1/32" or "::FFFF:10.0.0.1", with `CONTRACT.ENUM_INVALID`. The message says the text to write. An inet member that is not an address is refused too. Rewrite each refused member, re-emit, and apply a migration that replaces the enum's CHECK constraint.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\benumType\('
  - id: psl-numeric-inet-enum-members-refused
    summary: |
      A PSL enum block typed `@@type("pg/numeric@1")`, `@@type("pg/inet@1")` or `@@type("pg/int8@1")` is now refused at `contract emit` with `PSL_EXTENSION_INVALID_VALUE` when a member is not written as Postgres prints it, such as "01.5", "-0", "10.0.0.1/32", "::FFFF:10.0.0.1" or, on int8, "007", or is not an address. The message says the text to write. Rewrite each refused member and re-emit. A numeric or inet enum's CHECK constraint changes, so apply a migration that replaces it; an int8 enum's contract is unchanged.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@@type\(\s*"pg/(?:numeric|inet|int8)@1"\s*\)'
  - id: numeric-inet-defaults-stored-as-postgres-prints
    summary: |
      A numeric default written with a leading zero or as negative zero in a TypeScript `.default()`, and an inet default written in a form Postgres prints differently, in PSL or in a TypeScript `.default()`, are now stored as Postgres prints them, so emitting the contract again changes its storage hash. An inet default that is not an address is now refused. Earlier versions could not apply most such contracts: the command that applied them failed and changed nothing. Emit the contract again, then run that command again.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '\bInet\b[^\n]*@default\('
        - '@db\.Inet\b[^\n]*@default\(|@default\([^\n]*@db\.Inet\b'
        - '\.default\(\s*[''"`]-?0(?:\d|\.0*[''"`]|[''"`])'
        - '(?<![\s\S])(?![\s\S]*GENERATED FILE - DO NOT EDIT)[\s\S]*?(?:[''"]pg/inet@1[''"]|\bpgInetColumn\b)'
  - id: ts-enum-string-timestamp-codecs-refused
    summary: |
      `defineContract` from the Postgres package now refuses an `enumType` typed by `pg/timestamp-string@1` or `pg/timestamptz-string@1` with `CONTRACT.ENUM_INVALID`. A query reads those values as the text Postgres prints, while the contract stores ISO 8601, so `db.enums` never found a value read back. Type the enum with `pg/timestamp-temporal@1` or `pg/timestamptz-temporal@1` and write its members as Temporal values.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\s\S])(?![\s\S]*GENERATED FILE - DO NOT EDIT)[\s\S]*?(?:[''"]pg/timestamp(?:tz)?-string@1[''"]|\b(?:PG_TIMESTAMP(?:TZ)?_STRING_CODEC_ID|pgTimestamp(?:tz)?StringColumn)\b)'
---

## `ts-numeric-inet-enum-members-written-as-postgres-prints`

A value in a contract is now the text Postgres returns for it. Postgres reads `01.5` as a `numeric` and prints `1.5`, and reads `10.0.0.1/32` as an `inet` and prints `10.0.0.1`. An enum member written the first way was stored that way in `contract.json` and in the enum's CHECK constraint, so `db.enums.<namespace>.<Enum>.has(row.value)` was false for every value read back. `defineContract` now refuses such a member and says what to write:

```text
CONTRACT.ENUM_INVALID: enumType("Ratio"): member "Half" is written "01.5", but the column stores "1.5". Write the member as "1.5".
```

Refused members:

- On `pg/numeric@1`, a member with a leading zero (`"01.5"`, `"007"`) or written as negative zero (`"-0"`, `"-0.00"`). Write it without the leading zeros or the minus sign: `"1.5"`, `"7"`, `"0"`, `"0.00"`. Trailing zeros stay, because Postgres keeps them on a `numeric` with no scale.
- On `pg/inet@1`, an IPv4 host address with `/32`, an IPv6 host address with `/128`, IPv6 with an upper-case hex digit, IPv6 with zeros Postgres compresses (`2001:db8:0:0:0:0:0:1` is `2001:db8::1`), or an IPv4-mapped address written in hex (`::ffff:a00:1` is `::ffff:10.0.0.1`). Write it as the message says.
- On `pg/inet@1`, a member that is not an address, refused with `pg/inet@1 JSON value must be an IP address as PostgreSQL writes it`.

1. Run `prisma contract emit`, or run the code that calls `defineContract`. Each refused member is reported with the value to write. The detection for this change looks for calls to `enumType(`; if you import it under another name, search for that name, and look for enums typed by `pg/numeric@1` or `pg/inet@1`.
2. Rewrite each refused member as the message says. Code that reads members through the enum, such as `db.enums.public.Ratio.members.Half`, needs no change. Code that compares a value with the old spelling does.
3. Re-emit. The enum's membership CHECK constraint's expression changes, and its name is derived from its expression, so the storage hash and the constraint's name both change. Plan and apply a migration: it drops the old CHECK constraint and adds the new one. Dropping a constraint is a destructive operation, so the plan needs the destructive operation class allowed.

Creating a client from a `contract.json` emitted by an earlier version that still holds such a member fails with `RUNTIME.DECODE_FAILED`, because `db.enums` reads every member through its codec. Re-emit the contract with this version first.

## `psl-numeric-inet-enum-members-refused`

The same rule holds in PSL. An enum block typed by `pg/numeric@1`, `pg/inet@1` or `pg/int8@1` whose member is not written as Postgres prints it is refused at `contract emit`:

```text
PSL_EXTENSION_INVALID_VALUE: enum "Ratio" member "Half" was rejected by codec "pg/numeric@1": pg/numeric@1 JSON value must be "1.5", as PostgreSQL writes this value
```

Rewrite each member as the message says.

- For a numeric or inet enum, the contract held the member as written, so follow steps 2 and 3 of `ts-numeric-inet-enum-members-written-as-postgres-prints`.
- For an int8 enum, such as a member written `"007"` or `"-0"`, earlier versions stored it as Postgres prints it, `"7"` or `"0"`. Write it that way and re-emit; `contract.json`, the CHECK constraint and every hash are unchanged.

## `numeric-inet-defaults-stored-as-postgres-prints`

A default is converted rather than refused, as a uuid default already is:

| Written | Stored |
| --- | --- |
| `.default('01.5')` on `pg/numeric@1` | `"1.5"` |
| `.default('-0')` on `pg/numeric@1` | `"0"` |
| `@default("10.0.0.1/32")` on `Inet`, or `.default('10.0.0.1/32')` on `pg/inet@1` | `"10.0.0.1"` |
| `@default("::FFFF:10.0.0.1")` on `Inet`, or the same `.default()` on `pg/inet@1` | `"::ffff:10.0.0.1"` |
| `@default("not an address")` on `Inet` | refused, `PSL_INVALID_LITERAL` |

A PSL numeric default was already converted: `@default(01.5)` was stored as `"1.5"`.

Earlier versions stored such a default as written, and Postgres stores the converted form, so the check that runs after the change is applied failed: `db init`, `db update` and `db migrate` stopped with `MIGRATION.RUNNER_FAILED` (`MIGRATION.SCHEMA_VERIFY_FAILED`) and rolled the change back. The database has none of the changes that contract adds, and no marker for it. With this version, a `contract.json` that still holds such a default stops `db init`, `db update` and `migration plan` with `CONTRACT.DEFAULT_INVALID`.

Emit the contract again with this version. The stored default changes, and with it the storage hash. Then:

- For a project kept with `db init` or `db update`, run the command that failed again. It applies the contract, and `db verify` then passes.
- For a project with migrations, delete the migration package that never applied: its directory under `migrations/app/`, and its contract snapshot `migrations/snapshots/<hash>/`, where `<hash>` is the `to` hash in the package's `migration.json`. Then run `prisma migration plan` and `prisma db migrate`.

One case did apply: a numeric default with a leading zero or a minus sign on zero, on a column with a precision such as `numeric(10,2)`, because earlier versions compared such a default by value. After you re-emit, the database needs no change but its marker names the old storage hash. Run `prisma db sign` for a project kept with `db init` or `db update`, or plan and apply a migration for a project with migrations.

## `ts-enum-string-timestamp-codecs-refused`

`pg/timestamp-string@1` and `pg/timestamptz-string@1` read a value as the text Postgres prints, such as `2024-01-02 03:04:05` or `2024-01-02 03:04:05+00`, while the contract stores ISO 8601, such as `2024-01-02T03:04:05` or `2024-01-02T03:04:05Z`. The `timestamptz` text also depends on the session's time zone. No member can equal a value read back, so `defineContract` now refuses an `enumType` typed by either codec:

```text
CONTRACT.ENUM_INVALID: enumType("Stamp"): an enum cannot use the codec pg/timestamp-string@1. A query reads each value as the text PostgreSQL prints, such as "2024-01-02 03:04:05", while the contract stores it in ISO 8601, such as "2024-01-02T03:04:05", so no value read back equals a member.
```

PSL refuses an enum block typed by either codec with the same reason, as `PSL_EXTENSION_INVALID_VALUE` at its `@@type`; it used to report the codec as unknown.

Type the enum with the Temporal codec of the same column type, `pg/timestamp-temporal@1` or `pg/timestamptz-temporal@1`, and write each member as a `Temporal.PlainDateTime` or a `Temporal.Instant`. `db.enums` then holds Temporal values and finds a value read back. Re-emit the contract; the enum's codec changes, and with it the storage hash. Plan and apply a migration, or run `prisma db sign` for a project kept with `db init` or `db update`.
