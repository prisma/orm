---
changes:
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
---

# Create a Mongo runtime driver from its descriptor

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

# Send commands through `MongoQueryable`, connect through `MongoDriver`

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
