# Slice: The contract describes Postgres extensions (TML-3460)

## Outcome

A Prisma 7 project whose schema needs `vector` (pgvector) and `pg_trgm` adopts Prisma 8 with two commands, and Prisma 8 then owns its migrations:

```prisma
datasource db {
  provider   = "postgresql"
  extensions = [vector, pg_trgm]
}
```

```bash
prisma contract emit
prisma db sign --db "$DATABASE_URL"
```

`db sign` checks the database against every contract space's contract: the application's, which now lists `pg_trgm`, and the pgvector pack's, which lists `vector`. If both hold, it writes the markers. A database built later from `migrations/` alone, such as a CI database, gets both extensions from the planner.

Today neither command works for this project:

- The Prisma 7 reader ignores the datasource `extensions` list, so the application's contract never mentions `pg_trgm`, and the planner never creates it.
- Each extension pack (pgvector, PostGIS, ParadeDB) installs its extension in a hand-written migration operation that records an invariant, such as pgvector's `pgvector:install-vector-v1`. The pack's contract does not mention the extension. `db sign` cannot prove the invariant, so it writes the pack's marker without it. `db verify` then fails on the missing invariant, and `db migrate` fails with `MIGRATION.NO_INVARIANT_PATH`.
- `db sign` refuses with `MIGRATION.CONTRACT_SPACE_LAYOUT_VIOLATION` until the pack's pinned files exist under `migrations/<space-id>/`, and only `migration plan` writes them.

This slice makes a Postgres extension something a contract declares, so checking the database against the contract proves the extension is installed, and no invariant is needed for it.

## Decisions (settled with Will, 2026-10-28)

1. **`db sign` has one rule.** It checks the database against each contract space's contract. If every space holds, it writes the markers. It never runs a migration operation.
2. **`db sign` refuses a space whose head ref requires an invariant its marker does not already record.** An invariant is a promise that a migration ran, and only running that migration keeps it. The refusal names the space and each missing invariant, and says to run `db migrate`. An extension that wants databases to be adoptable by `db sign` describes what it needs in its contract instead of in an invariant.
3. **A Postgres extension is an object kind of the Postgres target, named `extension`.** It follows the `native_enum` kind, whose whole lifecycle the planner and verifier manage. It does not follow `role`, which the planner never creates.
4. **An extension is declared in the namespace of the schema its objects are created in**, as a table is. PostgreSQL records that schema for each extension (`pg_extension.extnamespace`; `CREATE EXTENSION … WITH SCHEMA`). Declared at the top level, it is in the default namespace, `public`. Supabase, for example, installs extensions into a schema named `extensions`, so its contract declares them in `namespace extensions`. An extension's name is unique across the whole database, so a contract that declares the same extension in two namespaces is refused.
5. **The extension's version is not recorded.** Hosts offer different versions, and no pack pins one today.
6. **Who declares an extension:** a pack declares the extension it needs in its own contract. An extension no pack covers, such as `pg_trgm`, goes in the application's contract. Two spaces declaring the same extension is the existing storage-element conflict (`PN-MIG-CHECK-014 STORAGE_ELEMENT_CONFLICT`).
7. **Extensions in the database that no contract declares are never reported**, in strict mode or not. PostgreSQL always has `plpgsql`, and hosts preinstall many more.
8. **CipherStash is out of scope.** It installs its EQL bundle with ordinary migrations and data invariants, which is correct. Under decision 2, `db sign` refuses a database that has not run them.
9. **Each pack's old install migration stays in its graph.** It is harmless there. A new migration from the empty contract to the pack's new contract gives new databases a one-step path.

## Requirements

### The `extension` kind

Copy the `native_enum` kind's path through the code; the paths below are under `packages/3-targets/postgres/`.

- **Object class and validation:** a frozen `PostgresExtension` class with `name` and optional `control`, plus its validator schema and entity-kind descriptor. Register it with the Postgres contract serializer beside `role` and `native_enum`. Contract JSON: `storage.namespaces.<namespace>.entries.extension.<name>`.
- **PSL:** an `extension` block, at the top level or in a `namespace` block:

  ```prisma
  extension pg_trgm {}

  namespace extensions {
    extension postgis {}
  }
  ```

- **TypeScript builder:** `extension(name)` in the Postgres contract builder, placed in a namespace the way the builder places a native enum.
- **Reading the database:** the Postgres control adapter reads `pg_extension` joined to `pg_namespace` into a new schema node kind on the database root, carrying the extension's schema. On the root a node pairs by name, so an extension moved to another schema is one difference and plans `SET SCHEMA`; under namespace nodes it would be one missing and one extra node.
- **Verification:**
  - A declared extension that is missing fails, in both modes.
  - An extension declared in one namespace and installed in another fails as an incompatible declaration.
  - Extras are never reported (decision 7).
  - The node's granularity is `entity`, mapped in `POSTGRES_NODE_ENTITY_KIND`, so a sibling contract space never sees another space's extension as an extra.
  - `control: external` means verify only.
- **Planning:**
  - A missing extension plans `CreateExtensionCall` with `WITH SCHEMA` naming its namespace's schema. Give the operation the precheck and postcheck `installExtension` has, using `extensionExistsAst`.
  - A removed extension plans `DROP EXTENSION` without `CASCADE`, classed destructive.
  - An extension moved to another namespace plans `ALTER EXTENSION … SET SCHEMA`.
  - Extension operations run before any type, table or index operation, in the existing `dep` bucket.
- **`contract infer` and `contract print`** write extension blocks, and the printer round-trips them. `contract infer` writes every extension except `plpgsql` and those a composed pack declares.

### Extension packs

For pgvector, PostGIS and ParadeDB:

- The pack's contract declares its extension.
- A new migration moves the pack from its old head to the new contract. Its one operation creates the extension if missing, and records no invariant.
- A new migration from the empty contract to the new contract gives new databases a one-step path (decision 9).
- The new head ref lists no invariants.
- The descriptor wires the new migrations, and the hash check at family-create time still passes.
- An existing database whose marker records the old install invariant moves to the new head with `db migrate`. Nothing requires the old invariant any more.

### The Prisma 7 reader

- The reader reads the datasource `extensions` list (`previewFeatures = ["postgresqlExtensions"]`).
- **Extension with a composed pack:** each listed extension that a composed pack declares adds nothing to the application's contract.
- **Extension with an uncomposed pack:** a listed extension with a pack that is not composed is refused with a new diagnostic, `PSL.PRISMA7_EXTENSION_PACK_MISSING`. It names the import to add to `extensions` in `prisma.config.ts`. The Postgres target's Prisma 7 binding maps each extension name to its pack's id and published import path: pgvector (`vector`), PostGIS (`postgis`) and ParadeDB (`pg_search`).
- **Extension with no pack:** every other listed extension becomes an `extension` entry in the application's contract.
- **Arguments:** the `schema:` argument puts the extension in that schema's namespace. A `version:` or `map:` argument is refused with a diagnostic naming the edit, since the contract would not describe it exactly.

### `contract emit` writes the pinned extension files

`contract emit` writes each composed pack's pinned files under `migrations/<space-id>/`, as `migration plan` does today: `contract.json`, `contract.d.ts`, `refs/head.json` and the migration directories. Without this, a Prisma 7 project, which never runs `migration plan`, cannot sign. `db sign` and `db verify` keep reading only the repository.

### `db sign`

Implement decision 2 in `packages/1-framework/3-tooling/cli/src/control-api/operations/db-sign.ts`. A space whose required invariants are not all on its marker is reported as not signed, with a new structured error code, and the command exits 4. No marker is written for it.

## Tests

- Unit tests for the class, validator, serializer, PSL block (including the refusal of one extension in two namespaces), TS builder, reading the database, verifier dispositions (missing, installed in another schema, extras ignored, a sibling space's extension ignored) and each planner case.
- An integration test per pack: a database that has the extension but no marker signs cleanly, and `db verify --strict` passes. A database on the pack's old head moves to the new head with `db migrate`.
- The Prisma 7 reader fixtures: `extensions` with a pack, without a pack, with `schema:`, and refused with `version:`.
- A CLI journey for the Outcome example: `contract emit`, `db sign`, `db verify --strict`, then `db migrate` of a later application change, and a fresh database built from `migrations/` alone that has both extensions.
- `db sign` refusing a space whose required invariant is missing.

## Docs

- A new ADR: a Postgres extension is a contract object kind, and `db sign` refuses a space with unmet invariants. It amends the contract spaces ADR (212), whose IR-boundary section says `CREATE EXTENSION` is the body of a migration operation and whose "What apply-time does not need" section says only `migrate` writes the pinned files. It also supersedes the leftover extension-dependency text in ADRs 116 and 154.
- The Migration System subsystem doc's `db sign` entry, the Postgres facade README, the pack READMEs, and the Prisma 7 adoption docs.

## Non-goals

- CipherStash, and object kinds for functions, operators, operator classes, aggregates or casts.
- Recording or upgrading an extension's version.
- Changing `db sign`'s check in any other way.

## Relation to TML-3270

TML-3270 reads Prisma 7's `@db.Bit`, `@db.VarBit`, `@db.Xml`, `@db.Oid` and `@db.Money`. Its sixth type, `@db.Citext`, waits for this slice (Will, 2026-10-29): a citext pack built the old way could not be adopted by `db sign`. After this slice merges, the citext pack is added the new way: its contract declares `citext`, it has no install invariant, and its extension map entry lets the Prisma 7 reader read both `@db.Citext` and `extensions = [citext]`.

## Done when

The PR is merged, TML-3460 is Done in Linear with a closing comment, and the Outcome example runs in CI.
