# Manual QA report — slice 3, `prisma contract convert`

Date: 2026-09-15. Runner: developer persona acting as an end user. Script: `projects/prisma7-contract-source/manual-qa-slice-03.md`. Scratch app: `wip/qa-convert/` (gitignored), set up like the slice 1 run: PGlite dev server from `@prisma/dev` started by `devdb.ts`, SQL applied with a `pg` script (`apply-sql.ts`), Prisma 7 SQL generated with `pnpm dlx prisma@7.10.0` from `wip/qa-convert/p7/` (a copy of the schema and a Prisma 7 `prisma.config.ts` with a placeholder URL), workspace packages made resolvable by symlinking `node_modules/@prisma/{orm-postgres,cli-engine,dev}`, `node_modules/pg` and `node_modules/dotenv`; no `pnpm install`. A `package.json` names `@prisma/orm-postgres` and `@prisma/cli-engine`. CLI: `node packages/1-framework/3-tooling/cli/dist/bin.mjs` (`$CLI` below). Output is JSON when stdout is not a terminal; runs marked `--format human` show what a terminal user sees. Logs: `wip/qa-convert/logs/step*-*.log`.

**Result.** Every step reaches the expected exit code and artifacts. `contract convert` writes the documented file, the re-emit from the converted PSL produces a byte-identical `contract.json` and `contract.d.ts`, the marker signed from the Prisma 7 source verifies against it, the refusal and hard-error paths write nothing, and `--json` reports the written path. No blockers. Three should-fix findings are in the human output around the cutover, none in `contract convert` itself: `migration plan --name baseline` says "0 operation(s)" and then lists 13 operations with a full DDL preview and tells the user to apply it (F-1); next-action lines print a literal `{bin}` placeholder instead of the binary name (F-2); the convert hard error tells the user to run `contract emit` again (F-3). The rest are notes: spellings in the converted file the README does not mention, the output location moving when `contract:` switches to a PSL file in another directory, a redundant `migration ref set` step in the guide, and small output inconsistencies.

## Step 1 — Start where slice 1's user ends

Schema `wip/qa-convert/prisma/schema.prisma` as the script specifies (`User`, `Post` with `onDelete: Cascade` and `@@index([authorId])`, `Tag`, `enum Role { USER ADMIN @map("admin") }`, `generator client { provider = "prisma-client" }`, datasource with `provider` only). Config copied from the `prisma7Schema` snippet in `packages/3-extensions/postgres/README.md` with `@prisma/cli-engine` as the README's contributor note says.

```
$ sh p7-diff.sh --from-empty --to-schema schema.prisma -o ../migration-1.sql   # pnpm dlx prisma@7.10.0 migrate diff ... --script; exit 0
$ tsx apply-sql.ts migration-1.sql                                              # applied migration-1.sql
$ node $CLI contract emit    # exit 0
  ... "storageHash":"67027c1b...","files":{"json":".../prisma/contract.json","dts":".../prisma/contract.d.ts"} ... "diagnostics":[]
$ node $CLI db sign          # exit 0  "summary":"Database signed (marker created)" ... "advancedRef":{"name":"db","hash":"67027c1b..."}
$ node $CLI db verify        # exit 0  "summary":"Database marker and schema match contract" ... "warnings":[],"unclaimed":[] ... "diagnostics":[]
$ grep -c '@internal/' prisma/contract.d.ts   # 0
```

`db sign` created `migrations/app/refs/db.json` and `migrations/snapshots/67027c1b.../`. Copy kept as `step1-contract.json` and `step1-copy/`.

Outcome: pass.

## Step 2 — Convert

```
$ node $CLI contract convert --format human   # exit 0
▸ Resolving contract source...
✔ Resolving contract source...
│  source:  prisma/schema.prisma

✔ Contract written to prisma/contract.prisma
```

`prisma/contract.prisma` (52 lines) opens with `// use prisma-8` and `// Converted from prisma/schema.prisma by \`prisma contract convert\`.`. Inside `namespace public`: models `User`, `Post`, `Tag`, `PostToTag` with the Prisma 7 model, field and relation names; `updatedAt temporal.timestamp(3, onCreate: now, onUpdate: now)`; `@@index([email], unique: true, map: "User_email_key")` and `@@index([name], unique: true, map: "Tag_name_key")` in place of `@unique`; `model PostToTag { A Int  B Int  a Post @relation(...)  b Tag @relation(...)  @@id([A, B])  @@index([B], map: "_PostToTag_B_index")  @@map("_PostToTag") }`; `native_enum Role { USER = "USER"  admin = "admin" }`; every relation carries `onUpdate: Cascade, index: false`.

Surprises as a user (none wrong; the hashes match in step 3): see F-5.

Outcome: pass.

## Step 3 — Switch and re-emit

`prisma.config.ts` changed to `contract: 'prisma/contract.prisma'` (the `prisma7Schema` import removed; Prisma 7 config kept aside as `prisma.config.p7.ts`).

```
$ node $CLI contract emit --format human   # exit 0
│  contract:  prisma/contract.json
│  types:     prisma/contract.d.ts
✔ Emitted contract.json and contract.d.ts
storageHash:    67027c1b2babdbebd8843c3bcb7d91be72f40bd1118247872008ae81b2f990c8
executionHash:  0d9fcbcd5529858c5171d48708abcb520d161d3bd7d76429f974d64d6adc54d5
profileHash:    3916f444a8a17ad749191acf9e08dad97d1a327b88c2f1d45d12f240296aa8b2
/Users/.../wip/qa-convert/prisma/contract.json
/Users/.../wip/qa-convert/prisma/contract.d.ts
$ diff step1-contract.json prisma/contract.json            # empty: identical
$ diff step1-copy/contract.d.ts prisma/contract.d.ts       # empty: identical
$ node $CLI db verify --format human   # exit 0
✔ Database marker and schema match contract
storageHash:  67027c1b...  profileHash:  3916f444...
```

The marker written from the Prisma 7 source in step 1 is still the one that verifies (same hashes, `db sign` not re-run yet).

Outcome: pass (F-7 noted on the two trailing paths).

## Step 4 — Finish the guide's phase 4, then phase 5

```
$ node $CLI migration plan --name baseline --format human   # exit 0
│  contract:    prisma/contract.json
│  migrations:  migrations/app
│  name:        baseline

✔ Planned baseline + 0 operation(s)

operations
├─ Create schema "public"
├─ Create enum type "Role"
├─ Create table "Post"
├─ Create table "Tag"
├─ Create table "User"
├─ Create table "_PostToTag"
├─ Create index "Post_authorId_idx" on "Post"
... (13 operations)
└─ Add foreign key "_PostToTag_B_fkey" on "_PostToTag"

from:      67027c1b...
to:        67027c1b...
baseline:  migrations/app/20260915T0546_baseline

ℹ DDL preview
CREATE SCHEMA IF NOT EXISTS "public";
CREATE TYPE "public"."Role" AS ENUM ('USER', 'admin');
CREATE TABLE "public"."Post" ( ... );
...
→ Review migrations/app/20260915T0546_baseline
→ Apply the migration: {bin} db migrate
```

Written: `migrations/app/20260915T0546_baseline/{migration.ts,migration.json,ops.json}`; `migration.json` has `"from": null, "to": "67027c1b..."`. A second run in JSON mode (`--name baseline-json`) returned `"noOp":true,"operations":[],"summary":"No changes detected between contracts"` and wrote nothing.

```
$ node $CLI db sign --format human   # exit 0
✔ Database signed
from:  none
to:    67027c1b...
✔ Advanced ref "db" → 67027c1b... (was 67027c1b...)
$ node $CLI migration ref set db 20260915T0546_baseline --format human   # exit 0
✔ Set ref "db" → 67027c1b...
$ node $CLI migration ref list --format human   # exit 0
Ref  Contract
db   67027c1b...
$ node $CLI migration status --format human   # exit 0
○   67027c1  @contract @db (db)
│↑  20260915T0546_baseline        ∅ → 67027c1  13 ops
○   ∅
✔ Up to date
```

Phase 5: moved `prisma/schema.prisma`, the Prisma 7 config copy and `p7/` out of the app (there was no generated Prisma 7 client to remove).

```
$ node $CLI contract emit --format human   # exit 0, same three hashes
$ node $CLI db verify --format human       # exit 0  ✔ Database marker and schema match contract
$ diff step1-contract.json prisma/contract.json   # empty
```

Also checked, because the plan output told me to: `db migrate --show` reports `Already up to date — nothing to run`; `db migrate` exits 0 with `✔ Already up to date` and `(no operations)`; `db verify` still passes. So following the wrong hint is harmless here.

Outcome: exit codes and artifacts as expected; the plan's human output does not match "proposes zero operations" (F-1, F-2); `db sign` and the ref step noted (F-6, F-9).

## Step 5 — Refusals

Config pointing at `prisma/contract.prisma`; `prisma/contract.prisma` mtime and sha recorded first.

```
$ node $CLI contract convert --format human   # exit 2
✘ [CONTRACT.CONVERT_REQUIRES_PRISMA7_SOURCE] contract convert applies only to a Prisma 7 schema source
  why: The configured contract source has format "psl"; only a source created with prisma7Schema(...) can be converted.
→ Point contract: at prisma7Schema("<path to schema.prisma>") in prisma.config.ts, then run contract convert again.
  docs: https://docs.prisma.io/docs/orm/v8/reference/error-reference/CONTRACT.CONVERT_REQUIRES_PRISMA7_SOURCE
$ node $CLI contract convert   # exit 2  ... "error":{"code":"CONTRACT.CONVERT_REQUIRES_PRISMA7_SOURCE", ... "meta":{"format":"psl"} ...
$ stat prisma/contract.prisma   # mtime unchanged (07:46:19); shasum -c OK
```

Back on the Prisma 7 config (schema and `prisma7Schema` config restored):

```
$ node $CLI contract convert --output other/dir/contract.prisma --format human   # exit 0
✔ Contract written to other/dir/contract.prisma
$ diff prisma/contract.prisma other/dir/contract.prisma   # empty
$ node $CLI contract convert --output other/dir/contract.prisma --format human   # exit 0
▸ Resolving contract source...
✔ Resolving contract source...
Overwriting existing file: other/dir/contract.prisma
│  source:  prisma/schema.prisma

✔ Contract written to other/dir/contract.prisma
$ node $CLI contract convert --output other/dir/contract.prisma   # exit 0
{"kind":"message","severity":"warn","text":"Overwriting existing file: other/dir/contract.prisma", ...}
{"kind":"result","envelope":{"ok":true, ... "source":{"format":"prisma7","input":"prisma/schema.prisma"},"psl":{"path":"other/dir/contract.prisma"} ...
```

`other/dir/` did not exist before and was created.

Outcome: pass (F-8 noted).

## Step 6 — A schema the converter cannot help with

Added `updatedAt DateTime? @updatedAt` to `Post` (line 27). Sha of both `contract.prisma` files recorded first.

```
$ node $CLI contract convert --format human   # exit 2
▸ Resolving contract source...
✘ Resolving contract source...
✘ [CONTRACT.SOURCE_LOAD_FAILED] Failed to resolve contract source
  why: Prisma 7 schema interpretation failed
→ Edit the schema where each finding points, then run contract emit again.
  docs: https://docs.prisma.io/docs/orm/v8/reference/error-reference/CONTRACT.SOURCE_LOAD_FAILED

✘ [CONTRACT.SOURCE_DIAGNOSTIC] prisma/schema.prisma:27:23 PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED: Field "Post.updatedAt" is optional but its value is generated by the ORM (@updatedAt). Prisma 8 cannot spell an optional generated field yet; drop the "?".
$ node $CLI contract emit --format human      # exit 2, byte-for-byte the same lines
$ node $CLI contract convert                  # exit 2, envelope "diagnostics":[{"code":"CONTRACT.SOURCE_DIAGNOSTIC", ... "where":{"path":"prisma/schema.prisma","line":27} ...}]
$ shasum -c step6-before.sha   # prisma/contract.prisma: OK, other/dir/contract.prisma: OK; mtime unchanged
```

Outcome: pass (F-3 on the next-action wording).

## Step 7 — `--json`

Schema restored.

```
$ node $CLI contract convert --json   # exit 0
{"kind":"message","severity":"warn","text":"Overwriting existing file: prisma/contract.prisma", ...}
{"kind":"result","envelope":{"ok":true,"commandId":"contract.convert","result":{"ok":true,"summary":"Contract converted successfully","target":{"familyId":"sql","id":"postgres"},"source":{"format":"prisma7","input":"prisma/schema.prisma"},"psl":{"path":"prisma/contract.prisma"},"timings":{"total":18}},"exitCode":0,"diagnostics":[],"nextActions":[]}, ...}
```

`psl.path` is the written path, relative to the working directory. `--json --format human` together prints the human form.

Outcome: pass.

## Step 8 — Is the README enough?

See F-4, F-5 and F-9. One extra check for F-4: with `contract: 'other/dir/contract.prisma'`, `contract emit` wrote `other/dir/contract.json` and `other/dir/contract.d.ts` (exit 0, same hashes) and left `prisma/contract.json` and `prisma/contract.d.ts` in place; `db verify` passed against `other/dir/contract.json`.

## Findings

- **F-1 ⚠ Should fix (step 4).** `migration plan --name baseline --format human` prints `✔ Planned baseline + 0 operation(s)` and then an `operations` tree of 13 create operations, a full DDL preview that would create every table, index and foreign key again, and `→ Apply the migration: {bin} db migrate`. A cutover user reads this as "Prisma 8 wants to recreate my schema" and is told to apply it. The JSON envelope on a second run says `noOp: true, operations: []`. In fact `db migrate` afterwards is a no-op (`Already up to date`), so nothing breaks, but the output contradicts itself and the README's "Prisma 8 takes over migrations". Expected: the plan says it recorded the current schema as a baseline and that there is nothing to apply, or the README says the 13 operations describe the schema Prisma 8 now owns and are not to be applied.
- **F-2 ⚠ Should fix (steps 4 and 8).** Next-action lines print a literal placeholder: `→ Apply the migration: {bin} db migrate` (`migration plan`) and `→ Check every space against the database: {bin} migration status` (`db migrate`). Expected: `prisma db migrate`, `prisma migration status`.
- **F-3 ⚠ Should fix (step 6).** After `contract convert` fails on a source diagnostic, the next action reads `Edit the schema where each finding points, then run contract emit again.` The user ran `contract convert`. Expected: the next action names the command that was run.
- **F-4 ℹ Note (step 8).** The CLI README's cutover block writes the PSL to `src/prisma/contract.prisma`, points `contract:` at it and says `prisma contract emit` gives "same hashes as before". It does, but the artifacts move: a PSL source writes `contract.json` and `contract.d.ts` beside the PSL file (`src/prisma/`), while the Prisma 7 source wrote them at `prisma/`. The old `prisma/contract.json` and `contract.d.ts` stay behind and a `db.ts` importing them keeps working against stale files with no warning. Verified with `other/dir/contract.prisma`: emit wrote `other/dir/contract.json`, `prisma/contract.json` remained. Expected: the README says the output location follows the PSL file, and how to keep the old path if the app imports it.
- **F-5 ℹ Note (step 2).** The README says two things are spelled differently from the Prisma 7 file (`index: false` on relations, enum members named after database values). The converted file also: turns every `@unique` into `@@index([...], unique: true, map: "...")`; puts `@@map("User")` on every model even where the table name equals the model name; spells `createdAt` as `Timestamp(3)` but `updatedAt` as `temporal.timestamp(3, onCreate: now, onUpdate: now)`; reorders `Post`'s fields (`tags` before `author`); names the junction model's relation fields `a` and `b`; adds `onUpdate: Cascade` to relations that did not spell it. None of this is wrong (hashes identical), but each one made me check whether something was lost. Expected: the README lists these spellings, or says "field order, `@@map` and index spellings differ; the hashes are what matters".
- **F-6 ℹ Note (step 4).** `db sign --format human` on an already-signed database prints `from:  none` / `to:  67027c1b...` and then `Advanced ref "db" → 67027c1b... (was 67027c1b...)`. "from: none" and "was 67027c1b..." disagree; the marker has existed since step 1. Expected: `from` shows the previous marker hash.
- **F-7 ℹ Note (steps 3 and 4).** `contract emit --format human` ends with two bare absolute paths (`/Users/.../prisma/contract.json`, `/Users/.../prisma/contract.d.ts`) after the hash block, repeating the `contract:`/`types:` lines above. Looks like stray output.
- **F-8 ℹ Note (steps 5 and 7).** The overwrite warning `Overwriting existing file: other/dir/contract.prisma` prints with no glyph or indent, between `✔ Resolving contract source...` and `│  source:`, unlike every other line in the CLI's human output. In JSON it is a proper `severity: "warn"` message.
- **F-9 ℹ Note (steps 4 and 8).** Guessing the READMEs left me doing: (a) neither README names the command that lists refs; `migration ref --help` does (`list`). (b) The guide says `prisma migration ref set db <timestamp>_baseline` without saying the directory name is printed by `migration plan` (`baseline: migrations/app/20260915T0546_baseline`) and that its form is `YYYYMMDDTHHMM_baseline`. (c) `db sign` already advances the `db` ref to the same hash (`✔ Advanced ref "db" → ...`, and `refs/db.json` exists from the first sign in step 1), so the guide's `migration ref set db <timestamp>_baseline` step is a no-op the guide does not explain. (d) The CLI README says the default output is `contract.prisma` beside `config.contract.output`; a user with `prisma7Schema('prisma/schema.prisma')` has to know from the other README that this means `prisma/contract.prisma`. The convert command's own output does name the path, which resolved it.

## Re-run after dispatch 5

Date: 2026-09-15, same scratch app (`wip/qa-convert/`), same dev database, CLI rebuilt from the dispatch 5 commits (`5d8a123d26` … `803720fb82`). Logs: `wip/qa-convert/logs/rerun*-*.log`. Steps 4, 5, 6, and 8 of the script were repeated; steps 1 to 3 and 7 were not affected by any finding.

### Step 4

The earlier baseline directory was removed so the plan would record one again.

```
$ node $CLI migration plan --name baseline --format human   # exit 0
│  contract:    prisma/contract.json
│  migrations:  migrations/app
│  name:        baseline

✔ Recorded the current schema as a baseline (13 operation(s)); nothing to apply

migrations/app/20260915T0609_baseline (the schema the baseline records)
├─ Create schema "public"
... (13 operations)
└─ Add foreign key "_PostToTag_B_fkey" on "_PostToTag"

from:      67027c1b...
to:        67027c1b...
baseline:  migrations/app/20260915T0609_baseline

ℹ DDL preview of what the baseline records — already in the database, not applied
CREATE SCHEMA IF NOT EXISTS "public";
...
→ Review migrations/app/20260915T0609_baseline
→ Confirm the database is up to date: prisma migration status
$ node $CLI db sign --format human   # exit 0
✔ Database signed
from:  67027c1b...
to:    67027c1b...
✔ Advanced ref "db" → 67027c1b... (was 67027c1b...)
$ node $CLI migration ref set db 20260915T0609_baseline --format human   # exit 0
✔ Set ref "db" → 67027c1b...
$ node $CLI migration ref list --format human
Ref  Contract
db   67027c1b...
$ node $CLI migration status --format human   # exit 0
○   67027c1  @contract @db (db)
│↑  20260915T0609_baseline        ∅ → 67027c1  13 ops
○   ∅
✔ Up to date
```

### Step 5

```
$ node $CLI contract convert --format human   # PSL config; exit 2
✘ [CONTRACT.CONVERT_REQUIRES_PRISMA7_SOURCE] contract convert applies only to a Prisma 7 schema source
  why: The configured contract source has format "psl"; only a source created with prisma7Schema(...) can be converted.
→ Point contract: at prisma7Schema("<path to schema.prisma>") in prisma.config.ts, then run contract convert again.
$ shasum -c logs/rerun5-before.sha   # prisma/contract.prisma: OK
$ node $CLI contract convert --output other/dir/contract.prisma --format human   # Prisma 7 config restored; exit 0
▸ Resolving contract source...
✔ Resolving contract source...
│  source:  prisma/schema.prisma

⚠ Overwrote existing file other/dir/contract.prisma
✔ Contract written to other/dir/contract.prisma
$ node $CLI contract convert --output other/dir/contract.prisma   # exit 0
  ... "psl":{"path":"other/dir/contract.prisma","overwrote":true} ...   (no message event any more)
```

### Step 6

`updatedAt DateTime? @updatedAt` added to `Post` (line 26).

```
$ node $CLI contract convert --format human   # exit 2
✘ [CONTRACT.SOURCE_LOAD_FAILED] Failed to resolve contract source
  why: Prisma 7 schema interpretation failed
→ Edit the schema where each finding points, then run contract convert again.
✘ [CONTRACT.SOURCE_DIAGNOSTIC] prisma/schema.prisma:26:23 PRISMA7_OPTIONAL_GENERATED_FIELD_UNSUPPORTED: Field "Post.updatedAt" is optional ... drop the "?".
$ node $CLI contract convert   # exit 2, "nextActions":[{"kind":"user-choice","label":"Edit the schema where each finding points, then run contract convert again."}]
$ shasum -c logs/rerun6-before.sha   # prisma/contract.prisma: OK, other/dir/contract.prisma: OK
```

### Step 8

```
$ node $CLI contract emit --format human   # config: other/dir/contract.prisma; exit 0
│  contract:  other/dir/contract.json
│  types:     other/dir/contract.d.ts
✔ Emitted contract.json and contract.d.ts
storageHash: 67027c1b...  executionHash: 0d9fcbcd...  profileHash: 3916f444...
/Users/.../wip/qa-convert/other/dir/contract.json
/Users/.../wip/qa-convert/other/dir/contract.d.ts
$ node $CLI db verify --format human   # exit 0  ✔ Database marker and schema match contract
$ node $CLI db migrate --format human   # exit 0
✔ Already up to date
→ Check every space against the database: prisma migration status
```

### Findings after dispatch 5

- **F-1 fixed** (`d3ac929ce3`). Summary "Recorded the current schema as a baseline (13 operation(s)); nothing to apply"; tree and preview headers say the operations are what the baseline records; next action is `prisma migration status`, not "apply". By design, not a planner defect: `packages/1-framework/3-tooling/cli/src/control-api/operations/migration-plan.ts`, the `fromHash === toStorageHash` branch after the baseline leg, records the schema as a baseline bundle when the `db` ref names the contract but no on-disk migration reaches it; the operations were the baseline leg's, the "+ 0 operation(s)" counted the delta leg. Planning semantics unchanged; `migration-plan.test.ts` asserts the wording and the actions.
- **F-2 fixed** (`0571869ce9`, `647225554e`). `→ Confirm the database is up to date: prisma migration status`, `→ Check every space against the database: prisma migration status`. The engine substitutes `{bin}` only in help examples; the CLI now resolves it in `runCommandAction` (every success-path action) and `normalizeError` (every settled error: labels, commands, why, summary, nested diagnostics). Tests in `normalize-error.test.ts` and `migration-plan.test.ts`.
- **F-3 fixed** (`5d8a123d26`). "run contract convert again"; `contract emit` keeps its wording (`control-api/contract-emit.test.ts`); `contract-convert.test.ts` drives the real loader through a failing source.
- **F-4 documented** (`803720fb82`): CLI README, `prisma contract convert`, paragraph "Where the artifacts go after the switch", verified again in step 8 (`other/dir/contract.json` written, `prisma/contract.json` left in place).
- **F-5 documented** (`803720fb82`): CLI README, the bulleted list under "The converted contract is the contract the Prisma 7 source produced".
- **F-6 fixed** (`7380d4e874`). `from: 67027c1b...` beside `(was 67027c1b...)`. The family recorded the previous marker only when it changed; it now records the marker it found. Regression test: the Prisma 7 journey signs twice and asserts `marker.previous.storageHash`.
- **F-7 documented** (`2bd638a7bf`). The two path lines are `contract emit`'s stdout data for pipes; the engine drops that mirror when both stdout and stderr are terminals (`contract-emit.test.ts`, "on a terminal the paths are not mirrored to stdout"). They appear only when `--format human` is forced with stdout redirected, which is how these logs are captured; a terminal user does not see them.
- **F-8 fixed** (`2bd638a7bf`). `⚠ Overwrote existing file other/dir/contract.prisma` as a warn block; the JSON document carries `psl.overwrote`. The engine renders bare message events without a glyph, so the fact travels in the document instead (same change in `contract infer`).
- **F-9 documented** (`803720fb82`): CLI README, "What each step prints and means" under the cutover block — `migration ref list`, the `YYYYMMDDTHHMM_baseline` directory as `migration plan` prints it, `db sign` advancing the `db` ref, and `migration ref set db <timestamp>_baseline` confirming rather than changing it after `db sign` (may be skipped once `ref list` shows the hash). The default output path for `prisma7Schema('prisma/schema.prisma')` is spelled out.
