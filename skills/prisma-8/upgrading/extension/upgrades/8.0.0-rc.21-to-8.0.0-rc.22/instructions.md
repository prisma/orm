---
from: "8.0.0-rc.21"
to: "8.0.0-rc.22"
changes:
  - id: mongo-result-shapes-read-storage
    summary: |
      `contractModelToMongoResultShape` and `contractFieldToMongoFieldShape` from `@prisma/orm-mongo/query-builder` take the contract's storage, `{ storage: contract.storage }` and `contract.storage`, instead of its value objects. `compileMongoQuery` from `@prisma/orm-mongo/orm` takes the contract's storage as its fifth argument. `MongoValueObjects` is removed. This replaces the rc.14 advice to pass `valueObjects`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bMongoValueObjects\b'
        - '\bcontractModelToMongoResultShape\s*\([\s\S]*?\bvalueObjects\b'
        - '\bcontractFieldToMongoFieldShape\s*\('
        - '\bcompileMongoQuery\s*\('
  - id: postgres-check-expression-types-move
    summary: |
      `PostgresCheckKind`, `PostgresCheckExpressionInput` and `PostgresCheckExpressionCandidate` are removed from `@prisma/orm-postgres/target/types`. Use `CheckExpressionInput` and `CheckExpressionCandidate` from `@prisma/orm-postgres/family-contract/check-expressions` (also exported at the same path by `@prisma/orm-mysql` and `@prisma/orm-sqlite`). A candidate's `kind` is `'membership'`, `'elementNotNull'` or the new `'shape'`, the check of a value object column's shape.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bPostgresCheck(?:Kind|ExpressionInput|ExpressionCandidate)\b'
  - id: field-types-read-storage-value-objects
    summary: |
      In `@prisma/orm-framework/contract/types`, `ValueObjectTypesFromDomain` is now `ValueObjectTypesFromStorage`, which takes the contract's storage namespaces. `FieldTypesFromDomain` takes the storage namespaces as a new, required sixth argument, `Contract['storage']['namespaces']`, since it reads both planes. An override for a value object field is keyed by the value object's storage namespace, at `[storage namespace]['valueObjects'][valueObject][field]`, while a model field's override stays keyed by its domain namespace.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bValueObjectTypesFromDomain\b'
        - '\bFieldTypesFromDomain\s*<'
  - id: value-object-reference-type
    summary: |
      In `@prisma/orm-framework/contract/types`, `ValueObjectFieldType` is renamed `ValueObjectReference`: the type of a field that refers to a value object, which is now the value object's storage coordinate. `ContractValueObjectField` stays the type of a value object's own field.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bValueObjectFieldType\b'
  - id: postgres-codec-json-type
    summary: |
      A PostgreSQL codec descriptor declares `jsonType`: the JSON type the codec's value is written as inside a JSON document, one of `'string'`, `'number'`, `'boolean'`, `'object'`, `'array'` or `'any'`. `'any'` means any JSON value, including `null`, as for a JSON codec. The derived check of a value object column requires a member to be of its codec's JSON type, and a required member is never JSON `null` unless its codec's type is `'any'`. A class that extends `PostgresCodecDescriptor`, or an object that implements `AnyPostgresCodecDescriptor`, declares it as a property. `postgresCodec(template, options)` reads it from the template, so a family codec template declares it. A registry accepts a descriptor without it, but a contract build that derives the check of a value object whose member uses such a codec refuses it with `CONTRACT.CODEC_JSON_TYPE_MISSING`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bextends\s+PostgresCodecDescriptor\b'
        - '\bAnyPostgresCodecDescriptor\b'
        - '\bpostgresCodec\s*\('
  - id: sql-stack-with-driver-requires-driver
    summary: |
      `SqlExecutionStackWithDriver` now requires its `driver`, and `createSqlExecutionStack(...)` returns it only when given a driver. Without a driver it returns `SqlExecutionStack`, which has no `driver` member. `createToSql(stack, contract)` takes `SqlExecutionStack`. Type a stack built without a driver as `SqlExecutionStack`, and remove checks such as `if (!stack.driver) throw ...` on a stack typed `SqlExecutionStackWithDriver`, which can no longer fail. The framework `ExecutionStack` now declares `driver` optional. The detection matches files that name `SqlExecutionStackWithDriver` or read `driver` from a stack, such as `stack.driver`, `clientStack.driver` or `const { driver } = createSqlExecutionStack(...)`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])SqlExecutionStackWithDriver(?![\w$])'
        - '(?<![\w$.])(?:this\.)?[\w$]*[sS]tack\.driver(?![\w$])'
        - '\{(?:[^{}]*,)?\s*driver(?![\w$])[^{}]*\}\s*=\s*(?:createSqlExecutionStack\s*\(|(?:this\.)?[\w$]*[sS]tack(?![\w$]))'
  - id: runtime-mode-from-framework-components
    summary: |
      No action is needed. `RuntimeMode` is now declared in `@internal/framework-components/runtime` and still exported from `@internal/sql-runtime`.
  - id: declare-postgres-extension-in-pack-contract
    summary: |
      A Postgres pack whose migration installs an extension with `installExtension(...)` and an invariant cannot be adopted by `prisma db sign`, which refuses a space whose head ref requires an invariant its marker does not record. Declare the extension in the pack's contract instead, with `extension pg_trgm {}` in PSL or `entities: [extension('pg_trgm')]` in a TypeScript contract, re-run `prisma contract emit` for the pack, and plan two migrations with `prisma migration plan`: one from the old head (`--from <old head hash>`), whose one operation creates the extension if it is missing, and one from the empty contract (`--from @empty`). Wire both into the descriptor's `contractSpace.migrations`, keep the old install migration, and set `migrations/refs/head.json` to the new storage hash with no invariants.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])installExtension\s*\('
  - id: mongo-driver-from-runtime-descriptor
    summary: |
      `@internal/driver-mongo` has no root export any more, so `createMongoDriver` and `MongoDriverImpl` are gone, as `@internal/driver-postgres` has none. Create a runtime driver from the descriptor that `@prisma/orm-target-mongo/driver/runtime` exports by default, then connect it. `@prisma/orm-mongo/driver` and `@prisma/orm-target-mongo/driver` now export what `driver/control` and `driver/runtime` export. The detection matches files that name `createMongoDriver` or `MongoDriverImpl`, or import the root `@internal/driver-mongo`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\w$])(?:createMongoDriver|MongoDriverImpl)(?![\w$])'
        - '[''"]@internal/driver-mongo[''"]'
  - id: mongo-driver-connect
    summary: |
      `@internal/mongo-lowering` adds `MongoQueryable`, with `execute` and `run`, as `SqlQueryable` is for SQL. `MongoDriver<TBinding = void>` extends it and adds `connect(binding)` and `close()`, as `SqlDriver<TBinding>` does. `MongoControlDriverInstance` extends `MongoQueryable`, not `MongoDriver`, so a control driver has no `connect`. `executeDdl`, `MongoRunnerDependencies.driver` and the migration runner now take `MongoQueryable`; `createMongoRuntime` takes `MongoDriver<unknown>`. Type code that only sends commands, or that receives a control driver, as `MongoQueryable`. A runtime driver you implement as `MongoDriver` adds `connect`. The detection matches classes that implement `MongoDriver`, interfaces and classes that extend it, type aliases that name it, and values, parameters and return types annotated or checked as `MongoDriver`, also inside a generic such as `Promise<MongoDriver>`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'implements\s[^{]*(?<![\w$])MongoDriver(?![\w$])'
        - '[\w$)]\??\s*:\s*MongoDriver(?![\w$])'
        - '[\w$)]\??\s*:\s*[\w$.]+<[^;{=]*(?<![\w$])MongoDriver(?![\w$])'
        - 'satisfies\s+MongoDriver(?![\w$])'
        - '(?:interface|class)\s[^{]*extends\s[^{]*(?<![\w$])MongoDriver(?![\w$])'
        - 'type\s+[\w$]+(?:<[^>]*>)?\s*=[^;]*(?<![\w$])MongoDriver(?![\w$])'
  - id: mongo-query-takes-context
    summary: |
      `mongoQuery` (`@internal/mongo-query-builder`, published as `@prisma/orm-family-mongo/query-builder` and `@prisma/orm-mongo/query-builder`) takes `{ context }`, a `MongoExecutionContext`, instead of `{ contract }`, and reads the contract from it. Code that builds the builder itself passes the execution context it already has, for example `mongoQuery({ context })` after `createMongoExecutionContext({ contract, stack })`; code that has a client or a static context uses `db.query` or `mongoStatic({ contract }).query`. The detection matches files that call `mongoQuery` with a `contract` option, import it under another name, or call it through a namespace import.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\w$.])mongoQuery\s*(?:<[^>()]*>)?\s*\(\s*\{\s*contract\b'
        - '(?<![\w$.])mongoQuery\s+as\s+[\w$]+'
        - '(?<![\s\S])(?=[\s\S]*\bimport\s*\*\s*as\s+([\w$]+)\s+from\s*[\x27\x22](?:@prisma/orm-(?:family-)?mongo/query-builder|@internal/mongo-query-builder)[\x27\x22])[\s\S]*(?<![\w$.])\1\s*\.\s*mongoQuery\s*\('
  - id: mongo-orm-takes-context
    summary: |
      `mongoOrm()` (`@internal/mongo-orm`, published as `@prisma/orm-family-mongo/orm` and `@prisma/orm-mongo/orm`) takes `{ context, runtime }`, as the SQL `orm({ context, runtime })` does. `MongoOrmOptions` loses `contract`, `executor`, `enums` and `mutationDefaults`: the ORM reads the contract, the codecs it builds enum accessors from, and the execution defaults from the context, and `runtime` is the executor. `mongoRaw()` takes `{ context }`. `createMongoCollection()` takes `({ context, runtime }, modelName)` (`MongoCollectionContext`, as the SQL ORM's `CollectionContext`) and always fills execution defaults. `MongoOrmEnums` and `ORM.MUTATION_DEFAULTS_MISSING` are removed, and the ORM no longer raises `ORM.ARGUMENT_INVALID` for missing enum accessors. The detection matches files that call `mongoOrm` or `mongoRaw` with a `contract` option, call `mongoOrm` with `executor` or `enums`, call `createMongoCollection` without a context object, pass `mutationDefaults`, or name `MongoOrmEnums` or `ORM.MUTATION_DEFAULTS_MISSING`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\w$.])mongo(?:Orm|Raw)\s*(?:<[^>()]*>)?\s*\(\s*\{\s*contract\b'
        - '(?<![\w$.])mongoOrm\s*(?:<[^>()]*>)?\s*\(\s*\{(?:[^{}]|\{[^{}]*\})*\b(?:executor|enums)\b'
        - '(?<![\w$.])createMongoCollection\s*(?:<[^>()]*>)?\s*\(\s*(?!\{)'
        - '(?<![\w$])mutationDefaults\s*:'
        - '(?<![\w$])MongoOrmEnums(?![\w$])'
        - 'MUTATION_DEFAULTS_MISSING'
  - id: mongo-runtime-takes-adapter
    summary: |
      `MongoRuntimeOptions` is `{ context, adapter, driver, middleware?, mode? }`, as the SQL runtime's options are: the caller creates the adapter with `stack.adapter.create(stack)`, and the runtime checks middleware against `context.contract.target`, so `context` is a `MongoExecutionContext<MongoContract>`. `MongoExecutionContext` is declared in `@prisma/orm-family-mongo/query-ast/execution` (`@internal/mongo-query-ast/execution`), still exported from the runtime entry; it has no `stack` member and no second type parameter (`TTargetId`), and its type parameter is constrained as SQL's `ExecutionContext` is: `MongoExecutionContext<TContract extends MongoContract = MongoContract>`, and `createMongoExecutionContext` takes the same constraint. `createMongoExecutionStack()` still takes an optional `driver`; given one, it returns `MongoExecutionStackWithDriver`, whose `driver` is always set, and without one it returns `MongoExecutionStack`, which has no `driver` member, as `createSqlExecutionStack()` does. `buildMongoEnums()` and `MongoEnumAccessors` are removed, and `MongoExecutionContext` has no `enums` member, as SQL's `ExecutionContext` has none: the static context builds `db.enums` with the framework's `buildNamespacedEnums`, as `postgresStatic()` does, and the ORM builds the accessors it checks writes against from the context, once per client. The detection matches files that call `createMongoRuntime(`, read `.stack` from a context, give `MongoExecutionContext` two type arguments or a non-contract type argument, or name `buildMongoEnums` or `MongoEnumAccessors`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\w$.])createMongoRuntime\s*\('
        - '(?<![\w$])[\w$]*[cC]ontext\s*\.\s*stack(?![\w$])'
        - '(?<![\w$])MongoExecutionContext\s*<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*,'
        - '(?<![\w$])MongoExecutionContext\s*<\s*(?:unknown|\{)'
        - '(?<![\w$.])(?:buildMongoEnums|MongoEnumAccessors)(?![\w$])'
  - id: mongo-build-refusal-index-duplicate-removed
    summary: |
      The MongoDB contract builder's `BuildRefusal` type, exported from `@prisma/orm-family-mongo/contract-ts/contract-builder`, no longer has the kind `indexDuplicate`. The builder now merges identical and redundant indexes instead of refusing them. Remove any `case 'indexDuplicate'` and any other code that reads that kind.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bindexDuplicate\b'
  - id: mongo-index-lookup-key-moved
    summary: |
      `indexLookupKey`, `MONGO_INDEX_OPTION_KEYS`, `MongoIndexOptionKey` and `canonicalize` are no longer exported from `@prisma/orm-family-mongo/schema-ir`. Import them from `@prisma/orm-family-mongo/contract`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'import\s+(?:type\s+)?\{[^}]*\b(?:indexLookupKey|MONGO_INDEX_OPTION_KEYS|MongoIndexOptionKey|canonicalize)\b[^}]*\}\s*from\s*[\x27"]@prisma/orm-family-mongo/schema-ir[\x27"]'
  - id: client-connect-safe-to-call-again
    summary: |
      `connect()` without options on a `postgres()`, `sqlite()`, `mysql()` or `mongo()` client no longer rejects when the client is connecting or connected. It waits for the connection and resolves with the runtime. `connect(options)` on such a client still rejects with `DRIVER.ALREADY_CONNECTED`, but its message is now `<Target> client is already bound` (for example `Postgres client is already bound`), it has a `why`, and its `fix` changed. Update code or tests that branch on `DRIVER.ALREADY_CONNECTED` after a `connect()` without options, or that match the old message `<Target> client already connected` or the old `fix` "Call connect() at most once per client.". Code that avoided a second `connect()` for fear of this error may call it freely. A `connect()` that is waiting when `close()` is called now rejects with `DRIVER.NOT_CONNECTED`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - 'DRIVER\.ALREADY_CONNECTED'
        - '(?:Postgres|SQLite|MySQL|Mongo) client already connected'
        - 'Call connect\(\) at most once per client'
---

# 8.0.0-rc.21 → 8.0.0-rc.22 — Extension author upgrade instructions

No change in this guide comes with a script. Make the changes below in any order.


## Value objects are storage entities

A contract keeps its value objects in storage, at `storage.namespaces.<ns>.entries.valueObject`, and a domain field names its value object by a storage coordinate. Code that read `domain.namespaces.<ns>.valueObjects` reads the storage namespaces instead.

### `mongo-result-shapes-read-storage`

```ts
// before
contractModelToMongoResultShape(model, { includes: { author: authorShape }, valueObjects });
contractFieldToMongoFieldShape(field, valueObjects);
compileMongoQuery(collection, state, storageHash, model, valueObjects);

// after
contractModelToMongoResultShape(model, { includes: { author: authorShape }, storage: contract.storage });
contractFieldToMongoFieldShape(field, contract.storage);
compileMongoQuery(collection, state, storageHash, model, contract.storage);
```

A value object field's shape is a document of its fields when `storage` holds the value object the field's coordinate names. Drop any `MongoValueObjects` type annotation; each parameter takes an object with the contract's storage `namespaces`.

### `postgres-check-expression-types-move`

```ts
// before
import type { PostgresCheckExpressionInput } from '@prisma/orm-postgres/target/types';

// after
import type { CheckExpressionInput } from '@prisma/orm-postgres/family-contract/check-expressions';
```

`postgresRenderCheckExpressions` stays in `@prisma/orm-postgres/target/types`. Its input also takes `valueObject`, a `ResolvedColumnValueObject` (the column's nullability, whether its JSON value is an array, and the value object), or `undefined`.

### `field-types-read-storage-value-objects`

```ts
// before
import type { FieldTypesFromDomain, ValueObjectTypesFromDomain } from '@prisma/orm-framework/contract/types';
type Fields = FieldTypesFromDomain<Contract['domain']['namespaces'], CodecTypes, Parameterized, Overrides, 'output'>;
type ValueObjects = ValueObjectTypesFromDomain<Contract['domain']['namespaces'], CodecTypes, Parameterized, Overrides, 'output'>;

// after
import type { FieldTypesFromDomain, ValueObjectTypesFromStorage } from '@prisma/orm-framework/contract/types';
type Fields = FieldTypesFromDomain<Contract['domain']['namespaces'], CodecTypes, Parameterized, Overrides, 'output', Contract['storage']['namespaces']>;
type ValueObjects = ValueObjectTypesFromStorage<Contract['storage']['namespaces'], CodecTypes, Parameterized, Overrides, 'output'>;
```

Pass the sixth argument for every contract, with value objects or without. `FieldTypeOverrides` has two kinds of key at its top level. Under `models`, the key is the domain namespace of the model. Under `valueObjects`, the key is the storage namespace that holds the value object. These can differ. On SQL every value object is stored in the default storage namespace, such as `public` on Postgres, whatever the namespace of the model that holds it. On MongoDB it is `__unbound__`.

```ts
// a model `User` in the PSL namespace `billing`, with an `Address` field, on Postgres
type FieldTypeOverrides = {
  readonly billing: { readonly models: { readonly User: { readonly status: { readonly output: 'active' | 'closed' } } } };
  readonly public: { readonly valueObjects: { readonly Address: { readonly kind: { readonly output: 'home' | 'work' } } } };
};
```

### `value-object-reference-type`

```ts
// before
import type { ValueObjectFieldType } from '@prisma/orm-framework/contract/types';
const reference: ValueObjectFieldType = { kind: 'valueObject', name: 'Address' };

// after
import type { ValueObjectReference } from '@prisma/orm-framework/contract/types';
const reference: ValueObjectReference = {
  kind: 'valueObject',
  plane: 'storage',
  namespaceId: 'public',
  entityKind: 'valueObject',
  entityName: 'Address',
};
```

### `postgres-codec-json-type`

```ts
// before
export class CitextDescriptor extends PostgresCodecDescriptor<void> {
  override readonly codecId = 'citext/text@1';
  // ...
}

// after
export class CitextDescriptor extends PostgresCodecDescriptor<void> {
  override readonly jsonType = 'string' as const;
  override readonly codecId = 'citext/text@1';
  // ...
}
```

Declare the type the codec's value is written as when the application value is turned into JSON: a vector is `'array'`, a geometry and bytes are `'object'`, and a JSON codec is `'any'`. A template passed to `postgresCodec(template, options)` declares `jsonType` itself, as the `sql/*` family codecs do.


## A SQL stack with a driver always has one

```ts
// Before
const stack: SqlExecutionStackWithDriver<'postgres'> = createSqlExecutionStack({ target, adapter });
if (!stack.driver) throw new Error('Driver descriptor missing from execution stack');

// After
const staticStack: SqlExecutionStack<'postgres'> = createSqlExecutionStack({ target, adapter });
const clientStack = createSqlExecutionStack({ target, adapter, driver });
const driverInstance = clientStack.driver.create();
```


## Declare a pack's Postgres extension in its contract

```ts
// Before: src/contract.ts
export const contract = defineContract(config, () => ({ models: {} }));

// After
import { defineContract, extension } from '@prisma/orm-postgres/contract-builder';
export const contract = defineContract(config, () => ({
  models: {},
  entities: [extension('vector')],
}));
```

After emitting the pack's contract, plan from the old head and from the empty contract, keep the old install migration in the descriptor, and list the two new migrations beside it. The head ref lists no invariants.


## Create a Mongo runtime driver from its descriptor

Put the descriptor on the execution stack, create the driver from the stack, and connect it to a binding. A `{ kind: 'url', url, dbName }` binding makes the driver open a `MongoClient` and close it on `close()`. A `{ kind: 'mongoClient', client, dbName }` binding uses your client and leaves it open.

```ts
// Before
import { createMongoDriver } from '@prisma/orm-target-mongo/driver';

const stack = createMongoExecutionStack({ target: mongoRuntimeTarget, adapter: mongoRuntimeAdapter });
const driver = await createMongoDriver(url, dbName);

// After
import mongoRuntimeDriver from '@prisma/orm-target-mongo/driver/runtime';

const stack = createMongoExecutionStack({
  target: mongoRuntimeTarget,
  adapter: mongoRuntimeAdapter,
  driver: mongoRuntimeDriver,
});
const driver = stack.driver.create();
await driver.connect({ kind: 'url', url, dbName });
```

Replace `MongoDriverImpl.fromDb(client.db(dbName))` with `driver.connect({ kind: 'mongoClient', client, dbName })` on a driver created the same way. Code that only sends DDL through a control adapter can use the control driver instead: `await mongoControlDriver.create(url)`, with `mongoControlDriver` the default export of `@prisma/orm-target-mongo/driver/control`. The control driver uses the database the URL names, so put `dbName` in the URL's path, for example `mongodb://localhost:27017/app`.

`createMongoRuntime(...)` closes the driver when the runtime closes, so keep calling `runtime.close()` and drop any separate `driver.close()`.

## Send commands through `MongoQueryable`, connect through `MongoDriver`

Code that only sends commands takes `MongoQueryable`, so it accepts a control driver and a runtime driver alike:

```ts
// Before
async function seed(driver: MongoDriver): Promise<void> {
  await driver.run(new CreateCollectionWireCommand('users', {}));
}

// After
async function seed(driver: MongoQueryable): Promise<void> {
  await driver.run(new CreateCollectionWireCommand('users', {}));
}
```

A stub that stands in for a control driver or a runner's driver implements `MongoQueryable`. A runtime driver that implements `MongoDriver` adds `connect`:

```ts
// Before
class StubMongoDriver implements MongoDriver {
  execute<Row>(command: AnyMongoDmlWireCommand): AsyncIterable<Row> { ... }
  async run(command: AnyMongoDdlWireCommand): Promise<void> { ... }
  async close(): Promise<void> {}
}

// After, when it only sends commands
class StubMongoDriver implements MongoQueryable {
  execute<Row>(command: AnyMongoDmlWireCommand): AsyncIterable<Row> { ... }
  async run(command: AnyMongoDdlWireCommand): Promise<void> { ... }
}

// After, when it is a runtime driver
class StubMongoDriver implements MongoDriver {
  async connect(): Promise<void> {}
  execute<Row>(command: AnyMongoDmlWireCommand): AsyncIterable<Row> { ... }
  async run(command: AnyMongoDdlWireCommand): Promise<void> { ... }
  async close(): Promise<void> {}
}
```


## The MongoDB query surfaces and runtime take an execution context

`mongoQuery`, `mongoRaw` and `mongoOrm` take `{ context }`, a MongoDB execution context, instead of `{ contract }`, as `sql({ context })` and the SQL ORM do. The context comes from `mongoStatic({ contract })` or `mongo({ contract })`, which validate the contract once.

```ts
// Before
import { mongoQuery } from '@prisma/orm-mongo/query-builder';
const query = mongoQuery({ contract });
const raw = mongoRaw({ contract });

// After
import mongoStatic from '@prisma/orm-mongo/static';
const { query, raw } = mongoStatic({ contract });

// Or, with a client
const db = mongo({ contract, url });
db.query.from('orders');
```

Code that builds the ORM itself passes the context, which also fills generated fields:

```ts
// Before
const orm = mongoOrm({ contract, executor, mutationDefaults: context, enums });
const users = createMongoCollection(contract, 'User', executor, enums, context);

// After, as the SQL orm({ context, runtime })
const orm = mongoOrm({ context, runtime: executor });
const users = createMongoCollection({ context, runtime: executor }, 'User');
```

The runtime takes an adapter beside the context, as the SQL runtime does, and reads the target from the context's contract:

```ts
// Before
const runtime = createMongoRuntime({ context, stack, driver });

// After
const stack = createMongoExecutionStack({ target, adapter });
const context = createMongoExecutionContext({ contract, stack });
const runtime = createMongoRuntime({ context, adapter: stack.adapter.create(stack), driver });
```

`MongoExecutionContext` takes one type parameter, a MongoDB contract: `MongoExecutionContext<Contract>`.


## MongoDB index identity: one refusal gone, four names moved

### `mongo-build-refusal-index-duplicate-removed`

Code that switches over `refusal.kind` no longer compiles while it names `indexDuplicate`. Delete that case:

```typescript
switch (refusal.kind) {
  case 'indexShape':
    return describeShape(refusal);
  // remove: case 'indexDuplicate': ...
}
```

### `mongo-index-lookup-key-moved`

The contract builder, the planner and the verifier now identify an index by one function in the contract package. Move these names to the `contract` import:

```typescript
import { MongoSchemaIndex } from '@prisma/orm-family-mongo/schema-ir';
import { indexLookupKey } from '@prisma/orm-family-mongo/contract';
```


## `connect()` on a client is safe to call again

```ts
// Before
await db.orm.public.User.first();
await db.connect(); // rejected with DRIVER.ALREADY_CONNECTED

// After
await db.orm.public.User.first();
await db.connect(); // resolves with the same runtime
await db.connect({ url: other }); // rejects: "Postgres client is already bound"
```

Replace an assertion on the old message with the new one:

```ts
// Before
await expect(db.connect({ url })).rejects.toThrow('Postgres client already connected');

// After
await expect(db.connect({ url })).rejects.toThrow('Postgres client is already bound');
```
