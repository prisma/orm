---
changes:
  - id: stored-contracts-expand-type-aliases
    summary: |
      A stored SQL contract whose columns name a type alias in `typeRef` no longer loads. Run `scripts/expand-type-aliases/expand-type-aliases.ts` from the project root, then re-emit the contract, then run `prisma db sign` against every database. The script writes each alias's parameters into the columns typed by it, in every stored contract, migration snapshots and the emitted `contract.json` included, and refreshes every hash and reference that changes.
    detection:
      glob: "**/contract.json"
      matches:
        - '"typeRef"\s*:'
    script: scripts/expand-type-aliases/expand-type-aliases.ts
  - id: psl-alias-attributes
    summary: |
      No action is needed. A `types {}` alias in PSL may now carry `@default`, `@onCreate` and `@onUpdate`, and the targets contribute `temporal.CreatedAt` and `temporal.UpdatedAt`. Aliases are still valid PSL, so a `contract.prisma` that uses them does not change.
  - id: ts-types-key-removed
    summary: |
      The TypeScript contract builder no longer takes a `types` key, and `field.namedType(...)` accepts only an enum. Replace `types: { X: type.Y(...) }` and each `field.namedType(types.X)` with a constant `const X = field.column(type.Y(...))` used as the field, and remove `types` from the object the contract returns. Write a `types` entry of the form `{ kind: 'codec-instance', ... }` that a field uses as a constant too, and delete one that no field uses. Re-emit the contract. The detection matches TypeScript files that call `field.namedType` with an alias or a string, or that return a `types` key from `defineContract`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])field\.namedType\(\s*(?:types\b|[\x27"`])'
        - '(?<![\s\S])(?=[\s\S]*\bdefineContract\()[\s\S]*(?<![\w$.\x27"])types\s*(?::(?!\s*(?:field\.|\{\s*codecTypes\b))|,|\})'
  - id: supabase-contract-expanded
    summary: |
      The `@prisma/orm-extension-supabase` contract no longer stores its nine type aliases, so the Supabase space's storage hash changes. Run `prisma db sign` against every database after upgrading.
    detection:
      glob: "**/package.json"
      matches:
        - '"@prisma/orm-extension-supabase"'
---

# Type aliases are written into each column

A type alias is now authoring shorthand only. In PSL, `types { Slug = VarChar(64) }` still works, but the contract no longer stores `Slug` in `storage.types` with a `typeRef` on each column that uses it. Each column stores the alias's codec and parameters itself. In TypeScript, an alias is a constant field builder.

Do the steps in this order: run the script that rewrites the stored contracts (`stored-contracts-expand-type-aliases`), change the TypeScript contract source if you have one (`ts-types-key-removed`), re-emit the contract, and then sign every database.

## `stored-contracts-expand-type-aliases`

Migration snapshots, the emitted `contract.json` and any other stored contract written by an earlier release may have a column with a `typeRef`. This release refuses such a contract and says to re-emit it or run this script. A historical snapshot cannot be re-emitted from today's source, so run the script. Commit your work first so the script's changes can be reviewed and undone with git. Run it from the project root:

```sh
node <guide>/scripts/expand-type-aliases/expand-type-aliases.ts
```

`<guide>` is the directory that holds this guide. Node 24 or later runs the TypeScript script directly; it needs no `tsx`. The script reads and writes files only and needs no database. It rewrites every SQL contract under the root, skipping `node_modules`, `.git`, `dist` and `build`. That includes a test fixture of an old contract: if you keep one on purpose, restore it with git afterwards.

In each contract it replaces every column's `typeRef` with the parameters of the `storage.types` entry it names, and removes each entry a column named. In a contract of your app's own contract space it also removes every entry that no column names. Your app's contract never needs such an entry: it is an alias that the source declares but no field uses, which a re-emit drops as well, or, in a TypeScript source, a `codec-instance` entry that no field uses, which `ts-types-key-removed` tells you to delete. Only an extension's contract space registers a database type. So in a contract of an extension's contract space, such as the copy of pgvector's space in `migrations/snapshots/`, the script keeps an entry that no column names, such as `vector`, and lists it. It makes the same change in the `contract.d.ts` next to the contract. The script tells the spaces apart by the migrations directory: a snapshot that a migration or ref under `migrations/app/` names is your app's, and one that a migration or ref under any other `migrations/<space>/` names is an extension's. A snapshot that no migration or ref names may be either, so the script keeps its unused entries and lists them. The emitted `contract.json` is your app's.

The storage hash changes, so the script renames each changed snapshot directory to its new hash. It rewrites every `migration.json`, ref, `migration.ts` and `contract.d.ts` that names an old hash, and gives each changed migration a new `migrationHash`. When it finishes, it prints how many files it rewrote, how many snapshot directories it renamed, each storage hash it replaced (`<old> -> <new>`), each `storage.types` entry it removed, per contract, and each entry it kept. A project with no `typeRef` is left unchanged, and the script says so. The script replaces the hashes in the import paths of `migration.ts` where they are, so if your project sorts imports with a linter, run its fix command afterwards.

It changes no file and exits 1 in these cases, and names the file:

- a `contract.json`, `migration.json`, `ops.json` or ref is not valid JSON;
- a contract's stored storage hash, or the name of its snapshot directory, does not match its content;
- a column names an alias that `storage.types` does not declare, stores both `typeRef` and `typeParams`, or has a codec or data type other than its alias's;
- a migration goes between two snapshots that become the same snapshot once their aliases are written into their columns, and has no data operation;
- a renamed snapshot directory already exists with different content.

For the first three cases, restore that file from version control, or re-emit it, and run the script again. Two snapshots become the same one when the only change between them was an alias: a migration that replaced `slug VarChar(64)` with `types { Slug = VarChar(64) }` and `slug Slug`, or that renamed an alias. After the upgrade such a migration goes from a snapshot to itself, which only a migration with a data operation may do. The script names each such migration that has no data operation. Delete its directory and run the script again. When that migration is your latest, nothing else names its target snapshot, so the script names that snapshot directory too; delete it as well. The script then writes the hash of the merged snapshot into every `migration.json`, ref and `migration.ts` that names either old hash, and gives each changed migration a new `migrationHash`. A migration with a data operation keeps its operations and goes from the merged snapshot to itself. If it stops partway, for example on a full disk, it says so; run it again to finish.

If the same upgrade also asks you to run `remove-nocheck.ts`, the two scripts may run in either order: each checks the hash of the content it reads.

Then re-emit the contract with `prisma contract emit`. A contract written in PSL gives the contract the script wrote, so the latest snapshot, the head ref and the emitted contract keep one storage hash. A contract written in TypeScript needs `ts-types-key-removed` first.

Each database's marker still holds the old storage hash, so `prisma db verify` and `prisma db migrate` refuse it until you sign it. The database itself does not change. After the re-emit, run `prisma db sign` against every database (development, staging, production):

```sh
prisma db sign --db "$DATABASE_URL"
```

The script has already written the new hash into each ref, so when `db sign` advances a ref, such as `migrations/app/refs/db.json`, it prints the new hash twice: `Advanced ref "db" → <new hash> (was <new hash>)`. This is expected, and the database is signed.

The script also gives each rewritten migration a new hash, and the database's migration history keeps the old ones. After the upgrade, `prisma migration status` therefore no longer marks the migrations applied before it as applied, although it still reports the database as up to date. `prisma db migrate` runs none of them again, and `prisma db verify` passes.

## `psl-alias-attributes`

There is nothing to change. PSL gains two things:

```prisma
types {
  Slug      = VarChar(64)
  UpdatedAt = TimestampString(3) @onCreate(now()) @onUpdate(now())
}

model Post {
  id        String             @id @onCreate(uuid())
  slug      Slug
  createdAt temporal.CreatedAt
  updatedAt UpdatedAt          @default(now())
}
```

- An alias may carry `@default`, `@onCreate` and `@onUpdate`. Each field typed by it gets them. A field may add an attribute its alias does not set, but writing one the alias already sets is the error `PSL_DUPLICATE_ATTRIBUTE`. `@id` and `@unique` belong on the field, not the alias.
- Postgres, SQLite and MongoDB contribute `temporal.CreatedAt` and `temporal.UpdatedAt`, written bare as a field type. Each stores exactly what the field presets `temporal.createdAt()` and `temporal.updatedAt()` stored, which this release removes; the `remove-field-presets` guide gives the replacement of every preset. Postgres also has `temporal.CreatedAtString`, `temporal.UpdatedAtString`, `temporal.CreatedAtJsDate` and `temporal.UpdatedAtJsDate`.

## `ts-types-key-removed`

Write an alias as a constant field builder and use it as the field:

```ts
// Before
({ field, model, type }) => {
  const types = { Embedding1536: type.pgvector.Vector(1536) } as const;
  const Post = model('Post', {
    fields: {
      embedding: field.namedType(types.Embedding1536).optional(),
    },
  });
  return { types, models: { Post } };
}

// After
({ field, model, type }) => {
  const Embedding1536 = field.column(type.pgvector.Vector(1536));
  const Post = model('Post', {
    fields: {
      embedding: Embedding1536.optional(),
    },
  });
  return { models: { Post } };
}
```

A field builder is immutable, so one constant serves every model. `type.*` now has a helper for every PSL type constructor of the stack, such as `type.VarChar(64)` and `type.TimestampString(3)`, and for the contributed aliases, such as `field.column(type.temporal.UpdatedAt())`. A string such as `field.namedType('Slug')` named an alias the same way; replace it with the alias's constant.

`field.namedType(...)` still takes an enum handle, such as `field.namedType(Priority)`; leave those calls alone.

A `types` key left in the definition fails with `CONTRACT.TYPES_KEY_REMOVED`. An entry may also be written `{ kind: 'codec-instance', codecId: ..., typeParams: ... }`. If a field uses it, through `field.namedType(types.X)` or `field.namedType('X')`, replace it with a constant `field.column(type.Y(...))` of the same type and parameters, as above. If no field uses it, delete it. Your app's contract space never needs a registered database type: only an extension's contract space registers one, under `databaseTypes`. The script removed such an entry from your stored contracts and listed it in its summary, so the re-emit gives the storage hash the script wrote.

Two calls that set the same thing on one builder now fail instead of the second one winning. `.default()` on a builder that already has a default throws `CONTRACT.DEFAULT_INVALID` with reason `default-set-twice`, and `.onCreate()` or `.onUpdate()` on a builder that already sets that phase throws, as before.

Re-emit the contract. If you ran `stored-contracts-expand-type-aliases`, the column gets the same type and parameters it had, so there is nothing more to sign or migrate.

## `supabase-contract-expanded`

The `@prisma/orm-extension-supabase` contract is re-emitted from its PSL, which keeps its nine aliases. The contract no longer stores them in `storage.types`, and each column stores its own type. The Supabase space's storage hash changes from `292489649ae6d6928de98a32b544bd9caf6b7d49718c10fe2720b83545a4b5a2` to `110ad99e1e466691bdb0a4349a17365561e76ad017f58beb272f4496b05b8e9e`.

A contract that composes the Supabase space references it by id, so your own `contract.json` and `contract.d.ts` do not change. A database that was signed against the previous Supabase contract no longer matches the new hash, so run `prisma db sign` against it after upgrading. The Supabase database itself does not change.
