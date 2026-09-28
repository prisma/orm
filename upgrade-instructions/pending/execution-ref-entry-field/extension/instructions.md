---
changes:
  - id: execution-ref-entry-field
    summary: |
      Each entry in `contract.execution.mutations.defaults` now names its target as
      `ref: { namespace, entry, field }` instead of `ref: { namespace, table, column }`. The values
      are the same table and column names. Re-emit the contract; code and types that read `.ref.table` or
      `.ref.column` read `.ref.entry` and `.ref.field`.
    detection:
      glob: "**/*.{json,ts,mts,cts}"
      matches:
        - '"ref"\s*:\s*\{(?![^{}]*"kind")[^{}]*"(?:table|column)"\s*:'
        - '\.ref\??\.(?:table|column)\b'
        - '\bref\s*:\s*\{(?![^{}]*\bkind\b)[^{}]*\b(?:table|column)\s*:[^{}]*\b(?:table|column)\s*:'
    script: ./scripts/rename-execution-ref-keys.ts
---

## `execution-ref-entry-field`

A contract with generated defaults (`temporal.createdAt()`, `temporal.updatedAt()`, `@default(uuid())` and the like) carries them under `execution.mutations.defaults`. Each entry's `ref` changes keys; the values do not:

```json
// before
{ "ref": { "namespace": "public", "table": "user", "column": "updated_at" }, "onUpdate": { "kind": "generator", "id": "timestampNow" } }

// after
{ "ref": { "entry": "user", "field": "updated_at", "namespace": "public" }, "onUpdate": { "kind": "generator", "id": "timestampNow" } }
```

1. Run `prisma contract emit` so `contract.json` and `contract.d.ts` use the new keys. The runtime rejects a contract whose refs still say `table` and `column` with `Contract structural validation failed: execution.mutations.defaults[0].ref.entry must be a string`.
2. Contracts stored under `migrations/` carry the old keys too: the snapshots in `migrations/snapshots/<hash>/contract.json` and `contract.d.ts`, and any intermediate contract a migration imports from its own directory, such as `migrations/app/<dir>/intermediate.json` and `intermediate.d.ts`. Run the script that ships beside this guide, from the project root. The path below is relative to this file:

   ```bash
   pnpm exec tsx ./scripts/rename-execution-ref-keys.ts
   ```

   The script reads every `.json` and `.d.ts` file under a `migrations/` directory, skipping `node_modules`, `.git` and `dist`, and changes only `execution.mutations.defaults[].ref` entries. In each one it renames `table` to `entry` and `column` to `field`, and writes the keys in the order `entry`, `field`, `namespace`, which is the order `prisma contract emit` writes. The old key order varies between files: older `contract.d.ts` files list `namespace`, `table`, `column`, newer ones `column`, `namespace`, `table`. The script handles any order; a hand edit or a search-and-replace that assumes one order misses some refs. A `contract.json` in canonical form stays canonical, so a snapshot matches a fresh emit apart from `executionHash`; an indented JSON file keeps its indentation. The script leaves every `executionHash` as it is. That hash no longer matches the renamed content, but the snapshot loader re-hashes only the storage section, so nothing checks it. `storageHash` and `profileHash` do not move, so snapshot directory names stay the same. A second run changes nothing. Pass `--check` to list the files it would change without writing them; it exits 1 if any would change.

   To confirm the rewrite, run `prisma db migrate --to <hash>` with the hash of an older snapshot. Before the rewrite it fails with `CONTRACT.VALIDATION_FAILED` and `execution.mutations.defaults[0].ref.entry must be a string`; afterwards it applies cleanly. `prisma migration check` and `prisma db verify` give the same result before and after the rewrite, so they do not confirm it.
3. Code that reads the section directly changes `.ref.table` to `.ref.entry` and `.ref.column` to `.ref.field`.

`executionHash` changes for every contract with generated defaults, because the canonical JSON changes. Nothing compares it against the database, so no migration or re-sign is needed.

### For extension authors

- The framework type `ExecutionMutationDefault['ref']` from `@internal/contract/types` is `{ namespace: string; entry: string; field: string }`. A type that matches refs by shape (for example a create-input type that checks whether a column has a generated default) matches `entry` and `field`.
- A pack that ships a contract with generated defaults re-emits it with `prisma contract emit`, and updates its pinned contract-space snapshots as in step 2.
- `MutationDefaultsOptions` passed to `applyMutationDefaults` still names the table as `table`; only the contract ref changes.
