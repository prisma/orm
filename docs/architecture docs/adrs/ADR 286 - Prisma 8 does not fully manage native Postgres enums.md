# ADR 286 — Prisma 8 does not fully manage native Postgres enums

**Status:** Accepted
**Date:** 2026-10-22

---

## Decision

An `enum` declared in the contract is stored in a column with a `CHECK` constraint, not a native enum type. Prisma 8 supports native enums that something else manages, such as Supabase's, and for those `migration plan` only appends new values. Use instead: declare an `enum` in the contract and let Prisma 8 store it with a `CHECK` constraint. For a native enum you rename, remove or reorder values in, write that migration by hand.

## Context

[Why Prisma 8 only supports externally-managed native Postgres enums](../../reference/postgres-native-enums.md) explains the limit: appending a value is the one change Postgres allows without rewriting the table; removing or reordering a value needs a new type and a full-table rewrite; and a value added in a transaction cannot be used in the same transaction, which breaks the atomic migrations Prisma 8 relies on.

## Consequences

Migrations stay atomic. No revisit-if condition is recorded.
