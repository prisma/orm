---
changes:
  - id: contract-stores-data-type
    summary: |
      A SQL contract names each column's data type in `dataType` (for example `pg/int4`) instead of
      its database type name in `nativeType`. Upgrade every extension that ships migrations in the
      same step, then run the colocated script on the project: it rewrites every contract, renames
      the snapshot directories to the new storage hashes, and rewrites the migrations, refs,
      `migration.ts` files and `contract.d.ts` files that name them.
    detection:
      glob: "**/*.json"
      matches:
        - '"nativeType"\s*:\s*"'
    script: ./scripts/data-type-in-contract.ts
  - id: column-descriptors-drop-native-type
    summary: |
      A hand-written column descriptor names its codec only: `{ codecId: 'pg/text@1' }` instead of
      `{ codecId: 'pg/text@1', nativeType: 'text' }`. Code that reads or builds a column of a stored
      contract uses `dataType` (for example `pg/text`) instead of `nativeType` (`text`).
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])(?<!readonly\s+)nativeType\s*:\s*[''"]'
        - '\.nativeType\b'
  - id: sign-databases-after-upgrade
    summary: |
      The upgrade changes every contract's storage hash, so every database's marker names a hash
      the project no longer has. Run `prisma db sign` against every database before deploying the
      application built with the new contract. `db sign` now signs every contract space, and its
      `--json` document is `{ ok, summary, spaces, advancedRefs }`.
  - id: parameter-casts-use-base-names
    summary: |
      PostgreSQL parameter casts are written with the data type's base name: `$1::int4` instead of
      `$1::integer`, and likewise `int2`, `int8`, `float4`, `float8` and `bool` instead of
      `smallint`, `bigint`, `real`, `double precision` and `boolean`. Logged SQL and SQL snapshots
      in tests change to match.
    detection:
      glob: "**/*.{ts,mts,cts,sql,json,snap}"
      matches:
        - '\$\d+::(?:integer|smallint|bigint|real|double precision|boolean)\b'
---

## `contract-stores-data-type`

Upgrade every extension that ships migrations (for example `@prisma/orm-extension-pgvector` and `@prisma/orm-extension-postgis`) in the same step as the framework, to the release its authors published for this change. An extension whose contract space is still in the old format makes the project refuse to load.

Commit your work first, so the script's changes can be reviewed and undone with git. Then run the script from the project root:

```sh
node <path-to-this-guide>/scripts/data-type-in-contract.ts
```

Node 24 or later runs the TypeScript script directly; it needs no `tsx`. It reads and writes files only and needs no database. It rewrites every `*.json` file under the root that parses as a SQL contract in the old format (a column or `storage.types` entry that stores `nativeType`), skipping `node_modules`, `.git`, `dist` and `build`. That includes a test fixture of an old-format contract: if you keep such a fixture on purpose, restore it with git afterwards (`git restore <file>`), or keep it outside the project root.

If the script stops on an error, for example on a full disk, it prints the error and `the upgrade stopped partway, run the script again to finish it`, and exits 1. After an error, Ctrl-C or a crash, run it again: it finishes the upgrade. A file the script was writing at that moment is either unchanged or complete, and it removes its own temporary files (ending in `.data-type-in-contract-tmp`) on the next run.

Run your formatter afterwards. The script replaces text in `migration.ts` and `contract.d.ts`, so the import order in `migration.ts` and the line wrapping in `contract.d.ts` can differ from what a fresh emit and your formatter produce.

When it finishes, it prints how many files it rewrote and how many snapshot directories it renamed, and each storage hash it replaced (`<old> -> <new>`). A contract already in the new format is never changed, even when its stored hash does not match its content, so a project already in the new format is left unchanged, and the script says that nothing changed. If it finds no SQL contract under the root, it says so; run it again from the project root. It prints `<file>: stored hash did not recompute; rehashed from content` for an old-format contract whose stored storage hash does not match its content, and rewrites it anyway. It changes no file and exits 1 when a column uses a codec it does not know (`<file>: unknown codec <id>; name its data type with --data-type <id>=<data type id>`) or when a renamed snapshot directory already exists with different content.

The script knows every codec that Prisma and its own extensions ship. For a codec from another extension, pass the line that extension publishes in its upgrade notes, once per codec, for example `--data-type acme/shape@1=acme/shape`. The option cannot change the data type of a codec the script already knows for a contract's target, but it can name the data type of a shared `sql/*` codec on a target the script does not know.

On SQLite, the contract now stores a literal default of an `Int` column as digit text, as it already stored a `BigInt` default: an `Int` default that was the JSON number `42` becomes the text `"42"`. The script makes this change. Planned SQL does not change (`DEFAULT 42`), and a database the previous release created still verifies. A `BigInt` default of 2^53 or less, which the previous release's check after `prisma db migrate` reported as missing, now passes. The same holds for the members of an `enum` typed by an integer codec (`@@type("sqlite/integer@1")`, `@@type("sql/int@1")`): the script writes their stored values as digit text. The schema does not change: members are written as before, for example `Low = 1`. An `enum` typed by `sqlite/json@1` now stores the JSON text of each member's document, and the script rewrites its stored values to that text; in the schema, write each member as a string holding that JSON text, for example `Low = '"low"'` instead of `Low = "low"`, and `Level = "1"` instead of `Level = 1`.

## `column-descriptors-drop-native-type`

In `contract.ts` and every other file that builds a column descriptor by hand, delete the `nativeType` property. The contract takes the column's data type from its codec.

```ts
// before
const pgText = { codecId: 'pg/text@1', nativeType: 'text' } as const;
const Priority = enumType('Priority', { codecId: 'pg/int4@1', nativeType: 'int4' }, member('Low', 0));

// after
const pgText = { codecId: 'pg/text@1' } as const;
const Priority = enumType('Priority', { codecId: 'pg/int4@1' }, member('Low', 0));
```

Code that reads a column of a stored contract (`contract.storage…tables[name].columns[name]`) reads `dataType`, the data type id such as `pg/text`, instead of `nativeType`, the database type name such as `text`:

```tsx
// before
<span className="col-type">{column.nativeType}</span>

// after
<span className="col-type">{column.dataType}</span>
```

Code that builds a stored contract's column by hand, for example a test fixture, writes the data type id in `dataType` instead of the type name in `nativeType`:

```ts
// before
id: { nativeType: 'uuid', nullable: false, codecId: 'pg/uuid@1' },

// after
id: { dataType: 'pg/uuid', nullable: false, codecId: 'pg/uuid@1' },
```

A type written by hand for such a contract changes the same way: `readonly nativeType: 'int4'` becomes `readonly dataType: 'pg/int4'`.

## `sign-databases-after-upgrade`

The upgrade gives every contract a new storage hash. Each database's marker still holds the old hash, so until you sign it:

- `prisma db migrate` refuses to run with `MIGRATION.MARKER_MISMATCH`;
- `prisma db verify` exits with code 4 and `CONTRACT.MARKER_MISMATCH`;
- `prisma migration status` does not label the migrations applied before the upgrade as applied.

The running application does not report the mismatch: it keeps answering queries and logs nothing, because the `postgres()` client has no logger for the marker check.

Run `prisma db sign` against every database (development, staging, production) before you deploy the application built with the new contract:

```sh
prisma db sign --db "$DATABASE_URL"
```

`db sign` verifies the live schema of every contract space (the application's and each extension's) against its contract, then writes the marker of every space that verified, in one transaction on PostgreSQL and SQLite. It advances each signed space's `db` ref, or the ref `--advance-ref <name>` names. Running it again changes nothing. A space that fails verification is not signed: the command prints its differences and exits with code 4. Repair that schema first (for example a Supabase database whose `auth` schema drifted from the extension's contract), then sign again.

A script that reads `db sign --json` reads one outcome per space. The document was `{ ok, summary, contract, target, marker }` for the application's space; it is now:

```json
{
  "ok": true,
  "summary": "Database signed",
  "spaces": [
    {
      "space": "app",
      "status": "signed",
      "contract": { "storageHash": "…", "profileHash": "…" },
      "marker": { "created": false, "updated": true, "previous": { "storageHash": "…", "profileHash": "…" } }
    }
  ],
  "advancedRefs": [{ "space": "app", "name": "db", "hash": "…" }]
}
```

`status` is `signed`, `unchanged` (the marker already held the contract's hashes), `failed` or `conflict`. A failed space has `space`, `status`, `contract: { storageHash }` and `schema`, the verification result, in place of `marker`, and `ok` is `false`. A space in conflict is one whose marker another process, such as `migrate`, changed while `db sign` ran: its `marker` is `{ expected, found }`, the marker hashes `db sign` read and the ones it found, it is not signed, and the command exits with code 4; run `db sign` again once that process has finished.

Code that signs through the programmatic control API calls `client.dbSign({ contract, migrationsDir })` instead of `client.sign({ contract })`, which is removed with `SignOptions` and `SignDatabaseResult`. `dbSign` verifies every contract space and signs each one that verified, as `db sign` does.

## `parameter-casts-use-base-names`

Update tests that assert query text or SQL snapshots:

| Before | After |
| --- | --- |
| `$1::integer` | `$1::int4` |
| `$1::smallint` | `$1::int2` |
| `$1::bigint` | `$1::int8` |
| `$1::real` | `$1::float4` |
| `$1::double precision` | `$1::float8` |
| `$1::boolean` | `$1::bool` |
| `$1::integer[]` | `$1::int4[]` |

Extension types keep their names (`$1::vector`, `$1::geometry`).
