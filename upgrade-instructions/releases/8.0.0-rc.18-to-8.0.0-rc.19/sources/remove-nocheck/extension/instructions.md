---
changes:
  - id: psl-nocheck-removed
    summary: |
      The PSL attribute `@noCheck` no longer exists, and writing it in an extension's contract source is an unknown-attribute error. A list that allows null elements is now written `T?[]`. Replace `T[] @noCheck(elementNotNull)` with `T?[]`, delete `@noCheck(membership)`, and replace a bare `@noCheck` with both. Then re-emit the extension's bundled contract. The detection matches PSL files that use the attribute.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@noCheck\b'
  - id: ts-nocheck-method-removed
    summary: |
      The TypeScript field builder no longer has a `noCheck()` method. Replace `.many().noCheck('elementNotNull')` with `.many({ elementsNullable: true })`, delete `.noCheck('membership')`, and replace a bare `.noCheck()` with both. Then re-emit the extension's bundled contract. The detection matches TypeScript files that call the method.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.noCheck\('
  - id: stored-contracts-drop-nocheck
    summary: |
      A stored SQL contract that has a `noCheck` key on a column no longer loads. Run `scripts/remove-nocheck/remove-nocheck.ts` from the extension's package root. It removes the key from every stored contract the extension ships, its migration snapshots included, and rewrites the hashes and references that change. Then re-emit the bundled contract.
    detection:
      glob: "**/contract.json"
      matches:
        - '"noCheck"\s*:'
    script: scripts/remove-nocheck/remove-nocheck.ts
---

# Generated checks can no longer be waived

Prisma 8 adds a check to a list column of a managed table so that its elements cannot be null, and a check to an enum-typed column so that it holds only the enum's values. `@noCheck` in PSL and `.noCheck()` in TypeScript used to skip these checks while the field kept its non-null element type. The client type then said the elements could not be null while the database accepted null. Both are removed, from an extension's contract source as from an application's.

## `psl-nocheck-removed`

Write a list whose elements may be null as `T?[]`:

```prisma
// Before
scopes String[] @default([]) @noCheck(elementNotNull)

// After
scopes String?[] @default([])
```

The database does not change: neither form has a check. The element type in the extension's `contract.d.ts` gains `| null`, so code in the extension and in applications that read the list must handle null elements.

If you want the check instead, delete the attribute and keep `T[]`. An application that installs the extension then gets the check in its next migration of the extension's contract space. Applying it fails if a stored list already holds a null element.

Delete `@noCheck(membership)`. The next migration adds the membership check to the enum column. Applying it fails if a stored value is not one of the enum's values.

A bare `@noCheck` waived every check the column had. Apply both rules above.

On a table the extension does not manage (`@@control(external)` or a contract-level policy other than `managed`), no check is derived either way. Only the element type changes.

Re-emit the bundled contract with the extension's own emit script, and ship the new `contract.json` and `contract.d.ts` together.

## `ts-nocheck-method-removed`

The same rules apply to the TypeScript builder:

```ts
// Before
scopes: field.text().many().noCheck('elementNotNull'),

// After
scopes: field.text().many({ elementsNullable: true }),
```

Delete `.noCheck('membership')` the same way. Re-emit the bundled contract.

## `stored-contracts-drop-nocheck`

Migration snapshots that an extension ships, and any other stored `contract.json` written by an earlier release, may have a `noCheck` key on a column. This release refuses such a contract and says to re-emit it. A historical snapshot cannot be re-emitted from today's source, so run the script instead. Do this before you re-emit the bundled contract, and commit your work first so the script's changes can be reviewed and undone with git. Run it from the extension's package root:

```sh
node <guide>/scripts/remove-nocheck/remove-nocheck.ts
```

`<guide>` is the directory that holds this guide. Node 24 or later runs the TypeScript script directly; it needs no `tsx`. The script reads and writes files only and needs no database. It removes the `noCheck` key from every column of every SQL contract under the root, skipping `node_modules`, `.git`, `dist` and `build`. That includes a test fixture of an old contract: if you keep one on purpose, restore it with git afterwards. Where the key waived the element check of a list, the script also makes the column, the field that maps it and their types in `contract.d.ts` lists whose elements may be null, which is what the source says after `psl-nocheck-removed`. The script does not change which checks a contract declares.

The storage hash changes, so the script also renames each changed snapshot directory to its new hash. It rewrites every `migration.json`, ref, `migration.ts` and `contract.d.ts` that names an old hash, and gives each changed migration a new `migrationHash`.

When it finishes, it prints how many files it rewrote, how many snapshot directories it renamed, and each storage hash it replaced (`<old> -> <new>`). A package with no `noCheck` key is left unchanged, and the script says so. It changes no file and exits 1, naming the file, when a `contract.json`, `migration.json` or ref is not valid JSON, when a contract's stored storage hash or snapshot directory name does not match its content (restore that file from version control, or re-emit it, and run the script again), or when a renamed snapshot directory already exists with different content. If it stops partway, for example on a full disk, it says so; run it again to finish.

Then re-emit the bundled contract. The extension's storage hash changes, so tell the applications that use it, in your release notes, to run `prisma db sign` against every database after they upgrade, and name the old and new hash. The app guide's entry `supabase-contract-lists-allow-null-elements` is an example of such a note. Tell them too that `prisma migration status` no longer marks the extension's migrations applied before the upgrade as applied, because each rewritten migration has a new hash and their databases' migration history keeps the old ones. `prisma db migrate` runs none of them again, and `prisma db verify` passes.
