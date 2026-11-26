---
changes:
  - id: stored-files-format-version
    summary: |
      Every file Prisma stores now names its format version. An extension's bundled `contract.json`, and each contract snapshot under `migrations/snapshots/<hash>/`, has `"formatVersion": 1` where it had `"schemaVersion": "1"`. Every `migration.json` and `migrations/refs/head.json` starts with `"formatVersion": 1`. This release refuses a bundled file without it, with `CONTRACT.FORMAT_VERSION_MISSING` or `MIGRATION.FORMAT_VERSION_MISSING`, so an extension published before it fails to load. Run the colocated script on the extension package, rebuild and republish. No hash changes.
    detection:
      glob: "**/*.json"
      matches:
        - '"schemaVersion"\s*:\s*"1"[\s\S]*"targetFamily"\s*:|"targetFamily"\s*:[\s\S]*"schemaVersion"\s*:\s*"1"'
        - '(?<![\s\S])(?![\s\S]*"formatVersion")[\s\S]*"migrationHash"\s*:'
        - '(?<![\s\S])(?![\s\S]*"formatVersion")(?=[\s\S]*"hash"\s*:)[\s\S]*"invariants"\s*:'
    script: ./scripts/stored-files-format-version/stored-files-format-version.ts
  - id: descriptor-self-consistency-takes-contract-json
    summary: |
      `assertDescriptorSelfConsistency`, from `@prisma/orm-postgres/migration-tools/spaces` (and the same path in the other facades and `@prisma/orm-toolchain`), takes the bundled contract as `contractJson` instead of its `target`, `targetFamily` and `storage`. It reads the contract's format version first.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bassertDescriptorSelfConsistency\s*\('
  - id: contract-space-from-json-reads-stored-files
    summary: |
      `contractSpaceFromJson`, from `@prisma/orm-postgres/migration-tools/spaces` (and the same path in the other facades and `@prisma/orm-toolchain`), takes the extension's id as `spaceId`, which its errors name, and reads its `contractJson`, each migration's `metadata` and its `headRef` as the stored files they are: each must carry `formatVersion`, and a `migration.json` or head ref with a field it does not know is refused. `headRef` is typed `unknown`; pass the imported `refs/head.json`, not an object built in code.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bcontractSpaceFromJson\s*[<(]'
  - id: canonicalize-contract-takes-version-from-serializer
    summary: |
      `canonicalizeContract` and `canonicalizeContractToObject`, from `@prisma/orm-framework/contract/hashing` (and `contract/hashing` in each facade), no longer take a `schemaVersion` option and write no version of their own. The canonical contract carries the `formatVersion` that the `serializeContract` you pass returns.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bcanonicalizeContract(ToObject)?\s*\([\s\S]*?\bschemaVersion\s*:'
  - id: contract-serializer-prints-version-1
    summary: |
      A target's contract serializer that extends `SqlContractSerializerBase` (from `@prisma/orm-family-sql/family/ir`) or `MongoContractSerializerBase` (from `@prisma/orm-family-mongo/family/ir`) overrides the protected `printContractV1` where it overrode `serializeContract`. The base class's `serializeContract` adds `formatVersion: 1` around what `printContractV1` returns, and `deserializeContract` reads the version before it parses the rest.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\boverride\s+serializeContract\s*\('
---

# Stored files carry a format version

## `stored-files-format-version`

Each file Prisma stores now says which version of its format it is in, so a later release can refuse a file written by a newer release instead of misreading it. An extension bundles stored files: its emitted `src/contract.json`, the `migration.json` of each of its migrations, `migrations/refs/head.json` and its contract snapshots. A descriptor imports them, and this release reads each one's version first. An extension built before this release therefore fails to load with `CONTRACT.FORMAT_VERSION_MISSING` (for the contract) or `MIGRATION.FORMAT_VERSION_MISSING` (for a `migration.json` or the head ref). The error names the extension and the file, and tells the application's developer to upgrade the extension, or to ask its author to republish it: the application cannot fix a file inside the extension's package.

```jsonc
// contract.json, before
{ "schemaVersion": "1", "targetFamily": "sql", ... }
// after
{ "formatVersion": 1, "targetFamily": "sql", ... }

// refs/head.json, before
{ "hash": "...", "invariants": [] }
// after
{ "formatVersion": 1, "hash": "...", "invariants": [] }

// migration.json, before
{ "from": null, "to": "...", ... }
// after
{ "formatVersion": 1, "from": null, "to": "...", ... }
```

Commit your work first. Then run the script from the extension package's root:

```sh
node <path-to-this-guide>/scripts/stored-files-format-version/stored-files-format-version.ts
```

Node 24 or later runs the TypeScript script directly. It reads and writes files only. It walks the package, skipping `node_modules`, `dist`, `build` and directories whose name starts with a dot. In every contract (any `*.json` file with `targetFamily`, `storage` and `schemaVersion` at the top level) it replaces `"schemaVersion": "1"` with `"formatVersion": 1`. In every `migration.json` that has an `ops.json` next to it, and every ref file under the package's `migrations/refs/` (or the migrations folder the package configures under another name; the script recognises a migrations folder by the contract snapshot store or the migrations in it, not by its name, and a ref in any other `refs` folder by its `hash` and `invariants`), it adds `"formatVersion": 1` as the first field. It keeps the rest of each file's bytes, prints each file it changed, and says so when nothing needed changing. A field a ref file does not have, which earlier releases ignored and dropped when they wrote the ref again, it drops and lists. It leaves a file unchanged, says what is wrong with it and what to do, and exits 1 when it cannot tell the file is one a release of Prisma wrote: a `contract.json`, `migration.json` or ref file it cannot read or parse; a ref file in a migrations folder it recognises without a `hash` or an `invariants` list; a `migration.json` next to an `ops.json` with a field the format does not have or without one it has; a contract with both `formatVersion` and `schemaVersion`, or a `contract.json` holding a contract with neither. Outside a migrations folder it recognises, it leaves alone, without a report, any file in a `refs` folder without a ref's content (a `hash` that is `empty` or a 64-character storage hash, and an `invariants` list of strings). If a command still refuses a ref file after the script ran, that ref was already invalid, and earlier releases refused it too: restore it from version control, or correct it by hand, since no Prisma command writes the head ref in an extension's own package: its `hash` is the `storage.storageHash` of the contract the extension emits. It does not follow symbolic links. It ignores a link to the package folder or a folder above it, and reports a link to any other file or folder outside the package that holds a stored file it would change or report.

No hash covers the format version: the storage hash, the head ref's hash, snapshot directory names and each `migrationHash` stay as they are. Then re-emit the extension's contract with `prisma contract emit`, which writes the new form of `contract.json`, rebuild the package and publish a release of it for this release of Prisma.

Code that catches these errors can test for them with `isFormatVersionError`, from `@prisma/orm-postgres/contract/format-version` (and the same path in the other facades and `@prisma/orm-framework`).

## `descriptor-self-consistency-takes-contract-json`

```ts
// before
assertDescriptorSelfConsistency({
  extensionId: 'my-extension',
  target: contractJson.target,
  targetFamily: contractJson.targetFamily,
  storage: contractJson.storage,
  headRefHash: headRef.hash,
});

// after
assertDescriptorSelfConsistency({
  extensionId: 'my-extension',
  contractJson,
  headRefHash: headRef.hash,
});
```

## `contract-space-from-json-reads-stored-files`

Every call passes the extension's id as `spaceId`, the same id as the descriptor's `id`, so an error about a bundled file names the extension. A call that builds the head ref in code passes the file instead:

```ts
// before
contractSpaceFromJson({
  contractJson,
  migrations,
  headRef: { hash: contractJson.storage.storageHash, invariants: [] },
});

// after
import headRef from '../../migrations/refs/head.json' with { type: 'json' };

contractSpaceFromJson({ spaceId: 'my-extension', contractJson, migrations, headRef });
```

A head ref may not declare `policies`; `contractSpaceFromJson` refuses one that does.

## `canonicalize-contract-takes-version-from-serializer`

Remove the `schemaVersion` option. The version comes from `serializeContract`: pass the target's contract serializer, whose `serializeContract` returns `formatVersion: 1`.

```ts
// before
const canonical = canonicalizeContract(contract, {
  schemaVersion: '1',
  serializeContract: (c) => serializer.serializeContract(c),
});

// after
const canonical = canonicalizeContract(contract, {
  serializeContract: (c) => serializer.serializeContract(c),
});
```

A `serializeContract` of your own that returns no `formatVersion` now produces a canonical contract without one, which this release refuses to read.

## `contract-serializer-prints-version-1`

A target that writes its contract in its own shape overrides `printContractV1`, which returns the contract without `formatVersion`; the base class adds it:

```ts
// before
class MyTargetContractSerializer extends SqlContractSerializerBase<MyContract> {
  override serializeContract(contract: MyContract): JsonObject {
    return printMyContract(contract);
  }
}

// after
class MyTargetContractSerializer extends SqlContractSerializerBase<MyContract> {
  protected override printContractV1(contract: MyContract): JsonObject {
    return printMyContract(contract);
  }
}
```

A serializer that still overrides `serializeContract` writes a contract without `formatVersion`, which its own `deserializeContract` then refuses.
