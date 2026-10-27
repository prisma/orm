---
changes:
  - id: iso-string-date-time-values
    summary: |
      The PostgreSQL text date and time types (`TimestamptzString`, `TimestampString`, `DateString`, `TimeString`, `Timetz`) read and write ISO 8601, the form the contract stores, instead of the text PostgreSQL prints. A `timestamptz` reads as the instant in UTC whatever the session's time zone, as in `2024-01-01T00:00:00Z`. A literal default or enum member on these types must be written in that form.
    detection:
      glob: "**/*.{prisma,ts,tsx,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\w$])(?:TimestamptzString|TimestampString|DateString|TimeString|Timetz)(?![\w$])'
        - '(?<![\w$])(?:timestamptzStringColumn|timestampStringColumn|dateStringColumn|timeStringColumn|timetzColumn|createdAtString|updatedAtString)(?![\w$])'
        - 'pg/(?:timestamptz-string|timestamp-string|date-string|time-string|timetz)@1'
  - id: date-style-iso-required
    summary: |
      The PostgreSQL driver ensures `DateStyle=ISO` on every connection it uses, including a `pg.Pool` or `pg.Client` the application passes to Prisma, which it sets with a statement. A statement in the application that sets a `DateStyle` other than `ISO`, or a pooler that drops the startup option, makes every read of a date or timestamp fail with `RUNTIME.DATE_STYLE_NOT_ISO`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs}"
      matches:
        - 'new\s+(?:pg\.)?(?:Pool|Client)\s*\('
---

# Text date and time values are ISO 8601

A column of `TimestamptzString`, `TimestampString`, `DateString`, `TimeString` or `Timetz` used to read the text PostgreSQL prints, which depends on the session's `TimeZone` and `DateStyle`. It now reads ISO 8601, the same on every server:

| Type | Before | After |
| --- | --- | --- |
| `TimestamptzString` | `2024-01-01 01:00:00+01` on a server in `Europe/Berlin` | `2024-01-01T00:00:00Z` |
| `TimestampString` | `2024-01-01 12:34:56.5` | `2024-01-01T12:34:56.5` |
| `DateString`, 44 BC | `0044-03-15 BC` | `-000043-03-15` |
| `Timetz` | `12:34:56+02`, `12:34:56+00` | `12:34:56+02:00`, `12:34:56Z` |

The same text is read inside an `.include()`. `infinity` and `-infinity` are unchanged. The generated `now()` values of these columns, such as `temporal.updatedAtString()`, are written in the same form.

Change the code that reads these values:

- Code that parses the old text, for example by replacing the space with `T` or appending `Z` before `new Date(...)`, can pass the value to `new Date(...)` or `Temporal.Instant.from(...)` directly for a `TimestamptzString`. A `TimestampString` value has no offset; append `Z` to read it as UTC, as before.
- Code that compares a read value with text in the old form, in application code or in tests, compares with the ISO form.
- Code that shows a value to a user formats it for display, since the value is no longer in the session's time zone.

A value the application writes may still be in any form PostgreSQL reads, and it reads back in ISO 8601. A literal default or an enum member on these types must be written in the stored form, because Prisma compares it with the value a query returns:

```ts
// Before
scheduledAt: field.column(timestamptzStringColumn).default('2024-01-15 10:30:00+00'),

// After
scheduledAt: field.column(timestamptzStringColumn).default('2024-01-15T10:30:00Z'),
```

`contract emit` refuses a default in another form with `CONTRACT.DEFAULT_INVALID`, and the message shows the form to write. A PSL default written with a tag, such as `` @default(timestamptz`2024-01-15 10:30:00+00`) ``, is unchanged. An enum on `TimestampString`, `TimestamptzString` or `Timetz` is now allowed.

The `now()` value of a `TimestampString(p)` or `TimestamptzString(p)` column is now rounded down to the column's precision, as a time column's is, so the column stores the value generated. Emit the contract again: its execution hash changes where such a column has a `now()` generator.

## `DateStyle=ISO` is required

The PostgreSQL driver now ensures `DateStyle=ISO` on every connection it uses. A connection Prisma opens from a URL starts with it as a startup option, after any `options` in the URL or `PGOPTIONS`. On a `pg.Pool` or `pg.Client` you pass to Prisma, the driver sets it with one statement on each connection before first use, and again after a connection held for a transaction, an ORM operation or a Supabase role scope is released. Nothing needs changing for either.

Remove any statement that sets a `DateStyle` other than `ISO` on a connection Prisma uses, such as a `SET DateStyle` in a pool's `connect` handler or in raw SQL: every date and time codec that reads a date or timestamp (text, `Temporal` or `Date`) refuses text in another style with `RUNTIME.DATE_STYLE_NOT_ISO`. Behind a connection pooler that refuses startup options, pass Prisma your own `pg.Pool` instead of a URL; behind one that runs each statement on another server connection, also run `ALTER ROLE <role> SET DateStyle = 'ISO'` (or set it on the database).
