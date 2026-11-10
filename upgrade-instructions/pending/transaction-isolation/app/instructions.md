---
changes:
  - id: mysql-explicit-isolation-default
    summary: Configure ReadCommitted explicitly if MySQL callbacks relied on the previous session-wide override.
---

# Preserve an intentional MySQL callback isolation choice

MySQL no longer sets every session to READ COMMITTED. Unconfigured explicit callback transactions now use the server/session default. If application code relied on the previous override, add `transactionOptions: { isolationLevel: 'ReadCommitted' }` to its MySQL client factory, or pass `{ isolationLevel: 'ReadCommitted' }` as the second argument to the relevant `transaction(callback, options)` calls.

A defined per-call level overrides the factory level. An omitted or undefined level inherits it; null does not reset defaults and is rejected. ORM-owned implicit transactions continue to use ReadCommitted, independently of callback options. Manual lower-level transactions do not inherit factory defaults.

Verify behavior against the deployment's configured database default and concurrent transactions. Do not assume the server default is RepeatableRead. This change does not introduce batch transactions, timeout/maxWait options, P2028 handling or retry behavior.
