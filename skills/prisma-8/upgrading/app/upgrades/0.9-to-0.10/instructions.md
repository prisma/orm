---
from: "0.9"
to: "0.10"
changes:
  - id: stamp-storage-types-kind-on-contract-snapshots
    summary: Stamp the `kind` discriminator (`"codec-instance"` / `"postgres-enum"`) on every entry in `storage.types` inside every committed `start-contract.json` / `end-contract.json` snapshot. The SQL family's contract serializer is now strict — untagged entries fail to load with a deserializer diagnostic naming the offending entry.
    detection:
      glob: "**/migrations/**/{start,end}-contract.json"
      contains:
        - '"codecId"'
      anyMatch: true
    script: ./stamp-storage-types-kind.ts
---

# 0.9 → 0.10 — User upgrade instructions

## `stamp-storage-types-kind-on-contract-snapshots`

Starting at the 0.10 release, the SQL family's contract serializer (`familyInstance.validateContract`, the seam every on-disk contract read now crosses) is **strict** about the `storage.types` polymorphic slot. Every entry must carry a `kind` discriminator (`"codec-instance"` for codec triples, `"postgres-enum"` for Postgres enums). The previous silent fallthrough in `normaliseTypeEntry` that quietly accepted untagged codec triples is gone.

Before 0.10, on-disk contract snapshots committed alongside your migrations looked like this:

```jsonc
{
  "storage": {
    "types": {
      "Embedding1536": {
        "codecId": "pg/vector@1",
        "nativeType": "vector",
        "typeParams": { "length": 1536 }
      },
      "user_type": {
        "codecId": "pg/enum@1",
        "nativeType": "user_type",
        "typeParams": { "values": ["admin", "user"] }
      }
    }
  }
}
```

Starting at 0.10 the same snapshots must look like this:

```jsonc
{
  "storage": {
    "types": {
      "Embedding1536": {
        "kind": "codec-instance",
        "codecId": "pg/vector@1",
        "nativeType": "vector",
        "typeParams": { "length": 1536 }
      },
      "user_type": {
        "kind": "postgres-enum",
        "name": "user_type",
        "nativeType": "user_type",
        "values": ["admin", "user"],
        "codecId": "pg/enum@1"
      }
    }
  }
}
```

The two-shape split reflects how the SQL family's hydration path discriminates: codec triples are plain JSON envelopes that round-trip through the slot unchanged; Postgres enums hydrate into a target-specific IR class instance (`PostgresEnumType`) whose structural shape includes `name` / `values` directly (no `typeParams` indirection).

Without this stamp, every CLI command that reads an on-disk contract — `prisma-next migration plan`, `migration new`, `migrate`, `migration show`, `db verify` — fails with a `Contract validation failed` envelope pointing at the offending snapshot and naming the missing `kind` discriminator. The failure is loud and the diagnostic identifies the file, but the only fix is to stamp the entries; there is no migration-time legacy shape acceptance any more.

### What `stamp-storage-types-kind.ts` does

The colocated script walks the project root, descends into every directory named `migrations/` (skipping `node_modules`, `.git`, `dist`, `build`), and rewrites every `start-contract.json` and `end-contract.json` whose `storage.types` slot has at least one untagged entry:

- **Already-stamped entries** (those carrying a `"codec-instance"` or `"postgres-enum"` `kind`) are left untouched. The codemod is idempotent — safe to re-run.
- **`pg/enum@1`** entries are rewritten as the `"postgres-enum"` shape: the entry's map key is lifted to `name`; `values` is lifted out of `typeParams.values`; `nativeType` and `codecId` are preserved; `typeParams` is dropped (its only meaningful content was `values`).
- **Every other codecId** (including extension-contributed codecs like `pg/vector@1`, `cipherstash/*`, etc.) is rewritten as the `"codec-instance"` shape: `kind` is prepended; `codecId`, `nativeType`, and `typeParams` are preserved verbatim.
- The whole snapshot is re-serialised via a JSON pretty-printer that mirrors the CLI's authoring shape: multi-line objects and arrays at `JSON.stringify(value, null, 2)` indentation, with short primitive arrays (`["admin", "user"]`, `["id"]`, etc.) inlined on a single line — the same on-disk shape the CLI emits. On CLI-authored snapshots, the diff outside `storage.types` is zero. Hand-edited snapshots may experience cosmetic whitespace shifts; this is acceptable because on-disk contract snapshots are CLI artefacts, not user-edited source.
- A `--check` flag turns the script into a dry-run; it lists which snapshots would be modified and exits non-zero if any still need fixing.

If a snapshot contains a `storage.types` entry that is neither already-stamped nor an untagged codec triple (i.e. some structurally unexpected shape), the script throws and names the offending entry. That case is a hand-edit required — the codemod refuses to guess.

### Validation

After running the script, run `pnpm prisma-next migration plan` against your project. It should be a no-op (no schema changes detected) — that's the loudest end-to-end check that every snapshot now loads cleanly under the strict serializer. If it crashes with `Contract validation failed`, the message names the snapshot path and the entry; either re-run the codemod (some snapshots may have been missed by the glob), or hand-edit the entry to the expected shape above.

Then run `pnpm typecheck && pnpm test` per the per-step flow. The new strict serializer changes only the on-disk loading path; in-memory contracts authored via the builder DSL are unaffected.
