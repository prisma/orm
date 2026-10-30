---
changes:
  - id: value-objects-in-storage
    summary: |
      A contract keeps its value objects in storage, at `storage.namespaces.<ns>.entries.valueObject`, and a field holding one names it by its storage coordinate. On SQL, a discriminator column names a value set, `<Base>.<field>`, of its variants' values. A `contract.json` that keeps `valueObjects` in the domain plane is refused with `CONTRACT.VALIDATION_FAILED`, saying to re-emit it. Run the colocated script on the project: it rewrites every contract and snapshot, renames the snapshot directories to their new storage hashes, and rewrites the migrations, refs, `migration.ts` files and `contract.d.ts` files that name them. Then sign each database and re-emit the contract.
    detection:
      glob: "**/*.json"
      matches:
        - '"valueObjects"\s*:'
    script: ./scripts/value-objects-in-storage/value-objects-in-storage.ts
  - id: value-object-types-from-storage
    summary: |
      `ValueObjectTypesFromDomain`, exported by `@prisma/orm-mongo/contract/types`, is now `ValueObjectTypesFromStorage` and takes the contract's storage namespaces. A committed `contract.d.ts` that imports it compiles again once it is re-emitted. Code of your own that imports it changes the name and passes `Contract['storage']['namespaces']`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bValueObjectTypesFromDomain\b'
  - id: postgres-value-object-checks
    summary: |
      On PostgreSQL, the contract derives a check for every value object column and every discriminator column of a managed table. The next `prisma migration plan` adds them, and `prisma db migrate` fails on a row that does not fit, including a row whose value object has a key the value object does not declare, which the SQL ORM never refused. Find such rows before you apply the migration.
  - id: discriminator-typed-by-variant-values
    summary: |
      A SQL discriminator field is typed by its variants' values, such as `'bug' | 'feature'`, instead of `string`. Code that assigns such a field to a `string` still compiles; a type assertion that expects `string` changes to the union.
---

# Value objects are storage entities

## `value-objects-in-storage`

Before you upgrade, apply every pending migration to each database (development, staging, production) with the release you are upgrading from, so each database is at the last migration. Then commit your work, so the script's changes can be reviewed and undone with git. Then upgrade the Prisma packages to this release. Run the script before you re-emit the contract: `prisma db sign` must see the contract the database was created from before a re-emit adds the new checks. Run it from the project root:

```sh
node <path-to-this-guide>/scripts/value-objects-in-storage/value-objects-in-storage.ts
```

Node 24 or later runs the TypeScript script directly; it needs no `tsx`. It reads and writes files only and needs no database. It rewrites every `*.json` file under the root that parses as a SQL or MongoDB contract keeping value objects in the domain plane, skipping `node_modules`, `dist`, `build` and directories whose name starts with a dot. In each contract it:

- moves each value object from `domain.namespaces.<ns>.valueObjects` to `storage.namespaces.<ns>.entries.valueObject`;
- writes each field that holds a value object as `{ kind: 'valueObject', plane: 'storage', namespaceId, entityKind: 'valueObject', entityName }` instead of `{ kind: 'valueObject', name }`;
- points a value object member typed by an enum at the enum's storage value set (`plane: 'storage'`, `entityKind: 'valueSet'`);
- on SQL, writes the value set of each discriminator, keyed `<Base>.<field>` in the base table's namespace and holding the variants' values, sorted, and points the discriminator column at it. A column an enum types keeps the enum's value set.

Storage now holds the value objects, so each contract it rewrites has a new storage hash. The script renames each snapshot directory to the new hash and rewrites every `migration.json` (with its `migrationHash`), ref, `migration.ts` and `contract.d.ts` that names an old one. It does not add the PostgreSQL checks described in `postgres-value-object-checks`: a snapshot records what its migrations created, and none created those checks.

When it finishes, it prints how many files it rewrote, how many snapshot directories it renamed, and each storage hash it replaced (`<old> -> <new>`). A project already in the new form is left unchanged, and the script says that nothing changed. It changes no file and exits 1 when a file it must read is not valid JSON, when a contract's stored hash does not match its content, when a field holds a value object the contract does not declare, when a member's enum has no storage value set, when a discriminator's value set name is already taken by an enum, when a renamed snapshot directory already exists with different content, or when it cannot read a directory under the root. If it stops on an error partway, for example on a full disk, run it again: it finishes the upgrade.

The script rewrites a snapshot's `contract.d.ts` for the moved value objects. In every `contract.d.ts` it finds, including those of contracts without value objects, it also passes the storage namespaces to `FieldTypesFromDomain`, which now requires them. It does not add the types of the discriminator value sets. Nothing reads them from a snapshot: a `migration.ts` that imports a snapshot's `contract.d.ts` compiles without them, and `prisma contract emit` writes them for the emitted contract.

Then:

1. Sign each database (development, staging, production) with the rewritten contract, before you re-emit: `prisma db sign --db "$DATABASE_URL"`. Its marker still holds the old storage hash, so until it is signed `prisma db migrate` refuses with `MIGRATION.MARKER_MISMATCH` and `prisma db verify` with `CONTRACT.MARKER_MISMATCH`. This works for a database at the last migration. It also points your local `db` ref at the rewritten contract, writing the ref if the project had none; `prisma migration plan` starts from that ref.
2. Re-emit the contract: `prisma contract emit`.
3. On PostgreSQL, plan the migration that adds the new checks with `prisma migration plan`, and apply it to each database with `prisma db migrate --advance-ref db --db "$DATABASE_URL"`, as `postgres-value-object-checks` describes. `--advance-ref db` moves the `db` ref to the new contract. Without it the ref stays at the contract of step 1, and the next `prisma migration plan` starts from there and writes a second migration that adds the same checks. On MongoDB there is nothing to plan: the collection validators do not change.

A database you could not migrate before the upgrade is behind the last migration, and `prisma db sign --db "$DATABASE_URL"` fails on it with `CONTRACT.SCHEMA_VERIFICATION_FAILED`, because it signs against the last contract. Do not follow its advice to run `prisma db update`: that skips the pending migrations. Instead, sign the database at the new hash of the hash its marker holds, then migrate it:

```sh
prisma db sign --contract <new hash> --no-advance-ref --db "$DATABASE_URL"
prisma db migrate --db "$DATABASE_URL"
prisma db verify --strict --db "$DATABASE_URL"
```

Find the new hash in the script's output: the marker holds the `<old>` hash of one `<old> -> <new>` line. `--no-advance-ref` leaves your local `db` ref where it is.

## `value-object-types-from-storage`

```ts
// before
import type { ValueObjectTypesFromDomain } from '@prisma/orm-mongo/contract/types';
type Outputs = ValueObjectTypesFromDomain<Contract['domain']['namespaces'], CodecTypes, never, {}, 'output'>;

// after
import type { ValueObjectTypesFromStorage } from '@prisma/orm-mongo/contract/types';
type Outputs = ValueObjectTypesFromStorage<Contract['storage']['namespaces'], CodecTypes, never, {}, 'output'>;
```

## `postgres-value-object-checks`

For each column that holds a value object, the contract derives a check named `<table>_<column>_shape_<hash>`. It accepts a JSON object with every required member, each of its JSON type, no other key, and for a list column an array of such objects; a nullable column also accepts SQL `NULL` and JSON `null`. For each discriminator column it derives `<table>_<column>_check_<hash>`, which accepts only the variants' values. A table whose control policy is not managed gets neither check.

After you re-emit the contract, `prisma migration plan` writes a migration that adds the checks. It starts from the `db` ref that `prisma db sign` wrote. Its DDL preview prints each check's expression. Before you run `prisma db migrate`, find the rows that would fail by selecting the rows where the expression is not true, for example:

```sql
SELECT id, address FROM "public"."user"
WHERE NOT ("address" IS NULL OR jsonb_path_match("address", 'strict … ') IS TRUE);

SELECT id, type FROM "public"."task" WHERE NOT ("type" IN ('bug', 'feature'));
```

Adding a check takes a lock on the table while Postgres reads every row to check it. Any later change to a value object renames the check, so the check is dropped and added again, and the rows are read again. Apply the migration when the table can wait for that read.

Copy the expression from the preview between `CHECK (` and the closing `)`. Fix or delete each row the query returns, for example by removing the extra keys with `UPDATE "public"."user" SET address = address - 'extra' WHERE address ? 'extra'`, then apply the migration with `prisma db migrate --advance-ref db`. A migration that fails on a row changes nothing, and the error names the check, its table and column, and the query that finds the rows; fix the rows and run `prisma db migrate --advance-ref db` again.

## `discriminator-typed-by-variant-values`

```ts
// before
expectTypeOf(task.type).toEqualTypeOf<string>();

// after
expectTypeOf(task.type).toEqualTypeOf<'bug' | 'feature'>();
```
