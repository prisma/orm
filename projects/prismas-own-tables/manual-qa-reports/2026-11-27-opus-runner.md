# Manual QA run, 2026-11-27: PostgreSQL's `_prisma` space and the schema rename

Branch `own-tables-contract-space` at `cec8b63184` (code last changed in `321b449d5a`). Script: `projects/prismas-own-tables/manual-qa.md`.

## Setup

- **New release:** the branch's existing build, not rebuilt. The build is current: `packages/9-public/@prisma/orm-toolchain/dist` was written at 21:29:44, after the last edit to the source files of `321b449d5a` (21:29:07), and the built CLI and framework contain that commit's new message text ("brings the records it keeps for itself up to date", "The records Prisma keeps for itself in this database are not up to date"). The merge of main that followed changed no package source. The CLI was run as `./node_modules/.bin/prisma` (the workspace's `@repo/prisma-bin`, which runs the built `@prisma/orm-toolchain`) from a scratch project `wip/qa/new` whose `node_modules` is a symlink to `examples/prisma-8-demo/node_modules`. Its config is the demo's form: `definePrismaConfig` from `@prisma/cli-engine` around `defineConfig` from `@prisma/orm-postgres/config`.
- **Release candidate:** the newest published versions, `@prisma/orm-postgres@8.0.0-rc.25` (dist-tag `latest`) and the CLI `prisma@8.0.0-rc.36` (dist-tag `latest`, which depends on `@prisma/orm-toolchain@8.0.0-rc.25`). Installed once, in `wip/qa/rc` with its own `package.json`, by `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock pnpm install --ignore-workspace`. The repository's lockfile and `node_modules` were not touched (`git status` clean afterwards). Config: `definePrismaConfig` from `prisma/config`, otherwise identical.
- **Contract source:** one PSL file per step, shared by both releases (`wip/qa/contracts/v1.prisma`: `User { id Int @id, email String, @@map("user") }`; `v2.prisma` adds `name String?`). Both releases emit byte-identical `contract.json` and `contract.d.ts` from it (storage hash `bc4424a6…` for v1, `174956a1…` for v2), so no format difference had to be worked around.
- **Migrations:** planned once with the release candidate (`migration plan --name initial`, then `migration plan --name add-name --from bc4424a6…`): `20261127T1038_initial` and `20261127T1039_add_name`. Both releases used these same files.
- **Database server — deviation from the script.** The script asks for "the one the integration tests use". That is `@prisma/dev` (`test/utils/src/exports/index.ts`, `createDevDatabase`), a PGlite server that accepts one connection and runs every connection as one superuser. It cannot give scenario 5 a second role that does not own a schema, and gives no separate database per scenario on one server. I used a real PostgreSQL 17.11 instead (Homebrew `postgresql@17`), one cluster under `wip/qa/pgdata` on port 55432, trust authentication, started by me (process 86967) and stopped with `pg_ctl stop` at the end. Each scenario got a new database (`CREATE DATABASE qa_sN`).
- Helper functions are in `wip/qa/lib.sh`. `dumprows <db> <schema>` prints every row of `marker`, `ledger` and `contract` as JSON, which I used to compare rows before and after.

## Scenario 1: a new database — Pass

```
$ prisma db init        (new release, empty database qa_s1, contract v1, no migrations)
The records Prisma keeps for itself in this database were brought up to date.
▸ Introspecting database schema … ✔ Applied 1 operation(s) across 1 contract space
App space
├─ Create table "user"
└─ marker bc4424a6f9ff59e7e105ddc2f34f88ce0b5dd5425a3cfdb6fa61f1ae31f55a1c
exit 0
```

SQL checks:

- Schemas: only `_prisma` (owner `postgres`); no `prisma_contract`.
- Tables in `_prisma`: `contract`, `ledger`, `marker`.
- `_prisma.marker`: `_prisma | 5807887e…` and `app | bc4424a6…`.
- `_prisma.ledger`: `1 | _prisma | 20261126T1200_create_prisma_tables | empty → 5807887e…` and `2 | app | '' | '' → bc4424a6…`.
- The output says once that the records were brought up to date and lists only "App space".

Then `db verify` ("✔ Database marker and schema match contract", exit 0), `migration status` ("✔ No migrations found", exit 0) and `migration log` (one row for `app`, exit 0). None shows `_prisma`; `--json` output of all three contains no `_prisma`.

Wording: "were brought up to date" reads oddly on a database that had no such records before; "were created" would be what happened. Minor.

## Scenario 2: a database set up by the release candidate — Pass

As written ("RC `db init`, then apply the first migration with `db migrate`"), on `qa_s2`:

```
$ prisma db init     (RC, contract v1, migration 1 on disk)
✔ Applied 1 operation(s) across 1 contract space   … marker bc4424a6…
$ prisma db migrate  (RC)
✔ Already up to date
```

So the first migration is never applied by `db migrate` here: `db init` already reached its contract, and the RC ledger holds a `db init` row with an empty migration name. Because the script's question is whether the second migration is applied on top of the first, I also ran a variant, `qa_s2b`, where the RC's `db migrate` alone applied migration 1 to an empty database (ledger row `20261127T1038_initial`, `empty → bc4424a6…`).

Rows recorded before the upgrade (`qa_s2`, schema `prisma_contract`): marker `app | bc4424a6… | 3916f444… | meta {}`; ledger `1 | app | '' | '' → bc4424a6…`; contract `bc4424a6…`. Tables `contract`, `ledger`, `marker`, owner `postgres`.

New release, contract v2, both migrations on disk:

```
$ prisma db migrate   (new release; same output on qa_s2 and qa_s2b)
The records Prisma keeps for itself in this database were brought up to date.
✔ Applied 1 migration(s) (1 operation(s)) across 1 contract space(s)
App space
├─ Add column "name" to "user"
└─ marker 174956a177dcd26588661edf2462d9ab99747ce74f3f5788792528acb3c86104
exit 0
```

SQL checks, both databases:

- Schemas: only `_prisma`.
- Every row from before is in `_prisma`, unchanged, except the `app` marker row, which the second migration moved to `174956a1…` (expected).
- New rows: marker `_prisma | 5807887e…`; ledger `_prisma | 20261126T1200_create_prisma_tables | empty → 5807887e…`.
- The ledger then holds `app | 20261127T1039_add_name | bc4424a6… → 174956a1…`, so the second migration was applied from the first, not planned from an empty database. Columns of `user`: `email`, `id`, `name`.

Second `db migrate`: "✔ Already up to date", no "brought up to date" line, and no row changed (`dumprows` identical before and after).

## Scenario 3: commands that only read, before the upgrade — Pass

On `qa_s3` (RC `db migrate` applied migration 1), new release with contract v2 and both migrations. All seven commands (`db verify`, `db verify --schema-only`, `migration status`, `migration log`, `db migrate --show`, `db init --dry-run`, `db update --dry-run`) printed the same error and exited 2:

```
✘ [CONTRACT.PRISMA_SPACE_BEHIND] The records Prisma keeps for itself in this database are not up to date with the installed release of Prisma
  why: They are in the schema `prisma_contract`, where the release candidates of Prisma 8 kept them. This release keeps them in the schema `_prisma`, so it cannot read which contract the database matches until they are brought up to date.
→ Bring the records Prisma keeps for itself up to date: prisma db migrate
  docs: https://docs.prisma.io/docs/orm/v8/reference/error-reference/CONTRACT.PRISMA_SPACE_BEHIND
```

Afterwards the schema was still `prisma_contract` and every row was unchanged. The `--json` envelope carries the same summary, `why`, one next action (`prisma db migrate`) and `meta: { spaceId: "_prisma", schema: "prisma_contract" }`.

As a user: it is clear what happened and which schema is involved. Two stumbles:

- The advice names only `prisma db migrate`, and running it does more than fix Prisma's records: it also applies every pending migration (here, `add_name`). A user who only wanted to check the database does not learn that from the message. The source text in `packages/1-framework/1-core/errors/src/control.ts` has a `fix` sentence that names `db init`, `db update` and `db sign` too, but it appears in neither the human output nor the JSON.
- **A project that uses `db update` and has no migrations, following the advice, gets an error.** Extra check on `qa_s3u` (RC `db init`, no migrations folder), new release, contract v2:

  ```
  $ prisma db migrate
  The records Prisma keeps for itself in this database were brought up to date.
  ✘ [MIGRATION.MARKER_MISMATCH] The database is at a contract that is not in the migration graph
    why: The database's marker names bc4424a6…, which no migration in migrations/app starts or ends at. …
  → Preview the changes: prisma db update --dry-run
  → Reconcile the database: prisma db update
  exit 2
  ```

  The rename did happen, and the second error's advice leads to `db update`. But the user followed the advice exactly and got a failure with exit code 2, about something they did not ask about.

## Scenario 4: the application, before and after — Pass only when the application passes `log`

The application is `wip/qa/new/src/main.ts`: `postgres({ contract })`, `db.connect({ url })`, then `orm.User.create(...)` and `orm.User.select('id','email').all()`. The demo app (`examples/prisma-8-demo`) could not be used: its config composes pgvector, and the Homebrew PostgreSQL has no `vector` extension.

Before `db migrate`, on `qa_s4` (RC database):

- `tsx src/main.ts`, the client with default options: `users: 1`, exit 0, **and no warning at all**. The client's default log is a no-op (`noopLog` in `packages/2-sql-family/5-runtime/src/sql-runtime.ts`), so the warning reaches nobody unless the application passes `log`.
- `tsx src/main-log.ts`, the same app with `log: console`: one warning, then the queries ran:

  ```
  { code: 'CONTRACT.PRISMA_SPACE_BEHIND', scope: 'marker-verification', expected: { storageHash: 'bc4424a6…', profileHash: '3916f444…' }, actual: null,
    message: "Prisma's own tables in this database were written by an earlier release of Prisma, so the contract the database matches cannot be read. Run `prisma db migrate` to bring them up to date." }
  users: 2
  ```

  The schema was still `prisma_contract` afterwards.

After `prisma db migrate` ("…were brought up to date", exit 0, schema now `_prisma`): `main-log.ts` printed `users: 3` and no warning, and `main.ts` printed `users: 4`.

Wording: the client says "Prisma's own tables … were written by an earlier release", while the CLI says "The records Prisma keeps for itself … are not up to date" and names `prisma_contract`. A user who sees both may not connect them. The client's message also does not name either schema.

## Scenario 5: a role that does not own the old schema — Pass, with a wording problem

Roles `qa_admin` and `qa_migrator` (both LOGIN, not superuser). Database `qa_s5` owned by `qa_admin`; `public` owned by `qa_admin`. RC `db init` as `qa_admin` created `prisma_contract` and its three tables, all owned by `qa_admin`. As `postgres` I granted to `qa_migrator`: `ALL ON SCHEMA prisma_contract`, `ALL ON ALL TABLES` and `ALL ON ALL SEQUENCES IN SCHEMA prisma_contract`, `ALL ON SCHEMA public`, `ALL ON ALL TABLES IN SCHEMA public`, and `CREATE ON DATABASE qa_s5`.

New release, as `qa_migrator`, contract v1 with migration 1:

```
$ prisma db migrate
✘ [MIGRATION.PRECHECK_FAILED] The records Prisma keeps for itself in this database could not be brought up to date
  why: Before operation _prisma.rename-release-candidate-schema runs, it checks: ensure the current role may rename schema "prisma_contract": renaming a schema needs the privileges of the role that owns it and the CREATE privilege on the database. Run the command as the role that owns "prisma_contract" (SELECT nspowner::regrole FROM pg_namespace WHERE nspname = 'prisma_contract' names it), or give the schema to the role that runs it with ALTER SCHEMA "prisma_contract" OWNER TO <role>. That check failed on this database. The failed apply changed nothing.
→ Follow the upgrade instructions: https://github.com/prisma/orm/tree/main/skills/prisma-8/upgrading/app
  docs: https://docs.prisma.io/docs/orm/v8/reference/error-reference#MIGRATION.PRECHECK_FAILED
exit 2
```

Nothing changed: the schema was still `prisma_contract`, owned by `qa_admin`, rows identical, no `_prisma`. I followed the advice: the owner query returned `qa_admin`, then I ran `ALTER SCHEMA "prisma_contract" OWNER TO qa_migrator` as `postgres`. The next `db migrate` as `qa_migrator` succeeded ("…were brought up to date", "✔ Already up to date", exit 0). Schema `_prisma` is now owned by `qa_migrator`, every row was kept, and the `_prisma` rows were added.

Extra check, `qa_s5c`: the migrating role already owns `prisma_contract` but has no CREATE on the database (`REVOKE CREATE ON DATABASE qa_s5c FROM PUBLIC`). The command stops with **the same message, word for word**. It still tells the user to run as the owner or to give the schema to the role, though the role already is the owner. It names no command for the missing privilege (`GRANT CREATE ON DATABASE <db> TO <role>`) and does not say which of the two conditions failed.

Wording a user would stumble on:

- "Before operation _prisma.rename-release-candidate-schema runs, it checks: ensure the current role may rename schema…" exposes an internal operation id, and "it checks: ensure …" is not a sentence.
- "That check failed on this database" comes after the advice, so it reads as if a further check failed.
- The link goes to the folder of every upgrade guide, not to the guide for this change.

Observation: after the rename, the three tables in `_prisma` are still owned by `qa_admin`, and only the schema belongs to `qa_migrator`. The grants are enough today. A later Prisma-space migration that alters one of these tables would need table ownership, and neither the message nor the instructions mention that.

## Scenario 6: both schemas — Pass

Upgraded database (`qa_s2b`, after scenario 2) plus `CREATE SCHEMA prisma_contract`. `db migrate`: "✔ Already up to date", exit 0. `db verify`: "✔ Database marker and schema match contract". Both schemas remain.

RC database (`qa_s6`, RC `db migrate` applied migration 1) plus an empty `CREATE SCHEMA _prisma`. New release, contract v2 with both migrations:

```
$ prisma db migrate
✘ [MIGRATION.PRECHECK_FAILED] The records Prisma keeps for itself in this database could not be brought up to date
  why: Before operation _prisma.rename-release-candidate-schema runs, it checks: ensure schemas "prisma_contract" and "_prisma" do not both exist: this release keeps Prisma's own tables in "_prisma", and "prisma_contract" was created by a release candidate of Prisma 8, so Prisma cannot tell which holds the tables to keep. Follow the upgrade instructions before dropping either schema. That check failed on this database. The failed apply changed nothing.
→ Follow the upgrade instructions: https://github.com/prisma/orm/tree/main/skills/prisma-8/upgrading/app
exit 2
```

Nothing changed: `prisma_contract`'s rows were identical, `_prisma` was still empty, and `user` had no `name` column.

Stumbles:

- "Prisma cannot tell which holds the tables to keep" is said of a `_prisma` that holds no tables at all.
- In this state, `db verify` and `migration status` still say "Bring the records … up to date: prisma db migrate", which is the command that just refused. The user goes round in a loop until they reach the instructions.

## Scenario 7: a command the change policy refuses — Pass

`qa_s7`: RC `db migrate` applied migration 1. Then I added `"policies": { "change": ["migrate"] }` to `migrations/app/refs/db.json` and ran RC `prisma db migrate --to db --permit-policy-change` ("✔ Policies updated: change: migrate"). The marker's `meta` was `{"policies": {"change": ["migrate"], "dataProtection": {…with-consent…}}}`.

New release, contract v2 with both migrations:

```
$ prisma db update
The records Prisma keeps for itself in this database were brought up to date.
✘ [MIGRATION.CHANGE_POLICY_FORBIDS] This database's change policy permits only migrations
  why: The marker records change: migrate, so db update may not move it.
→ Migrations on disk already lead from the database to `174956a1…`, so a migration planned now would be a second path between the same two contracts, and `db migrate` applies only one of them. Apply them with `prisma db migrate --to 174956a1…`, which names the migration.ts to change if one of them fails.
exit 2
```

Results:

- The schema is `_prisma`, every row from before is there, and the `app` marker still records the `migrate`-only policy.
- The `_prisma` marker has `meta {}`.
- `user` was not changed.

The user learns both things: the first line says the records were brought up to date, and the error says `db update` was refused. What they do not learn is that the schema was **renamed**. No output in any scenario names the rename or `_prisma`. A user with grants, scripts or monitoring that name `prisma_contract` gets no hint that they have just broken. The same gap applies to scenarios 2, 4 and 5.

## Scenario 8: the release candidate's tool against an upgraded database — Pass; the instructions are true but incomplete

On `qa_s2` (upgraded by the new release to v2), RC project with contract v2 and both migrations:

```
$ prisma db verify   (RC)
✘ Marker missing
✘ [CONTRACT.MARKER_MISSING] Database not signed
  why: No database signature (marker) found
→ Sign the database: prisma db sign --db <url>
exit 4
```

No schema was created by `db verify`.

```
$ prisma db migrate  (RC)
✔ Applied 2 migration(s) (1 of 3 operation(s); the other 2 had nothing to do, since their postchecks already held) across 1 contract space(s)
App space
├─ Create schema "public"
├─ Create table "user"
├─ Add column "name" to "user"
└─ marker 174956a1…
exit 0
```

It **created a new `prisma_contract`** with all three tables. Its ledger has `20261127T1038_initial` (`empty → bc4424a6…`) and `20261127T1039_add_name` (`bc4424a6… → 174956a1…`), and its marker `app` is at `174956a1…`. `_prisma` was untouched (rows identical). Afterwards the new release's `db verify`, `migration status` and `db migrate` were all clean and said nothing about `prisma_contract`.

The release candidate's application (`rc/src/main-log.ts`, `log: console`) against an upgraded database (`qa_s4`) logged `CONTRACT.MARKER_MISSING` "Contract marker not found in database", ran its queries, and created no schema. Without `log` it printed nothing.

Compared with the instructions ("After the database is brought up to date"):

- True: the RC tool "creates a new `prisma_contract` schema beside it and writes its records there", and the new release neither reads nor reports them.
- Missing: **the RC's `db migrate` replays every migration from an empty database.** It thinks the database has no history. Here every operation had a postcheck that already held, so nothing broke. A migration whose operations do not skip themselves (a data transform, raw SQL, a backfill) would run a second time against live data. The instructions do not say this, and it is the part that can do harm.
- Missing: the RC's `db verify` tells the user to run `prisma db sign`, which would also write a marker into a new `prisma_contract`.
- Partly untrue: "It logs a warning and keeps running". It keeps running, but logs only when the application passes `log`. By default it is silent.

## Scenario 9: the upgrade instructions — Pass with defects in the text

I followed `upgrade-instructions/pending/prisma-tables-in-prisma-schema/app/instructions.md` against the RC scratch project `wip/qa/rc` and its databases.

1. Detection for `prisma-tables-move-to-prisma-schema`: `**/package.json` matching `"@prisma/orm-postgres"\s*:` hits `package.json`. It applies.
2. "Run the command the project already uses, usually `prisma db migrate`, once with the new release": done in scenario 2; works. For a project that uses `db update`, the instructions' wording ("the command the project already uses") is right, but the CLI error names only `db migrate` (see scenario 3).
3. "The command renames the schema first, before its own checks. So a command that the database's change policy then refuses … has still renamed the schema": confirmed in scenario 7.
4. "Commands that only read … they stop with `CONTRACT.PRISMA_SPACE_BEHIND`": true for every CLI command in scenario 3. **Not true for "the check the client runs when it is first used"**, which the same sentence includes. The client does not stop. It runs every query, and it warns only if the application passes `log` (scenario 4).
5. Owner query `SELECT nspowner::regrole FROM pg_namespace WHERE nspname = 'prisma_contract'`: works, returned `qa_admin`. Fix 2 (`ALTER SCHEMA … OWNER TO`) works (scenario 5). "The migrating role also needs CREATE on the database. If it does not have it, grant it": correct, but no statement is given, and the CLI message gives none either.
6. Both schemas: "count the rows of `marker` and `ledger` in each". When `_prisma` is an empty schema (the example the instructions themselves give: "someone created a `_prisma` schema by hand"), the count fails with `ERROR: relation "_prisma.marker" does not exist`. An agent can work that out, but the instruction does not cover it.
7. Pre-release-candidate (`0.x`) tables: not run (see below).
8. RC tool used after the upgrade: `SELECT count(*) FROM pg_namespace WHERE nspname = 'prisma_contract'` returned 1 on `qa_s2`. Comparing the ledgers as instructed, I looked for rows of `prisma_contract.ledger` whose `space` and `migration_hash` are not in `_prisma.ledger`. One came back: `app | 20261127T1038_initial`. Read by the instruction ("a migration recorded only in `prisma_contract` was applied by the older tool and is not in the new release's history"), an agent would conclude the RC applied `initial` after the upgrade. In fact the database was first set up by `db init`, whose ledger row has an empty name, and the RC's replay of `initial` did nothing. So the comparison gives a false alarm on any database that started with `db init`. It is harmless, because the instruction says to stop and tell the user, but it is misleading.
9. `name-the-prisma-schema`: the search for `prisma_contract` outside `node_modules` and build output found nothing in the scratch project. Inside `node_modules` it found 18 files of the RC's own packages; `skills/prisma-8/references/upgrade-app.md` step 4 already tells the agent to skip `node_modules`. The SQL and TypeScript examples are correct.
10. Prisma Studio: prisma/studio#1606 exists and was merged on 2026-11-27 08:15 UTC. I did not check whether a Studio release that includes it has been published. Telling the user to "use a Prisma Studio release that includes" it gives no version.

The error messages link to `https://github.com/prisma/orm/tree/main/skills/prisma-8/upgrading/app`, which returns 200 but is the folder of all guides. This guide reaches it only when a release is prepared. That is expected under `upgrade-instructions/README.md`, but until then the link does not lead to this text.

## Defects, most serious first

1. **The upgrade instructions do not say that a release candidate's `db migrate` against an upgraded database replays every migration from the start.** Reproduce: scenario 8. Bring a database up to date with the new release, then run the RC's `prisma db migrate` with the project's migrations. It reports "Applied 2 migration(s)" and runs each operation whose postcheck does not already hold. Any operation without such a check (data transforms, raw SQL) runs a second time on live data. The instructions describe only the new `prisma_contract` schema.
2. **A project that uses `db update` gets an error when it follows `CONTRACT.PRISMA_SPACE_BEHIND`'s advice.** Reproduce: a database set up by the RC's `db init`, no `migrations/` folder, new release. `prisma db verify` advises `prisma db migrate`. Running that renames the schema, then fails with `MIGRATION.MARKER_MISMATCH`, exit 2. The message's `fix` text that names `db update`, `db init` and `db sign` is not shown in the human output or the JSON.
3. **No output says that the schema was renamed.** Reproduce: scenario 2 or 7. The only line is "The records Prisma keeps for itself in this database were brought up to date." It names neither `prisma_contract` nor `_prisma`, so a user whose grants or scripts name `prisma_contract` gets no warning from the tool.
4. **The client's warning is silent by default, and the instructions say otherwise.** Reproduce: scenario 4. `postgres({ contract })` without `log`, against an RC database: no output, and queries run. The instructions say the client's first-use check "stop[s] with `CONTRACT.PRISMA_SPACE_BEHIND`" (it does not stop), and that an RC application on an upgraded database "logs a warning" (only with `log`). The script's expectation of "one warning" holds only with `log: console`.
5. **The precheck message for a role that may not rename the schema is the same whichever condition failed, and is hard to read.** Reproduce: scenario 5 and its extra check `qa_s5c`, where the role owns the schema but lacks CREATE on the database. The text still says to give the role the schema. It never gives `GRANT CREATE ON DATABASE`, exposes the operation id `_prisma.rename-release-candidate-schema`, and starts with "it checks: ensure …".
6. **The both-schemas guidance does not cover an empty `_prisma`.** Reproduce: scenario 6, second half. The message says Prisma "cannot tell which holds the tables to keep" though `_prisma` has no tables. The instructions' row count then fails with `relation "_prisma.marker" does not exist`. Read-only commands keep advising `prisma db migrate`, which keeps refusing.
7. **The ledger comparison in the instructions flags migrations on databases that began with `db init`.** Reproduce: scenario 9, step 8.
8. **The client and the CLI describe the same state in different words.** The client says "Prisma's own tables … were written by an earlier release"; the CLI says "The records Prisma keeps for itself … are not up to date" and names `prisma_contract`. Reproduce: scenario 4 with `log: console`, next to scenario 3.
9. Minor: on a brand-new database `db init` says the records "were brought up to date" when they were created (scenario 1). Error links use two URL forms: `error-reference/CODE` for most codes and `error-reference#MIGRATION.PRECHECK_FAILED` for the precheck. Both resolve.

## What I could not run, and what I did instead

- **The integration tests' database server.** `@prisma/dev` (PGlite) cannot give a second, non-owner role or separate databases. I used a real PostgreSQL 17.11 for every scenario.
- **The example application `examples/prisma-8-demo`.** It needs the `vector` extension, which this PostgreSQL does not have. I used a small app in the scratch project with the same client calls (`postgres`, `connect`, `orm.User.create`, `select().all()`).
- **Scenario 2 as written** never applies migration 1 with `db migrate`, because the RC's `db init` already reaches its contract. I ran it as written and also as a variant where the RC's `db migrate` applies migration 1. Both pass.
- **Scenario 5** needed `db migrate` to have something to succeed at without changing app tables the migrating role does not own. I used contract v1 with migration 1, so the success run renames only Prisma's schema.
- **Fix 1 of scenario 5** (run once as the owner) was not tried; fix 2 was.
- **Tables from a `0.x` release** (the instructions' third stop condition) were not tried: it would need a second install, and the brief allowed one.
- **Whether a Prisma Studio release includes prisma/studio#1606** was not checked.
