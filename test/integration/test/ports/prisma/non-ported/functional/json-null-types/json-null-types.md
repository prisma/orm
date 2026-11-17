# Non-ported — json-null-types

- `packages/client/tests/functional/json-null-types/tests.ts` › `nullableJsonField > JsonNull` — `Prisma.JsonNull` sentinel creates a nullable JSON field storing JSON null literal — `Prisma.JsonNull`/`Prisma.DbNull`/`Prisma.AnyNull` are Prisma-client-specific sentinel objects; Prisma 8 has no equivalent distinction between JSON null literal and SQL NULL (nullable `Json?` fields use plain `null`).
- `packages/client/tests/functional/json-null-types/tests.ts` › `nullableJsonField > DbNull` — `Prisma.DbNull` sentinel stores SQL NULL in nullable Json field — same gap.
- `packages/client/tests/functional/json-null-types/tests.ts` › `requiredJsonField > JsonNull` — `Prisma.JsonNull` sentinel on required Json field stores JSON null literal — same gap.
- `packages/client/tests/functional/json-null-types/tests.ts` › `requiredJsonField > DbNull` — `Prisma.DbNull` rejected with @ts-expect-error and runtime error on required Json — same gap (no Prisma.DbNull/JsonNull distinction in Prisma 8; also asserts a Prisma-specific inline error snapshot).
- `packages/client/tests/functional/json-null-types/tests.ts` › `properties of DbNull/JsonNull/AnyNull > instanceof checks pass` — `Prisma.DbNull instanceof Prisma.NullTypes.DbNull` etc. — Prisma-client-specific `NullTypes` class hierarchy with no Prisma 8 equivalent.
- `packages/client/tests/functional/json-null-types/tests.ts` › `properties of DbNull/JsonNull/AnyNull > custom instances are accepted for cross-bundle compatibility` — `new Prisma.NullTypes.JsonNull()` accepted for cross-bundle compat — same gap.
