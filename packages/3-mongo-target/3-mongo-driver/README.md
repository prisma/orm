# @internal/driver-mongo

MongoDB driver for Prisma 8. Executes wire-protocol documents against a MongoDB connection.

## Responsibilities

- **Command execution**: Sends lowered wire-protocol documents to MongoDB and returns raw results
- **Connection management**: Creates and manages the MongoDB client connection
