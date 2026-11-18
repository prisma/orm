# Manual QA: slice 8, migrations after the handover

Run against branch `tml-3457-migrations-after-handover` after `pnpm build`. Use the real CLI the way a user would: the workspace `prisma` bin for Prisma 8 and the `prisma7` bin (Prisma 7.10.0) that `examples/prisma7-adoption` depends on. Put scratch projects under `wip/qa-b/`, with `node_modules` linked to the example's. Use an in-process Postgres from `@prisma/dev` (`tsx scripts/db-start.ts`, as the example does); never a user database. Record each step's command, trimmed output and verdict in `manual-qa-reports/<YYYY-MM-DD>-pr-b.md`. If a step fails, record the evidence and keep going.

## 1. A Prisma 7 project after the handover

Copy the example's `prisma/`, `scripts/`, `src/`, `prisma.config.ts`, `prisma7.config.ts` and `package.json` to `wip/qa-b/p7/`. Start the database with `tsx scripts/db-start.ts`, which writes `.env`.

Hand the project over:

- `prisma7 migrate deploy --config prisma7.config.ts` applies both Prisma 7 migrations.
- `prisma7 generate --config prisma7.config.ts`, then `tsx scripts/seed.ts` writes rows.
- `prisma contract emit`, `prisma db sign`, then `prisma db verify --strict` report no findings.

### 1a. A changed `onDelete`

- Edit `prisma/schema.prisma`: `Post.author` gets `onDelete: Cascade`.
- `prisma contract emit`, then `prisma migration plan --name author-cascade`. Read the SQL: the change package drops `Post_authorId_fkey` and adds it back with `ON DELETE CASCADE`. The plan asks no question and needs no flag.
- `prisma db migrate --advance-ref db`, then `prisma db verify --strict`: no findings, nothing unclaimed.
- In the database, `pg_constraint.confdeltype` for `Post_authorId_fkey` is `c` (it was `r`).
- `prisma migration plan --name again` plans nothing.

### 1b. A primary key moved while another table's foreign key references it

- Edit `User`: `id Int @default(autoincrement()) @unique` and `@@id([id, email])`. `Post.authorId` still references `User.id`.
- `prisma contract emit`, `prisma migration plan --name user-composite-key`. Read the SQL order: drop `Post_authorId_fkey`, drop `User_pkey`, add `User_pkey PRIMARY KEY ("id", "email")`, create `User_id_key`, add `Post_authorId_fkey` back, unchanged (`ON DELETE CASCADE`).
- `prisma db migrate --advance-ref db`, `prisma db verify --strict`: no findings.
- In the database: `User_pkey` covers `(id, email)`; `Post_authorId_fkey` exists; inserting a `Post` with an `authorId` that has no user fails with a foreign key violation.
- `prisma7 migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --config prisma7.config.ts` prints an empty migration.

### 1c. A primary key change blocked by a foreign key on an external table

A Prisma 7 schema cannot mark one table external, so first move the contract source to Prisma 8 PSL, as phase 5 of the example describes:

- `prisma contract print --output prisma/contract.prisma`, point `contract` in `prisma.config.ts` at it, `prisma contract emit`: the storage hash does not change.
- `Post` and `Tag` keep their keys: the implicit many-to-many junction `_PostToTag` must reference their `@id` (`PSL_JUNCTION_TARGET_FK_NOT_ID`). So add a `Profile` model whose relation references `User`'s composite key `(id, email)` from 1b. Plan and apply it, and insert a profile row for each user.
- Mark `Profile` `@@control(external)`. Move `User`'s key back to `id` (`@id`), and keep a unique index on `(id, email)` so the `Profile` foreign key still has a target. `prisma contract emit`.
- `prisma migration plan --name user-key-back` is refused with `foreignKeyConflict`. The message names `User_pkey`, `Profile_userId_userEmail_fkey` and `Profile`, and gives advice for `migration plan` and for `db update`.
- Follow the `db update` advice on a second database built with `prisma db migrate --to db`: `prisma db update` is refused the same way. Drop the foreign key by hand and remove the relation from the contract, emit, run `prisma db update`, then add the foreign key back to the database and the contract. `prisma db verify --strict` has no findings.
- Follow the `migration plan` advice on the first database: `prisma migration new --name user-key-back`, write the drop of the foreign key, the key change and the re-add into `migration.ts`, run it with `node`, then `prisma db migrate --advance-ref db`. `prisma db verify --strict` has no findings and the foreign key is enforced.
- Check the other `migration plan` advice offline: remove `@@control(external)`, emit, and `prisma migration plan --from <hash before the change>` plans the same five operations. Delete that package and put `@@control(external)` back.

## 2. Prisma 7 `migrate` commands

In the same project, type each of `prisma migrate dev`, `prisma migrate deploy`, `prisma migrate status`, `prisma migrate diff`, `prisma migrate reset` and `prisma migrate resolve`, in a terminal and with `--json`.

- Each exits 2 with `CLI.COMMAND_MOVED`, a reason, and one replacement command with the binary name filled in.
- Run each replacement (with placeholders filled in). It exists, and it does what the reason says: after a contract edit, `contract emit` then `migration plan` then `db migrate --advance-ref db` apply it; `db update --dry-run` prints the change and applies nothing; `migration status` lists a pending migration on a database that is behind and `db migrate` applies it; on a new empty database `db migrate` applies every migration; `db sign <migration>` refuses while the database lacks that migration's schema and signs once it has it.

## 3. Strict verify reports the cross-schema foreign key `contract infer` leaves out

On a fresh database, create `secure.owners (id int4 PRIMARY KEY)` and `public.sessions (id int4 PRIMARY KEY, owner_ref int4 REFERENCES secure.owners(id))`. In a Prisma 8 project, `prisma contract infer`, point the config at the inferred PSL, `prisma contract emit`.

- `prisma db verify --schema-only --strict --json` exits non-zero with `ok: false`, `meta.strict: true`, and exactly one issue: path `database / public / sessions / foreign-key:owner_ref->secure.owners(id)`, node kind `sql-foreign-key`, outcome `not-expected` (no `expected`, one `actual`). No warnings.
