# Gap check: spec sections 6 and 7 against the repository

Summary (23 rules): 3 true today, 9 partly true, 9 not true, 2 nothing to check.
Not true and no plan task: 6.1 a later release reads everything stored (the files part; the database part is plan task 4); 6.1 no stored format changes unless still readable; 6.2 each stored file records its format version; 6.2 a reader checks the version first; 6.2 rename `schemaVersion`; 6.3 a hash never changes while its content has not; 6.3 the format version is not a storage hash input.
Partly true with no plan task: 6.1 earlier releases read later data when they can; 6.2 a command stops on a record it cannot interpret; 6.3 same content gives the same hash in every release; 6.5 an older migration still applies; 7 the runtime marker check never stops the application, and each failure is a warning.
Covered by plan task 4: every 6.4 rule that is not true today, and the ledger write failure under 6.3.
Checked by reading code on 2026-11-23 at commit f1712a228a. Nothing was run.

## Stored files: what exists today

| File | Written by | Format version | What a reader does with unknown content |
| --- | --- | --- | --- |
| `contract.json` (and each snapshot copy under `migrations/<space>/snapshots/<hash>/`) | `packages/1-framework/3-tooling/emitter/src/emit.ts` | `schemaVersion`, the constant `'1'` (`emit.ts:11`, `:37`) | Rejects any unknown key, at the top level and below: SQL `packages/2-sql-family/1-core/contract/src/validators.ts:552`, MongoDB `packages/2-mongo-family/1-foundation/mongo-contract/src/contract-schema.ts:430`. The value of `schemaVersion` is never compared with anything. |
| `contract.d.ts` | `emit.ts` via `generate-contract-dts.ts` | None | It is TypeScript. It imports helper types from the facade's `/contract-types` entrypoint, so it compiles only while those types stay compatible. |
| `migration.json` | `packages/1-framework/3-tooling/migration/src/io.ts:52-71` | None | Rejects any unknown field (`io.ts:43-50`). The migration is then reported as unloadable and every command that checks integrity refuses (`packages/1-framework/3-tooling/cli/src/control-api/operations/contract-space-aggregate-loader.ts:290-306`). |
| `ops.json` | `io.ts` | None. The file is a bare JSON array, so it has nowhere to put one. | Shallow check only (`packages/1-framework/3-tooling/migration/src/op-schema.ts`); unknown fields pass. PostgreSQL steps carry literal SQL. MongoDB steps are a command tree that `packages/3-targets/mongo/1-target/src/core/migrations/mongo-ops-serializer.ts` rebuilds; an unknown command kind throws (lines 498, 602, 664, 750, 770). |
| `migration.ts` | `packages/1-framework/3-tooling/migration/src/migration-ts.ts` | None | Not read by the runner; it is source the user runs to produce `ops.json`. |
| Ref files `migrations/<space>/refs/<name>.json` | `packages/1-framework/3-tooling/migration/src/refs.ts:290-311` | None | Unknown fields are ignored (`refs.ts:71-79`, no `'+': 'reject'`). `writeRef` writes back only `hash`, `invariants` and `policies`, so rewriting a ref drops any field it did not know. |
| `prisma.config.ts` | The user | None; it is TypeScript code | Outside section 6. Noted only because the brief asked. |

## 6.1 Reading across releases

### "A later release reads everything an earlier release in the major stored: every part of the contract, migration files, contract snapshots, ref files, the marker and the ledger." (6.1)

Status: not true.

Evidence: nothing in the repository makes or checks this promise. The contract readers are strict, and the release candidates have already changed the format in ways older files fail: `test/integration/test/contract-format/supabase-before-dbgenerated-removal.test.ts` asserts that a contract written before columns named their data type is refused. Snapshots and extension contracts are re-hashed on every read (`packages/1-framework/3-tooling/migration/src/contract-snapshot-store.ts:47-75`, `assert-descriptor-self-consistency.ts:48`); the comment at `contract-snapshot-store.ts:55` says a release that changes the hashing rules makes every existing snapshot read as tampered with. Generated `contract.d.ts` depends on the facade's helper types. On PostgreSQL the marker read names its columns (`packages/3-targets/postgres/2-adapter/src/core/control-adapter.ts:652-664`), and the ledger table written before June 2026 lacks columns the current code writes (see 6.4). No test reads files or database records saved from an earlier release; the 55 folders under `test/integration/test/upgrade-instructions/` each test one breaking change and its upgrade, not reading old data unchanged.

Work needed: once the format is frozen at `8.0.0`, save one sample of each stored file and record kind and add tests that the current code reads them, for PostgreSQL and MongoDB. Plan task 4 covers the marker and ledger; nothing in the plan covers the files.

### "No stored format changes except in a way a later release can still read." (6.1)

Status: not true.

Evidence: no check exists. `schemaVersion` stayed `'1'` through format changes such as the one the Supabase fixture test above refuses. Strict validation means any renamed or removed field breaks older files.

Work needed: a test of saved samples (above) is what would catch a change; a rule for reviewers alone would not. No plan task.

### "The reverse is not guaranteed. An earlier release may fail on data a later release stored. It is also not prevented: an earlier release works with such data whenever it can interpret it." (6.1)

Status: partly true.

Evidence: tolerant readers: ref files (`refs.ts:71`), `ops.json` entries (`op-schema.ts`), the PostgreSQL marker and ledger reads (named columns, so extra columns are ignored), the MongoDB marker (`packages/3-targets/mongo/2-adapter/src/core/marker-ledger.ts:20`, `'+': 'delete'`) and MongoDB ledger reads. Strict readers: `contract.json` for SQL and MongoDB and `migration.json` reject any key they do not know, so one added optional field makes every earlier release refuse the file.

Work needed: decide which unknown fields an earlier release may ignore in `contract.json` and `migration.json`, and let the readers ignore them. No plan task.

## 6.2 Format versions

### "Each stored file records the version of its format: the contract, migration files and ref files." (6.2)

Status: not true.

Evidence: only `contract.json` has one (`schemaVersion`, always `'1'`). `migration.json`, `ops.json` and ref files have none (`io.ts:43-50`, `refs.ts:71-75`, sample files in `examples/*/migrations/`). `ops.json` is a bare array and cannot carry one without changing its shape.

Work needed: add a format version field to `migration.json` and ref files (and decide how `ops.json` is covered, for example by the version in `migration.json`). No plan task.

### "A reader checks the version before interpreting the file." (6.2)

Status: not true.

Evidence: `readContractEnvelope` checks only that `schemaVersion` is a string (`packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts:195`). The SQL validator strips it unread (`validators.ts:1146`). The MongoDB schema accepts any string (`contract-schema.ts:432`). The other files have no version to check.

Work needed: every reader of a stored file compares the version first and reports an unknown version as such, before shape validation. No plan task.

### "A command that would modify the database or the user's files from a record it cannot interpret stops with an error, and modifies nothing." (6.2)

Status: partly true.

Evidence: true in most cases, by accident of strict validation. An unreadable `contract.json` or `migration.json` stops the command before any database work, and the error says "validation failed" or "unloadable", not "unknown format version" (`contract-space-aggregate-loader.ts:290-306`). PostgreSQL `db migrate` runs in one transaction (`packages/3-targets/postgres/1-target/src/core/migrations/runner.ts:283`), so a corrupt marker found after the control tables are created (`runner.ts:195-198`) rolls everything back. MongoDB reads the marker before any command (`packages/3-targets/mongo/1-target/src/core/migrations/mongo-runner.ts:1203`) and an unknown command kind throws while the ops are rebuilt. Gaps: a file from a later format that happens to pass validation is interpreted anyway, because no version is checked; and rewriting a ref file (`refs.ts:290-311`, used by `advanceRef`) silently drops fields it did not understand.

Work needed: follows from the two rules above; also make `writeRef` refuse, or keep, fields it does not know. No plan task.

### "The contract's format version field, `schemaVersion` today, is renamed to a name that does not contain 'schema'." (6.2)

Status: not true.

Evidence: `schemaVersion` in `emit.ts:37`, `canonicalization.ts:68`, `hashing.ts:67`, `command-helpers.ts:163`, `validators.ts:1146`, `contract-schema.ts:432`, `packages/2-sql-family/2-authoring/contract-ts/src/data-contract-json-schema.ts:94`, `contract-space-aggregate-loader.ts:361`.

Work needed: rename the field in the writer, the readers and the JSON schema, and give existing files a path to the new name. No plan task.

## 6.3 Hashes

What goes into each hash today. `computeStorageHash`, `computeProfileHash` and `computeExecutionHash` (`packages/1-framework/0-foundation/contract/src/hashing.ts:50-106`) all build a stand-in contract and pass it through `canonicalizeContract` (`canonicalization.ts:255-293`) with `schemaVersion: '1'`, then SHA-256 the pretty-printed JSON. The hashed object holds `schemaVersion`, `targetFamily`, `target`, `profileHash: ''`, empty `roots`, `domain`, `extensions`, `capabilities` and `meta`, plus the section being hashed (`storage`, `capabilities` or `execution`). Namespace `kind` fields are removed from storage first (`hashing.ts:19-37`). The canonicalization drops default values with hard-coded exceptions (`canonicalization.ts:94-180`, including `onDelete: 'noAction'` and `generated: false`), and each family adds its own rules for empty values and storage ordering (`shouldPreserveEmpty`, `sortStorage`). The migration hash (`packages/1-framework/3-tooling/migration/src/hash.ts:88-101`) is SHA-256 over the sorted-key JSON of `migration.json` without `migrationHash`, and of `ops.json`; it has no release-specific input.

### "A hash is a predictable function of content. The same stored content produces the same hash in every release of the major." (6.3)

Status: partly true.

Evidence: each hash is deterministic within a release (`hashing.test.ts` checks stability and key-order independence). Across releases nothing holds it fixed: the storage, profile and execution hashes depend on canonicalization code and family hooks with no version, and no test pins a hash of a fixed stored contract (`packages/1-framework/0-foundation/contract/test/hashing.test.ts` compares hashes only with each other). The migration hash depends only on file content.

Work needed: save a fixed set of contracts with their hashes and test that the current code reproduces them. No plan task.

### "A release that writes different `storage` content for a contract produces a new storage hash. That is acceptable." (6.3)

Status: nothing to check. It permits something. Storage content is an input to the storage hash, so it already holds.

### "A hash must never change while the content it covers has not." (6.3)

Status: not true.

Evidence: any change to `canonicalization.ts`, to a family's `shouldPreserveEmpty` or `sortStorage`, to `omitNamespaceKindsForHash`, or to the `SCHEMA_VERSION` constant changes hashes of unchanged content. `contract-snapshot-store.ts:55` states that such a release would make every existing snapshot read as tampered with. Nothing detects it.

Work needed: the pinned-hash test above, plus either freezing these rules for the major or hashing stored content by the rules of the format version it was written in. No plan task.

### "The contract's format version is not an input to the storage hash. It describes how the JSON is written, not what the database holds." (6.3)

Status: not true.

Evidence: `hashing.ts:14` and `:67` pass `schemaVersion: '1'` into `canonicalizeContract`, which puts it into the hashed object (`canonicalization.ts:261`). The same applies to the profile and execution hashes. Removing it changes every existing storage hash, so existing databases, migrations, snapshots and ref files would need to move to new hashes.

Work needed: drop the field from the hash inputs and provide the move for existing projects and databases. No plan task.

### "The storage hash identifies a contract and connects one migration to the next." (6.3)

Status: true today.

Evidence: `migration.json` `from` and `to` are storage hashes (`io.ts:43-50`); the marker stores it as `core_hash` / `storageHash`; ref files store it as `hash`; snapshots are stored under it (`contract-snapshot-store.ts:44`).

### "The migration hash protects a migration's files against unintended edits." (6.3)

Status: true today.

Evidence: every read recomputes and compares it (`io.ts:256-263`, `hash.ts:113-131`). It also has two other roles today: it identifies a migration when duplicates are removed, and it breaks ties when ordering otherwise equal paths (`packages/1-framework/3-tooling/migration/src/migration-graph.ts:58`, `:72-80`). The spec leaves that to the migrations design document.

### "The ledger is informational: nothing is applied or refused because of it." (6.3)

Status: partly true.

Evidence: no decision reads the ledger. It is read by `migration status`, `migration log` and, to explain a marker mismatch, by `db migrate` through `readLedgerQuietly` (`packages/1-framework/3-tooling/cli/src/control-api/operations/migrate.ts:840`). But writing the ledger row is part of the migration transaction, so when the ledger table is in an older form the whole migration is rolled back (`analysis.md`, "A real database whose ledger table is older"). MongoDB silently skips ledger documents that lack a field (`packages/3-targets/mongo/2-adapter/src/core/migrations/mongo-control-adapter.ts:363-373`).

Work needed: the ledger write stops failing once the table is kept up to date. Covered by plan task 4.

## 6.4 Database records

What exists today. PostgreSQL: schema `prisma_contract` with tables `marker`, `ledger` and `contract`, each created with `IF NOT EXISTS` and never altered (`packages/3-targets/postgres/1-target/src/contract-free/control-bootstrap.ts:43-70`). `db sign` creates only the schema and marker; `db migrate` creates all three (`runner.ts:417-432`). The ledger's columns changed in June 2026 and its `contract_json_before` / `contract_json_after` columns were replaced by the `contract` table in July 2026 (`git show 93f052cce5`). No code in the repository issues `ALTER` against these tables. The marker's `canonical_version` column is always written as null (`control-adapter.ts:480`, `:505`). MongoDB: one collection, `_prisma_migrations`, holding marker documents and ledger documents (`packages/3-targets/mongo/2-adapter/src/core/marker-ledger-collection.ts`); it is never created or indexed explicitly, documents are inserted, and there is no contract collection. SQLite and MySQL have their own control tables, also `IF NOT EXISTS`, still with the older `contract_json_before` / `contract_json_after` ledger columns (`packages/3-targets/sqlite/1-target/src/contract-free/control-bootstrap.ts:32-33`, `packages/3-targets/mysql/1-mysql/1-target/src/contract-free/control-bootstrap.ts:38-39`).

### "No upgrade fails with a database error because they are missing or are in the form an earlier release wrote. The ORM brings them up to date itself, or, for a change that is not additive, stops and names the one command that does." (6.4)

Status: partly true.

Evidence: PostgreSQL, missing: handled. Commands create the tables, and the runtime first checks `information_schema` and reports a missing table as a missing marker (`control-adapter.ts:639-650`). PostgreSQL, older form: not handled. Nothing adds columns, and `db migrate` fails on the ledger insert for a database set up before June 2026; a marker table without a column the read names would fail the same way. No code stops and names a command. MongoDB: a missing collection is not an error, and the readers tolerate missing fields, so no database error arises; but nothing brings older documents up to date either, and an older marker document without a `space` field reads as no marker (`mongo-control-adapter.ts:205-225`).

Work needed: the ORM detects the form of its own tables and either updates it (additive) or stops with one named command. Covered by plan task 4, which names both PostgreSQL and MongoDB.

### "The marker and ledger change additively (they gain columns, rows or fields, and existing ones keep their meaning), or through a command the user runs that states it will change them." (6.4)

Status: not true.

Evidence: the June and July 2026 ledger changes were neither additive for existing tables nor made by a command. No mechanism exists today to make either kind of change.

Work needed: as above. Covered by plan task 4.

### "Either way, the release makes the change to an existing database: it applies an additive change itself, and any other change through that command. The user never edits or drops the marker or ledger by hand." (6.4)

Status: not true.

Evidence: for a PostgreSQL database with the older ledger, the only ways past the failure today are to change or drop the control tables by hand (`analysis.md`).

Work needed: as above. Covered by plan task 4.

### "Where possible they stay usable by the earlier release." (6.4)

Status: partly true.

Evidence: earlier releases read the marker and ledger by naming columns (PostgreSQL) or by tolerant parsing (MongoDB `'+': 'delete'`), so an added column or field does not break their reads. Their writes also name columns (`packages/3-targets/postgres/2-adapter/src/core/marker-ledger.ts:51-60`), so a new column that is `NOT NULL` without a default would break an earlier release's ledger insert. Nothing checks this.

Work needed: a test that an earlier release's reads and writes still work against the current tables, as part of whatever task 4 builds. Covered by plan task 4, which requires any change to these tables to meet section 6.4.

### "The ledger gets no version field of its own." (6.4)

Status: true today.

Evidence: neither the PostgreSQL ledger columns (`control-bootstrap.ts:18-29`) nor MongoDB ledger documents (`mongo-control-adapter.ts:329-341`) have one.

## 6.5 Migrations across a major

### "A migration written by an earlier release in the major still applies." (6.5)

Status: partly true.

Evidence: PostgreSQL ops carry literal SQL and are replayed as written. But applying needs three other things that the current release interprets: `migration.json` must pass its strict schema; the destination snapshot `contract.json` must pass current contract validation and reproduce its storage hash; and the PostgreSQL runner verifies the database against that contract with the current verifier after applying (`runner.ts:219-225`). MongoDB ops are rebuilt by current code (`mongo-ops-serializer.ts:844-853`), so removing or renaming a command kind or field breaks every older migration that uses it. No test applies a migration written by an earlier release.

Work needed: include saved migrations, with their snapshots, in the saved-sample tests and apply them, for PostgreSQL and MongoDB. No plan task.

### "At a new major, users are given a way to carry their migrations forward. They are not asked to delete migrations, and old formats are not read indefinitely." (6.5)

Status: nothing to check. There is no later major yet. The tool is part of plan task 9, which covers the move to a new major through spec section 10.

## 7. Runtime marker check

What exists today. SQL runtime (PostgreSQL, MySQL, SQLite share it): on the first query, unless `verifyMarker: false`, the runtime reads the application space's marker (`packages/2-sql-family/5-runtime/src/sql-runtime.ts:873-880`, `:1608-1640`) and compares the storage hash and, when the contract has one, the profile hash. The PostgreSQL reader is `packages/3-targets/postgres/2-adapter/src/core/adapter.ts:55` calling `readMarkerDiscriminated`. MongoDB runtime: no marker check at all (`packages/2-mongo-family/7-runtime/src/` has none).

### "The check that compares a running application's contract with the database's marker never stops the application." (7)

Status: partly true.

Evidence: a missing marker or a mismatch only logs. A read or decode failure is rethrown (`packages/1-framework/1-core/errors/src/execution.ts:149-171`) out of `verifyMarker`, which fails the user's query; the stored promise is cleared so the next query tries again and fails again until a read succeeds (`sql-runtime.ts:875-878`). On PostgreSQL that includes a marker table missing a column the read names. MongoDB never stops, because it has no check.

Work needed: catch read and decode failures in `verifyMarker` and turn them into warnings. No plan task.

### "A hash mismatch, a marker that cannot be decoded, and a marker that cannot be read each produce a warning." (7)

Status: partly true.

Evidence: mismatch gives `CONTRACT.MARKER_MISMATCH` and a missing marker gives `CONTRACT.MARKER_MISSING`, both as warnings (`sql-runtime.ts:1615-1639`). Undecodable (`CONTRACT.MARKER_ROW_CORRUPT`) and unreadable markers throw instead. MongoDB produces no warning in any case.

Work needed: the same change as above for SQL. Whether MongoDB should gain the check is not stated in the spec. No plan task.
