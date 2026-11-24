---
changes:
  - id: stored-files-format-version
    summary: |
      Every file Prisma stores in a project now names its format version. A `contract.json`, and each contract snapshot under `migrations/snapshots/<hash>/`, has `"formatVersion": 1` where it had `"schemaVersion": "1"`. Every `migration.json` and every ref file under `migrations/<space>/refs/` starts with `"formatVersion": 1`. This release refuses a file without it, with `CONTRACT.FORMAT_VERSION_MISSING` or `MIGRATION.FORMAT_VERSION_MISSING`. Run the colocated script on the project: it adds the version to each file and changes nothing else. No hash changes.
    detection:
      glob: "**/*.json"
      matches:
        - '"schemaVersion"\s*:\s*"1"[\s\S]*"targetFamily"\s*:|"targetFamily"\s*:[\s\S]*"schemaVersion"\s*:\s*"1"'
        - '(?<![\s\S])(?![\s\S]*"formatVersion")[\s\S]*"migrationHash"\s*:'
        - '(?<![\s\S])(?![\s\S]*"formatVersion")(?=[\s\S]*"hash"\s*:)[\s\S]*"invariants"\s*:'
    script: ./scripts/stored-files-format-version/stored-files-format-version.ts
---

# Stored files carry a format version

## `stored-files-format-version`

Each file Prisma writes into your repository now says which version of its format it is in, so a later release can tell an old file from a new one and refuse a file written by a newer release instead of misreading it:

```jsonc
// contract.json, before
{ "schemaVersion": "1", "targetFamily": "sql", ... }
// after
{ "formatVersion": 1, "targetFamily": "sql", ... }

// migration.json and refs/<name>.json, before
{ "from": null, "to": "...", ... }
// after
{ "formatVersion": 1, "from": null, "to": "...", ... }
```

This release reads only files that have it. Without it, `prisma db migrate`, `prisma db update`, `prisma migration plan` and the other commands stop with `CONTRACT.FORMAT_VERSION_MISSING` (for a contract or a snapshot) or `MIGRATION.FORMAT_VERSION_MISSING` (for a `migration.json` or a ref file), naming the file. So does a client given a `contract.json` that lacks it. A contract that Prisma built in memory, by the TypeScript contract builder or by `contractFromJson`, has no format version and needs none.

Commit your work first, so the script's changes can be reviewed and undone with git. Then run the script from the project root:

```sh
node <path-to-this-guide>/scripts/stored-files-format-version/stored-files-format-version.ts
```

Node 24 or later runs the TypeScript script directly; it needs no `tsx`. It reads and writes files only and needs no database. It walks the project, skipping `node_modules`, `dist`, `build` and directories whose name starts with a dot, and:

- in every contract (any `*.json` file with `targetFamily`, `storage` and `schemaVersion` at the top level: the emitted `contract.json` and each snapshot's), replaces `"schemaVersion": "1"` with `"formatVersion": 1`;
- in every `migration.json` that has an `ops.json` next to it, and every ref file under `<migrations>/<space>/refs/`, adds `"formatVersion": 1` as the first field. `<migrations>` is a folder that holds Prisma's contract snapshot store (a `snapshots` folder with a `<hash>/contract.json` in it) or a migration (a folder with both `migration.json` and `ops.json`), whatever the folder is named, so a migrations folder configured under another name is found too, and another tool's folder named `migrations` is not. A JSON file in any other `refs` folder is a ref when its content is one: a `hash` that is `empty` or a 64-character storage hash, and an `invariants` list of strings. So the refs of a space with no migrations are found even when `migrations/snapshots/` was deleted. Any other JSON file in a `refs` folder is not Prisma's, and the script leaves it alone.

It edits each file in place and keeps the rest of its bytes and layout. It prints each file it changed. A project already in the new form is left unchanged, and the script says nothing changed.

A ref file may have fields a ref does not have, for example a note added by hand. Earlier releases ignored such a field when they read the ref, and dropped it when they wrote the ref again. This release refuses the file, so the script drops the field and lists each field it dropped.

The script leaves a file unchanged, says what is wrong with it and what to do, and exits 1 when it cannot tell the file is one a release of Prisma wrote: a `contract.json`, `migration.json` or ref file it cannot read or parse; a ref file in a migrations folder it recognises without a `hash` or an `invariants` list; a `migration.json` next to an `ops.json` with a field the format does not have or without one it has; a contract with both `formatVersion` and `schemaVersion`; a `contract.json` holding a contract with neither; and a directory it cannot list. It still changes every other file. Fix each reported file by hand as the report says, then run the script again.

Outside a migrations folder the script recognises, it cannot tell a broken ref from another tool's file, so it leaves alone, without a report, any file in a `refs` folder that does not have a ref's content. If a command still refuses a ref file after the script ran, that ref was already invalid, and earlier releases refused it too. Restore it from version control, or set it again with `prisma migration ref set <name> <contract>`.

The script does not follow symbolic links. A link to a file or folder inside the project leads to files it reaches anyway, and a link to the project folder or a folder above it leads back to the project; the script ignores both. A link to a file or folder outside the project, such as a migrations folder shared between packages, that holds a stored file the script would change or report is reported, and the script exits 1: run the script on that folder too.

No hash covers the format version: storage hashes, snapshot directory names and each `migrationHash` stay as they are, and no database needs signing again.

Then re-emit the contract with `prisma contract emit`, which writes the new form itself, and commit the result.
