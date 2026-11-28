# Slice: every reader refuses a key the format does not define

Part of the format-versions pull request. Part of the project in [../../spec.md](../../spec.md).

## Why

The format version decision says a reader refuses a field it does not know, so that a release cannot add a field to a stored format without raising its version. That has to hold in `8.0.0`: an `8.0.0` reader stays in use for the whole major, and a reader that ignores an unknown key cannot be made strict afterwards. Several readers ignored unknown keys: about 25 kinds of object in a contract, every object in a MongoDB `ops.json`, and SQL `ops.json` had no reader at all.

## What is built

- **Contracts.** The validators of the SQL family, the PostgreSQL entry kinds and the MongoDB family refuse a key they do not define. The error names the key's full path.
- **MongoDB operations.** Every object in an operation is read strictly.
- **SQL operations.** A reader in the SQL family that every operation passes before a runner, the statement preview or the checks of a recorded path act on it. Each SQL target supplies a schema for its own fields, the step marks only it reads, and a conversion for its earlier shapes.
- **Open places.** Content Prisma carries for someone else accepts any key. The decision record lists the places.
- **Earlier shapes.** Format 1 of `ops.json` reads every shape a pre-release of Prisma 8 wrote, because `ops.json` is covered by the migration hash and cannot be rewritten. The reader converts each to the current shape before it checks the operation. They were found by going through the history of every writer across the published release tags, not only through the files saved in the repository.
- **Type parameters.** Every first-party codec's parameter schema refuses a key it does not define.

## Tests

- For each object made strict: one unknown key is refused, and the message names its path.
- Every contract and `ops.json` saved in the repository still reads, and each such test fails on an empty list of files.
- Each earlier shape reads, and a malformed one is refused.
- What each planner writes is accepted by the reader.

## Done when

- The tests above pass.
- A contract written by `8.0.0-rc.25` passes the strict validators after conversion from version 0.
- `/drive-code-review` on the final commit has no open finding.
