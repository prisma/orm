# Upgrade rewrite: facts needed to specify the script

Made on branch `data-types-completion` on 2026-09-29. It collects what the user-facing upgrade script must read, rewrite and recompute when a SQL contract replaces `nativeType` with `dataType`. `CLI/` stands for `packages/1-framework/3-tooling/cli/src/`, and `MIG/` for `packages/1-framework/3-tooling/migration/src/`. Open points are marked DECISION NEEDED and continue the numbering of [`change-list.md`](change-list.md).

## 1. Files in a user's project that hold a hash or a type name

Layout, confirmed in `examples/prisma-8-demo/migrations/`: `migrations/<space>/<migration>/{migration.json, ops.json, migration.ts, contract.prisma}`, `migrations/<space>/refs/*.json`, and one store `migrations/snapshots/<storage hash>/{contract.json, contract.d.ts}` shared by all spaces (`MIG/space-layout.ts:45-80`, `MIG/contract-snapshot-store.ts:41-43`). `<space>` is `app` for the user's own contract and the extension id (`pgvector`, `postgis`) for an extension's contract space.

| File | Field | Rewritten? | Written by | Read by |
| --- | --- | --- | --- | --- |
| Emitted `contract.json` | `storage.namespaces.<ns>.entries.table.<t>.columns.<c>.nativeType` | Replace with `dataType` | `buildSqlContractFromDefinition` (`packages/2-sql/2-authoring/contract-ts/src/build-contract.ts:876`) | Contract validation (`packages/2-sql/1-core/contract/src/ir/storage-entry-schemas.ts:37-70`) |
| | `storage.types.<name>.nativeType` | Replace with `dataType` | `build-contract.ts:1631-1643` | `packages/2-sql/1-core/contract/src/validators.ts:62-69` |
| | `extensions.<pack>.types.storage[].nativeType` | Remove the `storage` list | `CLI/control-api/contract-enrichment.ts:30-57` | No reader found |
| | `storage.storageHash` | Recompute | `build-contract.ts:1727-1737` | Marker checks, snapshot store |
| | `profileHash`, `execution.executionHash` | Keep | `build-contract.ts:1761-1765`; `packages/1-framework/0-foundation/contract/src/build-execution-section.ts:27` | Marker checks |
| Emitted `contract.d.ts` | `readonly nativeType: '…'` in each column and `storage.types` entry | Replace with `dataType` | `packages/2-sql/3-tooling/emitter/src/index.ts:683, 747` | TypeScript only |
| | `StorageHashBase<'…'>` literal (for example `examples/prisma-8-demo/src/prisma/contract.d.ts:42`) | Replace with the new hash | the emitter | TypeScript only |
| `migrations/snapshots/<hash>/contract.json` | Same fields as the emitted contract | Same rewrite | `writeContractSnapshot` (`MIG/contract-snapshot-store.ts:94-145`) | `readContractSnapshotJson` (`:153-178`), which can recompute the hash and compare it with the directory name (`:67-87`) |
| `migrations/snapshots/<hash>/contract.d.ts` | Same as the emitted file. For an extension space it is a placeholder `export {};` (`CLI/control-api/operations/contract-space-seed-phase.ts:189-200`) | Same rewrite; placeholder unchanged | same | `migration.ts` type imports |
| `migrations/snapshots/<hash>/` | The directory name is the storage hash | Rename | `MIG/contract-snapshot-store.ts:41-43` | same |
| `migrations/<space>/<migration>/migration.json` | `from` (hash or `null`), `to`, `migrationHash` (`packages/1-framework/1-core/framework-components/src/control/control-migration-types.ts:52-63`) | Replace `from` and `to`; recompute `migrationHash` | `buildAttestedMetadata` (`MIG/migration-base.ts:240-253`); `CLI/control-api/operations/migration-plan.ts:210`; `migration-new.ts:213` | The graph loader; `verifyMigrationHash` (`MIG/hash.ts:111-128`) |
| `migrations/<space>/<migration>/ops.json` | No hash, no `nativeType`. Type names only inside SQL text | Keep byte-identical | `MIG/migration-base.ts` | `computeMigrationHash` |
| `migrations/<space>/<migration>/migration.ts` | Import paths `../../snapshots/<hash>/contract` and `…/contract.json` (for example `examples/prisma-8-demo/migrations/app/20260810T1108_add_post_engagement_counters/migration.ts:3-10`) | Replace the hashes in the paths | the planner's TypeScript renderer | `tsx migration.ts` |
| | `col('name', 'int8', …)` type text (`:21`) | Keep | same | same |
| `migrations/<space>/<migration>/contract.prisma` | PSL source of that migration's end contract | Keep | the user or the planner | `scripts/regen-example-migrations.mjs` in this repository |
| `migrations/<space>/refs/<name>.json`, including `refs/head.json` and `refs/db.json` | `hash` (`MIG/refs.ts:11-14, 42, 56-63`) | Replace | `emitContractSpaceArtifacts` (`MIG/emit-contract-space-artifacts.ts:73-78`); `db sign` and other commands that advance a ref | `readRef`; `migration plan` takes its origin from the `db` ref (`CLI/control-api/operations/plan-resolution.ts:105-125`) |
| `migrations/<extension>/…` | Copies of the extension's `migration.json`, `ops.json`, `refs/head.json`, and its contract in the snapshot store | Same rewrite; see section 6 | `runContractSpaceSeedPhase` (`contract-space-seed-phase.ts:98-177`) | The aggregate loader |
| User-written `contract.ts` | Hand-written `{ codecId, nativeType }` objects (`examples/prisma-8-demo/prisma/contract.ts:12-16`) | Depends on DECISION NEEDED 1 | the user | `contract emit` |

I found no other file that stores these values. `migration.json` and `ops.json` do not embed a contract. I did not find a lock file or cache that holds a hash.

Older contract layouts exist in committed snapshots. 46 committed snapshot contracts store columns at `storage.namespaces.<ns>.tables.<t>.columns.<c>` instead of `…entries.table…` (under `examples/prisma-8-demo/fixtures/*/migrations/snapshots/` and `apps/telemetry-backend/migrations/snapshots/`). Their stored storage hash does not recompute with today's rules. See DECISION NEEDED 11.

## 2. How each hash is computed, and the order of the rewrite

### Storage hash

`computeStorageHash({target, targetFamily, storage, shouldPreserveEmpty, sortStorage})` (`packages/1-framework/0-foundation/contract/src/hashing.ts:74-86`). Steps:

1. Take `storage` without `storageHash` (`MIG/hash.ts:41`).
2. Remove `kind` from each namespace (`hashing.ts:19-37`).
3. Build a contract with only `targetFamily`, `target`, `storage`, empty `roots`, `domain`, `extensions`, `capabilities`, `meta`, and `profileHash: ''` (`hashing.ts:53-65`).
4. Canonicalise with schema version `'1'` (`hashing.ts:14, 66-71`): drop keys whose value is a default (`false`, empty list, empty object), except the paths the rules keep (`packages/1-framework/0-foundation/contract/src/canonicalization.ts:82-148`); apply the family's storage sort; sort object keys (`:179`); order the top-level keys (`:66, 197`); print with `JSON.stringify(…, null, 2)` (`:284`).
5. SHA-256, hexadecimal (`hashing.ts:39-43, 84`).

The SQL family's two hooks are `sqlContractCanonicalizationHooks` (`packages/2-sql/1-core/contract/src/canonicalization-hooks.ts:10-66`): five path patterns whose empty values are kept, and a sort by `name` of each table's `checks`, `indexes` and `uniques`.

The hash covers the whole `storage` subtree, so it covers `codecId`, `nativeType` and `typeParams` of every column and `storage.types` entry. It does not cover `extensions`.

### Profile hash and execution hash

- `computeProfileHash` hashes `capabilities` (`hashing.ts:98-106`). The SQL builder always passes `capabilities: {}` (`build-contract.ts:1757-1765`). **It does not change.**
- `computeExecutionHash` hashes the `execution` section (`hashing.ts:88-96`). No committed contract has `nativeType` inside `execution`. **It does not change.**

### Migration hash

`computeMigrationHash(metadata, ops)` (`MIG/hash.ts:89-100`): SHA-256 of the canonical JSON of the list `[sha256(canonical metadata without migrationHash), sha256(canonical ops)]`. Canonical JSON is sorted keys, then `JSON.stringify` (`packages/1-framework/1-core/framework-components/src/utils/canonicalize-json.ts:20`). It covers `from`, `to`, `providedInvariants`, `createdAt` and the whole `ops.json`. It does not cover `migration.ts`, `contract.prisma` or any contract.

### Snapshots

A snapshot has no hash of its own. Its directory name is the contract's storage hash, and the check recomputes that hash from the file (`MIG/contract-snapshot-store.ts:67-87`). On a mismatch it raises `MIGRATION.CONTRACT_SNAPSHOT_CONTENT_MISMATCH`, "Contract snapshot content does not match its hash" (`MIG/errors.ts:560-576`). An extension descriptor has the same check against `headRef.hash`, `MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH` (`MIG/assert-descriptor-self-consistency.ts:48-65`).

### Does any hash need the user's stack?

No. Every hash is a function of file content and fixed rules. The storage hash needs the SQL family's two hooks, which are constant data, not the user's configured stack. The script copies the rules, as `strip-sha256-hash-prefixes.ts` copies the migration hash (section 4).

I checked this with a scratch script that imports nothing from the repository: it reproduces the stored storage hash and profile hash of 236 of the 282 committed SQL contracts. The 46 that fail are exactly the older-layout snapshots named in section 1. Replacing `nativeType` with `dataType` changes the storage hash of 280 of the 282; the two that keep their hash are the paradedb contract and its snapshot, which have no column and no `storage.types` entry.

### Order of the rewrite

1. Find every SQL contract: emitted `contract.json` files and `migrations/snapshots/*/contract.json`.
2. For each, check that the stored `storage.storageHash` recomputes from the current content. Stop on a mismatch (DECISION NEEDED 11).
3. Rewrite the content: `nativeType` to `dataType` by the table in section 3, and remove `extensions.<pack>.types.storage`.
4. Recompute the storage hash, write it to `storage.storageHash`, and record old hash to new hash.
5. Rewrite the `contract.d.ts` beside each contract.
6. Rename each `migrations/snapshots/<old>/` to `<new>/`.
7. In each `migration.json`, replace `from` and `to` through the map, then recompute `migrationHash`. `ops.json` is read, not written.
8. In each `migration.ts`, replace the hashes in the snapshot import paths.
9. In each `refs/*.json`, replace `hash` through the map.
10. Report each file, and fail if a hash in `migration.json` or a ref is not in the map.

Two contracts with different old hashes cannot get the same new hash unless they differed only in `nativeType` for the same codec, which the table in section 3 would have to cause. The script should fail if a rename target already exists with different content.

## 3. From `codecId` to data type id

The data type of a codec is fixed in its descriptor. For the five shared `sql/*` codecs it is fixed per target, because each target adapts them (`packages/3-targets/3-targets/postgres/src/core/codecs.ts:324-352`, `packages/3-targets/3-targets/sqlite/src/core/codecs.ts:236-254`). So the script's table is keyed by the contract's `target` and the `codecId`. Both are in `contract.json`.

Sources: Postgres `packages/3-targets/3-targets/postgres/src/core/codecs.ts`, `date-codecs.ts`, `temporal-codecs.ts`, `temporal-string-codecs.ts` (the line is the `dataType` declaration); ids in `codec-ids.ts:8-42` and `data-types.ts:56-118`.

| `target` | `codecId` | Data type id | Source |
| --- | --- | --- | --- |
| postgres | `pg/text@1` | `pg/text` | `codecs.ts:383` |
| postgres | `pg/text-array@1` | `pg/text-array` | `codecs.ts:588` |
| postgres | `pg/enum@1` | `pg/enum` | `codecs.ts:473` |
| postgres | `pg/char@1` | `pg/char` | `codecs.ts:1628` |
| postgres | `pg/varchar@1` | `pg/varchar` | `codecs.ts:1658` |
| postgres | `pg/int@1` | `pg/int4` | `codecs.ts:1693` |
| postgres | `pg/int2@1` | `pg/int2` | `codecs.ts:679` |
| postgres | `pg/int4@1` | `pg/int4` | `codecs.ts:629` |
| postgres | `pg/int8@1` | `pg/int8` | `codecs.ts:740` |
| postgres | `pg/int8number@1` | `pg/int8` | `codecs.ts:796` |
| postgres | `pg/float@1` | `pg/float8` | `codecs.ts:1720` |
| postgres | `pg/float4@1` | `pg/float4` | `codecs.ts:844` |
| postgres | `pg/float8@1` | `pg/float8` | `codecs.ts:892` |
| postgres | `pg/numeric@1` | `pg/numeric` | `codecs.ts:1002` |
| postgres | `pg/unboundedint@1` | `pg/numeric` | `codecs.ts:1063` |
| postgres | `pg/bool@1` | `pg/bool` | `codecs.ts:940` |
| postgres | `pg/bit@1` | `pg/bit` | `codecs.ts:1169` |
| postgres | `pg/varbit@1` | `pg/varbit` | `codecs.ts:1219` |
| postgres | `pg/bytea@1` | `pg/bytea` | `codecs.ts:1267` |
| postgres | `pg/uuid@1` | `pg/uuid` | `codecs.ts:1314` |
| postgres | `pg/inet@1` | `pg/inet` | `codecs.ts:1361` |
| postgres | `pg/tsquery@1` | `pg/tsquery` | `codecs.ts:1424` |
| postgres | `pg/interval@1` | `pg/interval` | `codecs.ts:1485` |
| postgres | `pg/json@1` | `pg/json` | `codecs.ts:1534` |
| postgres | `pg/jsonb@1` | `pg/jsonb` | `codecs.ts:1579` |
| postgres | `pg/timetz@1` | `pg/timetz` | `codecs.ts:1118` |
| postgres | `pg/date-temporal@1` | `pg/date` | `temporal-codecs.ts:66` |
| postgres | `pg/timestamp-temporal@1` | `pg/timestamp` | `temporal-codecs.ts:115` |
| postgres | `pg/timestamptz-temporal@1` | `pg/timestamptz` | `temporal-codecs.ts:172` |
| postgres | `pg/time-temporal@1` | `pg/time` | `temporal-codecs.ts:227` |
| postgres | `pg/date-string@1` | `pg/date` | `temporal-string-codecs.ts:58` |
| postgres | `pg/timestamp-string@1` | `pg/timestamp` | `temporal-string-codecs.ts:106` |
| postgres | `pg/timestamptz-string@1` | `pg/timestamptz` | `temporal-string-codecs.ts:165` |
| postgres | `pg/time-string@1` | `pg/time` | `temporal-string-codecs.ts:223` |
| postgres | `pg/timestamptz-date@1` | `pg/timestamptz` | `date-codecs.ts:127` |
| postgres | `sql/char@1` | `pg/char` | `codecs.ts:325` |
| postgres | `sql/varchar@1` | `pg/varchar` | `codecs.ts:331` |
| postgres | `sql/int@1` | `pg/int4` | `codecs.ts:337` |
| postgres | `sql/float@1` | `pg/float8` | `codecs.ts:343` |
| postgres | `sql/text@1` | `pg/text` | `codecs.ts:349` |
| postgres | `pg/vector@1` (pgvector) | `pgvector/vector` | `packages/3-extensions/pgvector/src/core/codecs.ts:182` |
| postgres | `pg/geometry@1` (postgis) | `postgis/geometry` | `packages/3-extensions/postgis/src/core/codecs.ts:155` |
| postgres | `arktype/json@1` (arktype-json) | `pg/jsonb` | `packages/3-extensions/arktype-json/src/core/arktype-json-codec.ts:220` |
| sqlite | `sqlite/text@1` | `sqlite/text` | `packages/3-targets/3-targets/sqlite/src/core/codecs.ts:280` |
| sqlite | `sqlite/integer@1` | `sqlite/integer` | `:336` |
| sqlite | `sqlite/real@1` | `sqlite/real` | `:387` |
| sqlite | `sqlite/blob@1` | `sqlite/blob` | `:436` |
| sqlite | `sqlite/datetime@1` | `sqlite/datetime` | `:497` |
| sqlite | `sqlite/json@1` | `sqlite/json` | `:539` |
| sqlite | `sqlite/bigint@1` | `sqlite/bigint` | `:611` |
| sqlite | `sqlite/bigintnumber@1` | `sqlite/bigint` | `:682` |
| sqlite | `sql/char@1` | today `sqlite/text` (`:237`); after settled Q4 the new type named `character` (DECISION NEEDED 9) | |
| sqlite | `sql/varchar@1` | `sqlite/text` | `:242` |
| sqlite | `sql/int@1` | `sqlite/integer` | `:247` |
| sqlite | `sql/float@1` | `sqlite/real` | `:252` |

Notes on the table:

- The paradedb, supabase, postgres and sqlite extension packages declare no codec with a data type of their own in `src/`; the search for `dataType =` declarations found only the three extension codecs above.
- The Mongo codecs are left out. Mongo contracts store no type name (research section 9), so the script does not touch them.
- The script can check its own work: for a Postgres column, the old `nativeType` must equal the data type's name, except for `pg/enum`, whose old `nativeType` equals `typeParams.typeName`. Every committed Postgres pair passes this check. A failure means the file was edited by hand.
- One committed contract uses a codec id that no longer exists: `pg/timestamptz@1`, in the two `apps/telemetry-backend/migrations/snapshots/*/contract.json` files. The repository itself therefore has the "unknown codec" case.

**DECISION NEEDED 10. A codec id the script does not know** (a third-party extension, or a retired id such as `pg/timestamptz@1`). Recommended: the script changes no file, lists every unknown `(target, codecId, nativeType)` it found with the files, and exits with an error. It accepts a repeatable option, for example `--data-type pg/citext@1=citext/citext`, and the instruction tells extension authors to publish that line in their own upgrade notes. Reason: a guessed id produces a contract whose hash is valid but whose load-time check (codec represents `dataType`) fails later, in a place far from the cause.

## 4. The precedent for upgrade scripts

### Existing scripts

- `stamp-storage-types-kind.ts`: source copies at `skills/prisma-8/upgrading/app/upgrades/0.9-to-0.10/` and `skills/prisma-8/upgrading/extension/upgrades/0.9-to-0.10/`, byte-identical. It uses only `node:fs/promises` and `node:path` (lines 79-80), runs from the project root (line 88), has one flag `--check` (line 87), adds `kind` to `storage.types` entries (lines 184-248), reports `OK`, `FIXED` or `WOULD FIX` per file (lines 344-358) and is idempotent. **It recomputes no hash**, and it looks only for `start-contract.json` and `end-contract.json` below `migrations` (lines 83, 104-122), a layout that no longer exists. It has no test.
- `strip-sha256-hash-prefixes.ts` (`skills/prisma-8/upgrading/app/upgrades/0.16-to-0.17/`) is the closer model. It copies the migration hash algorithm inline (lines 92-134), keeps a map of old to new migration hash (lines 229, 297-298), rewrites `refs/*.json` (lines 326-340), and covers `migrations/snapshots/<hex>/contract.json` and `contract.d.ts` (lines 57-59). It renamed no directory (lines 62-63). It has no test.
- No existing script recomputes a storage hash or renames a snapshot directory. Both are new.
- The one script with a test is `scripts/codemods/add-model-map.mjs` with `scripts/codemods/add-model-map.test.mjs`, listed in `test:scripts` (`package.json:50`).

### How the copies reach users

`scripts/sync-package-skills.ts:28-46` copies the whole `skills/prisma-8` tree into `@prisma/orm-postgres`, `@prisma/orm-sqlite` and `@prisma/orm-mongo` at `prepack` (`packages/9-public/@prisma/orm-postgres/package.json:14`). The copies under `packages/9-public/` are ignored by git (`.gitignore:36`).

### How an instruction is structured

- A feature pull request adds a fragment without a version: `upgrade-instructions/pending/<descriptive-name>/<app|extension>/instructions.md`, with scripts under `scripts/` in the same audience directory (`upgrade-instructions/README.md:7-17`).
- The file has YAML frontmatter with `changes[]`; each change has `id`, `summary`, optional `detection` and optional `script`, a path relative to `instructions.md` (`skills-contrib/record-upgrade-instructions/SKILL.md:40`). The body has one section per change id.
- A feature pull request must not name a release (`upgrade-instructions/README.md:19`). At release, fragments are assembled into `skills/prisma-8/upgrading/<audience>/upgrades/<from>-to-<to>/instructions.md`, scripts go under that guide's `scripts/<fragment-name>/`, and the originals are archived under `upgrade-instructions/releases/<from>-to-<to>/sources/` (`upgrade-instructions/README.md:25-29`). The current version is `8.0.0-rc.13` (`package.json:3`).
- Two audiences: `app` for changes under `examples/`, `extension` for changes under `packages/3-extensions/` (`SKILL.md:24-28`). Scripts are copied into both.

### Where the script lives, how it runs, what it may use

- Place: `upgrade-instructions/pending/<name>/app/scripts/…` and the same under `extension/`.
- Run: from the project root, after the version bump, install and `prisma skills sync`, as `pnpm exec tsx <skill>/upgrading/app/upgrades/<from>-to-<to>/<script>` (`skills/prisma-8/references/upgrade-app.md:64-77`).
- Allowed: TypeScript run with `tsx`, shell, or a codemod; no network, no environment variables, no input other than the user's files and bundled assets (`SKILL.md:63`). In practice the existing scripts import Node built-ins only.
- Before merge the author restores `examples/` to the base commit, runs the fragment, and checks the result equals the pull request head outside test directories; the same for `packages/3-extensions/` (`SKILL.md:84-126`). For this project that check is strong: the script's output must equal what `pnpm fixtures:emit` produces.

### What `pnpm check:upgrade-coverage` checks

Script: `scripts/check-upgrade-coverage.mjs` (`package.json:55`). It reads committed trees, not the working directory, and runs in CI (`.github/workflows/ci.yml:133-137`) and at publish.

- For each audience it lists changed files under the covered directory and ignores test files, `package.json` files that differ only in dependency versions or scripts, and a `contract.json` or `contract.d.ts` that differs only in the extension version stamp (lines 128-184).
- If a file remains, the head must add a new pending `instructions.md` for that audience, or the check reports `per-pr-declaration` (lines 312-329).
- Each `instructions.md` must have frontmatter with a `changes` list; each `script` must be a relative path to an existing file, without `..` (lines 186-215).
- It does not check that the instruction is correct (`upgrade-instructions/README.md:44`).

This project changes contracts under both `examples/` and `packages/3-extensions/`, so it needs an `app` and an `extension` declaration.

## 5. `db sign` and databases that hold old hashes

### What `db sign` does today

Command: `CLI/orm/db/sign.ts`. Family code: `packages/2-sql/9-family/src/core/control-instance.ts:836-944`.

1. Reads the emitted contract (`sign.ts:256-263`). An old-format contract fails here after this project, with `CONTRACT.VALIDATION_FAILED` (`CLI/control-api/client.ts:356-362`).
2. Verifies the live schema against the contract with `strict: false` (`sign.ts:331-336`). On failure it writes nothing and exits 4 (`:337-355`).
3. Reads the marker of the app space only (`control-instance.ts:861`). No marker: inserts one (`:867-872`). Same hash: writes nothing (`:877-880`). Different hash: updates `core_hash`, `profile_hash` and `updated_at`, guarded by the old hash (`:880-893`; Postgres `packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts:482-492`).
4. Advances the `db` ref and writes the contract snapshot (`sign.ts:382-390`).

It does not need the old hash to be known. It never writes the ledger. **It does not sign extension contract spaces.**

Step 2 depends on this project's own verify. After the change, verify compares data type ids, so `db sign` succeeds only if introspection resolves every column of the database to the id the new contract names.

### What a user sees before signing

The marker holds the old storage hash, and the files hold the new ones.

| Command | Result | Source |
| --- | --- | --- |
| `migrate` | Refused: `MIGRATION.MARKER_MISMATCH`, "Database marker is not reachable in the on-disk migration graph". The three suggested fixes do not mention `db sign`. | `CLI/orm/migrate.ts:362-372`; `CLI/utils/cli-errors.ts:486-519` |
| `migrate`, when only an extension's marker is old | `MIGRATION.PATH_UNREACHABLE`, "Current contract has no planned migration path for contract space …" | `CLI/control-api/operations/migrate.ts:635-655`; `cli-errors.ts:572-583` |
| `db verify` | Exit 4, `CONTRACT.MARKER_MISMATCH`, "Contract storageHash does not match database marker"; fix text "Migrate database or re-sign if intentional". The schema is not checked. | `CLI/orm/db/verify.ts:145-149, 486-516`; `packages/1-framework/1-core/errors/src/execution.ts:34-43` |
| `db verify --schema-only` | Skips the marker | `CLI/orm/db/verify.ts:383-390` |
| `db update`, `db init` | No refusal for the app space: they plan from the live schema. With no operations, `db update` reports "Database already matches contract across N space(s), signature updated". An old extension marker gives `RUNNER_FAILED`, "Cannot resolve apply path for extension space …". | `CLI/control-api/operations/db-run.ts:185-202, 296-297, 381-387` |
| `migration status` | Exit 0 with warning `MIGRATION.MARKER_NOT_IN_HISTORY`; its hints name `db sign` and `db update`. | `CLI/orm/migration/status.ts:396-411`; `status-findings.ts:42-65` |
| `migration plan`, `migration new` | Do not connect. `migration plan` reads the `db` ref from disk, so the script must rewrite refs. | `CLI/control-api/operations/plan-resolution.ts:105-125` |
| The application at run time | A warning log `CONTRACT.MARKER_MISMATCH`, "Contract marker hash does not match runtime contract". Queries continue. | `packages/2-sql/5-runtime/src/sql-runtime.ts:936-944` |

### What `migration status` shows after signing

- The marker equals the contract hash, so there is no warning, nothing is pending, and the headline is "Up to date" (`CLI/orm/migration/status.ts:146-148, 396-397`).
- A migration is labelled "applied" only when its `migrationHash` is among the ledger's `migrationHash` values (`CLI/control-api/operations/migration-status-overlay.ts:24-30, 55-59`). The ledger holds old hashes, so no migration is labelled applied. Nothing warns about ledger hashes that are not in the graph. This matches the cost accepted in settled Q1a.
- `migration log` prints the ledger rows as stored, with the old hashes (`CLI/orm/migration/log.ts:157-180`).
- `migrate` does not read the ledger (`CLI/control-api/operations/migrate.ts:151`), and reports "Already up to date" (`:249-276`).

**DECISION NEEDED 12. Extension markers.** Settled Q1a says `db sign` repairs a database. It signs the app space only (`control-instance.ts:861, 868, 887`). A database that uses pgvector or postgis keeps an old marker for that space, and then `migrate`, `db update` and `db init` fail as shown above. `db verify` tells the user to "remove the conflicting marker row" (`CLI/control-api/operations/db-verify.ts:346-355`). Recommended: `db sign` also signs every extension space whose on-disk head contract verifies against the database. Reason: without it the settled upgrade path does not work for any project with a schema-contributing extension, and no other command can repair the marker.

**DECISION NEEDED 13. The `migrate` refusal message.** Its three fixes do not mention `db sign` (`cli-errors.ts:486-519`), although this is the first error most users will see. Recommended: add `db sign` as a fix line, as `migration status` already does. Reason: settled Q1b keeps upgrade advice out of the contract loader, but this message is about the marker, where `db sign` is the general remedy.

## 6. Extensions that ship a contract space

| Extension | Ships | Contract has a type name? | Storage hash changes? |
| --- | --- | --- | --- |
| pgvector | `src/contract.json`, `src/contract.d.ts`, `migrations/20260601T0000_install_vector_extension/{migration.json, migration.ts, ops.json}`, `migrations/refs/head.json`, `migrations/snapshots/<hash>/{contract.json, contract.d.ts}` | One `storage.types` entry `vector` (`packages/3-extensions/pgvector/src/contract.ts:48-55`) | Yes |
| postgis | The same set, with `20260601T0000_install_postgis_extension` | One `storage.types` entry `geometry` (`packages/3-extensions/postgis/src/contract.ts:47`) | Yes |
| paradedb | The same set, with `20260601T0000_install_pg_search_extension` | None | No |
| supabase | `src/contract/contract.json` and `contract.d.ts`; no `migrations/` directory. Its head ref is computed from the contract: `headRef: { hash: contract.storage.storageHash, invariants: [] }` (`packages/3-extensions/supabase/src/pack/index.ts:17`) | Yes, many columns and entries | Yes |
| arktype-json, postgres, sqlite, mongo, sql-orm-client, middleware packages | No contract space found | | |

`refs/head.json` holds `{hash, invariants}`; the hash is the extension contract's storage hash (`examples/prisma-8-demo/migrations/pgvector/refs/head.json`). The descriptor imports it (`packages/3-extensions/pgvector/src/exports/control.ts:46, 84`), and the framework checks that it recomputes from `contractJson` (`MIG/assert-descriptor-self-consistency.ts:48-65`).

### How a user's project is affected

A user's project holds copies. `runContractSpaceSeedPhase` (`CLI/control-api/operations/contract-space-seed-phase.ts:98-177`) writes, for each extension:

- the extension's contract into `migrations/snapshots/<hash>/`, only if that directory does not exist (`MIG/contract-snapshot-store.ts:116-118`);
- `migrations/<extension>/refs/head.json`, always overwritten (`MIG/emit-contract-space-artifacts.ts:73-78`);
- each migration package into `migrations/<extension>/<dirName>/`, only if that directory does not exist (`MIG/io.ts:133-143`).

After the user installs the new extension version and before the script runs:

1. `refs/head.json` is overwritten with the new hash on the next `migration plan`.
2. The migration package directory already exists, so it keeps the old `to` and the old `migrationHash`.
3. The on-disk graph of that space then ends at the old hash and no longer reaches the head. I did not run this; it follows from the two "only if missing" rules.

So the script must rewrite the extension copies in the user's project as well, and its result must equal, byte for byte in `migration.json` and `refs/head.json`, what the new extension version ships. This holds when the extension's own files are produced by the same rewrite, because `createdAt`, `providedInvariants` and `ops.json` do not change. It is a requirement on the in-repository regeneration: `pnpm migrations:regen` re-runs `migration.ts` and keeps `createdAt` (`MIG/migration-base.ts:240-253`), so the two results agree.

The database side is DECISION NEEDED 12: the extension's marker holds the old hash, and `db sign` does not update it.

A third-party extension with its own contract space has the same problem and the same remedy: its author runs the `extension` audience script and publishes a new version. A user who upgrades the framework before the extension does has extension copies that the script can still rewrite, but the installed extension's descriptor then publishes an old-format contract, which the loader refuses (settled Q1b).

## 7. The rewrite inside this repository

Committed files, counted in the working tree without `node_modules` and `dist`:

| Kind | apps | examples | packages | test | Total |
| --- | --- | --- | --- | --- | --- |
| `contract.json` that contains `nativeType` | 3 | 68 | 12 | 197 | 280 |
| of which snapshot contracts | 2 | 56 | 2 | 0 | 60 |
| `contract.d.ts` that contains `nativeType` | 3 | 68 | 14 | 197 | 282 |
| Other JSON with `nativeType` | 0 | 0 | 38 | 19 | 57 |
| `migration.json` | 2 | 77 | 3 | 0 | 82 |
| `ops.json` (read, not rewritten) | 2 | 77 | 3 | 0 | 82 |
| `migration.ts` under `migrations/` | 2 | 74 | 3 | 0 | 79 |
| Snapshot directories named by a hash | 2 | 63 | 3 | 0 | 68 |
| Ref files (`refs/*.json`) | 0 | 14 | 3 | 0 | 17 |

The "other JSON" files are 35 `expected-contract.json` (Prisma 7 fixtures), 16 `expected.contract.json` (parity fixtures), the JSON Schema, and five single fixtures. Under `packages`, the migration files, snapshots and refs all belong to the pgvector, postgis and paradedb extension packages.

Of the 68 snapshot directories, 7 belong to the Mongo examples (`examples/mongo-demo`, `examples/retail-store`) and are not touched, and one (paradedb) keeps its hash. The other 60 are renamed.

Commands, in order:

1. `pnpm --filter @internal/sql-contract-ts schemas:generate` for the JSON Schema.
2. `pnpm --filter @internal/extension-supabase contract:generate` for the Supabase contract.
3. `pnpm fixtures:emit`, which also runs `build:contract-space`, `pnpm migrations:regen` and `pnpm migrations:regen:examples` (`package.json:57-59`). It needs a Postgres database.
4. `pnpm fixtures:check` to confirm nothing differs afterwards (`package.json:60`).
5. The upgrade script itself, run against `examples/` and `packages/3-extensions/` restored to the base commit, to prove it produces the same files as steps 2 to 4 (`skills-contrib/record-upgrade-instructions/SKILL.md:84-126`).

**DECISION NEEDED 11. Snapshots whose stored hash does not recompute.** 46 committed snapshot contracts use an older column layout and do not reproduce their own hash. 44 are under `examples/prisma-8-demo/fixtures/*/migrations/snapshots/` and 2 under `apps/telemetry-backend/migrations/snapshots/`; the latter also use the retired codec `pg/timestamptz@1`. `pnpm migrations:regen:examples` rebuilds example snapshots from each migration's `contract.prisma`, which would replace them, but I did not confirm that it covers the `fixtures/` directories or `apps/`. Recommended: inside the repository, regenerate these from source rather than rewrite them. For users, the script refuses a contract whose stored hash does not recompute, names the file, and changes nothing. Reason: rewriting a contract that is already inconsistent would produce a new hash for content nobody checked, and the user's real problem is an earlier upgrade step that was skipped.

## Not verified

- I did not run `db sign`, `migrate` or `db verify` against a database. The behaviour in section 5 is read from the code.
- Whether introspection plus the new comparison gives an empty difference for every existing database depends on this project's resolver, which does not exist yet.
- The text of the error when the on-disk `db` ref names a hash that is not in the graph.
- Whether any tool outside this repository (the getting-started evaluation, documentation site examples) stores contracts or migrations.
