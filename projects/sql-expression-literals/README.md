# SQL expression literals

Raw SQL in PSL and in the TypeScript contract builder is written one way everywhere: as a `` sql`...` `` literal, which is a value of the data type `sql/expression`.

- Linear project: [SQL expression literals](https://linear.app/prisma-company/project/sql-expression-literals-c8a6659e7f4c)
- Decision ticket: [TML-3282](https://linear.app/prisma-company/issue/TML-3282)
- [handover.md](handover.md): the next steps, for an agent taking over. Read it first.
- [status.md](status.md): where the work stands, and the context for resuming it. Read it first.
- [spec.md](spec.md): what the project delivers and when it is done.
- [design.md](design.md): every name, signature, message and file the project changes.
- [design-notes.md](design-notes.md): the decisions, their reasons, and the alternatives rejected.
- [plan.md](plan.md): the slices and their order.
- [research/](research/): the code survey the design is based on. Most reports cite commit `6a5b58ecb7`; `block-specs.md`, `rebase-delta.md` and `review-followups.md` cite `47d727b70d`, the head of PR #30381 before it was rebuilt and merged.
- [research/](research/) also holds the architect and principal-engineer reviews of the first design, and the verification of the second. The current design applies their findings.

This directory is transient. It is deleted at close-out, after its decisions have moved into ADR 256 and the ADRs it amends.
