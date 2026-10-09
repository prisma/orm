# Drive `project` context

> Read by `drive-create-project` and `drive-close-project` before they start. Capture project-specific facts the generic skills can't know. Update when a drive run surfaces something the next run should inherit.

**Skills served:** `drive-create-project`, `drive-close-project`

## Project tracking

Transient project workspaces live under `projects/<project>/`. No default Linear team or board is assumed; record tracker references explicitly when supplied. Closed project workspaces are deleted rather than archived in-tree.

## Lanes & ownership

Use the ownership and review requirements of the affected Prisma packages. No separate Drive lane map is maintained.

## Acceptance-criteria conventions

Use binary `AC-<number>` criteria in the project review ledger. At close, retain evidence in the merged implementation PR and its tests; project coordination files remain transient.

## Closing conventions

Require all slice PRs to be merged or explicitly deferred, all review threads resolved, CI complete, and the mandatory final retro landed. Migrate only genuinely reusable methodology; specs, plans, briefs, rollups, reviews, walkthroughs, traces, and retros are transient. Open a dedicated close-out PR that deletes the project workspace.

## Known constraints & gaps

A project may have no Linear reference. In that case, state this explicitly in the close-out PR instead of inventing one.

## References

- Repository agent guidance: [`AGENTS.md`](../../AGENTS.md)
