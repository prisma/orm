---
from: "0.8"
to: "0.9"
changes:
  - id: strip-inline-contracts-from-migration-manifests
    summary: Remove the inlined `fromContract` / `toContract` fields from every committed `migration.json`; the destination contract continues to live next door as `end-contract.json`.
    detection:
      glob: "**/migrations/**/migration.json"
      contains:
        - '"fromContract"'
        - '"toContract"'
      anyMatch: true
    script: ./strip-inline-contracts.ts
---

# 0.8 → 0.9 — User upgrade instructions

## `strip-inline-contracts-from-migration-manifests`

Starting at the 0.9 release, `migration.json` no longer carries `fromContract` or `toContract`. The schema rejects those keys as unknown, so any committed manifest that still inlines them fails to load with a `MIGRATION.INVALID_MANIFEST` error from the loader (which is what powers `prisma-next migration plan` / `apply` / `verify`).

The destination contract was already being written to disk next door as `end-contract.json` (and the source as `start-contract.json`); the in-manifest copy was redundant. `migrationHash` is unaffected — it has always been computed without those two fields, so stripping them does not change the stored hash and existing `from` / `to` storage-hash bookends remain valid.

### What `strip-inline-contracts.ts` does

The colocated script walks the project root, descends into every directory named `migrations/` (skipping `node_modules`, `.git`, `dist`, `build`), and rewrites every `migration.json` whose JSON object contains either key:

- Manifests that already lack both keys are left untouched (idempotent — safe to re-run).
- Manifests with either key are rewritten with the two key/value spans excised at the text level. The formatting of every surviving field (whitespace, inline-vs-multiline arrays, key ordering, trailing newline) is preserved byte-for-byte; only the removed keys (and their trailing comma+newline) disappear from the diff. The script reparses the result to guard against accidental corruption.
- A `--check` flag turns the script into a dry-run; it lists which manifests would be modified and exits non-zero if any still need fixing.

### Validation

After running the script, run `pnpm typecheck && pnpm test` per the per-step flow. The migration loader's schema check is the structural validation; the project's own test suite covers any consumer-side code that previously read `metadata.fromContract` / `metadata.toContract` (rare — the fields were unused in the apply / verify path).

If you have application code that inspected `metadata.toContract` for any reason, read the contract from the sibling `end-contract.json` file instead (and `metadata.fromContract` becomes the predecessor migration's `end-contract.json`).
