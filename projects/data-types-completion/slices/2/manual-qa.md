# Slice 2 manual QA: upgrading projects from 8.0.0-rc.14

Run on 2026-10-02 against branch `tml-3388-data-type-in-contract` at `c9e856a35a`. The tip moved to `eb98d8433e` during the run; that commit changes one line of `slices/2/plan.md` and no code, so the results hold for it.

## Result

| Project | 1. rc.14 project, migration applied, row inserted | 2. Upgrade to slice 2 | 3. Refusal before sign, then sign, verify, migrate, status, read | 4. Add a nullable column |
| --- | --- | --- | --- | --- |
| pgvector (PSL) | pass | pass | pass, except the runtime logs nothing (finding 1) | pass |
| PostGIS (TypeScript contract) | pass | pass | pass, except the runtime logs nothing (finding 1) | pass |
| SQLite (PSL) | pass, after removing two schema features rc.14 cannot apply | pass | pass | pass |

No step failed because of slice 2 code. Slice 2 also fixes two rc.14 SQLite defects (findings F and G). The defects found in slice 2's deliverables are in the upgrade instruction text (findings 1 to 4).

## How the projects were made and upgraded

The rc.14 projects follow the rc.14 README: `pnpm dlx prisma@8.0.0-rc.19 orm init --target postgres --authoring psl --yes` in a folder holding only a `package.json`, then `pnpm add @prisma/orm-extension-pgvector@8.0.0-rc.14` (or `-postgis`). `prisma@8.0.0-rc.19` is the CLI's `latest` tag and `8.0.0-rc.14` is the ORM packages' `latest` tag. `orm init` has no SQLite target, so the SQLite project installs `@prisma/orm-sqlite@8.0.0-rc.14`, `prisma@8.0.0-rc.19` and `@prisma/cli-engine@0.6.2` by hand and copies the config and client from the rc.14 `examples/prisma-8-demo-sqlite`. Every project needs the pnpm override `"@prisma/orm-toolchain": 8.0.0-rc.14` (finding A).

Databases: `pgvector/pgvector:pg17` on port 54393 (54391 was taken) and `imresamu/postgis:17-3.5` on port 54392, because `postgis/postgis:17-3.5` has no arm64 image; the PostGIS README names `imresamu/postgis` for Apple Silicon. SQLite uses a file.

Slice 2 packages: every workspace package named `@internal/*` or `@prisma/orm-*` (84) packed with `pnpm pack`, as `test/integration/test/cli-journeys/init-journey/harness.ts` does, from a copy of `packages/` so no tracked file changed. Each project then names its facade and extensions as `file:` tarballs and overrides all 84 packages to their tarballs. The extensions' peer `@prisma/orm-target-postgres` is added as a direct `file:` dependency; without it pnpm took the peer from the registry (rc.14).

Each project is its own git repository, committed before the script runs, as the instructions ask. Logs are under `wip/qa/logs/`.

## pgvector project

```prisma
enum Status {
  @@type("pg/text@1")
  Draft     = "draft"
  Published = "published"
}

model Document {
  id        Int                @id @default(autoincrement())
  title     String
  meta      Json               @default(json`{"tags":["a","b"],"n":1}`)
  status    Status             @default(Draft)
  embedding pgvector.Vector(3)
}
```

**Step 1, pass.** `prisma contract emit`; `prisma migration plan --name init` (app migration plus `migrations/pgvector/20260601T0000_install_vector_extension`); `prisma db migrate` applied 2 migrations across 2 spaces, markers `4ef6bdb…` (app) and `3d2c56a…` (pgvector). The client inserted and read `{"id":1,"title":"first","meta":{"n":1,"tags":["a","b"]},"status":"draft","embedding":[1,2,3]}`. `db verify` passed and `migration status` printed `✓ applied` and `Up to date`.

**Step 2, pass.**

- With the slice 2 packages installed and the old contract, `prisma db verify` refuses: `[CONTRACT.VALIDATION_FAILED] … storage.namespaces.public.entries.table.Document.columns.embedding.nativeType: contracts no longer store a column's database type name; the column names its data type in "dataType"` (five paths, no mention of the script).
- `pnpm exec tsx <guide>/scripts/data-type-in-contract.ts` fails: `Command "tsx" not found` (finding 2). `node <guide>/scripts/data-type-in-contract.ts` exits 0 and prints nothing (finding 3).
- The script rewrote `contract.json` (`"dataType": "pgvector/vector"`, `"pg/int4"`, `"pg/json"`, `"pg/text"`; `types.storage` removed; storage hash `4ef6bdb…` to `d24540f…`), `contract.d.ts`, both `migration.json` files, `migration.ts` (snapshot imports), `migrations/pgvector/refs/head.json`, and renamed both snapshot directories.
- No formatter is configured in an `orm init` project, so that step does not apply. `prisma contract emit` then leaves `contract.json` byte for byte unchanged (storage hash `d24540f…`). `contract.d.ts` changes only its import list, which comes from the pending entry `contract-dts-imports-only-used-types`.
- Detection: `contract-stores-data-type` matches before the script and not after. None of slice 1's app entries apply; `ts-contract-lists-extension-codecs` matches emitted `contract.d.ts` and `migration.ts` (finding 5).
- Running the script a second time changes nothing.

**Step 3, pass except the runtime log.**

```text
$ prisma db migrate
✘ [MIGRATION.MARKER_MISMATCH] Database marker is not reachable in the on-disk migration graph
→ Overwrite the marker if the database already matches the contract: prisma db sign
$ node scripts/read.ts
rows [{"id":1,"title":"first",…}]        (no warning logged; finding 1)
$ prisma migration status
⚠ [MIGRATION.MARKER_NOT_IN_HISTORY] … marker for space "app" … / … space "pgvector" …
$ prisma db sign
✔ app: signed d24540f… (was 4ef6bdb…)
✔ pgvector: signed 4a96b48… (was 3d2c56a…)
✔ Advanced ref "db" → d24540f…
$ prisma db verify
✔ Database marker and schema match contract
$ prisma db migrate
✔ Already up to date across 2 space(s)
$ prisma migration status
✔ Up to date                              (no warning; the init migration is no longer marked applied, as documented)
$ node scripts/read.ts
rows [{"id":1,"title":"first","meta":{"n":1,"tags":["a","b"]},"status":"draft","embedding":[1,2,3]}]
```

A second `db sign` reports both spaces `unchanged`. `db sign --json` has the documented shape `{ ok, summary, spaces, advancedRefs }`.

**Step 4, pass.** Added `note String?`. `migration plan --name add_note` planned `ALTER TABLE "public"."Document" ADD COLUMN "note" text;` from `d24540f…`; `db migrate` applied it; `db verify` passed; `migration status` showed it `✓ applied` and `Up to date`; the client read `"note":null`. A later `migration plan` with no schema change starts from the stale `db` ref and plans the same column again (finding C).

## PostGIS project

The brief asks for `postgis.Geometry(4326)` and a bare `Geometry`. rc.14 PSL refuses the bare form (`Field "Place.shape" type "Geometry" is not supported`, then `Argument "srid" of postgis.Geometry is missing`), so this project uses a TypeScript contract, which also covers slice 2's `column-descriptors-drop-native-type` entry and slice 1's TypeScript entries:

```ts
const pgText = { codecId: 'pg/text@1', nativeType: 'text' } as const;
const pgInt4 = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;
const Kind = enumType('Kind', pgText, member('Park', 'park'), member('Store', 'store'));
// in defineContract({ extensions: { postgis } }, …):
id: field.column(pgInt4).default(autoincrement()).id(),
name: field.column(pgText),
meta: field.json().default({ open: true, floors: [1, 2] }),
kind: field.namedType(Kind).default('park'),
location: field.column(geometry({ srid: 4326 })),
shape: field.column(geometryColumn),
```

**Step 1, pass.** The plan created `"location" geometry(Geometry,4326) NOT NULL` and `"shape" geometry NOT NULL`; `db migrate` applied 2 migrations across 2 spaces (markers `3fd0573…`, `7e98a4d…`); the client inserted and read the row with GeoJSON points; `db verify` and `migration status` passed.

**Step 2, pass.** Detection matched `contract-stores-data-type`, `column-descriptors-drop-native-type` (`contract.ts`) and `ts-contract-lists-extension-codecs`. The script rewrote the files as in the pgvector project (`"postgis/geometry"`, storage hash `3fd0573…` to `3bb608d…`). Emitting before editing `contract.ts` gives the same `contract.json`: the leftover `nativeType` keys are ignored. After deleting `nativeType` from both descriptors, as the instructions say, the emit gives the same `contract.json` again. With TypeScript 5.9.3 added, `tsc --noEmit` over the whole project (contract, client, both `migration.ts` files, snapshot `contract.d.ts` files) passes. Slice 1's `srid: 0` check works: `Field "Place.location" has type parameters that its data type does not accept: postgis/geometry: srid must be at least 1 (was 0)` (finding I).

**Step 3, pass except the runtime log.** Same output as pgvector: `MARKER_MISMATCH` with the `db sign` hint; the runtime reads the row and logs nothing; `db sign` signs `app` (`3bb608d…`) and `postgis` (`2db551a…`); then `db verify` passes, `db migrate` is up to date, `migration status` is `Up to date` with no warning, and the client reads the row.

**Step 4, pass.** Added `note: field.column(pgText).optional()`; planned `ALTER TABLE "public"."Place" ADD COLUMN "note" text;`, applied, verified, status `Up to date`. The client inserted a second row with geometry values and read both rows. The typecheck still passes.

## SQLite project

rc.14 cannot apply a migration for this model with an `autoincrement()` id or a JSON `null` default (findings D and E), and a `BigInt` default of 2^53 or less fails rc.14's own check (finding F). The rc.14 project therefore uses `id Int @id`, leaves the `null` default to step 4, and gives `BigInt` a default above 2^53, inserting an explicit value because rc.14 cannot read that default back (finding G):

```prisma
enum Priority {
  @@type("sqlite/integer@1")
  Low  = 1
  High = 2
}

model Item {
  id       Int      @id
  title    String
  metaObj  Json     @default(json`{"b":2,"a":[1,"x"]}`)
  count    Int      @default(42)
  big      BigInt   @default(9007199254740993)
  priority Priority @default(Low)
  instant  DateTime @default("2024-01-01T01:00:00.500+01:00")
}
```

**Step 1, pass.** rc.14 planned `"big" INTEGER NOT NULL DEFAULT 9007199254740993`, `"count" INTEGER NOT NULL DEFAULT 42`, `"metaObj" TEXT NOT NULL DEFAULT '{"a":[1,"x"],"b":2}'`, `"priority" INTEGER NOT NULL DEFAULT 1`, `"instant" TEXT NOT NULL DEFAULT '2024-01-01T00:00:00.500Z'`. `db migrate` applied it (marker `ca930fa…`); the client inserted and read the row; `db verify` and `migration status` passed.

**Step 2, pass.** Detection matched `contract-stores-data-type` and slice 1's `sqlite-contract-d-ts-char-aggregates`. The script changed the stored forms as designed:

| Column | rc.14 contract | After the script |
| --- | --- | --- |
| `metaObj` default | `{"a":[1,"x"],"b":2}` (JSON value) | `"{\"a\":[1,\"x\"],\"b\":2}"` (JSON text) |
| `count` default | `42` | `"42"` |
| `big` default | `"9007199254740993"` | unchanged |
| `priority` default, enum members, value set | `1`; `1`, `2` | `"1"`; `"1"`, `"2"` |
| `instant` default | `"2024-01-01T00:00:00.5Z"` | unchanged |
| data types | `nativeType` `integer`, `text` | `dataType` `sqlite/integer`, `sqlite/text` |

Storage hash `ca930fa…` became `87d3f7e…`. `prisma contract emit` leaves `contract.json` unchanged; `contract.d.ts` gains the `sql/char@1` and `sql/varchar@1` aggregate rows that slice 1's entry describes, and one default type is wrapped differently, as the instructions warn.

**Step 3, pass.** `db migrate` refused with `MARKER_MISMATCH` and the `db sign` hint; `migration status` warned `MARKER_NOT_IN_HISTORY`; `db sign` signed `87d3f7e…` (was `ca930fa…`); `db verify` against the database rc.14 created passed (`Database marker and schema match contract`), including the bare `DEFAULT 9007199254740993` against the stored text and the JSON text default; `db migrate` was up to date; `migration status` was `Up to date` with no warning; the client read the row (`"priority":1`, `"big":"5n"`).

**Step 4, pass.** Added `extra Json? @default(json`null`)`, which rc.14 could not apply. The contract stores `"null"`; the plan is `ALTER TABLE "Item" ADD COLUMN "extra" TEXT DEFAULT 'null';`; `db migrate` applied it and its check passed; `db verify` passed; `migration status` was `Up to date`; the client inserted a second row and read both with `"extra":null`.

### The rc.14 migration rc.14 could not apply

A second project kept rc.14's contract and planned migration with the `autoincrement()` id, `metaNull Json? @default(json`null`)` and the large `BigInt` default. After the upgrade and the script, `db migrate` on an empty file reports one failure instead of rc.14's two: the JSON `null` default now passes, and only `column:id` default `autoincrement()` fails (finding D). A scratch project on slice 2 applies `BigInt @default(4242)` cleanly (fixed, finding F) and still cannot read back `9007199254740993` (finding G).

## Findings

### In slice 2's deliverables

1. **The runtime does not log `CONTRACT.MARKER_MISMATCH`.** `upgrade-instructions/pending/data-type-in-contract/app/instructions.md` (`sign-databases-after-upgrade`) and design 10.2 say the running application logs it. With `postgres()` from `@prisma/orm-postgres/runtime` nothing is logged: `PostgresExecutionOptions` (`packages/3-extensions/postgres/src/runtime/postgres-options.ts`) has no `log` field, so `SqlRuntimeBase` uses `noopLog` and the warning in `verifyMarker` (`packages/2-sql/5-runtime/src/sql-runtime.ts`) goes nowhere. The silence predates slice 2; the claim is new. Fix the text (for example, `db verify` exits 4 with `CONTRACT.MARKER_MISMATCH`), or give the facade a logger. Not a blocker for the upgrade.
2. **`pnpm exec tsx` fails in a project made by `orm init`**, which installs no `tsx`: `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "tsx" not found`. `node <script>` works on Node 24, the minimum supported version. The instruction should say `node`.
3. **The script prints nothing on success.** A user cannot tell what it changed without `git status`. One summary line (files rewritten, snapshot directories renamed) would help.
4. **The SQLite `BigInt` sentence does not match rc.14.** The instructions say a migration "writes a `BigInt` default as `DEFAULT 42` instead of `DEFAULT '42'`". rc.14 already writes `DEFAULT 42` for PSL `BigInt` defaults, small and large; the quoted form does not appear in rc.14. For users upgrading from rc.14 there is nothing to see.
5. **Slice 1's `ts-contract-lists-extension-codecs` detection matches PSL projects.** Its `codecId: 'pg/vector@1'` pattern matches emitted `contract.d.ts` and `migration.ts`. A reader can see that the entry does not apply, but the pattern should skip emitted files or look only for `defineContract`.

### Found on the way, older than slice 2

- **A. The published CLI cannot emit an rc.14 project.** `prisma@8.0.0-rc.19` (the `latest` tag) depends on `@prisma/orm-toolchain` `8.0.0-rc.13` exactly, and no published `prisma` uses rc.14. `orm init` with rc.14 fails: `CONTRACT.PACK_CONTRIBUTION_INVALID: Malformed authoring pslBlock contribution at "enum"`. The workaround is a pnpm override of `@prisma/orm-toolchain` to `8.0.0-rc.14`. The release that ships slice 2 needs a `prisma` CLI on the same toolchain, or users hit this again.
- **B.** The `prisma-8` skill shipped in `@prisma/orm-postgres` names `@internal/extension-pgvector/control`, `@internal/postgres/config` and similar (10 times in `references/contract.md`) where users must import `@prisma/orm-…`. Still true at HEAD.
- **C. A stale `db` ref after `db sign` and `db migrate`.** `db sign` writes `migrations/app/refs/db.json`; `db migrate` does not move it; the next `migration plan` starts from it, warns `Planning from it forks the migration graph`, writes a migration that repeats the applied change, and exits 0. rc.14's `db sign` also writes this ref by default and its `db migrate` also leaves it, but the upgrade makes every user run `db sign`, so every upgraded project meets this on its second plan. Running `db sign` again, or `migration plan --from`, avoids it.
- **D. SQLite `Int @id @default(autoincrement())` cannot be migrated**, on rc.14 and on slice 2: the check after `db migrate` reports `column:id` default `autoincrement()` missing for `"id" INTEGER PRIMARY KEY AUTOINCREMENT`. Any SQLite model with an autoincrement id is affected.
- **E. Fixed by slice 2:** on rc.14 a SQLite JSON `null` default fails the check after `db migrate` (contract `null`, database `'null'`).
- **F. Fixed by slice 2:** on rc.14 a SQLite `BigInt` default of 2^53 or less fails the same check (contract `'4242'`, database `4242`).
- **G.** The SQLite driver throws `ERR_OUT_OF_RANGE` reading an integer above 2^53, on rc.14 and slice 2, so a `BigInt` default above 2^53 breaks `create` (it reads the row back).
- **H.** rc.14 PSL cannot write a PostGIS geometry without an SRID; only the TypeScript `geometryColumn` can.
- **I.** A TypeScript contract build error reaches the CLI as `CONTRACT.SOURCE_LOAD_FAILED` with the fix line `Ensure contract.source.load resolves to ok(Contract) or returns structured diagnostics`, which means nothing to a user.

### In the QA setup

- The first set of tarballs lacked the `dist/dist-*.mjs` chunk files, because the copy step excluded every name starting with `dist-`. Loading failed with `ERR_MODULE_NOT_FOUND`. The copy was redone excluding only directories, and all 84 packages were packed again before any result above.
- pnpm satisfied the extensions' exact peer `@prisma/orm-target-postgres@8.0.0-rc.14` from the registry instead of the tarball. Adding the target tarball as a direct dependency fixed it. A real release has a new version number, so this does not affect users.

## Rerun on 2026-10-06: list columns

Run against branch `minerva/s2-land` at `1cc96fc345`. Since the first run, the script also writes lists in the new form (`many: { elementNullable: false }`) and keeps the membership check of a Postgres enum list column as the database has it. This run tests that against a real database.

The setup follows "How the projects were made and upgraded" above, with these differences. `prisma@latest` is now `8.0.0-rc.20`, which depends on `@prisma/orm-toolchain` `8.0.0-rc.14`, so the override from finding A matched it and changed nothing. The database is `postgres:17` in Docker on port 54394. Logs are under `wip/qa-lists/logs/` in the slice 2 checkout.

```prisma
enum Role {
  USER
  ADMIN
}

model Item {
  id     Int      @id @default(autoincrement())
  tags   String[]
  scores Int[]
  roles  Role[]
}
```

### Result

| Step | Result |
| --- | --- |
| 1. rc.14 project, migration applied, two rows inserted | pass |
| 2. Upgrade: refusal, script, contracts load, new list form | pass |
| 3. Sign, verify, status, read | pass |
| 4. Emit again, plan, migrate, verify, new check in the database | pass |
| 5. Add `notes String?[]` | pass, after working around the older finding C |
| 6. Emit before `db sign` | the commands refuse; the guide does not lead the user out (finding 6) |

No step failed because of slice 2 code.

**Step 1, pass.** rc.14 stored `"many": true` and planned `"roles" text[] NOT NULL` with `CONSTRAINT "Item_roles_check_e6bad644" CHECK ("roles"::text[] <@ ARRAY['USER', 'ADMIN']::text[])`, plus one `_elem_not_null` check per list. `db migrate` applied it (marker `b180877…`). The client inserted two rows and read `{"id":1,"roles":["USER"],"scores":[1,2,3],"tags":["a","b"]}` and `{"id":2,"roles":["ADMIN","USER"],"scores":[42],"tags":[]}`.

**Step 2, pass.**

- With slice 2 installed, `db verify` refuses the old contract: `CONTRACT.VALIDATION_FAILED … columns.roles.nativeType: contracts no longer store a column's database type name` (four paths, exit 2).
- `node <guide>/scripts/data-type-in-contract.ts` prints `Rewrote 4 files and renamed 1 snapshot directory. Storage hashes changed (old -> new): b180877… -> 6cd359d…`.
- `contract.json` has `"many": { "elementNullable": false }` for `tags`, `scores` and `roles`, in the domain fields and in the storage columns, and no `"many": true`. `contract.d.ts` declares `many: { readonly elementNullable: false }` on the lists and `many: false` on `id`. The renamed snapshot equals `contract.json` apart from `_generated`.
- The enum check keeps rc.14's name and expression.
- `db verify` now reports `CONTRACT.MARKER_MISMATCH` (exit 4). `migration status` loads the migration graph and warns `MIGRATION.MARKER_NOT_IN_HISTORY`.

**Step 3, pass.** `db sign` prints `✔ app: signed 6cd359d… (was b180877…)` and `Advanced ref "db" → 6cd359d…`. `db verify` prints `Database marker and schema match contract`. `migration status` prints `Up to date`. The client reads both rows, and every list comes back as an array.

**Step 4, pass.**

- `contract emit` changes the enum check from `Item_roles_check_e6bad644` with `"roles"::text[] <@ ARRAY['USER', 'ADMIN']::text[]` to `Item_roles_check_dd48eece` with `array_remove("roles"::text[], NULL) <@ ARRAY['USER', 'ADMIN']::text[]`. The storage hash becomes `1735cee…`. The three `_elem_not_null` checks do not change. The emit also adds a domain `valueSet` (enum `Role`) to the `roles` field, which the script does not write; that changes no hash.
- `migration plan` plans from `6cd359d…`: `⚠ Drop check constraint "Item_roles_check_e6bad644"`, `Add check constraint "Item_roles_check_dd48eece"`, then `This migration contains destructive operations that may cause data loss.`
- `db migrate` applies it and `db verify` passes. `pg_constraint` holds `Item_roles_check_dd48eece | CHECK ((array_remove(roles, NULL::text) <@ ARRAY['USER'::text, 'ADMIN'::text]))` and no `Item_roles_check_e6bad644`. Inserting `roles = '{BOGUS}'` fails on the new check.

**Step 5, pass.** The contract stores `"many": { "elementNullable": true }` for `notes` and adds no element check. The first `migration plan` starts from the `db` ref, which `db migrate` left at `6cd359d…`: `⚠ The default origin ref 'db' points at 6cd359d…, which already has a migration leading to 1735cee…. Planning from it forks the migration graph` (finding C). With `--from 1735cee…` it plans the new column, a backfill placeholder (the table has rows) and `SET NOT NULL`. After filling the backfill with `notes = '{}'` and running `migration.ts`, `db migrate` applies 3 operations, `db verify` passes and `migration status` prints `Up to date`. The client inserts `notes: ['first', null, 'third']` and reads back `"notes":["first",null,"third"]`; the older rows read `"notes":[]`.

**Step 6, the guide does not lead the user out.** In a second copy of the step 1 project and its own database: the script, then `contract emit` (hash `1735cee…`), then:

```text
$ prisma db sign
✘ app: not signed, the schema does not satisfy its contract
└─ ✘ missing: database/public/Item/check:Item_roles_check_dd48eece
→ Change the database to match the contract, then sign again: prisma db update
→ Or change the contract source to describe the database as it is, re-run contract emit, then sign again
$ prisma db migrate
✘ [MIGRATION.MARKER_MISMATCH] Database marker is not reachable in the on-disk migration graph
→ Overwrite the marker if the database already matches the contract: prisma db sign
```

`db migrate` sends the user to `db sign`, and `db sign` sends them to `db update` or to editing the schema. The guide says only to sign before emitting. Two ways out work:

- `prisma db sign 6cd359d…`, the hash the script printed, signs against the script's snapshot, which keeps the old check. Then `migration plan` writes the drop-and-add migration, `db migrate` applies it and `db verify` passes. This works for every database.
- `prisma db update --confirm <database>`, run on a copy of the database, drops and adds the check and writes marker `1735cee…`. It repairs only that database.

### Findings

#### In slice 2's deliverables

6. **The guide has no way back after emitting before `db sign`.** `upgrade-instructions/pending/data-type-in-contract/app/instructions.md` should add one sentence: if you already emitted, sign each database with the hash the script printed (`prisma db sign <new hash>`), then plan and migrate. Users are likely to hit this, because the step 2 refusal's first next action is `Re-emit the contract: prisma contract emit` (finding K).
7. **The guide does not mention the data-loss warning.** The planned migration shows `⚠ Drop check constraint` and "may cause data loss". The guide could say that the drop loses no data, because the same migration adds the new check.

#### Older than slice 2

- **C, again.** `db migrate` leaves the `db` ref where `db sign` put it, so the first plan after the check migration forks the graph. Every upgraded project with an enum list meets this.
- **J.** Dropping a check constraint is classified `destructive` (since `60b2ed9e6c`, June 2026), so swapping a check prints the data-loss warning.
- **K.** `CONTRACT.VALIDATION_FAILED` offers `prisma contract emit` as its first next action, as in rc.14. For a contract in the old format, the right action is the upgrade script.
- **L.** `migration status --json` puts an unexpanded placeholder in its hints: `Run '{bin} db sign' to overwrite the marker…`. rc.14 has the same text.
