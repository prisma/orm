# Manual QA run, 2026-11-28: the split of `_prisma.marker` into `signatures` and `config`

Branch `own-tables-signatures-config` at `4731d98e85`. Script: `projects/prismas-own-tables/manual-qa.md`, all ten scenarios.

Result: 8 pass, 2 fail (scenario 6, second half, and scenario 10).

## Setup

- **New release:** `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock pnpm build`, run once at the start. Exit 0, 105 of 105 tasks, 94 from cache. The built target (`packages/3-targets/postgres/1-target/dist/control.mjs`) contains the `signatures` and `config` tables. The CLI ran as `./node_modules/.bin/prisma` in the scratch project `wip/qa/new`, whose `node_modules` links to `examples/prisma-8-demo/node_modules`. **Reused** from the last run.
- **Release candidate:** `@prisma/orm-postgres@8.0.0-rc.25` and `prisma@8.0.0-rc.36` in `wip/qa/rc`. The registry still has `rc.25` as `latest` for `@prisma/orm-postgres`, so the install from the last run is still the newest. **Reused**; no install this run.
- **Contracts and migrations:** `wip/qa/contracts/v1.prisma` (`User { id, email }`), `v2.prisma` (adds `name String?`), and the migrations `20261127T1038_initial` and `20261127T1039_add_name`. **Reused.** Storage hashes: v1 `bc4424a6…`, v2 `174956a1…`.
- **Helpers:** `wip/qa/lib.sh` (**reused**: `project`, `newdb`, `schemas`, `tables`) plus a new `wip/qa/r2/lib2.sh` with `run <rc|new> <args>` (runs the CLI and logs to `wip/qa/r2/transcript.log`) and `dumpall <db> <schema>`, which prints `signatures`, `config`, `marker`, `ledger` (id, space, name, hash, origin and destination prefixes, md5 of `operations`, `created_at`) and `contract` (hash, md5 of `contract_json`, `created_at`).
- **Database server:** the PostgreSQL 17.11 cluster in `wip/qa/pgdata` from the last run, **reused**, on port 55432. Same deviation as last time: the integration tests' server (`@prisma/dev`, PGlite) runs every connection as one superuser and cannot give scenario 5 a non-owner role. Started with `LC_ALL=en_US.UTF-8 pg_ctl -D wip/qa/pgdata -l wip/qa/r2/pg.log -o "-p 55432 -k wip/qa/r2" start` (process 78002; without `LC_ALL` it failed with "postmaster became multithreaded during startup", and without `-p` it tried port 5432, which another server holds). Stopped at the end with `pg_ctl -D wip/qa/pgdata stop`; process 78002 is gone. Each scenario got a new database `qa2_sN`.
- The full transcript of every CLI run is in `wip/qa/r2/transcript.log` (gitignored).

## Scenario 1: a new database — Pass

Empty `qa2_s1`, contract v1, no migrations.

```
$ prisma db init    [new]
The records Prisma keeps for itself in this database were brought up to date.
▸ Introspecting database schema
✔ Introspecting database schema
▸ Planning migration
✔ Planning migration
▸ Initialising database across spaces
✔ Initialising database across spaces
│  contract:  src/prisma/contract.json
│  database:  postgres://****@localhost:55432/qa2_s1

✔ Applied 1 operation(s) across 1 contract space

App space
├─ Create table "user"
└─ marker bc4424a6f9ff59e7e105ddc2f34f88ce0b5dd5425a3cfdb6fa61f1ae31f55a1c

✔ Advanced ref "db" → bc4424a6f9ff59e7e105ddc2f34f88ce0b5dd5425a3cfdb6fa61f1ae31f55a1c
→ Confirm the space is up to date: prisma migration status
exit 0
```

SQL checks:

- Schemas: `_prisma` (owner `postgres`) only. No `prisma_contract`.
- Tables in `_prisma`: `config`, `contract`, `ledger`, `signatures`. No `marker` (`relation "_prisma.marker" does not exist`).
- `signatures`: `_prisma | 3e3fe1bc… | 3916f444… | {}` and `app | bc4424a6… | 3916f444… | {}`.
- `config`: no row.
- `ledger`: `1 | _prisma | 20261126T1200_create_prisma_tables | empty → 3e3fe1bc` and `2 | app | '' | → bc4424a6`.
- The "brought up to date" line appears once; only "App space" is listed.

```
$ prisma db verify    [new]
▸ Connecting to database...
✔ Connecting to database...
▸ Verifying database marker...
✔ Verifying database marker...
▸ Introspecting database schema
✔ Introspecting database schema
▸ Verifying contract spaces
✔ Verifying contract spaces
│  contract:  src/prisma/contract.json
│  mode:      full (marker + schema, tolerant)
│  database:  postgres://****@localhost:55432/qa2_s1

✔ Database marker and schema match contract

storageHash:  bc4424a6f9ff59e7e105ddc2f34f88ce0b5dd5425a3cfdb6fa61f1ae31f55a1c
profileHash:  3916f444a8a17ad749191acf9e08dad97d1a327b88c2f1d45d12f240296aa8b2
exit 0

$ prisma migration status    [new]
│  migrations:  migrations
│  database:    postgres://****@localhost:55432/qa2_s1

(no migrations)

✔ No migrations found
exit 0

$ prisma migration log    [new]
│  database:  postgres://****@localhost:55432/qa2_s1

Applied at                  Migration  Change       Ops
2026-11-28 18:29:13 +11:00  —          ∅ → bc4424a  1 ops
2026-11-28T07:29:13.450Z	app			bc4424a6f9ff59e7e105ddc2f34f88ce0b5dd5425a3cfdb6fa61f1ae31f55a1c	1
exit 0
```

(The tab-separated line is the command's standard output when it is not a terminal; the table is standard error. Both were captured together.) The `--json` output of all three commands contains `_prisma` zero times.

Wording: "were brought up to date" on a database that had no records; they were created. Carried over from the last run.

## Scenario 2: a database set up by the release candidate — Pass

As written, on `qa2_s2`: RC `db init` (contract v1, migration 1 on disk) applied `Create table "user"`, then RC `db migrate` said "✔ Already up to date". As last time, `db init` already reaches the contract, so I also ran the variant `qa2_s2b`, where RC `db migrate` alone applied migration 1 ("✔ Applied 1 migration(s) (2 operation(s))", ledger `20261127T1038_initial`, `empty → bc4424a6`).

Rows before the upgrade, `qa2_s2` (`prisma_contract`):

```
## prisma_contract.marker      (space, core_hash, profile_hash, invariants, meta)
app|bc4424a6…|3916f444…|{}|{}
## prisma_contract.ledger
1|app||bc4424a6…||bc4424a6|932586729a5ff122b40cd0865a5f0729|2026-11-28 18:29:41.55691+11
## prisma_contract.contract
bc4424a6…|bc89b1ba2c421d40ffe4f3cb039dbf27|2026-11-28 18:29:41.55691+11
```

`marker.updated_at` `2026-11-28 18:29:41.55691+11`; `contract_json`, `canonical_version`, `app_tag` empty. `qa2_s2b` had `ledger 1|app|20261127T1038_initial|9caa1a46…|empty|bc4424a6|64aa3dde…` and `contract bc4424a6…|7b299713…`.

New release, contract v2, both migrations (same output on both databases):

```
$ prisma db migrate    [new]
The records Prisma keeps for itself in this database were brought up to date.
▸ Running migration plan across spaces
✔ Running migration plan across spaces
│  migrations:  migrations
│  database:    postgres://****@localhost:55432/qa2_s2

✔ Applied 1 migration(s) (1 operation(s)) across 1 contract space(s)

App space
├─ Add column "name" to "user"
└─ marker 174956a177dcd26588661edf2462d9ab99747ce74f3f5788792528acb3c86104

✔ Advanced ref "db" → 174956a177dcd26588661edf2462d9ab99747ce74f3f5788792528acb3c86104
→ Check every space against the database: prisma migration status
app	20261127T1039_add_name	bc4424a6…	174956a1…	1
exit 0
```

SQL checks, `qa2_s2`:

```
schemas: _prisma (postgres) only
tables: _prisma.config, contract, ledger, signatures; no marker
## _prisma.signatures
_prisma|3e3fe1bc…|3916f444…|{}
app|174956a1…|3916f444…|{}
## _prisma.config            (no row)
## _prisma.ledger
1|app||bc4424a6…||bc4424a6|932586729a5ff122b40cd0865a5f0729|2026-11-28 18:29:41.55691+11     (unchanged)
2|_prisma|20261126T1200_create_prisma_tables|ccb07c33…|empty|3e3fe1bc|cbc45b49…|…
3|app|20261127T1039_add_name|b17a3a83…|bc4424a6|174956a1|d6ab6b6a…|…
## _prisma.contract
174956a1…|d10a0754…|…
bc4424a6…|bc89b1ba2c421d40ffe4f3cb039dbf27|2026-11-28 18:29:41.55691+11                       (unchanged)
```

`qa2_s2b` is the same with its own ledger row 1 and contract row unchanged. Columns of `user`: `email`, `id`, `name`. The second migration was applied from `bc4424a6`, on top of the first.

The `app` signature moved to v2 because the second migration ran, so this run alone cannot show the copied hashes. **Extra check `qa2_s2c`:** RC `db migrate` with migration 1, then the new release with contract v1 and migration 1 only (nothing pending). Before: `marker app|bc4424a6…|3916f444…|{}|updated_at 2026-11-28 18:30:21.389754+11|meta {}`. After: `signatures app|bc4424a6…|3916f444…|{}|signed_at 2026-11-28 18:30:21.389754+11`. Hashes, invariants and the time are copied exactly; `config` has no row because `meta` had no policies.

The `_prisma` ledger row's operations, in order: `check-release-candidate-columns.{marker,ledger,contract}`, `rename-release-candidate-schema`, `create-schema`, `create-table.{signatures,config,ledger,contract}`, `check-columns.{marker,signatures,config,ledger,contract}`, `move-marker`.

Second `db migrate` on both databases:

```
$ prisma db migrate    [new]
│  migrations:  migrations
│  database:    postgres://****@localhost:55432/qa2_s2

✔ Already up to date

App space
├─ (no operations)
└─ marker 174956a177dcd26588661edf2462d9ab99747ce74f3f5788792528acb3c86104

✔ Advanced ref "db" → 174956a177dcd26588661edf2462d9ab99747ce74f3f5788792528acb3c86104
→ Check every space against the database: prisma migration status
exit 0
```

No "brought up to date" line. `dumpall` before and after is identical on both.

## Scenario 3: commands that only read, before the upgrade — Pass

`qa2_s3`: RC `db migrate` applied migration 1. New release, contract v2, both migrations. All seven commands, `db verify`, `db verify --schema-only`, `migration status`, `migration log`, `db migrate --show`, `db init --dry-run`, `db update --dry-run`, printed this and exited 2 (`db verify` first prints its "Connecting" and "✘ Verifying database marker..." steps):

```
✘ [CONTRACT.PRISMA_SPACE_BEHIND] The records Prisma keeps for itself in this database are not up to date with the installed release of Prisma
  why: They are in the schema `prisma_contract`, where the release candidates of Prisma 8 kept them. This release keeps them in the schema `_prisma`, so it cannot read which contract the database matches until they are brought up to date.
→ Bring the records up to date, in a project that applies migrations: prisma db migrate
→ Bring the records up to date, in a project that changes its database with db update: prisma db update
→ Bring the records up to date, in a project that only signs its database: prisma db sign
  docs: https://docs.prisma.io/docs/orm/v8/reference/error-reference/CONTRACT.PRISMA_SPACE_BEHIND
exit 2
```

Afterwards the schema was still `prisma_contract` and `dumpall` was identical to before. The `--json` envelope has the same summary, `why` and three next actions, with `meta: {"spaceId":"_prisma","situation":"releaseCandidateSchema"}`.

As a user: clear. It says which schema, why it cannot read it, and which command to run for each kind of project. The two stumbles from the last run are fixed: the advice now names `db update` and `db sign`.

**Extra checks of the other two pieces of advice.**

- `qa2_s3u`: RC `db init`, no migrations folder; new release, contract v2, `prisma db update`:

  ```
  The records Prisma keeps for itself in this database were brought up to date.
  ▸ Introspecting database schema
  ✔ Introspecting database schema
  ▸ Planning migration
  ✔ Planning migration
  ▸ Updating database across spaces
  ✔ Updating database across spaces
  │  contract:  src/prisma/contract.json
  │  database:  postgres://****@localhost:55432/qa2_s3u

  ✔ Applied 1 operation(s) across 1 contract space
  ⚠ control policy suppressed: namespace "__unbound__" — namespace '__unbound__' has effective control 'external' but declared 'external'

  App space
  ├─ Add column "name" to "user"
  └─ marker 174956a177dcd26588661edf2462d9ab99747ce74f3f5788792528acb3c86104

  ✔ Advanced ref "db" → 174956a177dcd26588661edf2462d9ab99747ce74f3f5788792528acb3c86104
  → Confirm the space is up to date: prisma migration status
  exit 0
  ```

  Schema `_prisma`, `signatures` `_prisma` and `app → 174956a1`, ledger rows 1 (kept), 2 (`_prisma`), 3 (the update). The last run's failure here (`MIGRATION.MARKER_MISMATCH` after following the advice) is gone.

- `qa2_s3s`: RC `db init`; new release, contract v1, `prisma db sign`: "The records Prisma keeps for itself in this database were brought up to date." then "✔ app: unchanged, already signed with bc4424a6…", "✔ Database signed", exit 0. Schema `_prisma` with both signature rows.

Stumble: the `⚠ control policy suppressed: namespace "__unbound__" — namespace '__unbound__' has effective control 'external' but declared 'external'` line on every `db update` here (also in scenario 7). It names an internal namespace and says a value differs from itself. It is probably not from this change, but a user upgrading sees it on the same screen.

## Scenario 4: the application, before and after — Pass (the warning needs `log`)

`qa2_s4`: RC `db migrate` applied migration 1. New release's app, contract v1. `src/main.ts` is the client with default options; `src/main-log.ts` passes `log: console`.

```
$ tsx src/main.ts
users: 1
exit 0
$ tsx src/main-log.ts
{
  code: 'CONTRACT.PRISMA_SPACE_BEHIND',
  scope: 'marker-verification',
  expected: {
    storageHash: 'bc4424a6f9ff59e7e105ddc2f34f88ce0b5dd5425a3cfdb6fa61f1ae31f55a1c',
    profileHash: '3916f444a8a17ad749191acf9e08dad97d1a327b88c2f1d45d12f240296aa8b2'
  },
  actual: null,
  message: 'The records Prisma keeps for itself in this database are not up to date with the installed release of Prisma, so the contract the database matches cannot be read. Run the command the project already uses to change its database: `prisma db migrate` in a project that applies migrations, `prisma db update` in one that changes its database with `db update`, or `prisma db sign` in one that only signs it. Each brings the records Prisma keeps for itself up to date before it does its usual work.'
}
users: 2
exit 0
```

Schema still `prisma_contract`. One warning, it names `prisma db migrate`, and the queries ran. With default options there is no warning, as the upgrade instructions now say ("by default the client says nothing"). The client's wording now matches the CLI's, which fixes last run's point about two different descriptions.

After `prisma db migrate` ("…were brought up to date.", "✔ Already up to date", exit 0; schema `_prisma`): `main-log.ts` printed `users: 3` and no warning; `main.ts` printed `users: 4`.

Restricted role: `CREATE ROLE qa_app4 LOGIN; GRANT USAGE ON SCHEMA public …; GRANT SELECT, INSERT ON public."user" …; GRANT USAGE ON SCHEMA _prisma …; GRANT SELECT ON _prisma.signatures TO qa_app4`. The role has no `SELECT` on `config` or `ledger` (checked with `has_table_privilege`: `f|f`). As `qa_app4`: `main-log.ts` printed `users: 5` with no warning, `main.ts` printed `users: 6`, both exit 0.

## Scenario 5: a role that does not own the old schema — Pass

Database `qa2_s5` and schema `public` owned by `qa_admin`. RC `db init` as `qa_admin` created `prisma_contract` and its tables, all owned by `qa_admin`. As `postgres`: `GRANT ALL ON SCHEMA prisma_contract`, `ALL ON ALL TABLES` and `ALL ON ALL SEQUENCES IN SCHEMA prisma_contract`, `ALL ON SCHEMA public`, `ALL ON ALL TABLES IN SCHEMA public`, `CREATE ON DATABASE qa2_s5`, all to `qa_migrator`.

New release as `qa_migrator`, contract v1, migration 1:

```
$ prisma db migrate    [new]
✘ [MIGRATION.PRECHECK_FAILED] The records Prisma keeps for itself in this database could not be brought up to date
  why: The role that runs this command must have the privileges of the role that owns schema "prisma_contract", because renaming a schema needs them. Find the owners of the schema and its tables with SELECT nspowner::regrole FROM pg_namespace WHERE nspname = 'prisma_contract' and SELECT relname, relowner::regrole FROM pg_class WHERE relnamespace = to_regnamespace('prisma_contract') AND relkind = 'r'. Give the schema and its tables to the migrating role with ALTER SCHEMA "prisma_contract" OWNER TO <migrating role>, then ALTER TABLE "prisma_contract"."marker" OWNER TO <migrating role>, ALTER TABLE "prisma_contract"."ledger" OWNER TO <migrating role>, ALTER TABLE "prisma_contract"."contract" OWNER TO <migrating role>.
→ Follow the upgrade instructions: https://github.com/prisma/orm/tree/main/skills/prisma-8/upgrading/app
  docs: https://docs.prisma.io/docs/orm/v8/reference/error-reference#MIGRATION.PRECHECK_FAILED
exit 2
```

Nothing changed: still `prisma_contract` owned by `qa_admin`, three tables, `dumpall` identical. Following the advice, as `postgres`: the two queries returned `qa_admin` for the schema and all three tables; then `ALTER SCHEMA "prisma_contract" OWNER TO qa_migrator` and the three `ALTER TABLE … OWNER TO qa_migrator`. Next run as `qa_migrator`:

```
$ prisma db migrate    [new]
The records Prisma keeps for itself in this database were brought up to date.
│  migrations:  migrations
│  database:    postgres://****@localhost:55432/qa2_s5

✔ Already up to date

App space
├─ (no operations)
└─ marker bc4424a6f9ff59e7e105ddc2f34f88ce0b5dd5425a3cfdb6fa61f1ae31f55a1c

✔ Advanced ref "db" → bc4424a6f9ff59e7e105ddc2f34f88ce0b5dd5425a3cfdb6fa61f1ae31f55a1c
→ Check every space against the database: prisma migration status
exit 0
```

`_prisma` and all four tables are owned by `qa_migrator`. `signatures` has `_prisma` and `app | bc4424a6…`; ledger row 1 and the contract row are unchanged; the `_prisma` ledger row was added.

The message is now specific, readable, and no longer shows the operation id. Last run's defect 5 is fixed.

Extra checks:

- **`qa2_s5t`: the role owns the schema but not its tables.** Stops before changing anything:

  ```
  ✘ [MIGRATION.PRECHECK_FAILED] The records Prisma keeps for itself in this database could not be brought up to date
    why: The role that runs this command must have the privileges of the role that owns table "prisma_contract"."marker", because this migration drops it once its rows are moved into "_prisma"."signatures" and "_prisma"."config", and dropping a table needs those privileges. Give the schema and its tables to the migrating role with ALTER SCHEMA "prisma_contract" OWNER TO <migrating role>, then ALTER TABLE "prisma_contract"."marker" OWNER TO <migrating role>, ALTER TABLE "prisma_contract"."ledger" OWNER TO <migrating role>, ALTER TABLE "prisma_contract"."contract" OWNER TO <migrating role>.
  → Follow the upgrade instructions: https://github.com/prisma/orm/tree/main/skills/prisma-8/upgrading/app
    docs: https://docs.prisma.io/docs/orm/v8/reference/error-reference#MIGRATION.PRECHECK_FAILED
  exit 2
  ```

  Schema still `prisma_contract`, rows identical.

- **`qa2_s5c`: the role owns the schema and tables but has no CREATE on the database** (`REVOKE CREATE ON DATABASE qa2_s5c FROM PUBLIC`):

  ```
  ✘ [MIGRATION.PRECHECK_FAILED] The records Prisma keeps for itself in this database could not be brought up to date
    why: The role that runs this command must have the CREATE privilege on the database, because renaming schema "prisma_contract" needs it. Grant it with GRANT CREATE ON DATABASE <database> TO <migrating role>, or run the command once as a role that has it.
  → Follow the upgrade instructions: https://github.com/prisma/orm/tree/main/skills/prisma-8/upgrading/app
    docs: https://docs.prisma.io/docs/orm/v8/reference/error-reference#MIGRATION.PRECHECK_FAILED
  exit 2
  ```

  After `GRANT CREATE ON DATABASE qa2_s5c TO qa_migrator`, the next run succeeded and `_prisma` is owned by `qa_migrator`.

Stumble: "or run the command once as a role that has it" leaves out that such a role must also own the schema and its tables. Minor.

## Scenario 6: both schemas — Fail (second half): an empty `_prisma` is dropped, not refused

First half, `qa2_s2b` (upgraded in scenario 2) plus `CREATE SCHEMA prisma_contract`:

```
$ prisma db migrate    [new]
│  migrations:  migrations
│  database:    postgres://****@localhost:55432/qa2_s2b

✔ Already up to date

App space
├─ (no operations)
└─ marker 174956a177dcd26588661edf2462d9ab99747ce74f3f5788792528acb3c86104

✔ Advanced ref "db" → 174956a177dcd26588661edf2462d9ab99747ce74f3f5788792528acb3c86104
→ Check every space against the database: prisma migration status
exit 0
```

`db verify`: "✔ Database marker and schema match contract", exit 0. Both schemas remain. Pass.

Second half, `qa2_s6`: RC `db migrate` applied migration 1, then `CREATE SCHEMA _prisma` (empty). New release, contract v2, both migrations. The script expects the command to stop. It did not:

```
$ prisma db migrate    [new]
The records Prisma keeps for itself in this database were brought up to date.
▸ Running migration plan across spaces
✔ Running migration plan across spaces
│  migrations:  migrations
│  database:    postgres://****@localhost:55432/qa2_s6

✔ Applied 1 migration(s) (1 operation(s)) across 1 contract space(s)

App space
├─ Add column "name" to "user"
└─ marker 174956a177dcd26588661edf2462d9ab99747ce74f3f5788792528acb3c86104

✔ Advanced ref "db" → 174956a177dcd26588661edf2462d9ab99747ce74f3f5788792528acb3c86104
→ Check every space against the database: prisma migration status
app	20261127T1039_add_name	bc4424a6…	174956a1…	1
exit 0
```

It dropped the empty `_prisma`, renamed `prisma_contract`, moved the marker and applied migration 2. `prisma_contract` is gone; `_prisma` has the four tables, ledger row 1 and the `bc4424a6` contract row unchanged; `user` has `name`. `db verify` and `migration status` are then clean.

This contradicts the script but matches the upgrade instructions, which now say: "When `_prisma` is empty … the command drops it before the rename, with a plain `DROP SCHEMA "_prisma"`." So the behaviour looks deliberate and the script's expectation is out of date. I report it as a failure against the script; someone should decide which one is wrong.

Extra checks of the cases where it should stop:

- **`qa2_s6n`: `_prisma` holds a table `foo`.** Stops, nothing changed (rows identical, `foo` still in `_prisma`):

  ```
  ✘ [MIGRATION.PRECHECK_FAILED] The records Prisma keeps for itself in this database could not be brought up to date
    why: Schema "_prisma" must be empty while schema "prisma_contract" exists. This release keeps Prisma's own tables in "_prisma", and "prisma_contract" holds the tables a release candidate of Prisma 8 created, so Prisma drops an empty "_prisma" and renames "prisma_contract" to it, and does not choose between them when "_prisma" holds anything. Follow the upgrade instructions before dropping either schema.
  → Follow the upgrade instructions: https://github.com/prisma/orm/tree/main/skills/prisma-8/upgrading/app
    docs: https://docs.prisma.io/docs/orm/v8/reference/error-reference#MIGRATION.PRECHECK_FAILED
  exit 2
  ```

  In this state `db verify` still advises `prisma db migrate` (and `db update`, `db sign`), which refuse. Carried over from the last run; the instructions cover what to do.

- **`qa2_s6r`: an empty `_prisma` owned by `qa_admin`, migrating as `qa_migrator`.** Stops:

  ```
  ✘ [MIGRATION.PRECHECK_FAILED] The records Prisma keeps for itself in this database could not be brought up to date
    why: The role that runs this command must have the privileges of the role that owns schema "_prisma", because Prisma drops the empty "_prisma" before it renames schema "prisma_contract" to "_prisma", and dropping a schema needs them. Give the empty schema to the migrating role with ALTER SCHEMA "_prisma" OWNER TO <migrating role>, or drop it with DROP SCHEMA "_prisma".
  → Follow the upgrade instructions: https://github.com/prisma/orm/tree/main/skills/prisma-8/upgrading/app
    docs: https://docs.prisma.io/docs/orm/v8/reference/error-reference#MIGRATION.PRECHECK_FAILED
  exit 2
  ```

  Both schemas remain.

- `qa2_s6o`: the same empty `_prisma` owned by `qa_admin`, but migrating as the superuser `postgres`: dropped and renamed, exit 0.

## Scenario 7: a command the change policy refuses — Pass

`qa2_s7`: RC `db migrate` applied migration 1. I wrote `"policies": { "change": ["migrate"] }` into `rc/migrations/app/refs/db.json` and ran:

```
$ prisma db migrate --to db --permit-policy-change    [rc]
▸ Running migration plan across spaces
✔ Running migration plan across spaces
│  migrations:  migrations
│  database:    postgres://****@localhost:55432/qa2_s7
│  to:          db

✔ Policies updated: change: migrate

App space
├─ (no operations)
└─ marker bc4424a6f9ff59e7e105ddc2f34f88ce0b5dd5425a3cfdb6fa61f1ae31f55a1c

✔ Advanced ref "db" → bc4424a6f9ff59e7e105ddc2f34f88ce0b5dd5425a3cfdb6fa61f1ae31f55a1c
→ Check every space against the database: prisma migration status
exit 0
```

`prisma_contract.marker.meta` for `app`: `{"policies": {"change": ["migrate"], "dataProtection": {"dataLoss": "data-loss-with-consent", "accessWidening": "access-widening-with-consent"}}}`.

New release, contract v2, both migrations:

```
$ prisma db update    [new]
The records Prisma keeps for itself in this database were brought up to date.
✘ [MIGRATION.CHANGE_POLICY_FORBIDS] This database's change policy permits only migrations
  why: The marker records change: migrate, so db update may not move it.
→ Migrations on disk already lead from the database to `174956a177dcd26588661edf2462d9ab99747ce74f3f5788792528acb3c86104`, so a migration planned now would be a second path between the same two contracts, and `db migrate` applies only one of them. Apply them with `prisma db migrate --to 174956a177dcd26588661edf2462d9ab99747ce74f3f5788792528acb3c86104`, which names the migration.ts to change if one of them fails.
  docs: https://docs.prisma.io/docs/orm/v8/reference/error-reference/MIGRATION.CHANGE_POLICY_FORBIDS
exit 2
```

SQL checks: schema `_prisma`; `config` holds `t | {"change": ["migrate"], "dataProtection": {"dataLoss": "data-loss-with-consent", "accessWidening": "access-widening-with-consent"}}`, exactly the release candidate's `meta -> 'policies'`; `signatures` `app | bc4424a6…`; `user` has no `name`.

The user learns both things: the first line says the records were brought up to date, and the error says `db update` was refused. Stumbles:

- "why: The marker records change: migrate" names the marker, which no longer exists. The policy is now in `_prisma.config`.
- As last run, no output says the schema was renamed.

Then I wrote `new/migrations/app/refs/db.json` with hash `bc4424a6…` and `"policies": { "change": ["migrate", "reconcile"] }`:

```
$ prisma db migrate --to db --permit-policy-change    [new]
▸ Running migration plan across spaces
✔ Running migration plan across spaces
│  migrations:  migrations
│  database:    postgres://****@localhost:55432/qa2_s7
│  to:          db

✔ Policies updated: change: migrate, reconcile

App space
├─ (no operations)
└─ marker bc4424a6f9ff59e7e105ddc2f34f88ce0b5dd5425a3cfdb6fa61f1ae31f55a1c

✔ Advanced ref "db" → bc4424a6f9ff59e7e105ddc2f34f88ce0b5dd5425a3cfdb6fa61f1ae31f55a1c
→ Check every space against the database: prisma migration status
exit 0
```

`config.policies` became `{"change": ["migrate", "reconcile"], "dataProtection": {…with-consent…}}`. `signatures` (space, core hash, `signed_at`) identical before and after: no row moved. Then `prisma db update` applied `Add column "name" to "user"`, exit 0 (with the same `__unbound__` warning as in scenario 3), and `signatures app` moved to `174956a1…`.

## Scenario 8: the release candidate's tool against an upgraded database — Pass; the instructions describe it truthfully

`qa2_s2` (upgraded to v2 in scenario 2), RC project, contract v2, both migrations.

```
$ prisma db verify    [rc]
▸ Connecting to database...
✔ Connecting to database...
▸ Verifying database marker...
✘ Verifying database marker...
│  contract:  src/prisma/contract.json
│  mode:      full (marker + schema, tolerant)
│  database:  postgres://****@localhost:55432/qa2_s2

✘ Marker missing

✘ [CONTRACT.MARKER_MISSING] Database not signed
  why: No database signature (marker) found
→ Sign the database: prisma db sign --db <url>
  docs: https://docs.prisma.io/docs/orm/v8/reference/error-reference/CONTRACT.MARKER_MISSING
exit 4
```

No schema created.

```
$ prisma db migrate    [rc]
▸ Running migration plan across spaces
✔ Running migration plan across spaces
│  migrations:  migrations
│  database:    postgres://****@localhost:55432/qa2_s2

✔ Applied 2 migration(s) (1 of 3 operation(s); the other 2 had nothing to do, since their postchecks already held) across 1 contract space(s)

App space
├─ Create schema "public"
├─ Create table "user"
├─ Add column "name" to "user"
└─ marker 174956a177dcd26588661edf2462d9ab99747ce74f3f5788792528acb3c86104

✔ Advanced ref "db" → 174956a177dcd26588661edf2462d9ab99747ce74f3f5788792528acb3c86104
→ Check every space against the database: prisma migration status
exit 0
```

It created a new `prisma_contract` with `marker`, `ledger`, `contract`: marker `app → 174956a1…`, ledger `20261127T1038_initial (empty → bc4424a6)` and `20261127T1039_add_name (bc4424a6 → 174956a1)`. `_prisma` was untouched (`dumpall` identical). Afterwards the new release's `db verify` ("✔ Database marker and schema match contract"), `migration status` ("✔ Up to date") and `db migrate` ("✔ Already up to date") were all clean and said nothing about `prisma_contract`.

The RC application on an upgraded database (`qa2_s4`): `main.ts` printed `users: 7` silently; `main-log.ts` logged `CONTRACT.MARKER_MISSING`, `message: 'Contract marker not found in database'`, then `users: 8`. No schema was created.

Compared with the instructions: every point is now stated. They say the RC's commands create a new `prisma_contract`, conclude no migration was applied and apply every migration again, with data migrations and raw SQL running twice; that RC `db verify` reports the database not signed and suggests `prisma db sign`; and that the RC application keeps running and warns only with `log`. All four match what I saw. Last run's defects 1 and 4 are fixed in the text.

## Scenario 9: the upgrade instructions — Pass

Followed `upgrade-instructions/pending/prisma-tables-in-prisma-schema/app/instructions.md` on `wip/qa/rc`.

1. Detection for `prisma-tables-move-to-prisma-schema`: `"@prisma/orm-postgres"\s*:` matches `rc/package.json` (`"@prisma/orm-postgres": "8.0.0-rc.25",`). Applies.
2. "Run the command the project already uses … once with the new release": done for `db migrate` (scenario 2), `db update` (`qa2_s3u`) and `db sign` (`qa2_s3s`). All work.
3. "The command renames the schema first, before its own checks": confirmed in scenario 7. "The command reads the policies it checks from `_prisma.config`": consistent with scenario 7.
4. Read-only commands stop with `CONTRACT.PRISMA_SPACE_BEHIND` and give the three commands: confirmed (scenario 3). The client's check does not stop and warns only with `log`: confirmed (scenario 4).
5. Owner queries and the four `ALTER … OWNER TO` statements: work (scenario 5). The CREATE grant statement: works (`qa2_s5c`).
6. View on `marker`: the text says the command "names those objects". The human output does not (scenario 10).
7. Both schemas: the `pg_depend` query on `qa2_s6n` listed `table _prisma.foo`; the table listing showed `_prisma.foo` and the three `prisma_contract` tables. Following "move each object to another schema": `ALTER TABLE _prisma.foo SET SCHEMA public`, then `db migrate` dropped the empty `_prisma` and renamed (exit 0), as the text says. The `prisma_contract` `pg_depend` query lists the three tables and `sequence prisma_contract.ledger_id_seq`, as the text says.
8. Pre-release-candidate (`0.x`) tables: not run (needs a second install).
9. After an RC tool ran (`qa2_s2`): `SELECT count(*) FROM pg_namespace WHERE nspname = 'prisma_contract'` returned 1. The listing returned `initial → bc4424a6…` and `add_name → 174956a1…`. Compared by space and `destination_core_hash`, both are also in `_prisma.ledger`, so both read as "ran again". That is right: the RC replayed both. Last run's false alarm from comparing by name is gone.
10. `name-the-prisma-schema`: searching `wip/qa/rc` for `prisma_contract` outside `node_modules` finds nothing (18 files inside `node_modules`, the RC's own packages).
11. Grants (`qa2_s9`): a role with `USAGE ON SCHEMA prisma_contract` and `SELECT ON prisma_contract.marker`. After the upgrade it had `USAGE` on `_prisma` (the schema grant carried over) and no `SELECT` on `_prisma.signatures`, as the text says. The new app as that role with `log` logged `CONTRACT.MARKER_MISSING`, `'Contract marker not found in database'`, and ran its queries (`users: 1`), exactly as the text says. After `GRANT USAGE ON SCHEMA _prisma` and `GRANT SELECT ON _prisma.signatures`: no warning, `users: 2`.
12. Prisma Studio: the registry has `@prisma/studio-core` `0.36.0` published `2026-11-27T18:20:56Z`, matching the text's version and date. I did not check its contents.

Nothing in the text was wrong or failed when followed, apart from item 6.

## Scenario 10: an object that depends on the old marker — Fail: the message does not name the view

`qa2_s10`: RC `db migrate` applied migration 1, then `CREATE VIEW public.marker_view AS SELECT space, core_hash FROM prisma_contract.marker`. New release, contract v2, both migrations:

```
$ prisma db migrate    [new]
✘ [MIGRATION.PRECHECK_FAILED] The records Prisma keeps for itself in this database could not be brought up to date
  why: No object outside table "prisma_contract"."marker" may depend on it, because this migration drops it once its rows are moved into "_prisma"."signatures" and "_prisma"."config", and PostgreSQL does not drop a table another object depends on. Drop each such object, such as a view over the table, then create them again over "_prisma"."signatures" once the command has run.
→ Follow the upgrade instructions: https://github.com/prisma/orm/tree/main/skills/prisma-8/upgrading/app
  docs: https://docs.prisma.io/docs/orm/v8/reference/error-reference#MIGRATION.PRECHECK_FAILED
exit 2
```

It stopped before changing anything: schema `prisma_contract`, three tables, rows identical, `user` has no `name`. After `DROP VIEW public.marker_view`, the next `db migrate` succeeded ("…were brought up to date.", "✔ Applied 1 migration(s) (1 operation(s))", exit 0), and `_prisma` has its four tables.

The failing check: **the human output does not name the view.** The user has to find `marker_view` themselves. The `--json` envelope does name it, in `meta.blockingObjects: [{"kind":"view","name":"marker_view"}]`, but without its schema (`public`). The upgrade instructions say the command "names those objects", which holds only for the JSON.

## Defects and confusing messages, most serious first

1. **Scenario 10: a view on `prisma_contract.marker` blocks the upgrade and the human message does not name it.** Reproduce: on an RC database, `CREATE VIEW public.marker_view AS SELECT space FROM prisma_contract.marker`, then the new `prisma db migrate`. The `why` says "Drop each such object, such as a view over the table" but lists none. Only `--json` has `blockingObjects`, and there without the schema.
2. **Scenario 6: the script and the behaviour disagree on an empty `_prisma`.** The script says the command stops; the command drops the empty schema and renames, which is what the upgrade instructions describe. One of the two needs changing.
3. **`MIGRATION.CHANGE_POLICY_FORBIDS` still says "The marker records change: migrate".** The marker table is gone; the policy is in `_prisma.config`. Reproduce: scenario 7.
4. **`db update` prints `⚠ control policy suppressed: namespace "__unbound__" — namespace '__unbound__' has effective control 'external' but declared 'external'`.** An internal name, and it says a value differs from itself. Reproduce: `qa2_s3u` or scenario 7. Probably not from this change.
5. **No output says that the schema was renamed** to `_prisma` or that `marker` was replaced. The only line is "The records Prisma keeps for itself in this database were brought up to date." Carried over from the last run.
6. Minor: CLI output still says "marker" for the signature (`└─ marker <hash>`, "Verifying database marker...", "Database marker and schema match contract") though the table is now `signatures`.
7. Minor: the CREATE-privilege message's "or run the command once as a role that has it" leaves out that the role must also own the schema and tables.
8. Minor, carried: on a brand-new database `db init` says the records "were brought up to date" when they were created. Precheck errors link to the folder of all upgrade guides, and use `error-reference#CODE` where other errors use `error-reference/CODE`.

Fixed since the last run: the read-only error now names `db update` and `db sign`, and both work; a `db update` project no longer hits `MIGRATION.MARKER_MISMATCH` after following the advice; each precheck now says which condition failed, without the operation id, and gives the exact SQL; the instructions now describe the release candidate's replay of every migration and the client's silence without `log`; the ledger comparison no longer gives a false alarm on databases that began with `db init`; the client and the CLI now word the warning the same way.

## What I could not run

- The integration tests' database server, for the reason given in Setup. A real PostgreSQL 17.11 was used throughout.
- `examples/prisma-8-demo`: it needs the `vector` extension, which this PostgreSQL lacks. The scratch app makes the same client calls.
- Tables from a `0.x` release: needs a second install.
- A command cancelled at a prompt (the instructions say it has still renamed the schema): the CLI ran without a terminal, so no prompt appeared.
- Whether Prisma Studio 0.36.0 actually reads `_prisma`.
