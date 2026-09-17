---
changes:
  - id: forward-transaction-options
    summary: beginTransaction, RuntimeConnection.transaction and withTransaction take an optional options argument carrying isolationLevel; code that implements or wraps them forwards it, or rejects a level it cannot apply.
    detection:
      glob: "**/*.ts"
      contains:
        - "beginTransaction("
---

## `forward-transaction-options`

`SqlConnection.beginTransaction`, `RuntimeConnection.transaction` and `withTransaction` gain an optional `options?: SqlTransactionOptions` argument (`{ isolationLevel?: 'readUncommitted' | 'readCommitted' | 'repeatableRead' | 'serializable' }`, exported from `@internal/sql-relational-core/ast` and `@internal/sql-runtime`). Existing calls and existing zero-argument implementations still compile. Update the places that sit between a caller and the driver, so a requested level is never dropped on the way:

- **A `RuntimeConnection` you build yourself** (for example a session object returned by a runtime subclass): accept the argument and pass it to the driver connection.

  ```ts
  // before
  async transaction(): Promise<RuntimeTransaction> {
    const tx = await conn.beginTransaction();

  // after
  async transaction(options?: SqlTransactionOptions): Promise<RuntimeTransaction> {
    const tx = await conn.beginTransaction(options);
  ```

- **A client method that wraps `withTransaction`**: add `options?: SqlTransactionOptions` as the second parameter of your `transaction(fn, options)` method, in its interface declaration and its implementation, and pass it as the third argument: `withTransaction(runtime, fn, options)`.

- **A `SqlConnection` you implement yourself** (a custom driver): apply `options.isolationLevel` when you begin the transaction, in the same statement as `BEGIN` where the database allows it. If the database cannot apply the requested level, reject before beginning with a structured error whose `code` is `DRIVER.ISOLATION_LEVEL_UNSUPPORTED`. Do not ignore the option.
