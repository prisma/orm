# Prisma 7 contract source and converter

Transient project workspace. Slices 1 and 4 are in https://github.com/prisma/orm/pull/30287, slice 3 (`contract print`) is in https://github.com/prisma/orm/pull/30315, and slice 5 (Prisma 8 takes over migrations from the Prisma 7 schema) is in https://github.com/prisma/orm/pull/30601. See [`spec.md`](./spec.md) for the project spec and [`design-notes.md`](./design-notes.md) for the alternatives considered. Slice specs live under [`slices/`](./slices/). The decisions the project publishes are recorded in [ADR 252](<../../docs/architecture docs/adrs/ADR 252 - An earlier Prisma version's schema is a contract source.md>).

Branch: `prisma7-contract-source`.

> Everything under `projects/` is transient. It is migrated to `docs/` or deleted at close-out per [`projects/README.md`](../README.md).
