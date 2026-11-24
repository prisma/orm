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
      `contractSpaceFromJson`, from `@prisma/orm-postgres/migration-tools/spaces` (and the same path in the other facades and `@prisma/orm-toolchain`), reads its `contractJson`, each migration's `metadata` and its `headRef` as the stored files they are: each must carry `formatVersion`, and a `migration.json` or head ref with a field it does not know is refused. `headRef` is typed `unknown`; pass the imported `refs/head.json`, not an object built in code.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bcontractSpaceFromJson\s*[<(]'
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

Each file Prisma stores now says which version of its format it is in, so a later release can refuse a file written by a newer release instead of misreading it. An extension bundles stored files: its emitted `src/contract.json`, the `migration.json` of each of its migrations, `migrations/refs/head.json` and its contract snapshots. A descriptor imports them, and this release reads each one's version first. An extension built before this release therefore fails to load with `CONTRACT.FORMAT_VERSION_MISSING` (for the contract) or `MIGRATION.FORMAT_VERSION_MISSING` (for a `migration.json` or the head ref).

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

Node 24 or later runs the TypeScript script directly. It reads and writes files only. It walks the package, skipping `node_modules`, `dist`, `build` and directories whose name starts with a dot. In every contract (any `*.json` file with `targetFamily`, `storage` and `schemaVersion` at the top level) it replaces `"schemaVersion": "1"` with `"formatVersion": 1`. In every `migration.json` that has an `ops.json` next to it, and every ref file in a `refs` directory, it adds `"formatVersion": 1` as the first field. It keeps the rest of each file's bytes, prints each file it changed, and says so when nothing needed changing. It reports a `contract.json`, `migration.json` or ref file it cannot read or parse, leaves it unchanged and exits 1.

No hash covers the format version: the storage hash, the head ref's hash, snapshot directory names and each `migrationHash` stay as they are. Then re-emit the extension's contract with `prisma contract emit`, which writes the new form of `contract.json` and the head ref itself, rebuild the package and publish a release of it for this release of Prisma.

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

No call changes when it passes the imported files, as an extension built by `prisma contract emit` does. A call that builds the head ref in code passes the file instead:

```ts
// before
contractSpaceFromJson({
  contractJson,
  migrations,
  headRef: { hash: contractJson.storage.storageHash, invariants: [] },
});

// after
import headRef from '../../migrations/refs/head.json' with { type: 'json' };

contractSpaceFromJson({ contractJson, migrations, headRef });
```

A head ref may not declare `policies`; `contractSpaceFromJson` refuses one that does.

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
