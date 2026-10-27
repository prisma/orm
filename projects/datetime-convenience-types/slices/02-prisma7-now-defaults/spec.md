# Slice 2 — `prisma7Schema` maps `@default(now())` as Prisma 7 behaved

**Linear:** [TML-3719](https://linear.app/prisma-company/issue/TML-3719) · **Parent:** [project spec](../../spec.md), decision 10

## At a glance

```prisma
// Prisma 7 schema, read by prisma7Schema('./schema.prisma')
model Post {
  id        Int      @id @default(autoincrement())
  createdAt DateTime @default(now())
}
```

| | Today | After |
| --- | --- | --- |
| Contract | database default `now()` only | database default `now()` and the `onCreate` generator `now` resolved from the column's codec |
| `create` through Prisma 8, server `TimeZone=Asia/Tokyo` | the database fills `createdAt` with Tokyo wall-clock time | the client writes the current UTC time |
| `INSERT` from outside Prisma | the database default | the database default (unchanged) |

Prisma 7 filled `@default(now())` on the client and also wrote the database default. Omitting the client generator is a bug.

## Chosen design

- The Prisma 7 reader (`packages/2-sql/2-authoring/contract-prisma7`) lowers `@default(now())` on a date or time field to both the database default and an `onCreate` generator, through the generator function registry, exactly as Prisma 8 PSL's `@default(now()) @onCreate(now())` lowers. It resolves the generator by the field's codec, so it is correct for whatever codec the reader picks today and after slice 5 changes it.
- `@default(now())` together with `@updatedAt` keeps the database default and both generators.
- The storage hash does not change (the column and its default are the same); the execution hash does, because the contract gains a generator. Adopted projects re-emit and commit the contract; there is no migration and no `db sign`, because the database marker records only the storage and profile hashes.

## Scope

**In:** the Prisma 7 reader's default lowering, its tests, the Prisma 7 adoption journey test and `examples/prisma7-adoption` if its contract changes, the `contract-prisma7` README, an `app` upgrade instruction, and an empty `extension` declaration for the Postgres README edit.

**Out:** any change to which codec the reader picks (slice 5); `contract infer`, which reads a database and cannot know the default came from Prisma 7.

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| `@default(now())` on a `@db.Date` or `@db.Time` field | Generator resolved by codec, like any other date or time codec |
| Optional field with `@default(now())` | Same mapping |
| `@default(now())` and `@updatedAt` on one field | Database default plus `onCreate` and `onUpdate` generators |
| A create that supplies `createdAt` explicitly | The supplied value wins, as for any generator |

## Slice-specific done conditions

- A Prisma 7 schema adopted with `prisma7Schema`, on a session with `TimeZone=Asia/Tokyo`, stores UTC for a create through Prisma 8, and a raw `INSERT` still gets the database default.

## Dispatch plan

1. **Reader mapping, tests, journey and upgrade instruction** — outcome: the at-a-glance table holds. Gates: `pnpm --filter @internal/contract-prisma7 test` (or the package's real name), the Prisma 7 journey test files, `pnpm typecheck` and `pnpm lint` for touched packages, `pnpm fixtures:check`, `pnpm check:upgrade-coverage --mode pr`.
