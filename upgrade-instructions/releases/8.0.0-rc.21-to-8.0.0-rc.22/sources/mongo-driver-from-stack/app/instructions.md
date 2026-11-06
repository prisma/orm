---
changes:
  - id: mongo-driver-from-runtime-descriptor
    summary: |
      `createMongoDriver` and `MongoDriverImpl` are no longer exported. `@prisma/orm-mongo/driver` and `@prisma/orm-target-mongo/driver` now export what `driver/control` and `driver/runtime` export, as the Postgres packages do. Create a runtime driver from the descriptor that `@prisma/orm-mongo/driver/runtime` exports by default, then connect it. The detection matches files that name `createMongoDriver` or `MongoDriverImpl`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\w$])(?:createMongoDriver|MongoDriverImpl)(?![\w$])'
---

# Create a Mongo runtime driver from its descriptor

Put the descriptor on the execution stack, create the driver from the stack, and connect it to a binding. A `{ kind: 'url', url, dbName }` binding makes the driver open a `MongoClient` and close it on `close()`. A `{ kind: 'mongoClient', client, dbName }` binding uses your client and leaves it open.

```ts
// Before
import { createMongoDriver } from '@prisma/orm-mongo/driver';

const stack = createMongoExecutionStack({ target: mongoRuntimeTarget, adapter: mongoRuntimeAdapter });
const driver = await createMongoDriver(url, dbName);

// After
import mongoRuntimeDriver from '@prisma/orm-mongo/driver/runtime';

const stack = createMongoExecutionStack({
  target: mongoRuntimeTarget,
  adapter: mongoRuntimeAdapter,
  driver: mongoRuntimeDriver,
});
const driver = stack.driver.create();
await driver.connect({ kind: 'url', url, dbName });
```

Replace `MongoDriverImpl.fromDb(client.db(dbName))` with `driver.connect({ kind: 'mongoClient', client, dbName })` on a driver created the same way. Code that only sends DDL through a control adapter can use the control driver instead: `await mongoControlDriver.create(url)`, with `mongoControlDriver` the default export of `@prisma/orm-mongo/driver/control`. The control driver uses the database the URL names, so put `dbName` in the URL's path, for example `mongodb://localhost:27017/app`.

`createMongoRuntime(...)` closes the driver when the runtime closes, so keep calling `runtime.close()` and drop any separate `driver.close()`.
