# Prisma 7 relations fixture

`schema.prisma` is `../supported/schema.prisma` reduced to the relation models (`User`, `Post`, `Tag`, `Profile`, `Settings`, `Composite`, `AuditLog`, `LegacyThing`) and both enums, with every default (`@default(...)`, `@updatedAt`) and every `@@index` removed, and the `Scalars`, `NativeTypes`, `Timestamps`, `Defaults`, and `MappedIndexes` models dropped (with them their `@@unique([firstName, other])` and `@@index`). Within the retained models, keys, uniques (`Post.slug @unique`, `@@unique([title, category])`, and the rest), and relations are unchanged from `supported/`. It predates default and index support and keeps the relation shapes isolated. The full schema is verified by `supported-verify/`.

There is no `migration.sql` here on purpose: the test applies `../supported/migration.sql`, the SQL Prisma 7.10.0 generated for the full schema, so the database is exactly what Prisma 7 builds. The interpreted contract verifies with zero findings.
