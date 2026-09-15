# Prisma 7 supported schema, verifiable form

`schema.prisma` is `../supported/schema.prisma` with three attributes removed, because the Prisma 7 contract source rejects the original forms by decision (option (a), 2026-09-13): an ORM-generated value on an optional field and `@updatedAt` combined with `@default` cannot be spelled in Prisma 8 yet.

- `Timestamps.updatedAtOpt DateTime? @updatedAt` became `DateTime?` (no generator; the column stays nullable, as `../supported/migration.sql` creates it).
- `Timestamps.updatedAtNow DateTime @default(now()) @updatedAt` became `DateTime @default(now())` (the SQL carries `DEFAULT CURRENT_TIMESTAMP`, which is exactly that default).
- `Defaults.uuidOpt String? @default(uuid())` became `String?` (no generator; the column stays nullable and has no database default in the SQL).

Everything else is byte-for-byte the supported schema. The test applies `../supported/migration.sql` unchanged, so the database is exactly what Prisma 7.10.0 built, interprets this file, and expects `db verify` to report nothing. `../supported/schema.prisma` itself is the error case: interpreting it yields `PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED` for `updatedAtOpt` and `uuidOpt` and `PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED` for `updatedAtNow`.

