# MySQL driver: one round trip per statement

**Project:** [`../../spec.md`](../../spec.md) · **Branch:** `mysql-driver-text-protocol` · **Design notes:** section 8 of [`../../design-notes.md`](../../design-notes.md)

## At a glance

The MySQL adapter renders a query with two parameters:

```sql
SELECT `id` FROM `user` WHERE `role` = ?1 LIMIT ?2
-- params: ['ADMIN', 10]
```

Today the driver prepares it on the server, waits for the reply, then executes it: two round trips. After this slice the driver hands the SQL and the values to the `mariadb` package's `query`, which writes the values into the statement and sends it once:

```sql
SELECT `id` FROM `user` WHERE `role` = 'ADMIN' LIMIT 10
```

One round trip for every statement, with or without values. Nothing is prepared.

## The rule

Our code never writes a value into SQL. The driver library does that. This is Will's rule from 2026-10-23, restated on 2026-10-29. Section 8 recorded it wrongly as "values never travel inside SQL text", which forced a prepared statement per query. This slice corrects section 8.

## Chosen design

- **Every statement goes through the package's text protocol.** `client.query(sql, values)` for a result, `client.queryStream(sql, values)` for `stream: true`. Both drivers, runtime and control, use this one path. Nothing calls `prepare`, `execute` or `executeStream`.
- **The package substitutes the values.** The driver keeps its `?N` → `?` rewrite and value ordering (`positional-params.ts`), then passes the ordered values to the package. The package's text encoder (`lib/cmd/encoder/text-encoder.js`, `writeParam`) writes each value:
  - a string, quoted and escaped;
  - a `Buffer`, as `_BINARY '…'`, escaped;
  - a `number` or `bigint`, as its decimal digits;
  - `null`, as `NULL`.

  It reads the server's `NO_BACKSLASH_ESCAPES` status flag from every reply and escapes for the current mode, so a user's raw `SET sql_mode` cannot break escaping. Its buffer escaping knows the connection's character set.
- **The driver's value rules stay, where the package still needs them** (`parameter-values.ts`):
  - A non-finite number is refused, because the package would write `NaN` into the SQL.
  - A bigint outside the signed 64-bit range is refused, so a parameter's type never depends on its value.
  - A `Uint8Array` is wrapped as a `Buffer`, because the package writes any other object as JSON.
  - A `Date` is refused, because the package writes it in the process's local time zone.

  An integer `number` is passed as it is: the package writes it as digits, which MySQL reads as an integer, so `LIMIT ?` works without the BIGINT conversion.
- **Rows keep their form.** Over the text protocol the server sends every value as its text, so the existing `typeCast` returns the server's text, bytes or null as the driver interface requires. The FLOAT and DOUBLE formatting in `float-text.ts` existed only because the binary protocol sent those values as binary numbers; it is deleted.
- **Prepared-statement machinery is deleted.** This includes:
  - `placeholder-count.ts`, the check of MySQL's placeholder count against the values;
  - statement closing;
  - the stream code specific to `executeStream`.

  The per-client lock stays, because it keeps statements in the order sent.
- **Session settings** are still applied once per connection, through the same path. `SET SESSION time_zone = ?` runs as `query` with values, so the package writes the value.
- **Section 8 of the design notes is rewritten** for the protocol. It records:
  - the reversal and its date;
  - the reason: two round trips per query;
  - the rule as Will stated it;
  - what keeps values safe: the package's encoder, the server status flag, and utf8mb4 fixed at sign-in.

## Coherence rationale

One reviewer reads this as "the MySQL driver sends each statement once". It touches only `packages/3-targets/mysql/3-driver`, its tests and docs, and the design notes. The adapter, codecs, runtime and everything above it are unchanged, because the driver still takes SQL with `?N` placeholders and codec-encoded values, and returns text, bytes or null.

## Scope

**In:** both drivers' statement path; deleting the prepared-statement code and the FLOAT/DOUBLE formatting; live injection tests; a round-trip count test; section 8, the driver README, the MySQL entries in `docs/reference/error-reference.md`, and an upgrade-instructions entry with no changes.

**Out:**
- Writes (slice 4).
- MariaDB (slice 6).
- The prepared-statement cache, and any option to choose the protocol.
- Any change in `packages/1-framework` or `packages/2-sql-family`.

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| A raw `SET SESSION sql_mode = 'NO_BACKSLASH_ESCAPES'` mid-session | The package escapes by the server's status flag; a live test sends hostile strings after switching the mode both ways |
| A fractional `number` such as `2.5` | The package writes `2.5`, which MySQL reads as an exact DECIMAL; the prepared path sent a DOUBLE. A live test compares a FLOAT and a DOUBLE column against a fractional parameter and records the result |
| A large or tiny `number` such as `1e21` | The package writes `1e+21`, which MySQL reads as a DOUBLE; covered by a live test |
| Negative zero | The package writes `0`; covered by a live test |
| Error 1295 ("statement not supported in the prepared statement protocol") | Can no longer occur; its README text is removed |
| `?` or `?1` inside a string value | The driver rewrites placeholders before substitution, and the package substitutes after, so a value is never scanned; a live test proves it |
| A value with a quote, a backslash, NUL, `\x1a`, multibyte characters, or invalid UTF-8 in a `Buffer` | Live injection tests in both backslash modes; each must come back exactly and never change the statement |

## Done when

- Every MySQL statement takes one round trip. A live test counts the commands the server receives (`Com_stmt_prepare` stays 0) for a query with values, a stream, a transaction and session setup.
- The injection tests pass in both backslash modes.
- The every-column-type live test reads the same values as before.
- The example app runs in CI.
