---
from: "8.0.0-rc.23"
to: "8.0.0-rc.24"
changes:
  - id: engine-pin-moves-to-0-10-0
    summary: |
      The toolchain now peers `@prisma/cli-engine@0.10.0` (up from 0.9.0). An extension package that depends on `@prisma/cli-engine` for its tests or tooling must move to `0.10.0`. The detection matches every declaration of `@prisma/cli-engine` in a `pnpm-workspace.yaml`, and in a `package.json` that lists an `@prisma/orm-*` package or names the engine in `overrides` or `resolutions`, unless its value is the plain version `0.10.0`, the version the toolchain peers. An exact pin in npm's object form, `{ ".": "0.10.0" }`, is matched too and needs no change.
    detection:
      glob: "**/{package.json,pnpm-workspace.yaml}"
      matches:
        - '(?<![\s\S])(?:(?=\s*\{)(?=[\s\S]*(?:"@prisma/orm-[a-z-]+"\s*:|"(?:overrides|resolutions)"\s*:[\s\S]*@prisma/cli-engine(?:@[^"\s]*)?"))|(?!\s*\{))[\s\S]*@prisma/cli-engine(?:@[^''"\s:]*)?[''"]?\s*:(?!\s*[''"]?0\.10\.0[''"]?\s*(?:[,}\r\n#]|$))'
  - id: mongo-fields-take-a-type
    summary: |
      The MongoDB TypeScript builder writes a field as `field.scalar(type.X())`, where `type` holds the type constructors the target and extension packs contribute, as PSL names them: `field.objectId()` is now `field.scalar(type.ObjectId())`, `field.date()` is `field.scalar(type.DateTime())` (on MongoDB `Date` is now a calendar date), `field.vector({ typeParams: { length: 3 } })` is `field.scalar(type.Vector(3))`, and `field.scalar('mongo/string@1')` is `field.scalar(type.String())`. `field.objectId()`, `field.string()`, `field.double()`, `field.int32()`, `field.bool()`, `field.date()`, `field.int64()`, `field.int64Number()`, `field.decimal128()`, `field.binary()`, `field.json()`, `field.bson()`, `field.vector()` and `field.scalar(codecId)` are removed. `type` comes from the `defineContract` callback, or from `@prisma/orm-mongo/contract-builder`. The MongoDB target now contributes these constructors in its descriptor's `authoring.type`, which the adapter contributed before; `Vector` is new. Run `scripts/mongo-type-helpers/rewrite-mongo-field-types.ts` to rewrite them. The contract does not change. The detection matches MongoDB contract sources that call a removed helper.
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
      `temporal-polyfill` is now a required peer dependency of `@prisma/orm-mongo` and `@prisma/orm-target-mongo`. The MongoDB control plane imports it, because `DateTime(as: temporal)`, `Date(as: temporal)` and `Time(as: temporal)` read `Temporal` values. npm, pnpm and bun install it automatically (npm with `legacy-peer-deps` set does not: see `temporal-polyfill-with-legacy-peer-deps`). An extension package that installs with Yarn and loads the target's control entry in its tests or tooling must add `temporal-polyfill` (`^1.0.4`) to its `devDependencies`.
    detection:
      glob: "**/yarn.lock"
      contains:
        - "@prisma/orm-mongo@"
        - "@prisma/orm-target-mongo@"
      anyMatch: true
  - id: temporal-polyfill-with-legacy-peer-deps
    summary: |
      npm does not install peer dependencies when `legacy-peer-deps` is set, so an extension package that installs with npm and that setting, and loads the MongoDB target's control entry in its tests or tooling, must add `temporal-polyfill` (`^1.0.4`) to its `devDependencies`, as a Yarn package must. The setting can come from an `.npmrc`, the user's npm config or the environment, which no file shows, so the detection matches every `package.json` that depends on `@prisma/orm-mongo` or `@prisma/orm-target-mongo`, and the step checks the setting npm uses.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/orm-mongo"'
        - '"@prisma/orm-target-mongo"'
      anyMatch: true
  - id: mongo-runtime-has-prepare
    summary: |
      `MongoRuntime`, from `@prisma/orm-mongo/family-runtime`, has `prepare(declaration, callback)`, and the `MongoClient` that `mongo()` returns has it too. An object you type as `MongoRuntime` or `MongoClient` yourself, such as a test double, needs a `prepare` method.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - ':\s{0,20}(?:MongoRuntime|MongoClient<[^<>]{0,200}>)\s{0,20}=\s{0,20}\{'
        - '\bimplements\s{1,20}MongoRuntime\b'
  - id: mongo-limit-skip-take-placeholders
    summary: |
      `MongoLimitStage.limit` and `MongoSkipStage.skip`, from `@prisma/orm-mongo/query-ast/execution`, are `number | MongoPreparedParamRef`, and `MongoValue` includes `MongoPreparedParamRef`, the placeholder a `prepare` callback receives. Code that reads `stage.limit` or `stage.skip` as a number, or that handles every kind of `MongoValue`, must handle the placeholder.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bMongo(?:Limit|Skip)Stage\b'
        - '\bMongoValue\b'
  - id: runtime-transaction-signal
    summary: Forward runtime transaction options and provide the required transaction AbortSignal.
  - id: forward-sql-transaction-options
    summary: Forward resolved isolation options through SQL transaction wrappers and configure ORM-owned transactions separately.
  - id: create-extension-not-exported
    summary: |
      `@internal/target-postgres/migration` and its public entrypoint `@prisma/orm-postgres/migration` no longer export the free function `createExtension`, which a `migration.ts` could not call correctly since 8.0.0-rc.22. A `migration.ts` that imports it now fails at once with `does not provide an export named 'createExtension'`. Call the method on the migration class instead: `createExtension('btree_gist')` becomes `this.createExtension({ extension: 'btree_gist' })`. The migration's `ops.json` does not change, so there is no need to run `node migration.ts` again.
    detection:
      glob: "**/migration.{ts,mts}"
      matches:
        - '(?<![\w$.])createExtension\s*\('
        - '\bimport\s*\{[^}]*(?<![\w$])createExtension(?![\w$])[^}]*\}\s*from\s*[\x27"](?:@internal/target-postgres|@prisma/orm-postgres)/migration[\x27"]'
  - id: data-transform-not-exported
    summary: |
      `@internal/target-postgres/migration` and its public entrypoint `@prisma/orm-postgres/migration` no longer export the free function `dataTransform`, which took an internal fourth argument a `migration.ts` cannot pass. A `migration.ts` that imports it now fails at once with `does not provide an export named 'dataTransform'`. Call the method on the migration class instead: `this.dataTransform(endContract, name, { check, run })`. The planner writes the method. The types `DataTransformClosure` and `DataTransformOptions` are still exported.
    detection:
      glob: "**/migration.{ts,mts}"
      matches:
        - '\bimport\s*\{[^}]*(?<![\w$])dataTransform(?![\w$])[^}]*\}\s*from\s*[\x27"](?:@internal/target-postgres|@prisma/orm-postgres)/migration[\x27"]'
  - id: raw-parts-hold-statement-asts
    summary: |
      The `parts` of `RawExpr` and `RawQueryAst` (from `@internal/sql-relational-core/ast`, published as `@prisma/orm-family-sql/relational-core/ast`) are now `ReadonlyArray<RawPart>`, where `RawPart = string | AnyExpression | SelectAst | InsertAst | UpdateAst | DeleteAst`. A raw template places a builder query, or a builder mutation after `.returning()`, as one statement part. Code that walks `parts` and treats every non-string part as an expression must handle the four statement kinds. The detection matches files that import these nodes and read `.parts`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*(?:@internal/sql-relational-core|@prisma/orm-family-sql/relational-core)/(?:ast|expression)[\x27"])(?=[\s\S]*(?<![\w$])(?:RawExpr|RawQueryAst|RawPart)(?![\w$]))[\s\S]*\.parts(?![\w$])'
---

# 8.0.0-rc.23 → 8.0.0-rc.24 — Extension author upgrade instructions

## Order of the steps

Make the changes below in any order, with three exceptions:

1. Move `@prisma/cli-engine` to `0.10.0` and add `temporal-polyfill` where it is needed before running anything else (`engine-pin-moves-to-0-10-0`, `temporal-polyfill-is-a-peer-dependency-of-mongo`, `temporal-polyfill-with-legacy-peer-deps`).
2. In MongoDB contract sources, run the field-types script before the date-types script (`mongo-fields-take-a-type`, then `mongo-date-is-a-calendar-date`). The first writes `field.date()` as `field.scalar(type.DateTime())`.
3. In SQL transaction wrappers, forward the isolation options first, then change the runtime wrappers to `RuntimeTransactionOptions` and the transaction `signal` (`forward-sql-transaction-options`, then `runtime-transaction-signal`).


## The toolchain moves to `@prisma/cli-engine` 0.10.0

### `engine-pin-moves-to-0-10-0`

For every file matched by `detection`, change each `@prisma/cli-engine` version that is not exactly `0.10.0`, such as `0.9.0`, `^0.9.0`, `>=0.9.0 <0.10.0` or `^0.10.0`, to `0.10.0` and reinstall. The toolchain peers that exact version, so a range that allows any other version, newer ones included, can install an engine it refuses. A package that uses `@prisma/cli-engine` without any `@prisma/orm-*` package keeps its own pin. An `overrides` or `resolutions` entry for `@prisma/cli-engine` at the top level, such as npm's `"@prisma/cli-engine": "0.9.0"` or `"@prisma/cli-engine": { ".": "0.9.0" }`, or Yarn's `"**/@prisma/cli-engine"`, pins the engine for every package of the workspace, so change it even in a root `package.json` that lists no `@prisma/orm-*` package. An entry scoped under another package, such as npm's `"some-package": { "@prisma/cli-engine": "0.9.0" }` or pnpm's `"some-package>@prisma/cli-engine"`, applies only below that package: change it when that package is an `@prisma/orm-*` package, such as `@prisma/orm-toolchain`, and leave it otherwise. A `pnpm-workspace.yaml` matches whatever its packages are, so change its pin only when a package that takes the engine from it also lists an `@prisma/orm-*` package. In engine 0.10.0 a normalized redirect's `replacement` is a list of steps rather than one string, so code that reads `CommandRedirect.replacement` from a command family reads an array.


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

Commit your work first. The script reads your code with the TypeScript compiler, so the project needs `typescript` installed. From the project root, run:

```sh
node <path-to-this-guide>/scripts/mongo-type-helpers/rewrite-mongo-field-types.ts
```

Pass files or directories to limit it. The script prints a line for each call it leaves. Rewrite each one by hand, except where the line says the script cannot tell the `field` is the MongoDB builder's and it is not. Then type-check the project. The script neither changes nor reports a `field.scalar` call whose argument is computed, such as `field.scalar(codecIdOf(kind))`, because it cannot tell a codec id from a type there; the type check reports each one that passes a codec id, since `field.scalar` takes only a type now. Where the type check cannot see it, in plain JavaScript or with an argument typed `any`, `contract emit` refuses the call with `CONTRACT.ARGUMENT_INVALID`. Write those with `type.X()`.

A field typed by your extension's own codec, written `field.scalar('shout/text@1')` before, needs a type constructor in your extension descriptor's `authoring.type`, under your namespace. The contract then writes `field.scalar(type.shout.Text())`:

```ts
authoring: {
  type: {
    shout: { Text: { kind: 'typeConstructor', output: { codecId: 'shout/text@1' } } },
  },
},
```

The script reports such a call and leaves it, because it cannot know the constructor's name.


## MongoDB: `Date` is a calendar date, and `temporal-polyfill` is a peer dependency

### `mongo-date-is-a-calendar-date`

Commit your work first. From the project root, run:

```sh
node <path-to-this-guide>/scripts/mongo-convenience-date-time-types/rewrite-mongo-date-types.ts
```

Pass files or directories to limit it.

### `temporal-polyfill-is-a-peer-dependency-of-mongo`

For each Yarn project that `detection` matches, add `"temporal-polyfill": "^1.0.4"` to `devDependencies` in the `package.json` that depends on `@prisma/orm-mongo` or `@prisma/orm-target-mongo`, then reinstall.

### `temporal-polyfill-with-legacy-peer-deps`

Skip this if the package installs with Yarn (see `temporal-polyfill-is-a-peer-dependency-of-mongo`), pnpm or bun. For a package that installs with npm, run `npm config get legacy-peer-deps` in the folder of each `package.json` that `detection` matches. It reports the setting npm uses there, from any `.npmrc`, the user's npm config or the `npm_config_legacy_peer_deps` environment variable. Where it prints `true`, or the install command passes `--legacy-peer-deps`, add `"temporal-polyfill": "^1.0.4"` to that `package.json`'s `devDependencies`, then reinstall.


## MongoDB prepared statements

### `mongo-runtime-has-prepare`

Give a hand-written `MongoRuntime` or `MongoClient` a `prepare` method. A test double that never prepares can throw:

```ts
const runtime: MongoRuntime = {
  query,
  execute,
  close: async () => {},
  prepare: () => Promise.reject(new Error('not used in this test')),
};
```

### `mongo-limit-skip-take-placeholders`

Where you read a `$limit` or `$skip` count from a stage, check for a placeholder before using it as a number:

```ts
const count = typeof stage.limit === 'number' ? stage.limit : undefined;
```

A placeholder's value is known only when a prepared statement runs.


## SQL transactions take isolation options and timeouts

Make the isolation change first, then the timeout change: both touch the same transaction wrappers.

### `forward-sql-transaction-options`

Import `SqlTransactionOptions` from `@prisma/orm-family-sql/relational-core/ast` when implementing SQL transaction wrappers. Accept optional `options?: SqlTransactionOptions` on driver connection `beginTransaction`/`transaction` methods and forward it unchanged through held-session and activity-owned routes. Runtime connection and activity wrappers take `RuntimeTransactionOptions` instead, which adds the callback timeouts; `runtime-transaction-signal` below describes them. The options contain only an optional `isolationLevel`; drivers must not receive an implicit/explicit discriminator. An absent level retains database/session defaults.

Custom facades validate global and local callback isolation options before acquisition, resolve a defined local level over the global level, and pass the result as the third argument of `withTransaction`. Keep callback defaults in facade closures, never on shared runtimes or drivers. Unknown keys, null and unsupported levels reject; an undefined property inherits.

Configure ORM-owned transactions separately through the ORM factory's optional `implicitTransactionOptions`. The MySQL facade supplies `{ isolationLevel: 'ReadCommitted' }`; standalone ORM instances can opt into the same policy. Retain these options in collection configuration when rebinding execution to an activity. Nested create/update and other multi-statement mutations use the mutation graph, which passes resolved options to the activity's transaction method when opening a transaction. Do not restore the removed nested-mutation executor or its connection fallback. Existing transaction-bound ORM scopes participate without opening another transaction or changing isolation. Do not copy callback defaults into this configuration.

Drivers validate supplied levels and select fixed SQL. Preserve existing query serialization. MySQL SET TRANSACTION and BEGIN share one lock; a missing level uses the server/session default. Remove any blanket session isolation override used only to implement the old ORM policy.

Preserve start-refusal and settlement metadata in wrappers. Release only a known-clean connection; destroy after uncertain start or rollback, including successful SET followed by failed BEGIN. Keep the original setup error when cleanup fails. Role-session setup, transaction, and reset must use the same held connection.

Validate resolved-options forwarding, absent/default ORM policy, factory-to-activity-to-graph propagation, nested writes, callback precedence, same-session role behavior and destruction/reset failures. Do not add timeout or batch semantics as part of this translation.

### `runtime-transaction-signal`

- Change runtime connection/activity wrapper parameters from driver `SqlTransactionOptions` to `RuntimeTransactionOptions`, imported from your SQL runtime entry (`@prisma/orm-family-sql/runtime` for published extensions). Forward the complete options to the underlying runtime transaction or `beginTransactionOn`, and preserve the returned transaction's `signal` when wrapping it. Drivers still receive isolation-only `SqlTransactionOptions`.
- Every handwritten `RuntimeTransaction` implementation or test double must expose a stable readonly `signal: AbortSignal`, even when untimed: `withTransaction` reads it unconditionally. For an untimed double, allocate one `AbortController` per transaction and expose its signal (for an object literal, `signal: new AbortController().signal` allocates it once).
- Never replace a real timed transaction's signal with an inert signal: doing so prevents callback timeout observation. Delegate the original signal; if implementing timed runtime transactions yourself, own the deadline and invalidation, abort with the structured timeout reason after invalidating access, and stop the timer at commit admission or rollback. There is no separate lifetime argument or `started(control)` callback.


## `createExtension` and `dataTransform` are no longer free functions

### `create-extension-not-exported`

`@internal/target-postgres/migration` no longer exports `createExtension`. Since 8.0.0-rc.22 the free function took an internal argument that only the migration class can supply, so a `migration.ts` that called it failed with `Cannot read properties of undefined (reading 'lowerToExecuteRequest')`. Now the import fails at once instead.

In every `migration.ts` the detection matches, call the method and remove `createExtension` from the import:

```ts
// Before
import { createExtension, Migration, MigrationCLI } from '@internal/target-postgres/migration';

override get operations() {
  return [createExtension('btree_gist'), ...];
}

// After
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';

override get operations() {
  return [this.createExtension({ extension: 'btree_gist' }), ...];
}
```

Without `schema`, the method creates the extension where the old function did: in the connection's current schema, unless the extension's control file names one. The migration's `ops.json` does not change, and there is no need to run `node migration.ts` again: `prisma db migrate` applies `ops.json` and does not load `migration.ts`.

### `data-transform-not-exported`

`@internal/target-postgres/migration` and its public entrypoint `@prisma/orm-postgres/migration` no longer export the free function `dataTransform`. It took an internal fourth argument that only the migration class can supply, so a `migration.ts` could not call it correctly. Remove `dataTransform` from the import and call `this.dataTransform(endContract, name, { check, run })`, as the planner writes it. The types `DataTransformClosure` and `DataTransformOptions` are still exported.


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
