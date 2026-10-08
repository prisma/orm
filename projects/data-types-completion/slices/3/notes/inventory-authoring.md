## Inventory: tagged date/time literals, SQLite datetime/json data types, verify through codecs, Prisma 7 reader

All paths are relative to `/Users/will/Projects/prisma/orm/.claude/worktrees/data-types-value-ownership-7ec585`. I edited nothing. Two design docs are already staged under `projects/data-types-completion/value-ownership/`.

### 1. Text casts

The cast machinery lives in `packages/1-framework/1-core/framework-components/src/shared/data-type.ts` (`casts` at :54, `dataType()` at :92). A cast is applied in `written-value.ts:220-242` (`castTypedValue`). Assembly also requires every cast source to be writable (`control-stack.ts` around :540).

**Casts from `pg/text`** (`packages/3-targets/3-targets/postgres/src/core/data-types.ts`):

| Type | Line | Cast | Parses? |
|---|---|---|---|
| `pg/char`, `pg/varchar` | :209-231 | `fromText` | no (`unchanged`) |
| `pg/inet` | :253 | `fromText` | no |
| `pg/bit`, `pg/varbit` | :259, :270 | `fromText` | no |
| `pg/uuid` | :235-251 | `asUuid` | **yes** – rewrites to PostgreSQL's spelling; your list doesn't include it, please decide |
| `pg/timetz`, `pg/interval`, `pg/bytea`, `pg/date`, `pg/time`, `pg/timestamp`, `pg/timestamptz` | :359-410 | all built by `typeCanonicalFromText` (:350-357): `casts: { [pgText.id]: toCanonicalForm }` | **yes** |

- Removing those seven casts is one edit at :356; `toCanonicalForm` must stay.
- `postgis/geometry` (`packages/3-extensions/postgis/src/core/data-types.ts:21`) takes text unchanged. `pgvector` has only a `listCast` from the integer types.

**Casts from `sqlite/text`** (`packages/3-targets/3-targets/sqlite/src/core/data-types.ts`): `sqlite/blob` :44, `sqlite/character` :59 and `sqlite/character-varying` :66, all `unchanged`. `sqlite/blob` is SQLite's bytes type and today takes any quoted string; the plan only names Postgres `bytea`.

**What happens once the casts go.** A quoted string falls through to `no-cast`. `exactRewrite` (`written-value.ts:126-137`) then already suggests the rewrite, e.g. "write ``date`...` ``", as soon as the type has a tag entry.

**Tests that write a quoted date/time/bytes default in Prisma 8 PSL: 18 files.**
- Package tests (3):
  - `packages/3-targets/3-targets/postgres/test/psl-infer/inferred-psl/inferred-psl.literal-defaults.test.ts` :114, :115, :166, :258
  - `.../inferred-psl/inferred-psl.data-type-defaults.test.ts` :152 (`"infinity"` sentinels), :184-186 (bytea)
  - `packages/2-sql/9-family/test/psl-build/default-mapping.test.ts` :332-333
- Integration tests (12):
  - `test/integration/test/date-time-defaults/psl-date-time-defaults.integration.test.ts`
  - `test/integration/test/date-time-defaults/sqlite-date-time-defaults.integration.test.ts`
  - `test/integration/test/cli-journeys/date-time-default-canonical-form.e2e.test.ts`
  - `test/integration/test/cli-journeys/control-plane-commands-without-temporal.e2e.test.ts`
  - `test/integration/test/control-plane-libraries-without-temporal.e2e.test.ts`
  - `test/integration/test/cli-journeys/migration-ts-column-defaults.e2e.test.ts`
  - `test/integration/test/cli-journeys/bytea-defaults.e2e.test.ts` :36-38, :194-195
  - `test/integration/test/cli-journeys/infer-roundtrip-fidelity.prisma7-defaults.e2e.test.ts` :224-240, :322
  - `test/integration/test/cli-journeys/infer-roundtrip-fidelity.brace-array-defaults.e2e.test.ts` :72
  - `test/integration/test/cli-journeys/infer-roundtrip-fidelity.e2e.test.ts` :341
  - `test/integration/test/authoring/defaults-on-existing-tables.integration.test.ts`
  - `test/integration/test/authoring/psl.sqlite-written-values.test.ts` :100
- Fixture schemas (3):
  - `test/integration/test/authoring/parity/default-date-time-types/schema.prisma`
  - `test/integration/test/authoring/parity/default-date-time-sqlite/schema.prisma`
  - `test/integration/test/date-time-defaults/_fixture-before-canonical-form/contract.prisma` (this one is deliberately old-form)

**Tests that assert the casts directly:**
- `packages/3-targets/3-targets/postgres/test/data-types.test.ts`
- `.../postgres/test/bytea-canonical-form.test.ts`
- `.../postgres/test/date-time-canonical-form.dates.test.ts`
- `packages/3-targets/3-targets/sqlite/test/data-types.test.ts`
- `packages/3-targets/6-adapters/postgres-codec-testkit/test/uuid-input.integration.test.ts`

### 2. Committed schemas and docs

- **`examples/`, `apps/`, `skills-contrib/`, `docs/reference`:** none.
- **Prisma 8 `.prisma` sources:** 3, the fixture schemas listed in section 1.
- **Prisma 7 sources, which stay quoted because that is Prisma 7 syntax:** 6.
  - `packages/2-sql/2-authoring/contract-prisma7/test/fixtures/{datetime-defaults,defaults,list-defaults}/schema.prisma` (16, 2 and 7 lines)
  - `test/integration/test/fixtures/prisma7-source/{reference,supported,supported-verify}/schema.prisma` (9 lines each)
- **Docs with quoted date defaults:** all historical, probably leave them alone.
  - `CHANGELOG.md` :256, :265
  - `docs/releases/v8.0.0-rc.14.md` :32, :41
  - `docs/architecture docs/adrs/ADR 184 ...md` :78
  - `skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.5-to-8.0.0-rc.6/instructions.md` and `.../8.0.0-rc.13-to-8.0.0-rc.14/instructions.md`
  - `upgrade-instructions/releases/8.0.0-rc.13-to-8.0.0-rc.14/.../date-time-default-canonical-form/app/instructions.md`
- **ADR 254 needs editing:** :106 (sqlite datetime codec represents `sqlite/text`) and :212 (the `json` tag yields `sqlite/text`). Also `docs/reference/scalar-types.md`, `docs/reference/codec-authoring-guide.md` and `docs/reference/error-reference.md`.
- **TypeScript contracts passing a string default to a date column.** These go through the codec, not the casts, and are valid for the `*String` and `timetz` codecs:
  - `test/integration/test/authoring/parity/default-date-time-types/contract.ts:22`
  - `test/integration/test/fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/contract-date-time-defaults.ts:19-23`
  - `test/e2e/framework/test/fixtures/contract.ts:119` (raw `{kind:'literal', value:'2024-01-15 10:30:00+00'}`)
  - `packages/3-extensions/postgres/test/contract-builder/default-input-type.test-d.ts:48,73,81,95` and `packages/3-extensions/sqlite/test/contract-builder/default-input-type.test-d.ts:12` (`@ts-expect-error` cases)

### 3. Tags

**How tags are registered.**
- `sql` comes from `packages/2-sql/1-core/contract/src/sql-expression.ts:16-21`; the family registers it at `packages/2-sql/9-family/src/core/control-descriptor.ts:36`.
- Postgres `json` is `packages/3-targets/3-targets/postgres/src/core/data-type-entries.ts:75-79`, under `pg/json`. It is contributed via `descriptor-meta.ts:26` and also used at `psl-infer/postgres-default-mapping.ts:8`.
- SQLite `json` is `packages/3-targets/3-targets/sqlite/src/core/data-type-entries.ts:46-56`, under `tagEntryKey('json')` with `type: sqliteText.id`; contributed via `descriptor-meta.ts:14`.

**Entry shape.** `DataTypeWrittenForm` is at `framework-authoring.ts:558-584`: the tag arm is `{kind:'tag', tag, type?, parse}`. `DataTypeAuthoringEntry` (:591), `tagEntryKey` / `isTagEntryKey` / `authoringEntryType` (:604-619) and the key rule (`control-stack.ts:504-521`) exist only for the SQLite `json` case. Once `sqlite/json` is a data type, its entry can sit under its own id and `type?` / `tagEntryKey` lose their only user.

**Language server.** `packages/1-framework/3-tooling/language-server/src/completion-values.ts:150-161` reads `type.tags` from the `taggedLiteral` arm. The arms are built in `packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts:208-250` (`scalarDefaultArms`): one arm per distinct documentation, offered for every column regardless of type (`anyTag`). Seven new Postgres tags would all be offered on every column.

**Expected-arm strings in tests.** These quote the list of admitted forms and will change: 25 occurrences of ``json`...` ``, e.g. `contract-psl/test/sql-attribute-specs.test.ts:367` and `interpreter.defaults.tagged-literal.test.ts:141`.

**`docs/reference/psl-editor-tooling-tagged-literals.md`.** :13 says "Every SQL target registers `json`"; it needs the new tags. Hover and highlighting are still marked not done.

**Where `contract infer` and `contract print` print date and bytea defaults today.**
- Both go through `mapDefault` in `packages/2-sql/9-family/src/core/psl-build/default-mapping.ts:57`.
- `writeScalar` (:202-222) tries the plain string first (`pg/text`), then admits it through the text cast (:146-159). So dates and bytea print as quoted strings, e.g. `@default("aGVsbG8=")` and `@default("infinity")`.
- Infer calls it at `postgres/src/core/psl-infer/infer-model-blocks.ts:398-429`; print calls it at `postgres/src/core/psl-print/column-defaults.ts:59`.
- Once the casts are gone, a date default only prints if its type has a tag entry. Otherwise it falls back to `sql`, or print refuses it (`refuseUnwritableLiteralDefault`).
- SQLite has no infer or print.

### 4. SQLite

**Where the names appear in source.**
- `codec-ids.ts:11-12` and `exports/codec-ids.ts`.
- `codecs.ts`:
  - `sqliteDatetimeCanonical` :525
  - `decodeSqliteDatetime` / `encodeSqliteDatetime` :537-552
  - `SqliteDatetimeCodec.encodeJson` :566 writes the canonical form with trailing zeros stripped (`timeText`, `date-time-canonical-form.ts:167`)
  - `datetimeCanonicalForm` :582
  - `SqliteDatetimeDescriptor` :590 (`toCanonicalForm`, `dataType = sqliteText.id`)
  - `SqliteJsonCodec` :613 (`encodeJson` → `canonicalizeJson` :627)
  - `jsonTextCanonicalForm` :654-667
  - `SqliteJsonDescriptor` :673 (`dataType = sqliteText.id`)
  - the JSON retag `JSON_RETAG_FN` :130-160
- `type-constructors.ts:50,55`, `authoring.ts:23,26`, `aggregates.ts:31-33,121-122`, `contract-free/columns.ts:24-25`.
- `migrations/planner-ddl-builders.ts:22-23,67-68` (datetime branch).
- `data-type-entries.ts:46` (`tagEntryKey('json')`).
- `native-type-normalizer.ts:7` (`normalizeSqliteNativeType` = trim + lowercase); used in the adapter at `control-adapter.ts:571`, exported at `exports/control.ts:40`.
- Adapter: `column-types.ts:28,32`, `marker-ledger.ts:64`.
- `valueObjectStorageType`: SQLite `'Json'` at `6-adapters/sqlite/src/exports/control.ts:16`; Postgres `'Jsonb'` at `6-adapters/postgres/src/exports/control.ts:17`. Resolved in `contract-psl/src/psl-field-resolution.ts:422-505` and checked in `9-family/src/core/contract-stack-checks.ts:63-83`.
- `contract-psl/src/value-object-default.ts:57`.
- The only two codec-level `toCanonicalForm` overrides are `codecs.ts:594` and `:677`. After the move, `CodecDescriptor.toCanonicalForm` (`codec-descriptor.ts:55,126`) and the codec branch of `canonicalFormOf` (:79) are dead.

**Committed SQLite `contract.json` files using these codecs: 13.**
- Without a literal default (4):
  - `examples/prisma-8-demo-sqlite/src/prisma/contract.json` (has a `now()` function default only)
  - `packages/3-targets/3-targets/sqlite/test/fixtures/sqlite-contract.json`
  - `test/e2e/framework/test/sqlite/fixtures/generated/contract.json`
  - `test/integration/test/planner-golden/fixtures/sqlite/generated/contract.json`
- With a literal default (9):
  - `test/integration/test/authoring/parity/default-date-time-sqlite/expected.contract.json`: `"2024-01-01T00:00:00.5Z"`, which becomes `.500Z`.
  - 8 upgrade-instruction fixtures under `test/integration/test/upgrade-instructions/data-type-in-contract/fixtures/{sqlite-defaults,sqlite-json-enums}/{before,after}/…` (the `src/prisma` or `prisma` contract plus one snapshot each). They hold json defaults: before = documents, after = JSON text.

**Load check.** `contract-stack-checks.ts:52-55` refuses a column whose codec represents a different data type. Every existing SQLite contract with `dataType: "sqlite/text"` on these codecs would therefore be refused, so this needs a new upgrade guide plus re-emission (new hashes).

### 5. Verify and planner

**Default comparison path.**
1. The contract side is built in `packages/2-sql/9-family/src/core/migrations/contract-to-schema-ir.ts:69-133`. It calls `resolveDefault(raw, resolvedNativeType)` (:99-102), `renderDefault` (:110) and `toCanonicalForm = canonicalFormOf(codec, …)` (:131).
2. The hooks are:
   - Postgres: `postgresResolveDefault` (`postgres/src/core/default-normalizer.ts:554-562`), `postgresRenderDefault` (`migrations/postgres-contract-to-schema.ts:12-21`).
   - SQLite: `sqliteResolveDefault` (`sqlite/src/core/default-normalizer.ts:110-118`), `sqliteRenderDefault` (`migrations/diff-database-schema.ts:34-42`).
3. The database side:
   - `parsePostgresDefault` (`default-normalizer.ts:463-541`) has per-native-type branches: bytea `storedText` :254-255 → `byteaInputBase64`; JSON :519-523; numeric/int :151. It is called from the Postgres adapter at `control-adapter.ts:1141`.
   - `parseSqliteDefault` (`sqlite/.../default-normalizer.ts:53-102`) is called at `control-adapter.ts:582`.
4. Comparison: `SqlColumnDefaultIR.isEqualTo` (`schema-ir/src/ir/sql-column-default-ir.ts:104-125`) → `resolvedDefaultsEqual` (`resolved-default-equality.ts:20-40`, normalisation :81-102) → `defaultInCanonicalForm` (`default-in-canonical-form.ts:20-53`).
5. Refusal: `explainMismatch` (`sql-column-default-ir.ts:129-135`) → `contractDefaultRefusal` (`default-in-canonical-form.ts:59-69`). That is also used for DDL in `postgres/.../migrations/column-ddl-rendering.ts:82` and `sqlite/.../column-ddl-rendering.ts:65` (`plannableDefault`).
6. The framework hook is `schema-diff.ts:95,119,217`.

**Type comparison path.**
- `SqlColumnIR.isEqualTo` (`sql-column-ir.ts:164-175`) compares the `resolvedNativeType` strings (:194-195). So do `postgres/.../issue-planner.ts:380`, `sqlite/.../issue-planner.ts:119` and `sqlite/.../operations/tables.ts:315`.
- Postgres normalisation: `normalizeSchemaNativeType` (`postgres/src/core/native-type-normalizer.ts:37`), `introspectedNativeType` (:74), `normalizeFormattedType` (:108). SQLite: `normalizeSqliteNativeType`.
- The contract side gets the name from `schemaTypeText(dataType, …)`.
- Data type ids are compared directly in three places:
  - `9-family/src/core/migrations/field-event-planner.ts:199` (`sameStorageColumn`; moving datetime/json to new data types would mark those columns `altered`)
  - `sql-contract/src/validators.ts:1018-1023` (`sameStorageType`, junction/foreign-key check at :1125)
  - `postgres/src/core/psl-print/refusals.ts:382`
- For re-adding `sqlite/datetime` and `sqlite/json`: give them a written-only `text` (no `catalog: true`), as before b32ec30b6d. Otherwise `findSqlDataTypeCollision` (`sql-data-type.ts` around :500) refuses two types claiming catalog text `text`.

**Async or sync.**
- Introspection is async: `postgres control-adapter.ts:703` and `sqlite control-adapter.ts:530`. Both receive an optional `contract`; SQLite ignores it. Calling an async `decode` there is feasible.
- `verifySchema` is **synchronous** (`9-family/src/core/control-instance.ts:238-243`, returns `VerifyDatabaseSchemaResult`), and so are `diffSchemas` (`schema-diff.ts:145`), `diffPostgresSchema` / `diffSqliteSchema` and `isEqualTo`.
- `inferPslContract` is sync (control-instance :270).
- So a `decode`-based comparison has to happen during introspection, which would need the codec lookup and contract, or in a new async pre-pass, or by making `verifySchema` async.
- Postgres introspection pins `DateStyle`, `IntervalStyle` and `bytea_output` (`control-adapter.ts:1675-1724`), so the text inside a raw default literal matches the wire text a codec decodes.
- `pg/date` and `pg/timestamp*` hold `infinity` (`data-types.ts:293-307`), which the Temporal codecs cannot decode.

**Default rendering.**
- Sync: the IR-side `renderDefaultLiteral` (`postgres/.../planner-ddl-builders.ts:64-91`, `sqlite/.../planner-ddl-builders.ts:56-82`).
- Async: the actual DDL goes through `lowerer.renderColumnDefault` (`postgres/.../operations/columns.ts:221`, `sqlite/.../operations/shared.ts:110`) to `pgRenderDdlColumnDefault` (`6-adapters/postgres/src/core/control-adapter.ts:1812-1891`) and `sqliteRenderDdlColumnDefault` (`6-adapters/sqlite/.../control-adapter.ts:780-805`), which call codec `encode` via `encodeLiteralDefault`.

**Planner branches on codec or data type id for defaults.**
- `postgres/.../planner-ddl-builders.ts:18,68` (`JSON_DATA_TYPES`), :81 (`postgresDateTimeDdlText`).
- `postgres/src/core/date-time-ddl-text.ts:3-38` (`DATE_TIME_TYPES`, `TYPES_WITH_A_YEAR`; BC / large-year rewriting).
- `6-adapters/postgres/.../control-adapter.ts:1843,1886` (`isPostgresDateTimeDataType`).
- `sqlite/.../planner-ddl-builders.ts:58` (`sqliteInteger.id`), :67 (`SQLITE_DATETIME_CODEC_ID` → `encodeSqliteDatetime`). This branch becomes unnecessary once the contract form is `toISOString()` text.

### 6. Prisma 7 reader

- `literalDefaultForm` is at `packages/3-targets/3-targets/postgres/src/core/prisma7-binding.ts:70-93`:
  - JSON → `{kind:'json'}`.
  - `pg/bytea` → `sqlExpression` (base64 → `'\x…'`, `ARRAY[...]::BYTEA[]`).
  - Timestamp, timestamptz, date, time and timetz → `sqlExpression` via `storedTemporalText`.
  - The doc comment at :43-51 gives the reason: avoiding a hash change (TML-3455).
- `prisma7-temporal-defaults.ts:46` `storedTemporalText`: `date` keeps the written date and drops the time; `time`/`timestamp` drop the offset; `timestamptz` becomes UTC text. Prisma 7 writes `DateTime @default("2024-…T…Z") @db.Date`, which a `date` tag parse that refuses a time component would reject, so this needs its own mapping. Tests: `postgres/test/prisma7-temporal-defaults.test.ts` (92 rows).
- The type is `Prisma7LiteralDefaultForm` (`contract-prisma7/src/target-binding.ts:13-23,54`), called at `interpreter.ts:1152`. It is consumed in `contract-prisma7/src/defaults.ts`:
  - `lowerPrisma7Default` :111-127: a `sqlExpression` form gives `{kind:'function'}`.
  - `sqlExpressionDefault` :246-266.
  - `writtenLiteral` :269-283: a string becomes `{kind:'string'}`, or `{kind:'tag', tag:'json'}`.
  - Once the casts go, a string on a date column has no path except the tag.
- Fixtures with date or bytes defaults: the 6 Prisma 7 schemas in section 2. Committed contracts storing them as `function` kind: **3 files, 25 columns**, `packages/2-sql/2-authoring/contract-prisma7/test/fixtures/{datetime-defaults (16), defaults (2), list-defaults (7)}/expected-contract.json`. Inline expectations are in `contract-prisma7/test/defaults.test.ts:26-58`. `examples/prisma7-adoption` has none.
- Only Postgres has a Prisma 7 binding; SQLite has none.

### 7. Mongo

Not affected.
- `packages/3-mongo-target/1-mongo-target/src/core/data-types.ts:1-5` says none of its types casts and none is written in a contract source.
- No `toCanonicalForm`, no casts and no authoring entries (only `descriptor-meta-runtime.ts:22` registers data types).
- `contract-prisma6/src/interpreter.ts:172` reads only `auto()` / `now()`.
- Only one test is cosmetically related: `contract-psl/test/provider.interpret.test.ts:266` (`String @default("now")`).

### 8. Prior art: b32ec30b6d (TML-3388, PR #30576)

The pre-commit `packages/3-targets/3-targets/sqlite/src/core/data-types.ts` declared:
- `sqliteJson = writtenAs('sqlite/json','text')` (written-only text).
- `sqliteDatetime = sqlDataType('sqlite/datetime', { texts:[{text:'text', written:true}], toCanonicalForm, casts:{[sqliteText.id]: datetimeCanonicalForm} })`.
- `sqliteBigint` as well.

Hand-written files it touched for these types (counts of matching hunk lines):
- SQLite target:
  - `sqlite/src/core/{data-types.ts, codecs.ts, data-type-entries.ts, migrations/column-ddl-rendering.ts}` and `README.md`
  - tests: `sqlite/test/{datetime-canonical-form, data-types, data-type-declarations, codec-strictness, sqlite-built-in-codec-descriptors, json-canonical-form, data-type-inventory, data-type-entries, data-type-authoring-tags, migrations/column-ddl-rendering}.test.ts`
- Framework components:
  - `framework-components/src/{control/control-stack.ts, shared/codec-descriptor.ts, shared/framework-authoring.ts, exports/authoring.ts}` (`tagEntryKey`, codec `toCanonicalForm`)
  - tests: `framework-components/test/{data-type-assembly, canonical-form-of}.test.ts`
- Schema IR and SQL family:
  - `schema-ir/src/ir/{sql-column-default-ir, sql-column-ir, resolved-default-equality}.ts` and `schema-ir/test/sql-column-default-ir.test.ts`
  - `9-family/src/core/{psl-build/default-mapping.ts, migrations/contract-to-schema-ir.ts}` and `contract-psl/src/data-type-default.ts`
- Postgres: `postgres/src/core/migrations/column-ddl-rendering.ts`, `postgres/src/core/psl-infer/infer-model-blocks.ts`
- Codec testkits: `6-adapters/{sqlite,postgres}-codec-testkit/src/index.ts`
- Docs: ADR 254, `docs/reference/{codec-authoring-guide, scalar-types, error-reference}.md`
- Upgrade script: `upgrade-instructions/.../data-type-in-contract/*/scripts/data-type-in-contract.ts:96-97`, which maps `sqlite/json@1` and `sqlite/datetime@1` to `sqlite/text` (now released in rc.15). Plus `test/integration/test/upgrade-instructions/data-type-in-contract/generate-fixtures.ts`.

The commit also regenerated about 1,070 contracts, snapshots and `contract.d.ts` files.

### Mechanical vs design judgment

**Mechanical fan-out:**
- Deleting the seven text casts (one line).
- Adding tag entries in `postgres/src/core/data-type-entries.ts`, with parse = the existing `pg*Canonical` and print = identity.
- Rewriting the 18 test files and 3 fixture schemas to tags, and updating the 25 expected-arm strings.
- Restoring `sqlite/datetime` and `sqlite/json` as data types from b32ec30b6d~1, moving both codecs' `toCanonicalForm` onto them, and deleting the codec-level `toCanonicalForm`, the `canonicalFormOf` codec branch, `tagEntryKey` and `type?`.
- Switching the SQLite datetime form to `toISOString` and dropping the planner branch at `planner-ddl-builders.ts:67`.
- Re-emitting the 13 SQLite contracts and their `.d.ts` / snapshots.
- Doc edits.

**Needs design judgment:**
- Whether `pg/uuid`'s parsing cast and SQLite `blob`'s text cast go too.
- How `infinity` and BC dates are written in a tag.
- Whether completion offers only the tags a column's type admits.
- The upgrade path for SQLite contracts that the load check would refuse (`contract-stack-checks.ts:55`), plus the `altered` event from `field-event-planner.ts:199`.
- Where the async codec `decode` runs, given that `verifySchema`, `diffSchemas` and `inferPslContract` are sync. That also covers what "wire" means for a raw SQL default, Temporal codecs that cannot decode `infinity`, and introspection without a contract.
- Replacing the native-type branches in `parsePostgresDefault`.
- What "column storage" equality means for `sameStorageType` and `sameStorageColumn`.
- The Prisma 7 mapping: `@db.Date` with a time, `@db.Time` with a date, and the contract-hash change TML-3455 avoided.
- Whether infer and print fall back to `sql` for types without a tag.

