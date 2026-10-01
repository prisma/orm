# Target-named scalars for Postgres and SQLite

Shaped 2026-09-25, not started; spec input from the Mongo defaults, codecs and Prisma 6 source project (merged 2026-09-25 to 2026-09-27). See [`spec.md`](./spec.md) for the rename tables, the `Json` preset split, `Json` refusing non-JSON values on PostgreSQL and SQLite, the enum storage-type rule moving into the framework, the upgrade fragments and the documentation changes. The decision it applies is [ADR 257](../../docs/architecture%20docs/adrs/ADR%20257%20-%20Scalar%20types%20are%20named%20after%20the%20target%20on%20every%20surface.md).

> Everything under `projects/` is transient — migrate long-lived architecture and upgrade documentation to `docs/`, remove repo-wide references to this workspace, and delete it at project close-out per [`projects/README.md`](../README.md).
