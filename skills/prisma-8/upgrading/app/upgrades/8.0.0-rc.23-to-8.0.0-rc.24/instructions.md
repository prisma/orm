---
from: "8.0.0-rc.23"
to: "8.0.0-rc.24"
changes:
  - id: engine-pin-moves-to-0-10-0
    summary: |
      The toolchain now requires `@prisma/cli-engine@0.10.0` (up from 0.9.0). A project that depends on `@prisma/cli-engine` itself must move to `0.10.0`. The detection matches every declaration of `@prisma/cli-engine` in a `pnpm-workspace.yaml`, and in a `package.json` that lists an `@prisma/orm-*` package or names the engine in `overrides` or `resolutions`, unless its value is the plain version `0.10.0`, the version the toolchain peers. An exact pin in npm's object form, `{ ".": "0.10.0" }`, is matched too and needs no change.
    detection:
      glob: "**/{package.json,pnpm-workspace.yaml}"
      matches:
        - '(?<![\s\S])(?:(?=\s*\{)(?=[\s\S]*(?:"@prisma/orm-[a-z-]+"\s*:|"(?:overrides|resolutions)"\s*:[\s\S]*@prisma/cli-engine(?:@[^"\s]*)?"))|(?!\s*\{))[\s\S]*@prisma/cli-engine(?:@[^''"\s:]*)?[''"]?\s*:(?!\s*[''"]?0\.10\.0[''"]?\s*(?:[,}\r\n#]|$))'
  - id: prisma-7-commands-answer-v7-command
    summary: |
      A Prisma 7 command the ORM answers, such as `prisma migrate dev`, now fails with `CLI.V7_COMMAND` instead of `CLI.COMMAND_MOVED`, still with exit code 2.
  - id: planner-warnings-json-field
    summary: |
      In `--json` output, `db update` and `db init` list the planner's warnings under `plannerWarnings` instead of `warnings`, as `migration plan` does.
  - id: mongo-fields-take-a-type
    summary: |
      The MongoDB TypeScript builder writes a field as `field.scalar(type.X())`, where `type` holds the type constructors the target and extension packs contribute, as PSL names them: `field.objectId()` is now `field.scalar(type.ObjectId())`, `field.date()` is `field.scalar(type.DateTime())` (on MongoDB `Date` is now a calendar date), `field.vector({ typeParams: { length: 3 } })` is `field.scalar(type.Vector(3))`, and `field.scalar('mongo/string@1')` is `field.scalar(type.String())`. `field.objectId()`, `field.string()`, `field.double()`, `field.int32()`, `field.bool()`, `field.date()`, `field.int64()`, `field.int64Number()`, `field.decimal128()`, `field.binary()`, `field.json()`, `field.bson()`, `field.vector()` and `field.scalar(codecId)` are removed. `type` comes from the `defineContract` callback, or from `@prisma/orm-mongo/contract-builder`. Run `scripts/mongo-type-helpers/rewrite-mongo-field-types.ts` to rewrite them. The contract does not change. The detection matches MongoDB contract sources that call a removed helper.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@prisma/orm-(?:mongo|family-mongo/contract-ts)/contract-builder[\x27"])[\s\S]*(?<![\w$])field\s*\.\s*(?:(?:objectId|string|double|int32|bool|date|int64|int64Number|decimal128|binary|json|bson|vector)\s*\(|scalar\s*\(\s*[\x27"])'
        - '(?<![\s\S])(?=[\s\S]*@prisma/orm-(?:mongo|family-mongo/contract-ts)/contract-builder[\x27"])(?=[\s\S]*\bfield\s*(?:as\s+|:\s*)[A-Za-z_$][\w$]*)[\s\S]*\.\s*(?:(?:objectId|string|double|int32|bool|date|int64|int64Number|decimal128|binary|json|bson|vector)\s*\(|scalar\s*\(\s*[\x27"])'
    script: ./scripts/mongo-type-helpers/rewrite-mongo-field-types.ts
  - id: mongo-date-is-a-calendar-date
    summary: |
      On MongoDB, `Date` is now a calendar date, stored as a BSON date at midnight UTC and read as a string such as `"2024-02-29"`. `DateTime` with no arguments is what `Date` was: an instant read as a JavaScript `Date` (`mongo/date@1`). Rewrite `Date` to `DateTime` in MongoDB schemas and `type.Date()` to `type.DateTime()` in MongoDB TypeScript contracts with `scripts/mongo-convenience-date-time-types/rewrite-mongo-date-types.ts`. The contract does not change.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\s\S])(?![\s\S]*(?<![\w$])datasource[ \t]+\w+[ \t]*\{)(?=[\s\S]*(?:(?<![\w$])ObjectId(?![\w$])|@map\("_id"\)))[\s\S]*\n[ \t]+[A-Za-z_]\w*[ \t]+(?:=[ \t]*)?Date(?![\w$])'
        - '(?<![\s\S])(?=[\s\S]*@(?:prisma/orm-(?:mongo|family-mongo/contract-ts)|internal/mongo)/contract-builder[\x27"])[\s\S]*(?<![\w$])[A-Za-z_$][\w$]*\s*\.\s*Date\s*\('
        - '(?<![\s\S])(?=[\s\S]*[\x27"]@prisma/orm-mongo/config[\x27"])[\s\S]*(?<![\w$])contract\s*:\s*[\x27"][^\x27"]+?(?<!\.ts)[\x27"]'
    script: ./scripts/mongo-convenience-date-time-types/rewrite-mongo-date-types.ts
  - id: temporal-polyfill-is-a-peer-dependency-of-mongo
    summary: |
      `temporal-polyfill` is now a required peer dependency of `@prisma/orm-mongo` and `@prisma/orm-target-mongo`. The MongoDB control plane imports it, because `DateTime(as: temporal)`, `Date(as: temporal)` and `Time(as: temporal)` read `Temporal` values. npm, pnpm and bun install it automatically (npm with `legacy-peer-deps` set does not: see `temporal-polyfill-with-legacy-peer-deps`). A project that installs with Yarn must add `temporal-polyfill` (`^1.0.4`) to its own dependencies.
    detection:
      glob: "**/yarn.lock"
      contains:
        - "@prisma/orm-mongo@"
        - "@prisma/orm-target-mongo@"
      anyMatch: true
  - id: temporal-polyfill-with-legacy-peer-deps
    summary: |
      npm does not install peer dependencies when `legacy-peer-deps` is set, so a MongoDB project that installs with npm and that setting must add `temporal-polyfill` (`^1.0.4`) to its own dependencies, as a Yarn project must. The MongoDB control plane imports it. The setting can come from an `.npmrc`, the user's npm config or the environment, which no file shows, so the detection matches every `package.json` that depends on `@prisma/orm-mongo` or `@prisma/orm-target-mongo`, and the step checks the setting npm uses.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/orm-mongo"'
        - '"@prisma/orm-target-mongo"'
      anyMatch: true
  - id: mongo-validator-change-checks-documents
    summary: |
      A MongoDB validator change that `migration plan` or `db update` writes now checks the documents first, and the apply stops while a document does not fit the new validator. Existing `migration.ts` files are unchanged.
  - id: mongo-type-change-is-asked
    summary: |
      A MongoDB field type change that can lose values is now a question, answered with `--convert` or `--delete`, as on SQL. A cast that keeps every value, such as `Int` to `Int64`, is planned with nothing asked.
  - id: mongo-new-required-field-gets-temporary-value
    summary: |
      A new required MongoDB field is now filled with a temporary value in the documents that lack it, as on SQL, unless `--backfill` names it.
  - id: create-extension-not-exported
    summary: |
      `@prisma/orm-postgres/migration` no longer exports the free function `createExtension`, which a `migration.ts` could not call correctly since 8.0.0-rc.22. A `migration.ts` that imports it now fails at once with `does not provide an export named 'createExtension'`. Call the method on the migration class instead: `createExtension('btree_gist')` becomes `this.createExtension({ extension: 'btree_gist' })`. The migration's `ops.json` does not change, so there is no need to run `node migration.ts` again.
    detection:
      glob: "**/migration.{ts,mts}"
      matches:
        - '(?<![\w$.])createExtension\s*\('
        - '\bimport\s*\{[^}]*(?<![\w$])createExtension(?![\w$])[^}]*\}\s*from\s*[\x27"]@prisma/orm-postgres/migration[\x27"]'
  - id: data-transform-not-exported
    summary: |
      `@prisma/orm-postgres/migration` no longer exports the free function `dataTransform`, which took an internal fourth argument a `migration.ts` cannot pass. A `migration.ts` that imports it now fails at once with `does not provide an export named 'dataTransform'`. Call the method on the migration class instead: `this.dataTransform(endContract, name, { check, run })`. The planner writes the method. The types `DataTransformClosure` and `DataTransformOptions` are still exported.
    detection:
      glob: "**/migration.{ts,mts}"
      matches:
        - '\bimport\s*\{[^}]*(?<![\w$])dataTransform(?![\w$])[^}]*\}\s*from\s*[\x27"]@prisma/orm-postgres/migration[\x27"]'
  - id: raw-parts-hold-statement-asts
    summary: |
      The `parts` of `RawExpr` and `RawQueryAst` (from `@prisma/orm-family-sql/relational-core/ast`) are now `ReadonlyArray<RawPart>`, where `RawPart = string | AnyExpression | SelectAst | InsertAst | UpdateAst | DeleteAst`. A raw template places a builder query, or a builder mutation after `.returning()`, as one statement part. Code that walks `parts` and treats every non-string part as an expression must handle the four statement kinds. The detection matches files that import these nodes and read `.parts`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@prisma/orm-family-sql/relational-core/(?:ast|expression)[\x27"])(?=[\s\S]*(?<![\w$])(?:RawExpr|RawQueryAst|RawPart)(?![\w$]))[\s\S]*\.parts(?![\w$])'
  - id: mysql-explicit-isolation-default
    summary: Configure ReadCommitted explicitly if MySQL callbacks relied on the previous session-wide override.
  - id: postgres-statement-on-lost-client-refused
    summary: |
      The PostgreSQL driver now refuses a statement on a `pg` client that lost its connection with `DRIVER.NOT_CONNECTED` and the message `Postgres connection is no longer usable.` It checks on a pooled connection, on a held connection, and in a transaction or savepoint, including its `BEGIN`, `COMMIT`, `ROLLBACK` and savepoint statements, and before each later step of a cursor. A client has lost its connection once it emitted `error` or `end` after the driver first used it, once a driver gave up on it (for example by destroying the connection of a transaction that ran out of time), or when `pg` marks it ended or broken. Before, such a statement was sent to the client. On a driver given one `pg.Client` that has already lost its connection, a query, and the start of a transaction or held connection, were already refused at 8.0.0-rc.23 with "Postgres connection lost or closed. Create a new client to reconnect.", and still are; the new message comes on a connection or transaction taken before the loss. The driver keeps this state for the client object, so code that recovers by patching the same object, for example by replacing its `query` method, now fails on the next statement: release the client and take a new one from the pool, or create a new `pg.Client`. The detection matches TypeScript and JavaScript sources that import `pg` and assign or define a `query` property, with `.query =`, `['query'] =`, `Object.defineProperty` or `Object.assign`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*(?:from\s*|require\s*\(\s*|import\s*\(\s*)[''"]pg[''"])[\s\S]*(?:\.query\s*=(?![=>])|\[\s*[''"]query[''"]\s*\]\s*=(?![=>])|defineProperty\s*\([^,]*,\s*[''"]query[''"]|Object\.assign\s*\([^,]*,\s*\{[^}]*\bquery\s*[:,}(])'
  - id: contract-artifacts-restamp
    summary: |
      An extension that writes its own package version into the contracts it emits, such as the Supabase extension, now writes 8.0.0-rc.24. Run `contract emit` once after upgrading so the emitted `contract.json` and `contract.d.ts` match the installed extension.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.23"'
---

# 8.0.0-rc.23 → 8.0.0-rc.24 — User upgrade instructions

## Order of the steps

Do the steps in this order, and skip a step that does not apply to the project:

1. Upgrade the Prisma packages. A project that depends on `@prisma/cli-engine` itself moves it to `0.10.0` (`engine-pin-moves-to-0-10-0`). A MongoDB project that installs with Yarn, or with npm and `legacy-peer-deps`, adds `temporal-polyfill` to its dependencies (`temporal-polyfill-is-a-peer-dependency-of-mongo`, `temporal-polyfill-with-legacy-peer-deps`).
2. Change the MongoDB contract sources. Run the field-types script first (`mongo-fields-take-a-type`), then the date-types script (`mongo-date-is-a-calendar-date`). The first script writes `field.date()` as `field.scalar(type.DateTime())`, so the second has nothing left to do for it; the second rewrites `Date` to `DateTime` in MongoDB schemas.
3. Run `prisma contract emit` and commit what it writes. The MongoDB contracts must not change; the only change to expect is the extension version stamp (`contract-artifacts-restamp`).
4. In PostgreSQL `migration.ts` files, call `this.createExtension(...)` and `this.dataTransform(...)` instead of the free functions (`create-extension-not-exported`, `data-transform-not-exported`). Existing `ops.json` files do not change.
5. Change the remaining code: MySQL callback transactions that relied on READ COMMITTED (`mysql-explicit-isolation-default`), PostgreSQL code that reuses a `pg` client after it lost its connection (`postgres-statement-on-lost-client-refused`), code that walks the `parts` of a raw SQL node (`raw-parts-hold-statement-asts`), and scripts that read the CLI's `--json` planner warnings or check for `CLI.COMMAND_MOVED` (`planner-warnings-json-field`, `prisma-7-commands-answer-v7-command`).
6. On MongoDB, the next `migration plan` or `db update` checks documents against a changed validator, asks about field type changes that can lose values, and fills new required fields with a temporary value. Read those three entries before planning the next schema change (`mongo-validator-change-checks-documents`, `mongo-type-change-is-asked`, `mongo-new-required-field-gets-temporary-value`).


## The CLI moves to `@prisma/cli-engine` 0.10.0 and answers Prisma 7 commands with `CLI.V7_COMMAND`

### `engine-pin-moves-to-0-10-0`

For every file matched by `detection`, change each `@prisma/cli-engine` version that is not exactly `0.10.0`, such as `0.9.0`, `^0.9.0`, `>=0.9.0 <0.10.0` or `^0.10.0`, to `0.10.0` and reinstall. The toolchain peers that exact version, so a range that allows any other version, newer ones included, can install an engine it refuses. A package that declares `@prisma/cli-engine` without any `@prisma/orm-*` package, such as a workspace root, keeps its pin only when no package of the workspace uses that pin with the ORM toolchain; when one does, change it too. The detection does not match such a `package.json` unless it also has an `overrides` or `resolutions` field, so check the workspace root by hand. An `overrides` or `resolutions` entry for `@prisma/cli-engine` at the top level, such as npm's `"@prisma/cli-engine": "0.9.0"` or `"@prisma/cli-engine": { ".": "0.9.0" }`, or Yarn's `"**/@prisma/cli-engine"`, pins the engine for every package of the workspace, so change it even in a root `package.json` that lists no `@prisma/orm-*` package. npm refuses an override of a package that the same `package.json` also depends on directly unless both are written the same, so write such a direct dependency the same as the override. An entry scoped under another package applies only there. npm's nested form, `"some-package": { "@prisma/cli-engine": "0.9.0" }`, applies to every copy of the engine below that package: change it when that package is an `@prisma/orm-*` package, such as `@prisma/orm-toolchain`, or depends on one, and leave it otherwise. pnpm's `"some-package>@prisma/cli-engine"` applies to that package's own dependency on the engine: change it when that package is an `@prisma/orm-*` package, and leave it otherwise. A `pnpm-workspace.yaml` matches whatever its packages are, so change its pin only when a package that takes the engine from it also lists an `@prisma/orm-*` package. Projects assembled by the `prisma` CLI resolve the engine automatically.

### `prisma-7-commands-answer-v7-command`

`prisma generate`, `validate`, `format`, `studio`, `db pull`, `db push`, `db seed`, `db execute` and the six `prisma migrate` commands fail with `CLI.V7_COMMAND`. The error names the Prisma 8 commands to run instead and their `--help`, or links the CLI docs when Prisma 8 has no equivalent. A script that checks for `CLI.COMMAND_MOVED` after running one of these commands checks for `CLI.V7_COMMAND` instead.


## The CLI's `--json` output lists planner warnings under `plannerWarnings`

### `planner-warnings-json-field`

A script that reads the planner's warnings from the `--json` result of `db update` or `db init` reads `plannerWarnings` instead of `warnings`. Each entry is unchanged: `kind`, `summary` and `why`. `migration plan --json` lists them under `plannerWarnings` too, and its `warnings` keeps its own messages, such as a default origin that forks the migration graph.


## MongoDB fields take a type from `type`

```ts
// Before
export const contract = defineContract({}, ({ field, model }) => ({
  models: {
    Doc: model('Doc', {
      fields: {
        _id: field.objectId(),
        embedding: field.vector({ typeParams: { length: 3 } }),
        raw: field.scalar('mongo/bson@1'),
      },
    }),
  },
}));

// After
export const contract = defineContract({}, ({ field, model, type }) => ({
  models: {
    Doc: model('Doc', {
      fields: {
        _id: field.scalar(type.ObjectId()),
        embedding: field.scalar(type.Vector(3)),
        raw: field.scalar(type.Bson()),
      },
    }),
  },
}));
```

### `mongo-fields-take-a-type`

Commit your work first. The script reads your code with the TypeScript compiler, so the project needs `typescript` installed; a JavaScript project adds it as a dev dependency for the run. From the project root, run:

```sh
node <path-to-this-guide>/scripts/mongo-type-helpers/rewrite-mongo-field-types.ts
```

Pass files or directories to limit it. The script prints a line for each call it leaves. Rewrite each one by hand, except where the line says the script cannot tell the `field` is the MongoDB builder's and it is not. Then type-check the project. The script neither changes nor reports a `field.scalar` call whose argument is computed, such as `field.scalar(codecIdOf(kind))`, because it cannot tell a codec id from a type there; the type check reports each one that passes a codec id, since `field.scalar` takes only a type now. Where the type check cannot see it, in plain JavaScript or with an argument typed `any`, `contract emit` refuses the call with `CONTRACT.ARGUMENT_INVALID`. Write those with `type.X()`.

A field written with an extension's codec id, such as `field.scalar('shout/text@1')`, is one the script reports: write the type constructor the extension contributes, such as `field.scalar(type.shout.Text())`.

MongoDB PSL gains `Vector` and `Vector(length)` for `mongo/vector@1`, which had no PSL name before. It now reads the arguments of a type call, so `Vector(3)` keeps its length. A type that takes no arguments, written with one, such as `String(5)`, used to have the argument ignored and is now refused with a message naming the argument; remove the argument.


## MongoDB: `Date` is a calendar date, and `temporal-polyfill` is a peer dependency

### `mongo-date-is-a-calendar-date`

```prisma
// Before: an instant
model Order {
  id     ObjectId @id @map("_id")
  paidAt Date
}

// After: the same instant, the same contract
model Order {
  id     ObjectId @id @map("_id")
  paidAt DateTime
}
```

MongoDB now has the convenience date and time types PostgreSQL, SQLite and MySQL have. `Date` is the calendar date, so a field that holds an instant must be written `DateTime`. Commit your work first, then from the project root run:

```sh
node <path-to-this-guide>/scripts/mongo-convenience-date-time-types/rewrite-mongo-date-types.ts
```

It rewrites `Date` to `DateTime` in MongoDB schemas, including in `types {}` aliases, and `type.Date()` to `type.DateTime()` in MongoDB TypeScript contracts. No release had `type.Date()` for an instant, because MongoDB's `type` helpers ship in this release too; the script rewrites it for a contract written against an unreleased build that already had them. Pass files or directories to limit it. Fix by hand each line it reports, then run `prisma contract emit`: the contract must not change.

A field you miss still compiles. Its TypeScript type becomes `string`, and reading a document whose value has a time of day fails with an error that names the field. Worse, `@onCreate(now())` or `@onUpdate(now())` on it writes today's date at midnight UTC, losing the time, with no error, so check every generated timestamp field. A field that really holds a calendar date can stay `Date`, if every stored value is at midnight UTC; it then reads `"2024-02-29"` instead of a `Date`. A Prisma 6 schema read with `prisma6Schema` is not rewritten: its `DateTime` and `DateTime @db.Date` stay instants read as a JavaScript `Date`.

### `temporal-polyfill-is-a-peer-dependency-of-mongo`

For each Yarn project that `detection` matches, add `"temporal-polyfill": "^1.0.4"` to `dependencies` in the `package.json` that depends on `@prisma/orm-mongo` or `@prisma/orm-target-mongo`, then reinstall.

### `temporal-polyfill-with-legacy-peer-deps`

Skip this if the project installs with Yarn (see `temporal-polyfill-is-a-peer-dependency-of-mongo`), pnpm or bun. For a project that installs with npm, run `npm config get legacy-peer-deps` in the folder of each `package.json` that `detection` matches. It reports the setting npm uses there, from any `.npmrc`, the user's npm config or the `npm_config_legacy_peer_deps` environment variable. Where it prints `true`, or the project's install command passes `--legacy-peer-deps`, add `"temporal-polyfill": "^1.0.4"` to that `package.json`'s `dependencies`, then reinstall.


## MongoDB plans rewrite the documents a schema change touches

### `mongo-validator-change-checks-documents`

Every validator change a new plan writes is `collMod(..., { ..., checkDocuments: true })`: as its own precheck, after the plan's rewrites, it checks that every document fits the new validator. When `db migrate` or `db update` stops with `MIGRATION.PRECHECK_FAILED` because documents do not fit:

1. Find them with the `mongosh` query the error prints, and change them so they fit the new validator. The old validator is still in place and may reject a document changed to the new shape, so an update that fixes one can skip document validation: write a `dataTransform` in `migration.ts`, or in `mongosh` run an update command with `bypassDocumentValidation: true`, such as `db.runCommand({ update: "users", updates: [{ q: { _id: … }, u: { $set: { … } } }], bypassDocumentValidation: true })`. Run the command again. For a field the change makes required, `migration plan --backfill Model.field` writes a step to fill it instead.
2. Or, under `db migrate`, apply the validator over them as before: set `checkDocuments` to `false` on that `collMod` in the migration's `migration.ts`, run the file with `node`, and run `db migrate` again. Those documents then fail their next update until they fit. `db update` writes no `migration.ts`, so there the documents must be fixed first.

Operations of the migration that ran before the validator change stay applied; a re-run skips them.

A database adopted from Prisma 6 has no validator, so its first plan adds one and checks every collection.

### `mongo-type-change-is-asked`

Where a plan now asks about a field, answer with `--delete Model.field`, which casts the values with `$convert` and fails on a value it cannot cast (a change such as `String` to `Boolean`, where `$convert` would turn `"false"` into `true`, has no cast and offers `--convert` only), or plan it with `migration plan --convert Model.field` and write the update in the `placeholder('Model.field:update')` slot of the data transform it writes.

### `mongo-new-required-field-gets-temporary-value`

To write your own value instead of the temporary one, plan the change with `migration plan --backfill Model.field` and write the update in the `placeholder('Model.field:update')` slot of the data transform it writes. A new required field under a unique index gets no temporary value, since every document would get the same one: on a collection with documents, the unique index build stops the apply first, because the documents that lack the field all hold `null`, and its error names `--backfill`. Plan it with `--backfill`.


## `createExtension` and `dataTransform` are no longer free functions

### `create-extension-not-exported`

`@prisma/orm-postgres/migration` no longer exports `createExtension`. Since 8.0.0-rc.22 the free function took an internal argument that only the migration class can supply, so a `migration.ts` that called it failed with `Cannot read properties of undefined (reading 'lowerToExecuteRequest')`. Now the import fails at once instead.

In every `migration.ts` the detection matches, call the method and remove `createExtension` from the import:

```ts
// Before
import { createExtension, Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

override get operations() {
  return [createExtension('btree_gist'), ...];
}

// After
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

override get operations() {
  return [this.createExtension({ extension: 'btree_gist' }), ...];
}
```

Without `schema`, the method creates the extension where the old function did: in the connection's current schema, unless the extension's control file names one. The migration's `ops.json` does not change, and there is no need to run `node migration.ts` again: `prisma db migrate` applies `ops.json` and does not load `migration.ts`.

### `data-transform-not-exported`

`@prisma/orm-postgres/migration` no longer exports the free function `dataTransform`. It took an internal fourth argument that only the migration class can supply, so a `migration.ts` could not call it correctly. Remove `dataTransform` from the import and call `this.dataTransform(endContract, name, { check, run })`, as the planner writes it. The types `DataTransformClosure` and `DataTransformOptions` are still exported.


## Raw parts can hold a statement AST

### `raw-parts-hold-statement-asts`

`RawExpr.parts` and `RawQueryAst.parts` used to hold strings and expression nodes. They now hold `RawPart`, which adds `SelectAst`, `InsertAst`, `UpdateAst` and `DeleteAst`: a builder query interpolated into `db.raw.sql` or `fns.raw` lands in the parts as its statement AST. A `RawQueryAst` interpolated into another raw template is still spread into the outer parts, so it never appears as a part.

In every file the detection matches, find each walk over `parts` that sends a non-string part to an expression handler, and give the statement kinds their own branch. Each statement AST has `kind` `'select'`, `'insert'`, `'update'` or `'delete'`, which no expression kind uses. A renderer renders a statement part with the function it uses for that statement at top level, with no parentheses:

```ts
// Before
parts.map((part) => (typeof part === 'string' ? part : renderExpr(part, ctx))).join('');

// After
parts
  .map((part) => {
    if (typeof part === 'string') {
      return part;
    }
    switch (part.kind) {
      case 'select':
        return renderSelect(part, ctx);
      case 'insert':
        return renderInsert(part, ctx);
      case 'update':
        return renderUpdate(part, ctx);
      case 'delete':
        return renderDelete(part, ctx);
      default:
        return renderExpr(part, ctx);
    }
  })
  .join('');
```

A walker that only needs parameters can call `part.collectParamRefs()` on every non-string part, since the statement ASTs have it too. `RawQueryAst.collectParamRefs()` and `rewrite()` already reach into statement parts.

`ExpressionFolder` has a new optional `mutation` arm, called for an INSERT, UPDATE or DELETE part of a `RawExpr`, beside the `select` arm called for a SELECT part. A folder that leaves it out gets `empty` for a mutation part, so existing folders compile unchanged; add the arm where a mutation's contents matter.


## Preserve an intentional MySQL callback isolation choice

### `mysql-explicit-isolation-default`

MySQL no longer sets every session to READ COMMITTED. Unconfigured explicit callback transactions now use the server/session default. If application code relied on the previous override, add `transactionOptions: { isolationLevel: 'ReadCommitted' }` to its MySQL client factory, or pass `{ isolationLevel: 'ReadCommitted' }` as the second argument to the relevant `transaction(callback, options)` calls.

You can also import `{ IsolationLevel }` from `@prisma/orm-mysql/runtime` and use `IsolationLevel.ReadCommitted` in either position. This optional constant syntax does not require migrating existing strings.

A defined per-call level overrides the factory level. An omitted or undefined level inherits it; null does not reset defaults and is rejected. ORM-owned implicit transactions continue to use ReadCommitted, independently of callback options. Manual lower-level transactions do not inherit factory defaults.

Verify behavior against the deployment's configured database default and concurrent transactions. Do not assume the server default is RepeatableRead. This change does not introduce batch transactions, timeout/maxWait options, P2028 handling or retry behavior.


## PostgreSQL: a statement on a `pg` client that lost its connection is refused

### `postgres-statement-on-lost-client-refused`

The PostgreSQL driver now checks whether a `pg` client has lost its connection before it sends a statement on a pooled connection, on a held connection, and in a transaction or savepoint, including its `BEGIN`, `COMMIT`, `ROLLBACK` and savepoint statements, and before each later step of a cursor, and refuses the statement with `DRIVER.NOT_CONNECTED` and the message `Postgres connection is no longer usable.` if so. A client has lost its connection once it emitted `error` or `end` after the driver first used it, once a driver gave up on it (for example by destroying the connection of a transaction that ran out of time), or when `pg` marks it ended or broken. Before this release, such a statement was sent to the client whatever its state. On a driver given one `pg.Client` that has already lost its connection, a query, and the start of a transaction or held connection, were already refused at 8.0.0-rc.23 with "Postgres connection lost or closed. Create a new client to reconnect.", and still are; the new message comes on a connection or transaction taken before the loss.

The driver records the loss against the client object, and nothing clears it. Code that recovers from a lost connection by patching the same client object stops working. For example, a pool wrapper that retries a failed first statement on a new connection by replacing `client.query` on the checked-out client: the retried statement succeeds inside the replaced `query`, and the next statement the driver sends on that client rejects with `DRIVER.NOT_CONNECTED`.

In each file the detection matches, check whether the code changes a `pg` client it gave to Prisma 8, or a client of a pool it gave to Prisma 8, to recover from a lost connection. If it does, release the lost client and take a new one from the pool instead (`client.release(error)`, then `pool.connect()`), or create a new `pg.Client`, and let the work run on the new client. A file that patches a client without importing `pg`, or that wraps the client in a `Proxy`, is not found; check pool wrappers by hand. Code that does not reuse a lost client needs no change.


## `contract-artifacts-restamp`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. This entry accounts for the extension's embedded `version` moving to `8.0.0-rc.24`; any other difference in the emitted files comes from an earlier entry in this guide.
