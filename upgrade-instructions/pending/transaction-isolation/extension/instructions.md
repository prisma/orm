---
changes:
  - id: forward-sql-transaction-options
    summary: Forward resolved isolation options through SQL transaction wrappers and configure ORM-owned transactions separately.
---

# Forward resolved SQL transaction options

Import `SqlTransactionOptions` from `@prisma/orm-family-sql/relational-core/ast` when implementing SQL transaction wrappers. Accept optional `options?: SqlTransactionOptions` on connection `beginTransaction`/`transaction` methods and forward it unchanged through held-session and activity-owned routes. The options contain only an optional `isolationLevel`; drivers must not receive an implicit/explicit discriminator. An absent level retains database/session defaults.

Custom facades validate global and local callback isolation options before acquisition, resolve a defined local level over the global level, and pass the result as the third argument of `withTransaction`. Keep callback defaults in facade closures, never on shared runtimes or drivers. Unknown keys, null and unsupported levels reject; an undefined property inherits.

Configure ORM-owned transactions separately through the ORM factory's optional `implicitTransactionOptions`. The MySQL facade supplies `{ isolationLevel: 'ReadCommitted' }`; standalone ORM instances can opt into the same policy. Retain these options in collection configuration when rebinding execution to an activity. Nested create/update and other multi-statement mutations use the mutation graph, which passes resolved options to the activity's transaction method when opening a transaction. Do not restore the removed nested-mutation executor or its connection fallback. Existing transaction-bound ORM scopes participate without opening another transaction or changing isolation. Do not copy callback defaults into this configuration.

Drivers validate supplied levels and select fixed SQL. Preserve existing query serialization. MySQL SET TRANSACTION and BEGIN share one lock; a missing level uses the server/session default. Remove any blanket session isolation override used only to implement the old ORM policy.

Preserve start-refusal and settlement metadata in wrappers. Release only a known-clean connection; destroy after uncertain start or rollback, including successful SET followed by failed BEGIN. Keep the original setup error when cleanup fails. Role-session setup, transaction, and reset must use the same held connection.

Validate resolved-options forwarding, absent/default ORM policy, factory-to-activity-to-graph propagation, nested writes, callback precedence, same-session role behavior and destruction/reset failures. Do not add timeout or batch semantics as part of this translation.
