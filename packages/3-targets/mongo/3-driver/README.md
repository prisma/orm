# @internal/driver-mongo

MongoDB driver for Prisma 8. Executes wire-protocol documents against a MongoDB connection.

## Responsibilities

- **Command execution**: Sends lowered wire-protocol documents to MongoDB and returns raw results
- **Connection management**: Creates and manages the MongoDB client connection

## Entry points

- **`@internal/driver-mongo/runtime`**: the runtime driver descriptor (default export). `create()` returns a driver that is not connected; `connect(binding)` connects it to a `MongoBinding`, either `{ kind: 'url', url, dbName }` or `{ kind: 'mongoClient', client, dbName }`. `close()` closes a `MongoClient` the driver created from a URL and leaves a caller's client open. `mongo()` from `@internal/mongo/runtime` creates its driver from this descriptor through the execution stack.
- **`@internal/driver-mongo/control`**: the control driver descriptor the CLI uses.
