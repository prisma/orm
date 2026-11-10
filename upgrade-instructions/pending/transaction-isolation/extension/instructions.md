---
changes:
  - id: forward-sql-transaction-start
    summary: Forward explicit or implicit isolation intent through SQL driver and role-session transaction wrappers.
---

# Forward SQL transaction start intent

Import `SqlTransactionStart` from `@prisma/orm-family-sql/relational-core/ast` when implementing SQL transaction wrappers. Accept optional `start?: SqlTransactionStart` on connection `beginTransaction`/`transaction` methods and forward it unchanged through held-session and activity-owned routes. An explicit start may carry `isolationLevel`; an implicit start represents ORM-owned work. An absent start retains manual/default behavior.

Custom facades validate global and local isolation options before acquisition, resolve a defined local level over the global level, and pass the result as the third argument of `withTransaction`. Keep callback defaults in facade closures, never on shared runtimes or drivers. Unknown keys, null and unsupported levels reject; an undefined property inherits. Existing transactions must remain the execution context for participating ORM operations, not trigger a second start.

Drivers validate target levels and select fixed SQL. Preserve existing query serialization. MySQL SET TRANSACTION and BEGIN share one lock; implicit starts select ReadCommitted, while unconfigured explicit starts use the server/session default. Remove any blanket session isolation override used only to implement the old implicit policy.

Preserve start-refusal and settlement metadata in wrappers. Release only a known-clean connection; destroy after uncertain start or rollback, including successful SET followed by failed BEGIN. Keep the original setup error when cleanup fails. Role-session setup, transaction, and reset must use the same held connection.

Validate the translation with explicit/implicit/absent start-input tests, local/global/undefined/null validation tests, same-session role tests, and destruction/reset failure tests. Do not add timeout or batch semantics as part of this translation.
