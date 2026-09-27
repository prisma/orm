# Target-named scalars for Postgres and SQLite

Shaped 2026-09-25, not started; spec input from the mongo-defaults-codecs-prisma6-source project. See [`spec.md`](./spec.md) for the rename tables, the `Json` preset split, the upgrade fragments and the documentation changes. The decision it applies is [ADR 256](../../docs/architecture%20docs/adrs/ADR%20256%20-%20Scalar%20types%20are%20named%20after%20the%20target%20on%20every%20surface.md).

> Everything under `projects/` is transient — migrate long-lived architecture and upgrade documentation to `docs/`, remove repo-wide references to this workspace, and delete it at project close-out per [`projects/README.md`](../README.md).
