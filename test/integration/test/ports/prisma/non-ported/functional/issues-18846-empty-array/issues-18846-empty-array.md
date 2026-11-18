# Non-ported — issues-18846-empty-array

- `packages/client/tests/functional/issues/18846-empty-array/tests.ts` › `correctly rejects empty arrays in places where empty objects are allowed` — subject: `AND: [[]]` (nested empty array in Prisma where input) should be type-rejected (`@ts-expect-error`) and throw a `PrismaClientValidationError` at runtime; Prisma 8's `.where()` takes a callback or shorthand object — there is no `AND: [[]]` input path, and no equivalent validation-error surface for this input shape — non-ported (input form `AND: [[]]` has no equivalent in Prisma 8's where API)
