---
changes:
  - id: client-functions-move-from-default-to-on-create
    summary: |
      `@default` now sets a database default only. `@default(uuid())`, `@default(cuid(2))`, `@default(ulid())` and `@default(nanoid())`, with any arguments, are refused with `PSL_GENERATOR_IN_DEFAULT`. Write `@onCreate(uuid())` and so on instead. Run `scripts/rewrite-default-generators.mjs` with the Prisma 8 schema files as arguments to rewrite them. The contract does not change, so there is nothing to re-emit, sign or migrate. The detection matches schema files that write one of these functions in `@default`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@default\(\s*(uuid|cuid|ulid|nanoid)\s*\('
    script: scripts/rewrite-default-generators.mjs
  - id: contract-print-writes-generator-attributes
    summary: |
      `contract print` now writes every generated value as `@onCreate(fn())` or `@onUpdate(fn())` after the column type, instead of a `temporal.*` or `id.*` field preset call or `@default(uuid())`. A printed file reads back as the same contract, with the same hashes. It also writes columns it refused before: a value generated on update, and a generated value beside a database default. Nothing to do unless you compare printed files with saved copies.
---

# Client generators are written `@onCreate(...)` and `@onUpdate(...)`

Prisma 8 PSL now says who writes a value. `@default(...)` is a database default: the database fills the column when an insert leaves it out. `@onCreate(fn())` and `@onUpdate(fn())` are values the client generates, on create and on every update. A function resolves for the column's codec, so `uuid()` works on `String`, `VarChar(n)`, `Char(n)` and `Uuid`, and `now()` gives each date and time type the value its codec takes.

```prisma
// Before
model Post {
  id        String   @id @default(uuid(7))
  slug      String   @default(nanoid(12))
  createdAt DateTime @default(now())
}

// After
model Post {
  id        String   @id @onCreate(uuid(7))
  slug      String   @onCreate(nanoid(12))
  createdAt DateTime @default(now())
}
```

`@default(now())` and `@default(autoincrement())` do not change. A column may have both: `createdAt DateTime @default(now()) @onCreate(now())` makes the client write its time on create and leaves the database default for other inserts.

## `client-functions-move-from-default-to-on-create`

Commit your work first, so the change can be reviewed and undone with git. Run the script with every Prisma 8 schema file of the project as arguments, from the project root:

```sh
node <guide>/scripts/rewrite-default-generators.mjs src/prisma/contract.prisma
```

`<guide>` is the directory that holds this guide. The script reads and rewrites only the files it is given. For each one it prints how many calls it rewrote, or that it left the file unchanged. It rewrites every `@default(uuid(...))`, `@default(cuid(...))`, `@default(ulid())` and `@default(nanoid(...))` to `@onCreate(...)`, keeping the call exactly as written, spaces included, and changes nothing else. It leaves string literals and `//` comments unchanged and does not count them, so rewrite a commented-out field yourself if you want it in step.

Do not pass a Prisma 7 `schema.prisma` that your config reads with `prisma7Schema(...)`. Prisma 7 keeps `@default(uuid())`, and the Prisma 7 reader turns it into the same generator. The script rewrites only a file that has the `// use prisma-8` directive (or the older `// use prisma-next`), read by the same rule `contract emit` uses. It leaves every other file unchanged and prints a line for it, so a Prisma 7 schema split across files is safe even when a file holds only models.

The contract does not change: `@onCreate(uuid())` lowers to the generator `@default(uuid())` lowered to, so `prisma contract emit` writes the same `contract.json` and hashes, and nothing needs to be signed or migrated.

In a TypeScript contract, `field.generated(...)` keeps working for now. Its replacement is `.onCreate(...)` with a call from `gen`, which this release adds:

```ts
import { field, gen } from '@prisma/orm-postgres/contract-builder';

const id = field.column(textColumn).id().onCreate(gen.uuid(7));
const updatedAt = field.column(timestamptzColumn).onCreate(gen.now()).onUpdate(gen.now());
```

## `contract-print-writes-generator-attributes`

`contract print` writes each generated column as its type followed by the generator attributes. A `temporal.timestamptz(3, onCreate: now, onUpdate: now)` field prints as `Timestamptz(3) @onCreate(now()) @onUpdate(now())`, and `@default(uuid())` prints as `@onCreate(uuid())`. Both read back as the same contract.
