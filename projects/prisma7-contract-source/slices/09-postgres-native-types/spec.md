# Slice: Postgres native types a Prisma 7 schema uses (TML-3270)

## Outcome

A Prisma 7 schema whose columns use `@db.Bit`, `@db.VarBit`, `@db.Xml`, `@db.Oid` or `@db.Money` emits a contract, and `db verify` reports nothing against the database Prisma 7 built. Each type can also be written in Prisma 8 PSL and with the TypeScript builder, and `contract infer` reads each column from a database.

Today the reader refuses all five with `PSL.PRISMA7_NATIVE_TYPE_UNSUPPORTED`, so a Prisma 7 project with one such column cannot adopt Prisma 8.

`@db.Citext` was in this slice and is moved out (Will, 2026-10-29). QA showed that an existing Prisma 7 database using citext could not adopt Prisma 8 with the citext pack: `db sign` cannot check that the extension exists, so it cannot record the pack's migration. Citext follows the Postgres extensions slice, which lets a contract declare an extension. Decisions 3 to 5 below are kept for that later PR.

## Decisions (settled with Will, 2026-10-27)

1. **`bit`, `varbit`, `xml`, `oid` and `money` are built-in PostgreSQL types**, so they belong to the Postgres target.
   - `pg/bit` and `pg/varbit` already exist with codecs and type constructors; only the Prisma 7 type map lacks them.
   - `pg/xml`: values are text. PostgreSQL has no `=` operator for `xml`, so the codec declares no `equality` trait and sets an `enumRefusal` saying so. It casts from `pg/text`.
   - `pg/oid`: an unsigned 32-bit integer, a JSON number from 0 to 4294967295. It casts from `pg/int2`, `pg/int4` and `pg/int8`, refusing a value out of range. The codec gives a `number`. Prisma 7 declares it on an `Int` field.
   - `pg/money`: stored as digit text with exactly two fraction digits, the `numeric(…,2)` spelling (`"12.50"`, `"-1234.56"`). Its range is PostgreSQL's: −92233720368547758.08 to +92233720368547758.07. It casts from the integer types and `pg/numeric`, refusing a value with more than two fraction digits rather than rounding it. The codec gives a decimal string, as `pg/numeric@1` does; Prisma 7 declares it on a `Decimal` field.
2. **`money` is read correctly, not as Prisma 7 reads it.** PostgreSQL prints `money` by the session's `lc_monetary`. Prisma 7.10.0's pg adapter reads it with `money.slice(1)`, which turns `-$7.25` into `$7.25` and keeps thousands separators. The Postgres target declares `lc_monetary=C` as a session setting beside `DateStyle=ISO`, so every driver connection prints `$1,234.56` and `-$1,234.56`. The codec's `fromWire` reads that text exactly and refuses any other form with a structured error naming the setting, as the date codecs refuse a non-ISO `DateStyle`. `toWire` sends digit text. PostgreSQL reads `money` input by `lc_monetary` too, so the adapter sends each `money` parameter as `numeric` and casts it, `$1::numeric::money`, which reads no separators. The conversion still scales by the locale's number of fraction digits, so writes, like reads, need `lc_monetary=C` under a locale whose number is not two. The setting also changes how `money` prints in the application's own raw SQL; the docs say so.
3. **(Later PR.) `citext` is a trusted contrib module, so it is an extension pack**, `packages/3-extensions/citext` (`@internal/extension-citext`), with a contract space whose one baseline migration runs `CREATE EXTENSION IF NOT EXISTS citext`, as pgvector's does. Its data type is `citext/citext` (catalog text `citext`), its codec `pg/citext@1` gives a `string`, and its PSL type constructor is `citext.Citext`, marked inferred. It casts from `pg/text`. The codec declares the traits a text codec declares: equality, ordering and text matching, all case-insensitive in PostgreSQL.
4. **(Later PR.) Packaging by tier of Postgres extension:**
   - every third-party extension has its own published package (pgvector, postgis and paradedb already do; nothing moves);
   - the 20 contrib modules PostgreSQL marks trusted share one published package, `@prisma/orm-postgres-contrib`, one entrypoint group per module (`/citext/...`);
   - the other 30 contrib modules will share one more package, created when the first of them needs a pack.
   An ADR records this rule and why `orm-postgres-contrib` does not carry the `orm-extension-` prefix of the six existing packs.
5. **(Later PR.) The Prisma 7 reader maps `@db.Citext` to `citext.Citext` only when the citext pack is composed.** Without it, the reader refuses the field with a diagnostic that names the edit: add `citext` from `@prisma/orm-postgres-contrib/citext/control` to `extensions` in `prisma.config.ts`. The reader does not read the datasource `extensions` list (TML-3460 owns that).

## Requirements

- Each of the five types: the Prisma 7 fixture `native-type-rejected-<type>` becomes an accepted fixture whose emitted contract is checked; `native-type-rejected-defaults` and `-uses` follow (a literal default on each type is read through the type's cast rule; a default no cast admits is refused with the usual code).
- `db verify` against the database Prisma 7's own SQL built, with a column of each type, reports nothing (extend the reference SQL recorded from Prisma 7.10.0 and the verify test that runs it).
- Prisma 8 PSL and the TypeScript builder can declare each type; `contract infer` prints each column with its inferred constructor; the printer round-trips each.
- The codec conformance test kit covers each new codec against a real database, including `money` values that are negative and at least 1,000, and both ends of `oid`'s range.
- `docs/reference/scalar-types.md`, the error reference entry for `PSL.PRISMA7_NATIVE_TYPE_UNSUPPORTED`, and the Postgres facade README's table list only what is still refused (of these six, only `@db.Citext`).

## Non-goals

- Reading the Prisma 7 datasource `extensions` list, or planning `CREATE EXTENSION` from a contract (TML-3460).
- Moving pgvector, postgis or paradedb.
- Packs for any other contrib module.

## Done when

The PR is merged, TML-3270 is Done in Linear with a closing comment, and the five fixtures above verify clean.
