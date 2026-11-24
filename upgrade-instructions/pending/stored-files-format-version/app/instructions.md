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

This release reads only files that have it. Without it, `prisma db migrate`, `prisma migration plan` and the other commands stop with `CONTRACT.FORMAT_VERSION_MISSING` (for a contract or a snapshot) or `MIGRATION.FORMAT_VERSION_MISSING` (for a `migration.json` or a ref file), naming the file. So does a client given a `contract.json` that lacks it.

Commit your work first, so the script's changes can be reviewed and undone with git. Then run the script from the project root:

```sh
node <path-to-this-guide>/scripts/stored-files-format-version/stored-files-format-version.ts
```

Node 24 or later runs the TypeScript script directly; it needs no `tsx`. It reads and writes files only and needs no database. It walks the project, skipping `node_modules`, `dist`, `build` and directories whose name starts with a dot, and:

- in every contract (any `*.json` file with `targetFamily`, `storage` and `schemaVersion` at the top level: the emitted `contract.json` and each snapshot's), replaces `"schemaVersion": "1"` with `"formatVersion": 1`;
- in every `migration.json` that has an `ops.json` next to it, and every ref file in a `refs` directory, adds `"formatVersion": 1` as the first field.

It edits each file in place and keeps the rest of its bytes and layout. It prints each file it changed. A project already in the new form is left unchanged, and the script says nothing changed. It reports a `contract.json`, `migration.json` or ref file it cannot read or parse, and a directory it cannot list, leaves them unchanged and exits 1; fix those files by hand, adding the field as above.

No hash covers the format version: storage hashes, snapshot directory names and each `migrationHash` stay as they are, and no database needs signing again.

Then re-emit the contract with `prisma contract emit`, which writes the new form itself, and commit the result.
