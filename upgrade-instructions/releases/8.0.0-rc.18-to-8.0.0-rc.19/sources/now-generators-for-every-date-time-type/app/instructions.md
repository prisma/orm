---
changes:
  - id: string-timestamp-presets-write-text
    summary: |
      The `temporal.*String` presets on Postgres (`timestampString`, `timestamptzString`, `createdAtString`, `updatedAtString`), and every `@updatedAt` field a `prisma7Schema(...)` contract reads, now fill the column with text from a new generator instead of a `Date`. Re-emit the contract with `prisma contract emit`. Only the execution hash changes, so the database needs no migration and no `db sign`. The detection matches a schema or contract source that uses one of these presets or `@updatedAt`.
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      matches:
        - 'temporal\.(?:timestamp|timestamptz|createdAt|updatedAt)String\('
        - '@updatedAt\b'
  - id: string-timestamp-codecs-take-text-only
    summary: |
      The Postgres `pg/timestamp-string@1` and `pg/timestamptz-string@1` codecs, behind `TimestampString(p)` and `TimestamptzString(p)`, now refuse a value that is not text with `RUNTIME.ENCODE_FAILED`. Before, a `Date` that reached them at runtime was converted. The ORM types were already `string`, so code that compiled still compiles. Code that passes a `Date` through a cast or from JavaScript now fails at runtime; write the text instead, such as `date.toISOString()`. A direct call of the codec's `encode` with a `Date` is now a type error.
---

# Re-emit contracts that use a string timestamp preset

On Postgres, a field written `temporal.timestampString(3, onCreate: now, onUpdate: now)`, `temporal.updatedAtString()` or another `temporal.*String` preset is filled by a generator that writes text, such as `2024-01-02 03:04:05.678` or `2024-01-02 03:04:05.678+00`. Before, it was filled by `timestampNow`, which produced a `Date`. A Prisma 7 schema read through `prisma7Schema(...)` gets the same preset for each `@updatedAt` field.

The generator's id is in the execution section of `contract.json`, so the execution hash changes. Run `prisma contract emit` again and commit the new `contract.json` and `contract.d.ts`. The storage hash does not change, and the database marker holds only the storage and profile hashes, so there is no migration to plan and no need to run `prisma db sign`.

# A string timestamp column takes text, not a `Date`

`TimestampString(p)` and `TimestamptzString(p)` columns take and return text, and the ORM types for them were already `string`, so code that compiled before still compiles. What changes is at runtime: their codecs used to convert a `Date` that reached them, and now they refuse it with `RUNTIME.ENCODE_FAILED`. A `Date` reaches them only through a cast, from JavaScript, or from a contract emitted before this change, whose generator still produced a `Date`, so re-emit the contract first.

```ts
// Before: compiles only through a cast, and was converted at runtime
await db.orm.public.Post.create({ title: 'Hello', publishedAt: new Date() as unknown as string });

// After
await db.orm.public.Post.create({ title: 'Hello', publishedAt: new Date().toISOString() });
```

A direct call of the codec's `encode` with a `Date` is now a type error as well.

To work with `Date` values, you can change the column to `TimestamptzJsDate(p)` (`temporal.timestamptzJsDate(...)` as a preset). That changes the column type to `timestamptz`, so it needs a migration: plan and apply one with `prisma migration plan` and `prisma migration apply`, and check how existing `timestamp` values convert, because Postgres reads them in the session's time zone.
