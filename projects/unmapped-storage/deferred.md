# Deferred

- **ADR 267 says a table node for a modelled table is refused.** The build allows one that lists only columns, and refuses it only when it also states table-level properties. Fix the ADR text in prisma/orm#30641 before it merges. (Slice 1 system-design review, 2026-10-09.)
- **A cross-space foreign key is typed as a model reference.** `ForeignKeyNode.references` with `spaceId` carries a `model` the build never looks up; in practice it is a table reference into another contract space. Changing it changes what the PSL reader produces, so it belongs with a change to that reader, not slice 1.
- **A relation to a bare model name used in two namespaces resolves by list order.** Recorded on TML-3280.
- **A many-to-many junction declared only by a table node is refused,** because a relation's `through` resolves by model. This matches ADR 267 (a junction is a model).
