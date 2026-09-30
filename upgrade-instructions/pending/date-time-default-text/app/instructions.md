---
changes:
  - id: date-time-default-stored-as-standard-text
    summary: |
      A PSL date or time default is stored in `contract.json` as its type's standard text, the text `Temporal` prints, however it was written: `@default("2024-01-01T01:00:00+01:00")` on a `DateTime` column is stored as `"2024-01-01T00:00:00Z"`. A default that was not already in that text gets a new storage hash when the contract is re-emitted. The database needs no change: re-emit, then `prisma db sign`, or record an empty migration with `prisma migration new`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(DateTime|Timestamptz|TimestamptzJsDate|TimestamptzString|Timestamp|TimestampString|Date|DateString|Time|TimeString|Timetz)(\([^)]*\))?(\[\])?\??([ \t]+@[\w.]+(\([^)\n]*\))?)*?[ \t]+@default\([\s\[]*"'
  - id: date-time-default-refused-text
    summary: |
      `prisma contract emit` refuses a date or time default its column's type does not hold, with `PSL_INVALID_DEFAULT_LITERAL`: an offset on `Timestamp`, `Date` or `Time`, no offset on `DateTime`, `Timestamptz` or `Timetz`, a date on a time column, a time on a `Date` column, more than six digits after the decimal point, or a date or time that does not exist. The message shows text the column takes.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(DateTime|Timestamptz|TimestamptzJsDate|TimestamptzString|Timestamp|TimestampString|Date|DateString|Time|TimeString|Timetz)(\([^)]*\))?(\[\])?\??([ \t]+@[\w.]+(\([^)\n]*\))?)*?[ \t]+@default\([\s\[]*"'
  - id: date-time-ts-default-stored-as-standard-text
    summary: |
      In a TypeScript contract, a default on `field.temporal.timestamptzJsDate()`, `field.temporal.timestamptzString()`, `field.temporal.timestampString()`, the SQLite `field.temporal.datetime()`, and the `dateStringColumn`, `timeStringColumn`, `timetzColumn` and SQLite `sqliteDatetimeColumn` helpers is stored as the standard text: `new Date('2024-01-01T00:00:00Z')` is stored as `"2024-01-01T00:00:00Z"`, not `"2024-01-01T00:00:00.000Z"`. The storage hash changes; re-emit, then sign or migrate as for PSL.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.(timestamptzJsDate|timestamptzString|timestampString|datetime)\([^)]*\)(\s*\.\w+\([^)]*\))*?\s*\.default\('
        - '\b(timestamptzJsDateColumn|timestamptzStringColumn|timestampStringColumn|dateStringColumn|timeStringColumn|timetzColumn|sqliteDatetimeColumn|datetimeColumn)\b[^\n]*\.default\('
---

## `date-time-default-stored-as-standard-text`

Each date and time type now stores one text for each value, the text `Temporal` prints. These three defaults are one instant, and each is stored as `"2024-01-01T00:00:00Z"`:

```prisma
model Event {
  id Int      @id
  a  DateTime @default("2024-01-01T00:00:00Z")
  b  DateTime @default("2024-01-01T00:00:00.000Z")
  c  DateTime @default("2024-01-01T01:00:00+01:00")
}
```

| Column type | Written | Stored before | Stored now |
| --- | --- | --- | --- |
| `DateTime`, `Timestamptz` | `2024-01-01 01:00:00+01` | as written | `2024-01-01T00:00:00Z` (UTC) |
| `Timestamp` | `2024-01-01 12:34:56.500` | as written | `2024-01-01T12:34:56.5` |
| `Date` | `0044-03-15 BC` | as written | `-000043-03-15` |
| `Time` | `12:34` | as written | `12:34:00` |
| `Timetz` | `12:34:56+02` | as written | `12:34:56+02:00` |
| SQLite `DateTime` | `2024-01-01 01:00:00+01:00` | as written | `2024-01-01T00:00:00Z` |

A year outside 0000 to 9999 is a sign and six digits. `prisma contract infer` and `prisma contract print` print a date or time default in the same text.

1. Search your `.prisma` files for `@default("` on a date or time column.
2. Run `prisma contract emit` and review the diff of `contract.json`. A default that changed text changes the storage hash. The database does not change: schema verification compares the old and the new text as the same value.
3. If you create the database with `prisma db init` or `prisma db update`, `prisma db verify` now reports that the database is signed with the earlier contract. Run `prisma db verify --schema-only` to confirm the schema matches, then `prisma db sign` to sign the database with the re-emitted contract.
4. If you use migrations, `prisma migration plan` refuses with "Contract changed but planner produced no operations", because nothing in the database changes. Run `prisma migration new --name standard-date-text` to write an empty migration from the earlier contract to the re-emitted one, then `prisma db migrate`. When `migration new` cannot tell where to start, pass `--from` with the storage hash of the earlier contract.

## `date-time-default-refused-text`

`prisma contract emit` now refuses a date or time default that its column's type does not hold, with `PSL_INVALID_DEFAULT_LITERAL`:

```text
Field "Event.localAt": pg/timestamp holds no UTC offset, but "2024-01-01T00:00:00Z" has one. Leave it out, as in "2024-01-01T12:34:56".
```

| Refused | Fix |
| --- | --- |
| an offset on `Timestamp`, `Date` or `Time` | remove the offset, or make the column `DateTime` if it holds an instant |
| no offset on `DateTime`, `Timestamptz`, `Timetz` or SQLite `DateTime` | add `Z` for UTC, or the offset, as in `2024-01-01T00:00:00Z` |
| a time on a `Date` column, or a date on a `Time` or `Timetz` column | remove the part the column does not hold |
| more than six digits after the decimal point | round to six digits or fewer |
| a date or time that does not exist, such as `2024-02-30`, `25:00:00` or `24:00:00` | write a real date or time; for `24:00:00`, write ``@default(sql`'24:00:00'::time`)`` |

Run `prisma contract emit` after each fix until it succeeds.

## `date-time-ts-default-stored-as-standard-text`

A TypeScript contract stores the same standard text as PSL. The codecs whose value is a `Date` or database text now write it:

```typescript
createdAt: field.temporal.timestamptzJsDate().default(new Date('2024-01-01T00:00:00Z')),
// stored before: "2024-01-01T00:00:00.000Z"; stored now: "2024-01-01T00:00:00Z"
```

A `*String` preset or column helper default is read by the column's type the same way PSL text is, so `'2024-01-01 00:00:00+00'` on `field.temporal.timestamptzString()` is stored as `"2024-01-01T00:00:00Z"`. Text the type does not hold is refused with `CONTRACT.DEFAULT_INVALID`, and the message says what is wrong, as in the table above. Defaults on `field.dateTime()` and the other `Temporal` presets were already stored in this text and do not change.

1. Search your contract files for `.default(` on the presets and helpers named above.
2. Run `prisma contract emit` and review the diff of `contract.json`.
3. Sign the database or record an empty migration, as steps 3 and 4 of `date-time-default-stored-as-standard-text` describe.
