---
from: "0.8"
to: "0.9"
changes:
  - id: strip-inline-contracts-from-migration-manifests
    summary: Remove the inlined `fromContract` / `toContract` fields from every committed `migration.json` (extension seed migrations included); the destination contract continues to live next door as `end-contract.json`.
    detection:
      glob: "**/migrations/**/migration.json"
      contains:
        - '"fromContract"'
        - '"toContract"'
      anyMatch: true
    script: ./strip-inline-contracts.ts
  - id: drop-migration-metadata-contract-fields-from-source
    summary: Remove `fromContract` / `toContract` from any extension source code that constructs or destructures `MigrationMetadata`; the SPI dropped both fields.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "fromContract"
        - "toContract"
      anyMatch: true
---

# 0.8 → 0.9 — Extension-author upgrade instructions

## `strip-inline-contracts-from-migration-manifests`

Starting at the 0.9 release, `migration.json` no longer carries `fromContract` or `toContract`. The schema rejects those keys as unknown, so any committed manifest that still inlines them fails to load with `MIGRATION.INVALID_MANIFEST`.

This applies to **seed migrations** shipped inside an extension package (e.g. `migrations/<edge-id>/migration.json` shipped under `packages/<extension>/migrations/`) just as it does to user-app migrations. The destination contract was already being written to disk next door as `end-contract.json` (and the source as `start-contract.json`); the manifest copy was redundant. `migrationHash` is unaffected — it has always been computed without those two fields, so stripping them does not change the stored hash.

### What `strip-inline-contracts.ts` does

The colocated script walks the project root, descends into every directory named `migrations/` (skipping `node_modules`, `.git`, `dist`, `build`), and rewrites every `migration.json` whose JSON object contains either key:

- Manifests that already lack both keys are left untouched (idempotent — safe to re-run).
- Manifests with either key are rewritten with the two key/value spans excised at the text level. The formatting of every surviving field (whitespace, inline-vs-multiline arrays, key ordering, trailing newline) is preserved byte-for-byte; only the removed keys (and their trailing comma+newline) disappear from the diff. The script reparses the result to guard against accidental corruption.
- A `--check` flag turns the script into a dry-run; it lists which manifests would be modified and exits non-zero if any still need fixing.

## `drop-migration-metadata-contract-fields-from-source`

The `MigrationMetadata` type exported by `@internal/migration-tools` no longer declares `fromContract` or `toContract`. Source TypeScript that constructs (or destructures) `MigrationMetadata` from those fields will now fail to compile.

There is no codemod — extension authors construct `MigrationMetadata` in too many shapes for a deterministic transform to be safe. Instead, walk every `.ts` / `.tsx` file matched by the `detection.glob` above and apply these rules locally:

- **Object-literal construction** (e.g. `const meta: MigrationMetadata = { ..., fromContract, toContract }`): drop both properties from the literal. If the value is later needed, read the contract from the sibling `end-contract.json` (or the predecessor's `end-contract.json` for the from-side) instead of carrying it in metadata.
- **Spread-into-existing** (e.g. `const meta = { ...prev, fromContract: ..., toContract: ... }`): drop the two keys from the spread. If `prev` was loaded from disk via `readMigrationPackage`, it already lacks the fields under 0.9 — no further work needed.
- **Destructuring** (e.g. `const { fromContract, toContract, ...rest } = meta`): remove both names from the destructure. If the consuming code used those values, switch the read to the sibling `end-contract.json`.
- **Type-only references** (e.g. `metadata.toContract`, `Pick<MigrationMetadata, 'fromContract'>`, etc.): TypeScript will surface these as compile errors after the bump. Replace with sibling-file reads or remove the field reference entirely.

If your extension also carries seed-migration manifests (the common case for extensions that ship a `migrations/` directory), the `strip-inline-contracts-from-migration-manifests` change above handles those at the JSON layer. Run that script first; the source-code change above only covers TypeScript that produces / consumes `MigrationMetadata` programmatically.

While at it, scan any seed `migration.ts` doc-comments in your extension for stale references to `metadata.toContract` (e.g. *"preserving the full `toContract` so `MigrationCLI.run` re-attests it"*). Those references were accurate under 0.8 and are no longer accurate under 0.9 — the `MigrationCLI.run` re-attestation now reads the destination contract from sibling `end-contract.json`, not from `metadata.toContract`. Update or remove the stale prose. This is documentation hygiene, not a structural break.

### Validation

After running the script and applying the source-level rules above, run `pnpm typecheck && pnpm test` (or your extension's own equivalent). `prisma-8-check-pins` should also pass, since it does not look at `MigrationMetadata` shape.
