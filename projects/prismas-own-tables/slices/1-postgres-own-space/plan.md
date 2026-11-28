# Slice 1: plan

The contract is in [spec.md](spec.md). Three dispatches, in order. Each is implemented by one agent and reviewed before the next starts.

## Dispatch 1. The space, and applying it below the command line

- `ControlTargetDescriptor` gains an optional `contractSpace`, and the reserved name `_prisma` gets a constant beside `APP_SPACE_ID`.
- A function in the migration tools that brings a descriptor-carried space up to date: read the space's row, stop when it is at the head, otherwise find the path through the in-memory migration packages and run it with the target's runner. `reconstructGraph` and `resolveRecordedPath` are widened to take packages without a folder path.
- The PostgreSQL target package gets the contract, the first migration, the head ref and the descriptor field.
- The PostgreSQL adapter's table handles, lookups and location names point at `_prisma`. `ensureControlTables` and the sign path's table creation stop running for PostgreSQL.
- Tests at the runner level against a real PostgreSQL database: fresh, release-candidate form, older form, and a second run. The descriptor consistency test. The package's existing runner tests get the tables through the new function.

## Dispatch 2. The commands

- The control client gets one method that calls the function, used at the start of `db init`, `db update` and `db sign`, and in the `db migrate` command before its first read. A dry run does not call it.
- `db init`, `db update` and `db verify` count `_prisma` as declared. `migration log` leaves its rows out by default.
- Commands that only read, and the client's check on first use, report the earlier form and name the command to run.
- The upgrade test of the spec, driven through the commands, and tests for each point above.

## Dispatch 3. What users read

- Every place in the skill, the examples, the reference docs and the READMEs that names `prisma_contract`.
- The upgrade instructions for this release.

The decision records and the subsystem doc are written by the orchestrator after dispatch 2.
