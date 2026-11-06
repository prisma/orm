# ADR 316 — An extension pack's extension is found through the connection's search_path

**Status:** Proposed
**Date:** 2026-11-06
**Amends:** [ADR 312 — A Postgres extension is a contract entity, and db sign refuses a space with unmet invariants](ADR%20312%20-%20A%20Postgres%20extension%20is%20a%20contract%20entity%2C%20and%20db%20sign%20refuses%20a%20space%20with%20unmet%20invariants.md), decisions 1, 2 and 5

## At a glance

A Supabase database installs every extension in a schema named `extensions`, and connects its `postgres` role with that schema on the search path:

```sql
SELECT e.extname, n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace;
--  extname | nspname
--  vector  | extensions

SHOW search_path;
--  "$user", public, extensions
```

The pgvector pack's contract declares its extension in the `unbound` namespace:

```prisma
namespace unbound {
  extension vector {}
}
```

A project that composes the pgvector pack adopts this database with the usual two commands:

```bash
prisma contract emit
prisma db sign --db "$DATABASE_URL"
```

`db sign` accepts `vector` in `extensions`, because a reference to `vector` that names no schema finds it on this connection.

## Decision

1. **A pack declares its extension in the unbound namespace.** A pack that declares an extension in a named namespace is refused when a command loads the configuration. The rule covers every entity kind whose name is unique across the whole database, not only extensions; today the extension is the only such kind. An application contract may also declare an extension in the unbound namespace. A top-level `extension` declaration still means schema `public`.
2. **Postgres checks an unbound extension against the search path.** The extension passes verification when its schema is on the connection's search path, as `current_schemas(true)` reports it. Otherwise it fails, and the message names the extension's schema and the search path. Offline planning has no connection and no search path, so it accepts an unbound extension wherever the contract it plans from puts it. When the contract it plans from declares the extension in the unbound namespace and the new contract names a schema, `public` included, the extension may be in any schema on the search path, so the planner plans `ALTER EXTENSION … SET SCHEMA` to the named schema. The operation's postcheck checks that the extension is in that schema, so the runner skips the move when it is already there.
3. **Postgres installs an unbound extension without naming a schema.** The planner plans `CREATE EXTENSION IF NOT EXISTS "vector"` with no `WITH SCHEMA`, so PostgreSQL creates it in the connection's current schema, unless the extension's control file names a schema of its own. The planner never plans `ALTER EXTENSION … SET SCHEMA` for an unbound extension. Which schema it belongs in is the user's choice, so a failed check comes with advice instead: add the schema to the search path, or reinstall the extension in a schema that is on it.
4. **Each extension is declared once across all contract spaces.** Two packs that declare the same extension are refused when a command loads the configuration. An application contract that declares an extension a pack declares is refused when it is planned, and when it is emitted from PSL. The message tells the user to remove their own declaration. At emit it names the pack. At plan time it says an extension pack declares the extension, because the planner can ask whether some contract space declares an entity, but not which one. An application that declares the extension in the unbound namespace, as the pack does, claims the same coordinate as the pack, so the existing check that refuses two contract spaces claiming one storage element refuses it, with that check's own message.

## What a pack's contract depends on

pgvector, PostGIS and citext refer to their extension's objects without naming a schema. A pgvector column's type is `vector`, not `public.vector`. Its distance query is `embedding <=> $1`. A PostGIS value is cast with `::geometry`. ParadeDB's operators work the same way; its functions and casts name the schema `pdb`.

PostgreSQL resolves a name that has no schema by searching the schemas on the connection's search path, in order. So a pack's columns and queries work on any connection whose search path includes the schema that holds the extension. Which schema that is does not matter.

The extension's declaration should check that same requirement. A declaration in `public` checks a different one. It refuses a Supabase database, where the columns work. It accepts a database with the extension in `public` and `public` missing from the search path, where the columns fail.

## The unbound namespace means "the connection decides"

The framework reserves one namespace, the unbound namespace ([ADR 223](ADR%20223%20-%20Target-owned%20default%20namespace.md)), for storage whose location the target settles when it connects, rather than when the contract is written. A target renders a reference to an entity in it without a namespace qualifier. Each target, and within a target each entity kind, settles the location in the way that matches how the database resolves a name with no qualifier:

| Target and entity kind | Where an entity in the unbound namespace is |
| --- | --- |
| Postgres table | the connection's current schema, where an unqualified `CREATE` puts it |
| Postgres role | nowhere: roles belong to the whole cluster, so they are always declared in the unbound namespace |
| Postgres extension | any schema on the connection's search path, where an unqualified type or operator name is found |
| MongoDB collection | the database the connection is bound to |
| MySQL table | the database the connection is bound to |

The Postgres extension row is the one this ADR adds. It differs from the table row because an extension's objects are found by lookup, and a lookup searches the whole search path. A table is checked where it would be created, which is one schema.

So the pack mechanism stays generic. A pack contributes an entity at a coordinate (namespace, entity kind, name), and here the namespace is the unbound one. What "on this connection" means for an extension is Postgres code, in the Postgres target.

The namespace must also be the same in every project. A pack's contract is pinned with its hash ([ADR 212](ADR%20212%20-%20Contract%20spaces.md)), and the pinned contract must hash to the pack's head. A namespace chosen per project would give one pack a different hash in each project. The unbound namespace is one value that every project shares.

## Why one declaration per extension

PostgreSQL installs each extension once per database, in one schema. Two declarations of `vector` can only both pass if they agree, and two contract spaces cannot see each other's choices when they are written. A second declaration is also a hazard: if the application declares `vector` and later removes the declaration, its plan would drop the extension the pack needs.

The checks run where both declarations are visible. Pack contracts are all visible when the configuration loads. The application's contract meets the packs' contracts in the planner, which already asks whether another contract space declares an entity before it drops one, and in the PSL interpreter, which reads the composed packs.

## Consequences

- A database whose extension sits in `public` passes, because `public` is on the default search path.
- A fresh database gets a pack's extension with no schema named: each pack has a migration from the empty contract straight to its new head that plans `CREATE EXTENSION IF NOT EXISTS` without `WITH SCHEMA`. A database built from a pack's earlier migrations has the extension in `public`, which passes.
- Each pack's head moves once, to a migration with no operations. An existing database fails `db verify` until the project runs `contract emit` and `db migrate`, which applies that migration. The release notes say so.
- An application cannot pin a pack's extension to one schema, because its own declaration is refused. An application that declares an extension a pack also declares must remove its declaration when it upgrades.
- A runtime connection whose search path lacks the extension's schema fails at query time. Sign and verify check only the connection they use.
- The Prisma 7 reader no longer compares the schema a Prisma 7 `extensions` entry gives with the pack's declaration. Verification against the database makes that check.
- `contract infer` still writes each installed extension that no pack declares in the schema it is installed in, because it describes the database as it is.

## Alternatives considered

- **Each project names the schema for the pack's extension.** The pinned contract's hash would differ per project, and the pinned contract would no longer hash to the pack's head.
- **Packs declare the extension with no schema check at all.** Verification would accept an extension in a schema the columns cannot see, and the failure would appear only at query time.
- **A Postgres-only "on the search path" flag on the extension entity.** It would be a second way to say where an entity lives, beside its namespace, and it would mean nothing to other targets. The unbound namespace already carries that meaning.
- **Check the application against packs in the framework's cross-space check.** That check compares coordinates, which include the namespace. Making it compare extension names alone would put a Postgres rule in the framework.
- **Document that Supabase databases cannot be adopted.** Supabase is a main hosting target. Whichever command adopts such a database, verification refuses it while the pack declares `public`.
