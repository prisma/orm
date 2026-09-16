# Prisma 7 supported schema, verifiable form

`schema.prisma` is `../supported/schema.prisma` with three attributes removed, because the Prisma 7 contract source rejects the original forms: Prisma 8 cannot yet express an ORM-generated value on an optional field, or `@updatedAt` combined with `@default`.

- `Timestamps.updatedAtOpt DateTime? @updatedAt` became `DateTime?` (no generator; the column stays nullable, as `../supported/migration.sql` creates it).
- `Timestamps.updatedAtNow DateTime @default(now()) @updatedAt` became `DateTime @updatedAt`, as the diagnostic advises. `@updatedAt` still sets the value on create and on update. The SQL still carries `DEFAULT CURRENT_TIMESTAMP`, which Prisma 7's next migration removes; lenient `db verify` accepts it, and strict `db verify` reports it as an extra default.
- `Defaults.uuidOpt String? @default(uuid())` became `String?` (no generator; the column stays nullable and has no database default in the SQL).

Everything else is byte-for-byte the supported schema. The test applies `../supported/migration.sql` unchanged, so the database is exactly what Prisma 7.10.0 built, interprets this file, and expects lenient `db verify` to report nothing. `../supported/schema.prisma` itself is the error case: interpreting it yields `PSL.PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED` for `updatedAtOpt` and `uuidOpt` and `PSL.PRISMA7_UPDATED_AT_WITH_DEFAULT_UNSUPPORTED` for `updatedAtNow`.

