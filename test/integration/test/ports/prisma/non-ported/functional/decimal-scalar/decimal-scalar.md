# Non-ported — decimal-scalar

- `packages/client/tests/functional/decimal/scalar/tests.ts` › `possible inputs > decimal as Decimal.js instance` — findFirst matching a Decimal.js instance returns the stored decimal — filters on a Decimal.js instance value — Prisma 8 has no Decimal.js input interop (Decimal is a Numeric branded string)
- `packages/client/tests/functional/decimal/scalar/tests.ts` › `possible inputs > decimal as decimal.js-like object` — findFirst matching a decimal.js-like object returns the stored decimal — filters on a decimal.js-like object ({d,e,s,toFixed}) — Prisma 8 has no Decimal.js-like input coercion path
