# Design: bring Prisma's own database tables up to date in each release

The design for project 7 of the [plan](../plan.md). It holds only what has been agreed. It implements section 6.4 of the [policy](../spec.md).

Prisma keeps tables for itself in a user's database: the marker, which records the contract the database matches; the ledger, which lists the migrations applied; and the contract table.

This design is our best effort, written before anything was built. Its purpose is fixed. Check its mechanism against the code as you build, and say so with evidence where it is wrong.

## 1. Each target has a contract space for Prisma's own tables

Prisma's own tables are a contract space, and it works the way an extension's does.

An extension such as pgvector holds a contract and migration folders in its package, made with the same `contract emit` and `migration plan` an application uses. Its descriptor imports them and carries them in a `contractSpace` field, so the whole migration graph is in the package's bundle. A target package does the same for Prisma's own tables: the same package layout, the same authoring commands, and the same `contractSpace` field, on the target's descriptor.

Each target has its own tables, in its own database's terms, so each target package has its own contract and migrations. The framework has no say in what a target stores or what it calls it, because the target also writes the queries against it.

The space's marker row records the hash of its contract, which says which form the tables are in. No version number is needed. Its migrations leave ledger rows like any other space's.

A gain that follows: today each adapter reads and writes these tables through table definitions written by hand beside the `CREATE TABLE` statements, and the two can disagree. With an emitted contract, the target can query its own tables through a client typed from that contract.

## 2. The framework adds the space, and treats it differently in four ways

The framework's extension descriptor already has an optional `contractSpace` field. The target descriptor gets the same field. The code that builds the list of spaces for a command adds the target's space to it.

The framework does this, and not each target's runner, so that the mechanism is the same on every target. Otherwise four runners and `db sign` would each write "put my own space first" themselves.

Everything after the list is built already works per space and needs no change: finding the path from the marker row to the newest contract, running the operations, writing the marker and ledger rows, `db sign` and `db verify`.

The differences from an extension's space:

- **It is read from the installed package, not from the user's repository.** An extension's contract and migrations are copied into the user's repository by `contract emit`, and only those copies are read when migrations are applied. For this space, the list-builder reads the target descriptor's `contractSpace` directly. The reason: these tables must match the release that is installed, not the repository. A user who upgrades Prisma and deploys without emitting first would otherwise apply an old copy, and the new release would then write to tables in the old form. The target package is always installed when migrations are applied, because the runner is in it.
- **It is applied before every other space.** Today extensions are applied in alphabetical order and the application last. This space comes before the extensions. The order is stated in code and not left to sorting.
- **Its name is reserved.** The space is named `_prisma`. The framework reserves it as it reserves `app`, and the check for marker rows of undeclared spaces counts it as declared. A space name must today begin with a letter, so the check on names is split: what an extension may declare, and what any space may be called.
- **It is not shown by default.** A user does not need to review changes to these tables, as with any other ORM. The command-line tool leaves this space out of what it displays, and shows it when asked. A user may still read the tables.

This is a stated exception to the decision record on contract spaces, which says that everything needed to apply and verify a database is in the user's repository.

This changes framework code: the target descriptor's type, the list-builder, the ordering, the name check and the displays. It was raised with the operator and agreed.

## 3. When it is applied

Today each target's runner creates these tables itself, with `CREATE … IF NOT EXISTS` statements its adapter supplies, before it reads any marker. `db sign` creates the marker table by a second route.

Both go away. Whenever migrations are executed or a database is signed, the `_prisma` space is run first, like any other space, in the same transaction where the database allows it. Its first migration creates the tables.

The space's own marker row lives in a table the space creates. That works because reading a marker from a missing table already returns "no row", so the path starts from an empty database.

The user is not asked and writes nothing. These operations must not fail, because a user can do little to repair them.

## 4. What its migrations may contain

Within a major version, only additions. Application instances on an earlier release keep reading these tables while a deploy is in progress. This is easy to enforce, because the migrations are our own and can be checked before a release.

## 5. From `8.0.0`, and databases set up by a release candidate

`8.0.0` writes the marker row for this space. Every database from `8.0.0` on then says which form its tables are in. Without that row, a database could be in any earlier form, and a later release could not tell which. So this is built before GA.

A database set up by a release candidate has the tables but no row for this space. `8.0.0` finds no row and runs the space's first migration. Each step checks whether its result already holds, as migration steps do today, and is skipped if so. Then the row is written. The user does nothing.

The checks look at the columns, not only at whether a table exists. A database from before the release candidates (`0.x`) can have these tables in an older form. There the check fails, and the command stops and points at the upgrade instructions. Those forms are not migrated.

On PostgreSQL the first migration also renames the schema, as section 6 says: if the old schema exists it is renamed, otherwise the new one is created. `ALTER SCHEMA … RENAME` changes only the catalogue, so it is instant at any size.

A consequence: a release candidate's command-line tool or application, pointed at a database that `8.0.0` has brought up to date, finds no marker. The application warns and runs, as the design for project 2 says.

To confirm per target while building: on PostgreSQL the tables have not changed since `rc.1`. SQLite changed a column default at `rc.15`, so its first migration must accept both.

## 6. Every name Prisma puts in a database begins with `_prisma`

The rule: anything a target stores in a user's database for Prisma (a table, a schema, a collection, an enum, a role), and any name Prisma invents inside a query, begins with `_prisma`, with one underscore.

The reason: these names share a namespace with the user's own. A user can tell from the name alone that the object is internal, maintained by Prisma, and not to be changed by hand. A collision with a user's name is unlikely with or without the underscore, but where our names share a space with theirs we make a collision impossible or resolvable. The underscore says "do not edit", not "do not look": the marker in particular is worth a user's reading.

What the code does today, from a search of the source on 2026-11-25:

| Where | Names today | Prefix today |
| --- | --- | --- |
| SQLite and MySQL tables | `_prisma_marker`, `_prisma_ledger` | one underscore |
| MongoDB collection | `_prisma_migrations` | one underscore |
| PostgreSQL schema | `prisma_contract`, holding `marker`, `ledger`, `contract` | none |
| Temporary names while a migration swaps enum values or names | `prisma_swap`, `prisma_swap_<name>` | none |
| Column aliases inside generated queries, in the ORM client | `__prisma_distinct_rn`, `__prisma_page_rn`, `__prisma_aggregate`, `__prisma_parent_key_…` and others | two underscores |
| Lock names | `prisma_marker_<hash>` on MySQL, `prisma_8.contract.marker` on PostgreSQL | none |

No rule or decision record explains the difference between one underscore and two. Each was chosen where it was written.

What changes:

- The PostgreSQL schema is renamed `_prisma`, automatically at `8.0.0` (section 5).
- The temporary names become `_prisma_swap…`. Nothing is stored, so nothing is migrated.
- The query aliases move to one underscore. They are never stored and never seen by a user.
- The space is named `_prisma`.
- Lock names stay. They are not objects in a namespace the user shares.

## 7. Decision records this project writes

The project writes these, in the pull requests that change the code. Each entry gives the context a writer needs. They are written by the orchestrator, not delegated.

### 7.1 Names Prisma puts in a database or a query begin with `_prisma`

- **Decision and reason:** section 6.
- **Evidence:** the table in section 6. Run the search again when writing, since the code will have moved.
- **Prior art, to verify before citing.** Tools that put their name in their own tables with no underscore: Kysely (`kysely_migration`), Knex (`knex_migrations`), Django (`django_migrations`), Alembic (`alembic_version`), Flyway (`flyway_schema_history`). Rails uses `schema_migrations` and `ar_internal_metadata`. With an underscore: Prisma 7 and earlier (`_prisma_migrations`), Drizzle (`__drizzle_migrations`, inside a schema named `drizzle` on PostgreSQL).
- **Alternatives considered:**
  - No prefix beyond the name, as Rails and most tools do. Rejected: the underscore is a clear sign of "internal", and Prisma's users already know it.
  - Two underscores. Rejected: it adds nothing once the rule is stated, and one convention is simpler than two.
  - Leaving PostgreSQL as an exception because a schema already separates its tables from the user's. Rejected: the schema's own name shares a namespace with the user's schemas.
  - Relying on the rule that a space name begins with a letter to keep `_prisma` out of the user's repository. Rejected as an argument: that is a check on names, and a check on names must not be what a structural property depends on.
- **Note for the writer:** a user moving from Prisma 7 may still have its `_prisma_migrations` table. The decision records on reading an earlier Prisma version's schema treat that table as the earlier tool's bookkeeping, and the PostgreSQL target leaves it alone. Say how the two relate.

### 7.2 Each target has a contract space for Prisma's own tables

- **Decision and reason:** sections 1 to 5.
- **What it amends:** the decision record on contract spaces (this space is read from the installed package, not the repository; a target descriptor may carry a space; the apply order gains a first position; the set of marker rows now includes `_prisma`), and the decision record on marker storage (the tables are created by a migration, not by `CREATE … IF NOT EXISTS`).
- **How it works today, for the "before" picture:** each target's runner calls its own `ensureControlTables`, which runs the statements the adapter returns from `bootstrapControlTableQueries()`; `db sign` uses `bootstrapSignMarkerQueries()`. The list of spaces is built from folders under the repository's `migrations/` by `loadContractSpaceAggregate`, and ordered by `concatenateSpaceApplyInputs`.
- **Alternatives considered:**
  - A version number on the marker and ledger. Rejected: a contract hash already says which form the tables are in, and a second mechanism for the same job is not needed.
  - Copying the space into the user's repository like an extension's. Rejected for the reason in section 2.
  - Each target's runner adding its own space, with nothing changed in the framework. Rejected: the mechanism would be written once per target and would drift.
  - A numbered list of statements kept by the target and run in order, outside the migration system. Rejected: it is a second, weaker migration system beside the one that exists.

### 7.3 Further records that depend on section 8

The split of the marker into contract signatures and configuration, the names, and MongoDB's three collections (section 8). This updates in place the decision records on marker storage and on MongoDB's migration state, and the glossary.

## 8. The tables and their names

The marker row holds two things with different scopes. Its hashes, contract and invariants say which contract one contract space was signed with. Its policies (`meta.policies`, the change policy and the data protection policy) describe the whole database, not one space. So the marker is split in two, and each record is named for what it is.

| Record | PostgreSQL | SQLite, MySQL, MongoDB | One row per | Holds |
| --- | --- | --- | --- | --- |
| Contract signatures | `_prisma.signatures` | `_prisma_signatures` | contract space | the hashes of the contract the space was signed with, when, and the invariants. The contract's JSON may be included for information. A row stands for one successful signing: `db sign`, or the signing at the end of `db migrate` and `db update` |
| Configuration | `_prisma.config` | `_prisma_config` | database | the change policy and the data protection policy |
| Ledger | `_prisma.ledger` | `_prisma_ledger` | applied change | as today: an append-only record of each change applied, never edited |

The reasons:

- "Marker" says nothing to someone who finds the table in their database. "Signature" matches the command that writes the row, `db sign`, and the error reference and command output already call the row a signature. In prose and errors the term is "contract signature", which keeps it apart from a cryptographic signature and from a PostgreSQL function signature.
- "State" was considered and rejected: everything persisted is state, so the word says nothing.
- "History" was considered for the ledger and rejected: a ledger has the exact meaning needed, an append-only record of what happened.
- Policies are per database, so they cannot live in a per-space row.

The concept is renamed everywhere, not only the tables, since no name can change after `8.0.0`: the client option `verifyMarker`, the flag `db verify --marker-only`, the error codes such as `CONTRACT.MARKER_MISSING`, the error fields such as `markerHash`, the `marker` object in `--json` output, the command-line messages, the glossary and the skill. The research behind this, with counts and paths, is in `wip/research/2026-11-25-prisma-table-names.md` on the planning session's worktree; run the search again when building.

MongoDB gets the same three collections, in place of its one `_prisma_migrations` collection. The decision record on MongoDB's migration state rejected separate collections because they doubled the setup. That no longer holds: there is a row per contract space, PostgreSQL has several tables, and the collection needs no setup today. Prisma 7 never created `_prisma_migrations` on MongoDB, so nothing reads the old name. The record is updated in place.

Prisma Studio reads these tables for its Migrations view (prisma/studio#1533), so it changes with them.

## 9. Not yet discussed

- **A change that is not an addition.** The policy says the ORM stops and names the one command that makes it.
- **The PostgreSQL `contract` table.** It holds one row per contract, keyed by hash, and each ledger row's destination contract is written to it. It was added for Prisma Studio's Migrations view, which shows the contract before and after each migration. Only PostgreSQL has it. To decide: whether it stays as `_prisma.contracts`, whether every target gets it, or whether the ledger row carries the contract instead.
