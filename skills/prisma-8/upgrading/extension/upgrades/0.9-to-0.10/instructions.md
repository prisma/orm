---
from: "0.9"
to: "0.10"
changes:
  - id: stamp-storage-types-kind-on-contract-snapshots
    summary: Stamp the `kind` discriminator (`"codec-instance"` / `"postgres-enum"`) on every entry in `storage.types` inside every committed `start-contract.json` / `end-contract.json` snapshot (extension seed migrations included). The SQL family's contract serializer is now strict — untagged entries fail to load with a deserializer diagnostic naming the offending entry.
    detection:
      glob: "**/migrations/**/{start,end}-contract.json"
      contains:
        - '"codecId"'
      anyMatch: true
    script: ./stamp-storage-types-kind.ts
  - id: stamp-storage-types-kind-in-source
    summary: Wrap untagged codec-triple inputs to `SqlStorage` (or any builder that materialises `storage.types`) with `toStorageTypeInstance(...)`, and use the target-specific `PostgresEnumType` class for Postgres-enum entries — the `SqlStorage` constructor now throws on untagged entries instead of papering over them.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "storage.types"
        - "codecId"
      anyMatch: true
---

# 0.9 → 0.10 — Extension-author upgrade instructions

## `stamp-storage-types-kind-on-contract-snapshots`

Starting at the 0.10 release, the SQL family's contract serializer (`familyInstance.validateContract`, the seam every on-disk contract read now crosses) is **strict** about the `storage.types` polymorphic slot. Every entry must carry a `kind` discriminator (`"codec-instance"` for codec triples, `"postgres-enum"` for Postgres enums). The previous silent fallthrough in `normaliseTypeEntry` that quietly accepted untagged codec triples is gone.

This applies to **seed migrations** shipped inside an extension package (e.g. `migrations/<edge-id>/{start,end}-contract.json` shipped under `packages/<extension>/migrations/`) just as it does to user-app migrations. Any extension that ships seed `*-contract.json` snapshots with untagged `storage.types` entries will fail to load under 0.10 with a `Contract validation failed` envelope.

Before 0.10, seed snapshots looked like this:

```jsonc
{
  "storage": {
    "types": {
      "Embedding1536": {
        "codecId": "pg/vector@1",
        "nativeType": "vector",
        "typeParams": { "length": 1536 }
      }
    }
  }
}
```

Starting at 0.10 the same entries must look like this:

```jsonc
{
  "storage": {
    "types": {
      "Embedding1536": {
        "kind": "codec-instance",
        "codecId": "pg/vector@1",
        "nativeType": "vector",
        "typeParams": { "length": 1536 }
      }
    }
  }
}
```

Postgres-enum entries undergo a structural change (the `name` is lifted from the entry's map key, `values` is hoisted out of `typeParams`, `typeParams` is dropped). See the user-facing entry (`../../../app/upgrades/0.9-to-0.10/instructions.md`) for the before/after on the enum shape — the on-disk transformation is identical for both audiences.

### What `stamp-storage-types-kind.ts` does

The colocated script walks the project root, descends into every directory named `migrations/` (skipping `node_modules`, `.git`, `dist`, `build`), and rewrites every `start-contract.json` and `end-contract.json` whose `storage.types` slot has at least one untagged entry:

- **Already-stamped entries** are left untouched (idempotent — safe to re-run).
- **`pg/enum@1`** entries are rewritten as the `"postgres-enum"` shape (lifts `name` from the map key, hoists `values` out of `typeParams`, drops `typeParams`).
- **Every other codecId** is rewritten as the `"codec-instance"` shape (`kind` prepended; `codecId`, `nativeType`, `typeParams` preserved verbatim).
- The whole snapshot is re-serialised via a JSON pretty-printer that mirrors the CLI's authoring shape (multi-line objects, inline short arrays of primitives) — the diff outside `storage.types` is zero on CLI-authored snapshots.
- A `--check` flag turns the script into a dry-run; lists affected snapshots and exits non-zero if any still need fixing.

If a snapshot contains a `storage.types` entry that is neither already-stamped nor an untagged codec triple, the script throws and names the offending entry. Hand-edit required.

## `stamp-storage-types-kind-in-source`

The SQL family's `SqlStorage` class now refuses untagged codec triples at construction time. Source code that builds an in-memory `SqlStorage` (or any contract-builder fixture / test that ends up materialising `storage.types`) with raw `{ codecId, nativeType, typeParams }` literals will throw at construction with a diagnostic like:

> `storage.types["Embedding1536"] has missing \`kind\`; expected "codec-instance" or "postgres-enum". Untagged codec triples should be wrapped with toStorageTypeInstance(...) before construction.`

There is no codemod for this — extensions construct `SqlStorage` via too many shapes (builder DSL, direct constructor, test fixtures, ad-hoc literals) for a deterministic transform to be safe. Instead, walk every `.ts` / `.tsx` file matched by the `detection.glob` above and apply these rules locally:

- **Codec-triple literal passed to `new SqlStorage({...})` or a builder that flattens to it** (e.g. `types: { Embedding1536: { codecId: 'pg/vector@1', nativeType: 'vector', typeParams: { length: 1536 } } }`): wrap each value with `toStorageTypeInstance(...)`:

  ```ts
  import { toStorageTypeInstance } from '@internal/sql-contract';

  const storage = new SqlStorage({
    types: {
      Embedding1536: toStorageTypeInstance({
        codecId: 'pg/vector@1',
        nativeType: 'vector',
        typeParams: { length: 1536 },
      }),
    },
    // …
  });
  ```

  The helper is idempotent — input already carrying the `kind` field passes through unchanged.

- **Postgres-enum literal** (e.g. `types: { user_type: { codecId: 'pg/enum@1', nativeType: 'user_type', typeParams: { values: ['admin', 'user'] } } }`): the canonical fix is to replace with a `PostgresEnumType` class instance from `@internal/postgres`:

  ```ts
  import { PostgresEnumType } from '@internal/postgres';

  const storage = new SqlStorage({
    types: {
      user_type: new PostgresEnumType({
        name: 'user_type',
        nativeType: 'user_type',
        values: ['admin', 'user'],
      }),
    },
    // …
  });
  ```

  The class instance carries `kind: 'postgres-enum'` and the structural shape the family discriminates on. Plain object literals with `kind: 'postgres-enum'` are rejected — the constructor route is mandatory because hydration of raw JSON envelopes is the target-specific serializer's job (cross-domain layering: the SQL family doesn't know about Postgres-enum's concrete class).

  **Minimal-fix alternative for fixtures / round-trip tests.** If the code in question only round-trips the codec triple as a plain envelope (no target-specific enum behaviour — e.g. a planner test fixture that never reaches Postgres-enum planning hooks), stamping `kind: 'codec-instance'` on the existing literal is a sufficient and idempotent fix:

  ```ts
  const fixtureStorage: SqlStorageInput = {
    types: {
      user_type: {
        kind: 'codec-instance',
        codecId: 'pg/enum@1',
        nativeType: 'user_type',
        typeParams: { values: ['admin', 'user'] },
      },
    },
    // …
  };
  ```

  The SQL family treats the entry as an opaque codec triple and round-trips it unchanged. Use this form only when you do not need `PostgresEnumType`'s enum-specific structural fields (`name`, `values` lifted out of `typeParams`) or its enum-planning behaviour — otherwise prefer the `PostgresEnumType` constructor above.

- **Test fixtures that round-trip a contract through JSON** (e.g. `JSON.parse(JSON.stringify(contract))`): ensure the source-side contract is constructed with stamped entries before the round-trip; the deserializer now refuses to silently re-stamp on the read.

- **Extension-contributed codec catalogues** (extensions that register custom codecs): no source change required for the catalogue itself — codec definitions don't carry `kind`. The change is only at the `SqlStorage.types` slot where catalogue entries materialise per-contract.

### Validation

After running the JSON codemod and applying the source-level rules above, run `pnpm typecheck && pnpm test` (or your extension's equivalent). `prisma-8-check-pins` should also pass — the pin set is unchanged for this transition; the breaking change is in runtime construction behaviour, not the dependency contract.

If your extension ships seed migrations under `packages/<extension>/migrations/`, also run the codemod with `--check` against the project root to confirm the seed snapshots all stamp correctly. The user-facing copy of the same codemod (under `../../../app/upgrades/0.9-to-0.10/`) operates on the user's app-space migrations; this copy operates on your extension's seed migrations.
