# Why Prisma 8 only supports externally-managed native Postgres enums

Postgres lets you define an enum as its own database type (`CREATE TYPE mood AS ENUM ('sad', 'happy')`). It looks tidy, but the type is a standalone object, separate from the tables that use it, and that makes it surprisingly painful to change later. Here's why.

- **You can't add a value and use it in the same transaction.** `ALTER TYPE ... ADD VALUE` is special-cased: the new value isn't usable until the transaction that adds it commits (and older Postgres won't let `ADD VALUE` run inside a transaction block at all). So a migration can't add an enum value and apply the changes that depend on it as one atomic step — and that atomicity is a guarantee Prisma 8's migrations rely on.

- **There's no way to remove or reorder a value in place.** Postgres simply has no command for it. Your only option is to build a *brand-new* enum type with the values you want and switch the column over to it.

- **And switching the column rewrites the whole table.** A column doesn't store the enum's text — it stores a reference bound to that specific type. Pointing the column at a new type means Postgres re-encodes **every row** into a fresh copy of the table, holding a lock that blocks all reads and writes until it finishes. On a large table that's a maintenance window, not a quick migration.

- **So changing enum data gets expensive fast.** Removing or reordering values on a column that already holds data takes 2 transactions, 1 full-table rewrite, and 1 data migration (convert the affected rows, then rebuild the type and repoint the column). If you need zero downtime, you stage it through a temporary type instead — which costs *2 full-table rewrites*.

- **Native enums can only hold strings.** You can't map an enum label to an arbitrary value; the stored values are always text.

`CHECK` constraints avoid all of this. The one tradeoff is disk space — each value is written out in full rather than as a reference to a central definition — but in exchange you can add, remove, and reorder values freely, because they live in your application rather than as a database object. Every change behaves like a normal migration: no full-table rewrites, no extra transactions, consistent with everything else Prisma 8 does.

So our strategy is:

- Prisma 8 supports **externally-managed** native Postgres enums — for example, the ones Supabase defines.
- When you declare an `enum` in your contract, Prisma 8 creates and manages the column with a `CHECK` constraint instead.
- Prisma 8 also lets you declare and manage a native Postgres enum yourself. `migration plan` appends new values in place (`ALTER TYPE ... ADD VALUE`), because that's the one change Postgres allows without a rewrite. If you rename, remove, or reorder a value, you own that migration — dropping the type, creating the replacement, and `ALTER`ing the column by hand.
