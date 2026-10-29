# ADR 311 — A Postgres extension is a contract entity, and db sign refuses a space with unmet invariants

**Status:** Accepted
**Date:** 2026-10-29
**Amends:** [ADR 212 — Contract spaces](ADR%20212%20-%20Contract%20spaces.md)
**Builds on:** [ADR 221 — Contract IR two planes with uniform entity coordinate and pack-contributed entity kinds](ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md), [ADR 225 — Three-layer extensibility for pack-contributed entity kinds](ADR%20225%20-%20Three-layer%20extensibility%20for%20pack-contributed%20entity%20kinds.md)

---

## At a glance

A contract declares the Postgres extensions it needs, as it declares tables and enums:

```prisma
extension pg_trgm {}

namespace extensions {
  extension postgis {}
}
```

The pgvector pack's own contract declares `extension vector {}`. Against a database that already has `vector` and `pg_trgm`, adoption is two commands:

```bash
prisma contract emit
prisma db sign --db "$DATABASE_URL"
```

`db sign` checks the database against each contract space's contract. `vector` and `pg_trgm` are part of those contracts, so the check proves they are installed, and sign writes both markers. A database built from `migrations/` alone gets both extensions from the planner.

## Decision

1. **`extension` is an entity kind of the Postgres target.** It is stored at `storage.namespaces.<namespace>.entries.extension.<name>` and holds the extension's name and an optional `control`. It has the whole lifecycle the `native_enum` kind has:
   - PSL `extension <name> {}`, and `extension(name)` in the TypeScript builder;
   - introspection from `pg_extension` joined to `pg_namespace`;
   - verification;
   - planning: `CREATE EXTENSION IF NOT EXISTS … WITH SCHEMA …`, `DROP EXTENSION` without `CASCADE` (destructive), and `ALTER EXTENSION … SET SCHEMA`;
   - `contract infer` and `contract print`.
2. **An extension is declared in the namespace of the schema its objects are created in.** PostgreSQL records one schema per extension (`pg_extension.extnamespace`). A top-level declaration is in `public`. An extension's name is unique across the database, so a contract that declares one name in two namespaces is refused.
3. **The version is not recorded.** Hosts offer different versions, and nothing pins one.
4. **Extensions no contract declares are never reported**, in strict mode or not. Every database has `plpgsql`, and hosts preinstall many more. A declared extension that is missing fails verification in both modes, and one installed in another schema fails as an incompatible declaration.
5. **A pack declares the extension it needs in its own contract.** pgvector declares `vector`, PostGIS `postgis`, ParadeDB `pg_search`. An extension no pack covers goes in the application's contract. Two spaces declaring the same extension in the same namespace is the existing storage-element conflict. That check compares coordinates, which include the namespace, so it does not yet refuse two spaces that declare one extension in different namespaces; verification then fails for one of them, because the database holds the extension in one schema.
6. **`db sign` refuses a contract space whose head ref requires an invariant that its marker does not record.** A space with no marker is refused only when its head ref lists invariants. Sign writes no marker, snapshot or `db` ref for a refused space and reports `MIGRATION.SIGN_INVARIANTS_MISSING`, naming the space and each missing invariant. Every other space that verifies is signed, and the command exits 4. Sign still never runs a migration operation. Only extension spaces can be refused: the application space's head ref is the emitted contract, which lists no invariants.
7. **`contract emit` writes each composed pack's pinned files** under `migrations/<space-id>/`, as `migration plan` does, and lists them in its output. The pinned files mirror the installed pack, so after a pack is upgraded or downgraded in `node_modules`, the next emit moves `refs/head.json` to that pack's head. `contract emit --output-path`, which writes the contract outside the project, writes no pinned files.

## Why

`db sign` has one rule: it checks the database against each contract space's contract and, where the check passes, writes the marker. Before this decision a pack's contract could not mention its extension, because the contract had no kind for one. Each pack installed its extension in a hand-written migration operation that recorded an invariant, such as `pgvector:install-vector-v1`. On a database that already had the extension, `db sign` had nothing to check. It wrote the marker without the invariant, and then `db verify` failed on the missing invariant and `db migrate` found no path.

An invariant is a promise that a migration ran. Only running the migration keeps that promise, and sign never runs one. So sign refuses a space whose invariants are not on its marker, instead of writing a marker that every later command rejects. A pack that wants databases to be adoptable by `db sign` describes what it needs in its contract. A pack that installs objects the contract cannot describe, such as functions and operators, keeps its migration and invariant, and such a database is adopted with `db migrate`.

The planner already orders operations by kind. An extension's operations run in the `dep` bucket after schemas and before types and tables, so a column whose type the extension provides is created after the extension.

The schema node for an installed extension sits on the database root, not under a namespace node. The differ pairs nodes within their parent. Under namespaces, an extension moved to another schema would be one missing node and one extra node. On the root it pairs by name, so a move is one difference and plans `SET SCHEMA`. The contract side keeps the extension under its namespace, as decision 2 says.

## Consequences

- A Prisma 7 project adopts Prisma 8 with `contract emit` and `db sign` when its datasource `extensions` list names extensions that packs or the application contract declare. The Prisma 7 reader turns each listed extension with no pack into an `extension` entry.
- Each pack keeps its old install migration in its graph. A database whose marker records the old invariant reaches the new head with `db migrate`. A new migration from the empty contract gives new databases one step to the head, and the new head ref lists no invariants.
- [ADR 212](ADR%20212%20-%20Contract%20spaces.md) is amended in two places:
  - its IR boundary section said `CREATE EXTENSION` is the body of a migration operation; it is now planned from the contract;
  - its "What apply-time does not need" section said only `migrate` writes the pinned files; `contract emit` writes them too.
- `contract infer` writes every installed extension except `plpgsql` and the ones a composed pack declares. A Supabase database's inferred contract declares the extensions Supabase installed, such as `namespace extensions { extension uuid-ossp {} }`.
- CipherStash is unchanged. Its EQL bundle is functions, operators and casts that the contract cannot describe, so it keeps its migrations and invariants, and `db sign` refuses a database that has not run them.

## Alternatives considered

- **`db sign` proves an invariant by running the migration operation's postcheck.** A postcheck shows the operation's result exists, not that the migration ran: a data invariant may record work no check can see. Sign would also gain a second mode, deciding per operation whether a check stands in for a run.
- **A `schema` field on the extension.** The contract already says where an entity lives: the namespace it is declared in. A field would be a second way to say it, and the two could disagree.
- **Report extensions no contract declares in strict mode.** Every database has `plpgsql`, and every host preinstalls its own set, so strict mode would fail on every hosted database.
- **Record and plan the extension's version.** Hosts offer different versions of the same extension, and an `ALTER EXTENSION … UPDATE` is the host's decision. A recorded version would fail verification on hosts that offer another.
- **Delete each pack's old install migration.** Existing markers point at its hash, and leaving it in the graph costs nothing.
