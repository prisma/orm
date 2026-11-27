# Slice: Prisma reads the files a release candidate wrote, by converting them

One pull request, built on the hash slice. Part of the project in [../../spec.md](../../spec.md).

## Why

The format version decision says a later release reads every file an earlier release wrote: each version of a file has a parser, and a unit converts a document of an earlier version into its own. Only version 1 exists, so the conversion path has never run. Files written by a release candidate are a real earlier format. Reading them through that path proves it works on real files before `8.0.0`, and spares release-candidate users the format script for now.

This is temporary. At `8.0.0` the version 0 units are deleted and a file without `formatVersion` is refused again, as the format version decision says.

Decided with Will on 2026-11-26. The hashes are not included: an old hash still needs the hash script and `prisma db sign`, because the hash rules are frozen from `8.0.0` and code that accepts the old hashes would be deleted without being reused.

## What is built

- **Version 0 of each kind of file:**
  - a contract or snapshot with `"schemaVersion": "1"` and no `formatVersion`;
  - a `migration.json` or ref file with no `formatVersion`.
  Only a release candidate wrote these, so the reader recognises them without guessing. A contract with neither field is still refused with `CONTRACT.FORMAT_VERSION_MISSING`: no release wrote it.
- **Conversion, as the format version decision describes it.** Each kind of file has a function that turns a version 0 document into a version 1 document. For `migration.json` and ref files it is in their version 1 units in the migration tooling. For the contract it lives in the framework, beside the shared reader: the step changes only the version field, which every family's contract shares, and the read paths that hold a contract before any family sees it (the CLI's contract reader, the snapshot store, an extension's bundled files) can then pass on only version 1. ADR 331 records this, and that a later step changing content one family owns needs each family to declare its own contract format. The reader converts one version at a time up to the newest it knows, so a later version 2 adds only its own converter. Built generally, not as a special case for version 0.
- **Every read path converts:** each family's contract reader, the CLI commands, the snapshot store, the loader behind the read commands, an extension's bundled files, and a contract passed to a client.
- **Reading changes nothing on disk.** Every writer writes version 1. A project may hold both versions at once, and that must work.
- **No hash changes.** Contract hashes do not read the version field, and the migration hash leaves `formatVersion` out, so a version 0 file keeps its hashes.
- **The hash script accepts version 0 files** and leaves their format as it is.
- **Upgrade instructions:** the format step is no longer required now. Its script stays, and the instructions say to run it before upgrading to `8.0.0`, which reads version 1 only.
- **A test that fails once the release is not a pre-release while a version 0 unit exists,** so `8.0.0` cannot ship with them.
- **The format version decision record** says what version 0 is and that it is removed at `8.0.0`.

## Tests

- Each converter: a version 0 document converts to the version 1 document the script would write.
- Each read path above accepts a version 0 file.
- A project in which every file is version 0, and one with both versions.
- A real project written by `8.0.0-rc.25`, after the hash script has run on it: every file reads, and the hashes it records are the hashes computed from its contracts.

## Done when

- The tests above pass, and each fails when its converter is broken.
- Manual QA: on the real `8.0.0-rc.25` project after the hash script, `contract emit`, `migration status`, `db sign`, `db migrate`, `db verify` and a query work with no format script run, on PostgreSQL and MongoDB.
- `/drive-code-review` on the final commit has no open finding.
