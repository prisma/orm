---
changes:
  - id: stored-contracts-drop-nocheck
    summary: |
      A stored SQL contract that has a `noCheck` key on a column no longer loads. Before any other step of this change, run `scripts/remove-nocheck/remove-nocheck.ts` from the project root, then run `prisma db sign` against every database. The script removes the key from every stored contract, migration snapshots and the emitted `contract.json` included. A list whose element check was waived becomes a list whose elements may be null, which is what the database allows. The script refreshes every hash and reference that changes.
    detection:
      glob: "**/contract.json"
      matches:
        - '"noCheck"\s*:'
    script: scripts/remove-nocheck/remove-nocheck.ts
  - id: psl-nocheck-removed
    summary: |
      The PSL attribute `@noCheck` no longer exists, and writing it is an unknown-attribute error. Replace `T[] @noCheck(elementNotNull)` with `T?[]`, delete `@noCheck(membership)`, and replace a bare `@noCheck` with both. Re-emit the contract. Where you deleted a membership waiver, the next migration adds the membership check. The detection matches PSL files that use the attribute.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@noCheck\b'
  - id: ts-nocheck-method-removed
    summary: |
      The TypeScript field builder no longer has a `noCheck()` method. Replace `.many().noCheck('elementNotNull')` with `.many({ elementsNullable: true })`, delete `.noCheck('membership')`, and replace a bare `.noCheck()` with both. Re-emit the contract. Where you deleted a membership waiver, the next migration adds the membership check. The detection matches TypeScript files that call the method.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.noCheck\('
  - id: prisma7-lists-allow-null-elements
    summary: |
      A contract read from a Prisma 7 `schema.prisma` now types the elements of every list as `T | null`, because Prisma 7 creates no check against null elements, and its storage hash changes. Run `stored-contracts-drop-nocheck` first. Otherwise, re-emit the contract and then run `prisma db sign` against every database. A database Prisma 7 built still matches the contract with no migration.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - '\bprisma7Schema\('
  - id: supabase-contract-lists-allow-null-elements
    summary: |
      The `@prisma/orm-extension-supabase` contract now declares its four `text[]` columns as lists whose elements may be null, so code that reads them gets `string | null` elements, and the Supabase space's storage hash changes. Run `prisma db sign` against every database after upgrading.
    detection:
      glob: "**/package.json"
      matches:
        - '"@prisma/orm-extension-supabase"'
---

# Generated checks can no longer be waived

Prisma 8 adds a check to a list column of a managed table so that its elements cannot be null, and a check to an enum-typed column so that it holds only the enum's values. `@noCheck` in PSL and `.noCheck()` in TypeScript used to skip these checks while the field kept its non-null element type. The client type then said the elements could not be null while the database accepted null. Both are removed.

Do the steps in this order: rewrite the stored contracts and sign the databases (`stored-contracts-drop-nocheck`), then change the contract source (`psl-nocheck-removed`, `ts-nocheck-method-removed`), then re-emit and migrate.

## `stored-contracts-drop-nocheck`

Migration snapshots, the emitted `contract.json` and any other stored contract written by an earlier release may have a `noCheck` key on a column. This release refuses such a contract and says to re-emit it or run this script. A historical snapshot cannot be re-emitted from today's source, so run the script. Do this before any other step of this change, and commit your work first so the script's changes can be reviewed and undone with git. Run it from the project root:

```sh
node <guide>/scripts/remove-nocheck/remove-nocheck.ts
```

`<guide>` is the directory that holds this guide. Node 24 or later runs the TypeScript script directly; it needs no `tsx`. The script reads and writes files only and needs no database. It rewrites every SQL contract under the root, skipping `node_modules`, `.git`, `dist` and `build`. That includes a test fixture of an old contract: if you keep one on purpose, restore it with git afterwards.

In each contract it removes the `noCheck` key from every column. Where the key waived the element check of a list, it also makes the column, the field that maps it and their types in `contract.d.ts` lists whose elements may be null. That is what the database allows, and it is what the source says after `psl-nocheck-removed` or `ts-nocheck-method-removed`. The script does not change which checks a contract declares: an enum column whose membership check was waived still has none until you migrate.

The storage hash changes, so the script renames each changed snapshot directory to its new hash. It rewrites every `migration.json`, ref, `migration.ts` and `contract.d.ts` that names an old hash, and gives each changed migration a new `migrationHash`. When it finishes, it prints how many files it rewrote, how many snapshot directories it renamed, and each storage hash it replaced (`<old> -> <new>`). A project with no `noCheck` key is left unchanged, and the script says so.

It changes no file and exits 1 in three cases, and names the file:

- a `contract.json`, `migration.json` or ref is not valid JSON;
- a contract's stored storage hash, or the name of its snapshot directory, does not match its content. Restore that file from version control, or re-emit it, and run the script again;
- a renamed snapshot directory already exists with different content.

If it stops partway, for example on a full disk, it says so; run it again to finish.

Each database's marker still holds the old storage hash, so `prisma db verify` and `prisma db migrate` refuse it until you sign it. The database itself does not change. Run `prisma db sign` against every database (development, staging, production) right after the script:

```sh
prisma db sign --db "$DATABASE_URL"
```

`db sign` checks the database against the rewritten contract and writes the new hash to its marker.

The script also gives each rewritten migration a new hash, and the database's migration history keeps the old ones. After the upgrade, `prisma migration status` therefore no longer marks the migrations applied before it as applied, although it still reports the database as up to date. Nothing else is affected: `prisma db migrate` runs none of them again, `prisma db verify` passes, and migrations you plan and apply after the upgrade are marked as usual.

## `psl-nocheck-removed`

Write a list whose elements may be null as `T?[]`:

```prisma
// Before
tags String[] @noCheck(elementNotNull)

// After
tags String?[]
```

The element type gains `| null`, so code that reads the list must handle null elements. The database does not change: neither form has a check. If you ran `stored-contracts-drop-nocheck`, re-emitting gives the contract the script wrote, so there is nothing to sign or migrate. If you did not, re-emit and then run `prisma db sign` against every database.

If you want the check instead, delete the attribute and keep `T[]`. Re-emit, then run `prisma migration plan` and `prisma db migrate`, or `prisma db update` in a project without migrations. The migration adds the check. Applying it fails if a stored list already holds a null element, so fix those rows first.

Delete `@noCheck(membership)`. Re-emit, then plan and apply a migration the same way. The migration adds the membership check to the enum column. Applying it fails if a stored value is not one of the enum's values, so fix those rows first.

A bare `@noCheck` waived every check the column had. Apply both rules above: a list column becomes `T?[]`, and an enum column loses the attribute.

## `ts-nocheck-method-removed`

The same rules apply to the TypeScript builder:

```ts
// Before
tags: field.text().many().noCheck('elementNotNull'),
role: field.column(roleColumn).noCheck('membership'),

// After
tags: field.text().many({ elementsNullable: true }),
role: field.column(roleColumn),
```

`.many({ elementsNullable: true })` leaves the database as it is and types each element as `T | null`. Deleting `.noCheck('membership')` makes the next migration add the membership check. Re-emit and then sign or migrate as `psl-nocheck-removed` says.

## `prisma7-lists-allow-null-elements`

A Prisma 7 database has no check on its list columns, so it accepts null elements. The Prisma 7 reader now says so: a `String[]` field reads as a list of `string | null`. Fix the type errors where code assumed non-null elements.

The contract's storage hash changes. If your project stores a contract an earlier release emitted, run `stored-contracts-drop-nocheck` first: after it and `prisma db sign`, re-emitting with `prisma contract emit` gives the same contract, and there is nothing more to do. Otherwise, re-emit the contract and then run `prisma db sign` against every database that was signed before.

A database Prisma 7 built matches the new contract with no migration. A project that hands over from Prisma 7 for the first time with this release verifies with `prisma db verify` after `prisma db sign`, as before. A database that was already signed fails `prisma db verify` with `CONTRACT.MARKER_MISMATCH` until you sign it again.

## `supabase-contract-lists-allow-null-elements`

The `@prisma/orm-extension-supabase` contract now declares four `text[]` columns as lists whose elements may be null, because the Supabase database has no check against null elements in them:

- `auth.custom_oauth_providers.acceptable_client_ids` (`CustomOauthProviders.acceptableClientIds`)
- `auth.custom_oauth_providers.scopes` (`CustomOauthProviders.scopes`)
- `storage.buckets.allowed_mime_types` (`StorageBucket.allowedMimeTypes`)
- `storage.objects.path_tokens` (`StorageObject.pathTokens`)

Code that reads these fields now gets `string | null` elements. The Supabase space's storage hash changes from `cb23216599e58b222c1fe7d880105d8f166c8490935cec5ed539dbe77847d679` to `292489649ae6d6928de98a32b544bd9caf6b7d49718c10fe2720b83545a4b5a2`.

A contract that composes the Supabase space references it by id, so your own `contract.json` and `contract.d.ts` do not change. What changes is the signature: a database that was signed against the previous Supabase contract no longer matches the new hash, so run `prisma db sign` against it after upgrading. The Supabase database itself does not change.
