---
from: "8.0.0-rc.16"
to: "8.0.0-rc.17"
changes:
  - id: decode-json-integer-text-refuses-other-spellings
    summary: |
      `decodeJsonIntegerText` from `@internal/framework-components/codec` now refuses digit text with a leading zero or a minus sign on zero, such as "007" or "-0", naming the text to write. An extension codec that reads an integer through it refuses those spellings in `contract.json` and in a PSL enum member. Write its values without leading zeros or a minus sign on zero, as its `encodeJson` should already.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\bdecodeJsonIntegerText\b'
  - id: enum-codecs-need-equality
    summary: |
      Every enum authoring surface, `enumType` in `defineContract` and the PSL enum block in both families, now refuses a codec whose descriptor does not declare the `equality` trait. A codec descriptor can also set the new `enumRefusal` field, a reason an enum cannot use it that ends with what to use instead. Declare `equality` on an extension codec whose values an enum may hold, and set `enumRefusal` on one that declares it but whose values a query reads back never equal a member as the contract stores it.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\btraits\s*[:=]'
  - id: enum-accessor-builders-take-codecs
    summary: |
      `buildNamespacedEnums()` and `buildEnumsMapForNamespace()` from `@internal/contract/enum-accessor` now take a codec lookup, `(codecId) => EnumMemberCodec`, as their last argument and read each member through the codec it returns. The lookup must return a codec for every enum; throw `RUNTIME.CODEC_DESCRIPTOR_MISSING` when the runtime has none. `createEnumAccessor()` takes the codec as an optional second argument. `EnumAccessor` members and values are typed `unknown`, and `has()` on `EnumAccessor` and `ContractEnumAccessor` takes `unknown`. Pass the runtime's codecs.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\b(?:buildNamespacedEnums|buildEnumsMapForNamespace|createEnumAccessor)\b'
  - id: mongo-orm-takes-enum-accessors
    summary: |
      `mongoOrm()` and `createMongoCollection()` from `@internal/mongo-orm` now require the contract's enum accessors, which they check a written enum value against. Code that builds them itself passes `buildMongoEnums(contract, context.codecs)` from `@internal/mongo-runtime` as `enums`; `createMongoCollection()` takes them before the optional `mutationDefaults`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\b(?:mongoOrm|createMongoCollection)\s*(?:<[^>]*>)?\s*\('
  - id: define-contract-carries-enums
    summary: |
      A target facade whose `defineContract` wraps `buildBoundContract` must carry the contract's enums as an `Enums` generic and export an `enumType` bound to its pack's codec types, as `@internal/postgres` and now `@internal/sqlite` do. Without them `db.enums` types each member as `JsonValue`, while it holds the value its codec reads, such as a bigint or a `Date`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\bbuildBoundContract\s*\('
  - id: contract-dts-enum-member-types
    summary: |
      An emitted `contract.d.ts` now gives every namespace that declares enums an `enumMemberTypes` entry, which types each member as `db.enums` holds it. Re-emit bundled contracts that declare enums. `contract.json`, every hash and migration snapshots are unchanged.
    detection:
      glob: "**/contract.d.ts"
      matches:
        - 'readonly enum: \{'
  - id: bundled-contract-foreign-keys-name-their-backing-index
    summary: |
      Each foreign key in a SQL `contract.json` now states what backs it in a new `index` field: `{ "name": "<index>" }`, `{ "primaryKey": true }` or `{ "unique": ["<column>", …] }`, absent for `index: false`. A bundled contract space with a foreign key gets a new storage hash. Regenerate the extension's bundled `contract.json` and `contract.d.ts` with its existing emission command.
    detection:
      glob: "**/contract.json"
      matches:
        - '"foreignKeys"\s*:\s*\[\s*\{'
  - id: relations-name-a-leading-key-or-index
    summary: |
      A relation in a bundled PSL contract that says `index: false` although a primary key, unique constraint or plain index of its model starts with its foreign key's columns now names that object with `index: "<name>"`, as `contract infer` writes it. Otherwise the stored foreign key says nothing backs it.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@relation\([^)]*\bindex\s*:\s*false'
  - id: foreign-key-materialization-takes-one-input
    summary: |
      `materializeForeignKeysAndIndexes()` from `@internal/sql-contract/foreign-key-materialization` takes one object, `{ tableName, foreignKeys, declaredIndexes, uniques, primaryKey, warnings }`, where each declared index is `{ index, namedByUser }`, and a foreign key's `index` is `true`, `false` or the name of a declared index, unique constraint or primary key. `backingIndexColumnKeys()`, `isBackedByColumnKeys()` and `BackingIndexCandidates` are removed; `derivedBackingIndexIsRedundant()` answers whether a table already serves a foreign key's lookups, by the rule the build uses.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:materializeForeignKeysAndIndexes|backingIndexColumnKeys|isBackedByColumnKeys|BackingIndexCandidates)\b'
  - id: planner-plan-statements
    summary: |
      Every call to a migration planner's `plan(...)` passes a new required `statements` list; pass `statements: []` when the call states no renames.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.plan\(\s*\{(?!(?:[^{}]|\{[^{}]*\})*?(?<![\w$])statements\s*[:,])(?:[^{}]|\{[^{}]*\})*?(?<![\w$])fromContract\s*[:,]'
  - id: planner-plan-origin
    summary: |
      Every call to a migration planner's `plan(...)` passes a new required `origin`: the storage hash the produced plan asserts it starts from. `fromContract` no longer sets the plan's origin.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.plan\(\s*\{(?!(?:[^{}]|\{[^{}]*\})*?(?<![\w$])origin\s*[:,])(?:[^{}]|\{[^{}]*\})*?(?<![\w$])fromContract\s*[:,]'
  - id: planner-success-applied-statements
    summary: |
      A migration planner's success result gains a required `appliedStatements` list; a planner, or a test double of one, that returns `{ kind: 'success', plan }` adds `appliedStatements`, empty when it applied no statements.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*(?<![\w$])MigrationPlanner(?:Result|SuccessResult)?(?![\w$]))(?![\s\S]*(?<![\w$])appliedStatements(?![\w$]))[\s\S]*kind:\s*["'']success["'']'
  - id: sql-planner-helpers
    summary: |
      In `@prisma/orm-family-sql/family/control`, `plannerSuccess(plan, warnings?)` becomes `plannerSuccess(plan, appliedStatements, subjects, warnings?)` (see `sql-planner-success-subjects`), `planFieldEventOperations(...)` takes required `tableRenames` and `columnRenames` lists, and the conflict kind union gains `'statementRefused'`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])plannerSuccess\s*\('
        - '(?<![\w$])planFieldEventOperations\s*\('
        - '(?<![\w$])SqlPlannerConflictKind(?![\w$])'
  - id: aggregate-planner-app-space
    summary: |
      The aggregate planner's `planMigration(...)` input takes a required `appSpace: { fromContract, statements }`, and a `PerSpacePlan` carries a required `appliedStatements` list.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])planMigration\s*\('
        - 'strategy:\s*["''](?:plan-from-diff|resolve-recorded-path|declared-state)["'']'
  - id: planner-success-data-loss
    summary: |
      A migration planner's success result gains required `dataLoss` and `accessWidening` lists of `MigrationOperationSubject` (from `@prisma/orm-framework/components/control`): the operations that lose data, and those that widen who can read or write rows, each by position with its subject. A planner, or a test double of one, that returns `{ kind: 'success', ... }` adds both, empty when it plans neither.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*(?<![\w$])MigrationPlanner(?:Result|SuccessResult)?(?![\w$]))(?![\s\S]*(?<![\w$])dataLoss(?![\w$]))[\s\S]*kind:\s*["'']success["'']'
  - id: sql-planner-success-subjects
    summary: |
      In `@prisma/orm-family-sql/family/control`, `plannerSuccess(plan, appliedStatements, warnings?)` becomes `plannerSuccess(plan, appliedStatements, subjects, warnings?)`, where `subjects` is `{ dataLoss, accessWidening }`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])plannerSuccess\s*\('
  - id: per-space-plan-subjects
    summary: |
      A `PerSpacePlan` from `@prisma/orm-toolchain/migration-tools/aggregate` carries required `dataLoss` and `accessWidening` lists, and `planMigration(...)` and `resolveRecordedPath(...)` take a required `storageNameOf(operation)`, which names each destructive operation of a recorded path in `dataLoss`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'strategy:\s*["''](?:plan-from-diff|resolve-recorded-path|declared-state)["'']'
        - '(?<![\w$])(?:planMigration|resolveRecordedPath)\s*\('
  - id: family-instance-storage-name-of
    summary: |
      `ControlFamilyInstance` from `@prisma/orm-framework/components/control` requires `storageNameOf(operation)`: the name the database knows the object an operation acts on by. A family instance, or a test double of one, implements it. `TargetMigrationsCapability` gains an optional `renameStatements: { refused: true, keepDataByHand }` for a target whose planner carries out no rename statement.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?:Sql|Mongo)?ControlFamilyInstance(?![\w$])'
  - id: operation-classes-and-calls
    summary: |
      Postgres `setNotNull`, MongoDB `dropIndex`, `setValidation` and `collMod`, and the matching op-factory calls are now `widening`. `AlterColumnTypeCall` (`@prisma/orm-target-postgres/target/op-factory-call`) takes an optional `operationClass`, and SQLite's `RecreateTableCall` (`@prisma/orm-target-sqlite/target/op-factory-call`) an optional `lossyColumns`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?:AlterColumnTypeCall|RecreateTableCall)(?![\w$])'
        - '(?<![\w$.])(?:dropIndex|setValidation|collMod)\('
        - '\bsetNotNull\('
  - id: control-client-db-update-answer-questions
    summary: |
      The control client's `dbUpdate(options)` requires an `answerQuestions` callback, which answers every question about an operation that would lose data or widen access, in order, or throws to refuse.
    detection:
      glob: "**/*.{ts,mts,cts,md}"
      matches:
        - '(?<![\s\S])(?![\s\S]*(?<![\w$])answerQuestions(?![\w$]))[\s\S]*\.dbUpdate\s*\('
  - id: collection-apply-is-now-with
    summary: |
      The collection method `apply(fn)` is renamed to `with(fn)`. Rename every call on a collection of the SQL ORM client, such as `db.orm.public.Post.apply(notDeleted)` or `posts.apply((p) => p.limit(10))`, to `.with(...)`. The detection matches `.apply(` only when its first argument is a name followed by `)`, `(` or `=>`, or an arrow function, because `Function.prototype.apply` (`fn.apply(this, args)`) and `Reflect.apply` share the name; it can still match a `Function.prototype.apply` call with one argument. Rename only where the receiver is a collection.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.apply\s*\(\s*(?:\(|[A-Za-z_$][\w$.]*\s*(?:\)|\(|=>))'
  - id: with-is-a-collection-member
    summary: |
      Every collection now has a `with` method instead of `apply`. A custom collection class that declares its own `with` member with another signature no longer compiles; rename it. An aggregate operation named `with` is refused with `ORM.AGGREGATE_OPERATION_RESERVED`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:^|\n)[ \t]*(?:(?:public|protected|private|readonly|static|async|override)\s+)*with\s*[(<:=?]'
  - id: orm-scope-is-now-fragment
    summary: |
      The SQL ORM client's `scope` methods are renamed to `fragment`: `db.orm.scope(fields, body)` is now `db.orm.fragment(fields, body)`, and `collection.scope(body)`, such as `db.orm.public.Post.scope(...)`, is now `collection.fragment(body)`. Rename each use whose receiver is the ORM client or a collection, including `typeof db.orm.scope` and `const { scope } = db.orm`. The detection matches every `.scope(` call; leave calls on other objects as they are.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.scope\s*[(<]'
        - '\btypeof\s+[\w$.]*\.scope\b'
        - '\{[^}]*\bscope\b[^}]*\}\s*=\s*[\w$.]*\borm\b'
  - id: orm-scope-types-are-now-fragment-types
    summary: |
      The types `Scope`, `FieldScope` and `ScopeFacts` exported by the SQL ORM client (`@prisma/orm-postgres/orm-client`, the other facades' `orm-client` entries and `@internal/sql-orm-client`) are renamed to `Fragment`, `FieldFragment` and `FragmentFacts`. The SQL builder's own `Scope` and `ScopeField` types are a different thing and keep their names; the detection matches `Scope` only in an import or re-export from the ORM client, or after a namespace import of it.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\b(?:FieldScope|ScopeFacts)\b'
        - '(?:import|export)\s+(?:type\s+)?\{[^}]*\bScope\b[^}]*\}\s*from\s*[''"]@(?:prisma/[\w-]+/orm-client|internal/sql-orm-client)[''"]'
        - 'import\s+(?:type\s+)?\*\s+as\s+([\w$]+)\s+from\s*[''"]@(?:prisma/[\w-]+/orm-client|internal/sql-orm-client)[''"][\s\S]*\b\1\.Scope\b'
  - id: fragment-is-a-collection-member
    summary: |
      Every collection now has a `fragment` method instead of `scope`. A custom collection class that declares its own `fragment` member with another signature no longer compiles; rename it. An aggregate operation named `fragment` is refused with `ORM.AGGREGATE_OPERATION_RESERVED`. The name `scope` is free again. The detection matches a member named `fragment` only in a file that extends `Collection`, and an aggregate operation declared as `operation: 'fragment'`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\bextends\s+Collection\b)[\s\S]*\n[ \t]*(?:(?:public|protected|private|readonly|static|async|override|get|set)\s+)*fragment\s*(?:\?\s*)?[(<:=]'
        - '\boperation\s*:\s*[''"]fragment[''"]'
  - id: namespace-named-fragment-hides-the-client-method
    summary: |
      A contract namespace named `fragment` now takes the name of the client's `fragment` method, so `db.orm.fragment` is that namespace and the client has no method to make a fragment for any model; code that called `db.orm.scope(fields, body)` with such a contract must make its fragments another way. A namespace named `scope` no longer hides anything.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?:^|\n)[ \t]*namespace\s+fragment\b'
  - id: fragment-error-texts
    summary: |
      Errors and compile errors about these functions say "fragment" where they said "scope", such as `Cannot define the fragment: the body is not a function` and `Pass the fragment to with on a collection: collection.with(fragment).` Update tests that assert on the old text.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'Cannot (?:define|apply) (?:the|a) scope|Pass the scope to with|Run the scope with apply|A scope (?:passed to with|applied with apply)|The scope was (?:made|declared)|the scope could not read the model|declaration in the scope'
  - id: collection-state-carries-locking
    summary: "CollectionState in @internal/sql-orm-client has a new required key, locking; a state literal built without spreading emptyState() must add it, carrying an existing state's value."
    detection:
      glob: "**/*.ts"
      contains:
        - "CollectionState"
---

# 8.0.0-rc.16 → 8.0.0-rc.17 — Extension author upgrade instructions

## `decode-json-integer-text-refuses-other-spellings`

`decodeJsonIntegerText(codecId, json, range?)` reads an integer a codec stores as decimal text. It now refuses any spelling other than the integer's decimal text:

```text
demo/big@1 JSON value must be "7", the integer's decimal text without leading zeros or a minus sign on zero
```

1. Find the codecs that call `decodeJsonIntegerText`. The detection for this change looks for the name.
2. Check that each codec's `encodeJson` writes `value.toString()` of the integer, so it never writes a spelling `decodeJson` now refuses.
3. Re-emit the extension's bundled contracts, if it ships any, and check that they load. A contract that holds such a spelling fails to load with `RUNTIME.DECODE_FAILED`.

## `enum-codecs-need-equality`

An enum compares a value with its members, so an enum cannot use a codec whose values cannot be compared for equality. `enumRefusalOf(descriptor)` from `@internal/framework-components/codec` gives the reason an enum cannot use a codec, or `undefined`. Every enum surface refuses through it, with `CONTRACT.ENUM_INVALID` in TypeScript and `PSL_EXTENSION_INVALID_VALUE` at the `@@type` in PSL.

1. For each codec descriptor the extension contributes, declare `equality` in `traits` when its type compares values for equality, so an enum can use it.
2. Set `enumRefusal` when the codec declares `equality` but its values read back never equal a member as the contract stores it: for example, the database normalises the value's text and the codec stores it as written, or the stored form is not text the database reads as the value. Write one or two sentences that say why and end with what to use instead:

```ts
class GeoHashDescriptor extends CodecDescriptorImpl<void> {
  override readonly traits = ['equality'] as const;
  override readonly enumRefusal =
    'The database normalises a geohash to its shortest form, so a member as written is not the value a query reads back. Use a text enum.';
}
```

A codec without `equality` may set `enumRefusal` too, to replace the generic reason with its own.

## `enum-accessor-builders-take-codecs`

An extension that builds `db.enums` passes the codecs of the runtime it builds them for. On a SQL runtime, resolve each codec through the execution context's codec registry, which throws `RUNTIME.CODEC_DESCRIPTOR_MISSING` for a codec no component registers:

```ts
const enums = Object.freeze(
  buildNamespacedEnums<TContract>(context.contract.domain, (codecId) =>
    context.contractCodecs.forCodecRef({ codecId }),
  ),
);
```

On Mongo, build them with `buildMongoEnums` from `@internal/mongo-runtime`, which resolves each codec through the execution context's codec lookup and throws `RUNTIME.CODEC_DESCRIPTOR_MISSING` when it has none:

```ts
const enumsByNamespace = buildMongoEnums(contract, context.codecs);
const enums = enumsByNamespace[UNBOUND_NAMESPACE_ID];
```

A static context that builds enums before it has an execution context must build the context first so it can pass the codecs. Each enum's codec is resolved when the accessors are built; its members are decoded when the enum is first read.

`createEnumAccessor(contractEnum)` without a codec keeps the members in their stored forms, as the native-enum accessor of `@internal/postgres` does.

The accessor's members are the values the codec reads, so code that read `EnumAccessor.values` or `members` as `JsonValue` must accept `unknown`. Members are decoded once, when the enum is first read; a mutable member, such as a `Date` or a `Uint8Array`, is a fresh copy on every read, and an immutable one, such as a Temporal value, is the same value on every read. `has()`, `nameOf()` and `ordinalOf()` find a value equal to a member: a primitive by SameValueZero, an object by its `Object.prototype.toString` kind and the form the codec stores it in. Code that passed a stored form to them must pass the value a query returns.

## `mongo-orm-takes-enum-accessors`

Pass the contract's enum accessors when building the Mongo ORM, the same ones the static context builds for `db.enums`:

```ts
const orm = mongoOrm<TContract>({
  contract,
  executor,
  mutationDefaults: context,
  enums: buildMongoEnums(contract, context.codecs),
});
```

`createMongoCollection()` takes the accessors as its fourth argument, before the optional `mutationDefaults`: `createMongoCollection(contract, 'User', executor, enums, mutationDefaults)`. A write of an enum field whose accessor `enums` lacks is refused with `ORM.ARGUMENT_INVALID`.

## `define-contract-carries-enums`

Give the facade's `defineContract` an `Enums` type parameter on both overloads, pass it to `buildBoundContract` through the definition type, and merge the scaffold's and the factory's enums in the factory overload:

```ts
import type {
  EnumTypeHandle,
  MergeEnums,
} from '@internal/sql-contract-ts/contract-builder';

type EnumsConstraint = Record<string, EnumTypeHandle>;

type Result<Types, Models, Extensions, Enums extends EnumsConstraint> = ReturnType<
  typeof buildBoundContract<
    SqlFamily,
    TargetPack,
    {
      readonly types?: Types;
      readonly models?: Models;
      readonly extensions?: Extensions;
      readonly enums?: Enums;
      readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
    }
  >
>;

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const Enums extends EnumsConstraint = Record<never, never>,
>(definition: Definition<Types, Models, Extensions, Enums>): Result<Types, Models, Extensions, Enums>;

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const ScaffoldEnums extends EnumsConstraint = Record<never, never>,
  const FactoryEnums extends EnumsConstraint = Record<never, never>,
>(
  scaffold: Scaffold<Extensions, ScaffoldEnums>,
  factory: (helpers: ComposedAuthoringHelpers<SqlFamily, TargetPack, Extensions>) => {
    readonly types?: Types;
    readonly models?: Models;
    readonly enums?: FactoryEnums;
  },
): Result<Types, Models, Extensions, MergeEnums<ScaffoldEnums, FactoryEnums>>;
```

Add `'enums'` to the keys the base scaffold omits from `ContractInput`, add `readonly enums?: Enums` to the definition and scaffold types, and type the implementation's `enums` as `EnumsConstraint`. Then export an `enumType` bound to the pack's codec types, and `member`, from the facade's contract builder:

```ts
import {
  bindEnumType,
  type ExtractCodecTypesFromPack,
} from '@internal/sql-contract-ts/contract-builder';

/** `enumType` bound to the pack's codec types, so each `member()` value is checked against the enum codec's input type. */
export const enumType = bindEnumType<ExtractCodecTypesFromPack<typeof targetPack>>();
```

## `contract-dts-enum-member-types`

Regenerate bundled `contract.json` and `contract.d.ts` together from the extension's authoring source with the extension's existing emission command. Only `contract.d.ts` changes, and only for contracts that declare enums.

## `bundled-contract-foreign-keys-name-their-backing-index`

Regenerate the bundled `contract.json` and `contract.d.ts` from the extension's authoring source with its existing emission command. Only contracts with a foreign key change. A database signed with the previous contract space needs `prisma db sign`; say so in the extension's release notes.

## `relations-name-a-leading-key-or-index`

For each `@relation(..., index: false)` in the bundled PSL source, look at the model's `@id`/`@@id`, `@@unique`/`@unique` and `@@index` entries. If one of them has the relation's `fields` as its first fields, in order, and is not partial and has no non-default `type` or `options`, replace `index: false` with `index: "<its map or name>"`. For example, with `@@unique([sessionId, authenticationMethod], map: "mfa_amr_claims_session_id_authentication_method_pkey")`, write `session AuthSession @relation(fields: [sessionId], references: [id], index: "mfa_amr_claims_session_id_authentication_method_pkey")`. Leave `index: false` where nothing qualifies. Then regenerate the bundled contract, as `bundled-contract-foreign-keys-name-their-backing-index` says. If the source comes from `contract infer`, re-running it writes the same.

## `foreign-key-materialization-takes-one-input`

Before:

```ts
const { foreignKeys, indexes } = materializeForeignKeysAndIndexes(
  tableName,
  authoredForeignKeys,
  declaredIndexes,
  uniques,
  primaryKey,
);
```

After:

```ts
const warnings: AuthoringWarning[] = [];
const { foreignKeys, indexes } = materializeForeignKeysAndIndexes({
  tableName,
  foreignKeys: authoredForeignKeys,
  declaredIndexes: authoredIndexes.map((authored) => ({
    index: lowerAuthoredIndex(tableName, authored, warnings),
    namedByUser: authored.name !== undefined || authored.map !== undefined,
  })),
  uniques,
  primaryKey,
  warnings,
});
flushAuthoringWarnings(warnings);
```

`namedByUser` says whether the source gave the index a `name` or `map`. An index not named by the user is left out when it duplicates another, and foreign keys that pointed at it then name the one that stays. `flushAuthoringWarnings` comes from `@internal/framework-components/authoring`.

Code that called `backingIndexColumnKeys()` or `isBackedByColumnKeys()` to decide whether a foreign key needs a backing index reads the stored foreign key's `index` instead: `{ name }` names an index of the table, `{ primaryKey: true }` says the primary key serves it, and `{ unique: [columns] }` names the unique constraint with those columns; the first columns of each are the foreign key's, and an absent `index` says nothing does. To ask the question of a live table, call `derivedBackingIndexIsRedundant(columns, { indexes, nodeOf, uniques, primaryKey })`, as `contract infer` does.

## `planner-plan-statements`

The options of `MigrationPlanner.plan` (from `@prisma/orm-framework/components/control`), of the SQL family's `SqlMigrationPlannerPlanOptions`, of the Postgres and SQLite planners, and of `MongoMigrationPlanner` (from `@prisma/orm-target-mongo/target/control`) gain a required `statements: readonly ResolvedMigrationStatement[]`: the `--rename` statements the user gave, resolved into namespace, model and field names. For each `plan({ ... })` call, add `statements: []` beside `fromContract`. A planner that forwards its options to another planner forwards `statements` too. Detection finds the calls that write their options inline in `plan({ ... })`; a call that builds its options object elsewhere and passes it in, such as `plan(options)`, is not detected, so check those calls by hand. `MongoMigrationPlanner` refuses a non-empty `statements` with a `statementRefused` conflict in this release.

A planner that cannot carry out statements must refuse them, never ignore them: an ignored statement plans a drop and create, which loses the data the statement was given to keep. When `statements` is not empty, return `{ kind: 'failure', conflicts: [...] }` with one conflict for the first statement it cannot carry out, of kind `statementRefused`, with that statement in `refusedStatement`, a `summary` that names it (`describeMigrationStatement(statement, fromContract, contract)` writes it in domain names), and a `why` that says how to keep the data without it. A planner that carries out some statements reports each one in `appliedStatements` and refuses the first one it cannot.

`ResolvedMigrationStatement`, `ResolvedModelRenameStatement`, `ResolvedFieldRenameStatement`, `ModelCoordinate`, `FieldCoordinate` and `describeMigrationStatement` are imported from `@prisma/orm-framework/components/control`.

## `planner-plan-origin`

The same planner options gain a required `origin: PlanOrigin | null`. It is the origin the produced plan asserts, which the runner checks against the database marker: the plan's `origin` and its `describe().from`. Until now a planner derived it from `fromContract`; now `fromContract` is only the contract the planner reads. To keep a call's behavior, pass `origin: planOriginOf(fromContract)`, with `planOriginOf` and the `PlanOrigin` type from `@prisma/orm-framework/components/control`. A call that plans from whatever state the database is in, as `db init` and `db update` do, passes `origin: null`. A planner implementation stamps `options.origin?.storageHash ?? null` onto its plan instead of reading the hash from `fromContract`. Detection finds the same inline `plan({ ... })` calls as `planner-plan-statements`; check calls that pass a prebuilt options object by hand.

## `planner-success-applied-statements`

`MigrationPlannerSuccessResult` gains a required `appliedStatements: readonly AppliedMigrationStatement[]`, one entry per statement the plan applied, in order, each with `operationIndexes`: the positions, in the plan's `operations`, of the operations it accounts for. `AppliedMigrationStatement` is imported from `@prisma/orm-framework/components/control`. In a planner implementation, or a test double of one, that returns `{ kind: 'success', plan, ... }`, add `appliedStatements: []` when the planner applies no statements.

`MigrationPlannerConflict` also gains an optional `refusedStatement`. A planner sets it only on a conflict that refuses a statement, as described under `planner-plan-statements`; existing conflicts leave it out.

Detection finds files that name `MigrationPlanner`, `MigrationPlannerResult` or `MigrationPlannerSuccessResult` and return `kind: 'success'` without `appliedStatements` anywhere in the file. It misses two cases, so check them by hand: a file that mentions `appliedStatements` once is skipped as a whole, even if another success result in it lacks the field; and a planner or test double that returns `{ kind: 'success', ... }` without naming one of those types, for example one typed through a family type such as `SqlPlannerSuccessResult`, is not found.

## `sql-planner-helpers`

These come from `@prisma/orm-family-sql/family/control`.

- Change `plannerSuccess(plan)` to `plannerSuccess(plan, [], { dataLoss: [], accessWidening: [] })`, and `plannerSuccess(plan, warnings)` to `plannerSuccess(plan, [], { dataLoss: [], accessWidening: [] }, warnings)`. The second argument is `appliedStatements`; the third is described under `sql-planner-success-subjects`.
- Add `tableRenames: []` and `columnRenames: []` to the options of each `planFieldEventOperations({ ... })` call.
- An exhaustive `switch` over `SqlPlannerConflictKind` gains a `case 'statementRefused':`.

## `aggregate-planner-app-space`

`planMigration`, `PerSpacePlan` and `AppSpacePlanningInputs` come from `@prisma/orm-toolchain/migration-tools/aggregate`. Add `appSpace: { fromContract: null, statements: [] }` to each `planMigration({ ... })` input, and `appliedStatements: []` to each `PerSpacePlan` object a test builds by hand.

## `planner-success-data-loss`

`MigrationPlannerSuccessResult` gains:

- `dataLoss: readonly MigrationOperationSubject[]`: one entry per operation, in plan order, that can lose rows or values (dropping a table, a column or a collection, or a type change that can change values).
- `accessWidening: readonly MigrationAccessChange[]`: one entry per operation that changes who can read or write rows, with `widens: true` when it widens access, such as disabling row-level security, and `false` when the change can go either way, such as dropping a row-level-security policy. Leave out the drop half of a policy replacement, a drop of a policy the same plan creates again (by name, or by generated-name prefix on the same table): it changes nothing in the end, and listing it would make every policy edit ask.

A `MigrationOperationSubject` is `{ operationIndex, subject }`: the operation's position in the plan's `operations`, and a `MigrationSubject`, which is `{ kind: 'model', namespaceId, model }` or `{ kind: 'field', namespaceId, model, field }` when the operation is about a model or field of `fromContract`, else `{ kind: 'storage', name }` with the name the database knows it by. The CLI turns each entry into a question the user answers with `--delete`, `--rename` or `--allow` before anything is written or applied, so a planner must list every operation of these kinds; an operation it leaves out is applied without asking.

`MigrationSubject`, `MigrationOperationSubject`, `MigrationAccessChange`, `MigrationSubjectJson` and `migrationSubjectJson` are imported from `@prisma/orm-framework/components/control`. In a planner or a test double that returns `{ kind: 'success', plan, appliedStatements }`, add `dataLoss: []` and `accessWidening: []` when it plans no such operation.

Detection finds files that name `MigrationPlanner`, `MigrationPlannerResult` or `MigrationPlannerSuccessResult` and return `kind: 'success'` without `dataLoss` anywhere in the file. Check by hand a file that mentions `dataLoss` once, and a success result typed through a family type such as `SqlPlannerSuccessResult`.

## `sql-planner-success-subjects`

Change `plannerSuccess(plan, appliedStatements)` to `plannerSuccess(plan, appliedStatements, { dataLoss: [], accessWidening: [] })`, and `plannerSuccess(plan, appliedStatements, warnings)` to `plannerSuccess(plan, appliedStatements, { dataLoss: [], accessWidening: [] }, warnings)`, when the planner plans no operation that loses data or widens access. A SQL planner that does computes the lists with `subjectsOfCalls(calls, context)` from the same module, which takes what each call loses and what access it changes (`CallSubjects`, as the Postgres and SQLite planners build them; each access entry carries `widens`) and names each subject through the origin contract; `planFieldEventCalls(...)` returns the calls of the codec field-event hooks with the column each was returned for (`FieldEventCall`), so their subjects can be named too.

## `per-space-plan-subjects`

Add `dataLoss: []` and `accessWidening: []` to each `PerSpacePlan` object a test builds by hand. `PerSpacePlan` extends `MigrationPlanSubjects` from `@prisma/orm-framework/components/control`, which declares the two lists; `MigrationPlannerSuccessResult` extends it too.

Pass `storageNameOf` to each `planMigration({ ... })` and `resolveRecordedPath({ ... })` call: the family instance's `storageNameOf`, or `(operation) => operation.id` in a test. The aggregate planner fills the lists from the planner's result for a space it plans from a diff, and for a space it applies from recorded migrations it lists each destructive operation in `dataLoss` under its storage name, and no access widening, since a written migration is reviewed before it runs.

## `family-instance-storage-name-of`

A `ControlFamilyInstance` implementation adds `storageNameOf(operation: MigrationPlanOperation): string`. The aggregate planner calls it to name what a destructive operation of a recorded migration loses, since no planner mapped it to a model. A SQL family returns the name from the operation's target details, `schema.table.column` for a column and `schema.name` for anything else; `storageNameOfOperation` from `@prisma/orm-family-sql/family/control` does that. A test double returns any stable name.

A target whose planner carries out no rename statement sets `renameStatements: { refused: true, keepDataByHand(subject, fromContract) }` on its `migrations` capability. The CLI then offers no `--rename` in a data-loss question, and ends the question with the text `keepDataByHand` returns: how to keep the subject's data by hand before running the command again. MongoDB's target sets it in this release, and its text says to rename the collection in `mongosh` before a plan that drops it is applied, and that a migration written by `migration plan` still drops it.

## `operation-classes-and-calls`

An operation is `destructive` only when it can lose rows or values. Postgres `setNotNull`, and MongoDB `dropIndex`, `setValidation` and `collMod` (with no `operationClass` given), are now `widening`, and so are the op-factory calls a planner builds for them. A planner or test that asserts `operationClass: 'destructive'` for them asserts `'widening'`.

`AlterColumnTypeCall` takes an optional last constructor argument, `operationClass: 'widening' | 'destructive'`, default `'destructive'`; pass `'widening'` only when every value of the old type converts to the new type unchanged. `RecreateTableCall` takes an optional second constructor argument, `lossyColumns`: the columns whose values the copy can change because their type changes. A planner that builds a recreate for a type change passes them, so `dataLoss` names those fields; they never reach the operation or `migration.ts`.

## `control-client-db-update-answer-questions`

In code and documentation that call the control client's `dbUpdate({ ... })` without `answerQuestions`, add a callback. Detection finds files that call `dbUpdate(` and never mention `answerQuestions`; a file with one call that has it and another that lacks it is skipped, so check it by hand. Pass the options `dbUpdate` takes: `contract` (the emitted `contract.json`), `mode` and `migrationsDir`. In a README example that has none of them, add `import contract from './src/prisma/contract.json' with { type: 'json' };` after the control client's import, and write the call with a callback that refuses every data loss and access widening, as `dbUpdate` used to without consent:

```typescript
await control.dbUpdate({
  contract,
  mode: 'apply',
  migrationsDir: 'migrations',
  answerQuestions: async (questions) => {
    if (questions.length > 0) throw new Error('db update would lose data or widen access');
    return [];
  },
});
```

The callback is called at least once per apply, with an empty list when nothing is in question; return `[]` then. To consent, return one `{ verb, text }` per question, in order: a verb from `question.verbs` and `question.subject` as the text.

## `apply` is now `with`

The collection method that runs a function on a collection is now `with`. A pure filter is still written `where(rowFragment)`; `with` runs a query fragment, a function from a collection to a collection, for what `where` cannot express, such as a shared `select` and `include`, an order, a limit or offset, or a variant.

These changes apply to the SQL ORM client only. The MongoDB ORM client did not change; skip matches in code that uses it.

### Rename `apply` to `with`

Rename each call on a collection, in the extension's code and in the scopes or collection classes it exports:

```diff
- const posts = await db.orm.public.Post.apply(notDeleted).apply(postSummary).all();
+ const posts = await db.orm.public.Post.with(notDeleted).with(postSummary).all();
```

The same holds inside an include refinement and inside a fragment's body:

```diff
- db.orm.public.User.include('posts', (posts) => posts.apply(postSummary));
+ db.orm.public.User.include('posts', (posts) => posts.with(postSummary));
```

Do not rename `Function.prototype.apply` or `Reflect.apply`. A call such as `fn.apply(this, args)`, `fragment.apply(undefined, [collection])` or `Reflect.apply(fn, target, args)` calls a function, not a collection; leave it as it is. When a match is unclear, rename it only if its receiver's type is a collection: `db.orm.<namespace>.<Model>`, a chain on one, a custom class that extends `Collection`, or the collection an include refinement or a fragment's body receives.

Also rename `apply` to `with` in comments and documentation that name it as the collection method, such as "run with `apply` on any collection of posts". The next section renames `scope` to `fragment` in the same places.

`with` is a reserved word in JavaScript, but a valid method name. `collection.with(fragment)` works; destructuring it as `const { with } = collection` does not.

The error texts that named `apply` change as well; the final texts are under "Error texts" in the next section.

### `with` is a member of every collection

A custom collection class that declares its own `with` with another signature no longer compiles. Rename that member and its call sites:

```diff
  class PostCollection extends Collection<Contract, 'Post'> {
-   with(term: string) { return this.where((post) => post.title.ilike(`%${term}%`)); }
+   withTitle(term: string) { return this.where((post) => post.title.ilike(`%${term}%`)); }
  }
```

A class that declared its own `apply` because the name was reserved may keep it under that name or rename it back.

An aggregate operation named `with` is now refused with `ORM.AGGREGATE_OPERATION_RESERVED` when the client is built; rename the operation. An aggregate operation may now be named `apply`.

## The `scope` methods and types are renamed to `fragment`

The general term for a function from a collection to a collection, run with `collection.with(fn)`, is **query fragment**, or **fragment** for short. A **scope** is a fragment that only imposes conditions on the query, such as a soft-delete filter. The methods and types that make fragments were named `scope`, although they also make fragments that select, include or order, so they are renamed to `fragment`. What they do has not changed.

These changes apply to the SQL ORM client only. The MongoDB ORM client did not change; skip matches in code that uses it.

### Rename `scope` to `fragment`

Rename the client's method and the collection method:

```diff
- const notDeleted = db.orm.scope(
+ const notDeleted = db.orm.fragment(
    { deletedAt: field.temporal.timestamptz().optional() },
    (rows) => rows.where((r) => r.deletedAt.isNull()),
  );
- const postSummary = db.orm.public.Post.scope((posts) => posts.select('id', 'title').include('user'));
+ const postSummary = db.orm.public.Post.fragment((posts) => posts.select('id', 'title').include('user'));
```

The same holds on a chained collection, a custom collection class and `this` inside one, in the extension's code and in the fragments or collection classes it exports, and in a type such as `typeof db.orm.scope` or a destructuring such as `const { scope } = db.orm`. Rename a use only when its receiver is the ORM client (`db.orm`, or the client `orm()` returns) or a collection. Leave `.scope(` calls on other objects as they are.

### Rename the types

```diff
- import type { FieldScope, Scope, ScopeFacts } from '@prisma/orm-postgres/orm-client';
+ import type { FieldFragment, Fragment, FragmentFacts } from '@prisma/orm-postgres/orm-client';
```

Rename every use of these types in the file, including a re-export such as `export type { Scope } from '@prisma/orm-postgres/orm-client'` and a qualified name such as `Orm.Scope` after `import * as Orm from '@prisma/orm-postgres/orm-client'`. Do not rename the SQL builder's `Scope` or `ScopeField`, which describe the tables and columns a builder query can see; they are imported from a `builder` entry or `@internal/sql-builder`, not from the ORM client.

### Rename what you named after scopes

Code that calls a fragment a "scope" still compiles, but rename it to match the new words. Name a module, a variable or a comment for a fragment that selects, includes, orders or limits a fragment, and keep "scope" for a fragment that only imposes conditions on the query. For example, a module `scopes.ts` that holds both a filter and a shared `select` becomes `fragments.ts`, with its imports updated, while a comment that describes a filter in it as a scope stays. Update documentation the same way, such as a README that names `db.orm.scope`, `.scope(...)` or a module you renamed.

### `fragment` is a member of every collection

A custom collection class that declares its own `fragment` with another signature no longer compiles. Rename that member and its call sites:

```diff
  class PostCollection extends Collection<Contract, 'Post'> {
-   fragment(text: string) { return this.where((post) => post.body.ilike(`%${text}%`)); }
+   containing(text: string) { return this.where((post) => post.body.ilike(`%${text}%`)); }
  }
```

A class may now declare a method named `scope`.

An aggregate operation named `fragment` is now refused with `ORM.AGGREGATE_OPERATION_RESERVED` when the client is built; rename the operation. An aggregate operation may now be named `scope`.

### A namespace named `fragment`

A contract namespace takes its name on the client even when the client has a method of that name. If your contract has a namespace named `fragment`, `db.orm.fragment` is that namespace, and the client has no method to make a fragment for any model. If code calls `db.orm.scope(fields, body)` with such a contract, replace each call: a fragment for one model with `collection.fragment(body)` on each model it serves, or a filter with a function of the model accessor (a row fragment) whose parameter is typed with `CodecField`, passed to `where`. A namespace named `scope` no longer hides a method, and `db.orm.scope` still reaches it.

### Error texts

Errors and compile errors about fragments say "fragment" where they said "scope". Before this change, after `apply` was renamed to `with`, they read `Cannot define the scope: the body is not a function`, `Pass the scope to with on a collection: collection.with(scope).` and, for the refused bulk writes, `A scope passed to with can add one without showing it at the call site.` They now read `Cannot define the fragment: the body is not a function`, `Pass the fragment to with on a collection: collection.with(fragment).` and `A fragment passed to with can add one without showing it at the call site.` Every other text that said "the scope" or "a scope" says "the fragment" or "a fragment" in the same place. The compile error for a model that lacks a declared field names the property `the model has no field that matches the declaration in the fragment`. Update tests that assert on the old text.

## `collection-state-carries-locking`

`CollectionState` in `@internal/sql-orm-client` now has a required `locking: ReadonlyArray<LockingClause> | undefined`, the row locks the collection's `forUpdate()`, `forNoKeyUpdate()`, `forShare()` and `forKeyShare()` recorded. Where you build a state literal, start from `{ ...emptyState(), ... }`, or, when you derive it from an existing state, spread that state or copy `locking: state.locking`. Setting `locking: undefined` while deriving from a locked state drops the caller's lock without an error.
