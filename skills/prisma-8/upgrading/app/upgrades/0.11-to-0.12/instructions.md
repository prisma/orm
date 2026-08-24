---
from: "0.11"
to: "0.12"
changes:
  - id: replace-verify-with-verify-marker
    summary: |
      The SQL runtime's `verify: { mode; requireMarker }` option is removed; replaced by `verifyMarker?: 'onFirstUse' | false` (default `'onFirstUse'`). The runtime no longer throws on contract-marker drift — instead it emits a structured `warn`-level log line once per runtime instance and proceeds with the query. Callers that previously caught `CONTRACT.MARKER_MISMATCH` to detect deploy-skew migrate to log scraping (filter on `code: 'CONTRACT.MARKER_MISMATCH'` / `code: 'CONTRACT.MARKER_MISSING'` from the runtime's `Log.warn` sink) or invoke the explicit `db-verify` CLI for fail-fast verification.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "verify:"
        - "requireMarker"
      anyMatch: false
  - id: remove-capabilities-from-define-contract
    summary: |
      The `capabilities` field on the first argument of `defineContract({...}, ...)` is removed. Capabilities are now contributed automatically by extension packs and target components; declaring them by hand is no longer accepted and the contract builder will refuse the literal. Delete the `capabilities: { ... }` block from every `defineContract` call site, then re-emit your contract artefacts (`pnpm emit`, which runs `prisma-next contract emit`) to refresh `contract.json` / `contract.d.ts`. The regenerated artefacts pick up the contributor-declared capabilities — including two new ones in the 0.12 line, `postgres.distinctOn` and `sql.lateral`, which extensions contribute on your behalf when their pack is in `extensionPacks`.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "defineContract"
        - "capabilities:"
      anyMatch: false
  - id: strip-migration-labels-hints
    summary: |
      The 0.12 migration manifest schema is closed (`'+': 'reject'`) and the metadata model no longer carries `labels` or `hints`; any on-disk `migration.json` still holding either key fails to load with `INVALID_MANIFEST` naming the offending key. Both fields are also dropped from the content-addressed migration identity, so `migrationHash` is now computed over `{ from, to, providedInvariants, createdAt }` plus the sibling `ops.json`. Run the colocated codemod to strip both keys from every `migration.json` and recompute its `migrationHash` over the slimmed envelope.
    detection:
      glob: "**/migration.json"
      contains:
        - '"labels"'
        - '"hints"'
      anyMatch: true
    script: ./strip-migration-labels-hints.ts
  - id: re-emit-closed-mongo-contracts
    summary: |
      Re-emit Mongo contract artefacts so emitted `$jsonSchema` validators are closed (`additionalProperties: false` at every level, including polymorphic `oneOf` branches). Each non-variant Mongo model must resolve to an `objectId` `_id` before emit succeeds — otherwise interpret fails with `PSL_MONGO_ID_REQUIRED`. After re-emitting, apply the open→closed validator migration with `prisma-next db update -y`; the planner classifies the tightening as `destructive` and refuses without confirmation.
    detection:
      glob: "**/contract.json"
      contains:
        - '"kind": "mongo-database"'
      anyMatch: true
    script: ./re-emit-closed-mongo-contracts.ts
  - id: public-default-namespace
    summary: |
      Un-namespaced Postgres models now emit under the `public` namespace instead of the `__unbound__` sentinel; explicit `namespace unbound { … }` in PSL still round-trips to `__unbound__`. Re-emit contract artefacts (`pnpm emit`, i.e. `prisma-next contract emit`) so `contract.json` / `contract.d.ts` pick up the new storage/domain namespace key (`__unbound__`/`postgres-unbound-schema` → `public`/`postgres-schema`). No hand-editing of emitted JSON is required when the PSL/TS contract source is unchanged.
    detection:
      glob: "**/contract.json"
      contains:
        - '"kind": "postgres-unbound-schema"'
      anyMatch: true
    script: ./re-emit-postgres-public-default.ts
  - id: domain-plane-namespaced-contract
    summary: |
      `contract.models` / `contract.valueObjects` moved under `contract.domain.namespaces.<ns>` (symmetric domain plane). Re-emit contract artefacts (`pnpm emit`) so emitted JSON and `contract.d.ts` carry the namespaced domain envelope; generated types switch from `Contract['models']` to `ContractModelsMap<Contract>`.
    detection:
      glob: "**/contract.d.ts"
      contains:
        - "Contract['models']"
      anyMatch: true
    script: ./re-emit-domain-namespaced-contracts.ts
  - id: runtime-qualified-sql-default-namespace
    summary: |
      Postgres runtime SQL now emits namespace-qualified table identifiers (e.g. `"public"."user"`). Flat `db.sql.*` / `db.*` call sites are unchanged. Update integration or snapshot tests that assert raw SQL strings. Re-emit contract artefacts only if you are still catching up an earlier 0.12 namespacing transition.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - 'FROM "user"'
      anyMatch: true
---

# 0.11 → 0.12 — User upgrade instructions

## `replace-verify-with-verify-marker`

Starting at the 0.12 release, the SQL runtime's marker-verification API is simplified. The previous `verify: { mode; requireMarker }` option carried two concerns — *when* to verify and *whether to throw on absent markers* — both of which leaked internal implementation detail into the public API. The new option is a single discriminated union: `verifyMarker?: 'onFirstUse' | false`, with `'onFirstUse'` as the default.

The runtime's response to contract-marker drift also changes. Previously the runtime threw `CONTRACT.MARKER_MISMATCH` (or `CONTRACT.MARKER_MISSING`) on every query when the database's contract hash didn't match the runtime's. From 0.12 onward, the runtime emits a structured `warn`-level log line **once per runtime instance** and proceeds with the query. The intent is to make rolling deploys safe by default: a drifted-but-running app surfaces the warning loudly without crashing every query for the duration of the deploy window.

### Migration

Walk every call site that constructs a SQL runtime via `createRuntime(...)` or the convenience wrappers (`sqlite(...)`, `postgres(...)`, `postgresServerless(...)`).

For each call site that passes `verify: {...}`:

- `verify: { mode: 'onFirstUse', requireMarker: false }` → `verifyMarker: 'onFirstUse'` (or simply omit the option — `'onFirstUse'` is the default).
- `verify: { mode: 'onFirstUse', requireMarker: true }` → `verifyMarker: 'onFirstUse'`. The `requireMarker: true` semantics (throw on absent marker) is removed; if you need fail-fast verification, use the `db-verify` CLI command at deploy time instead of relying on the runtime to crash.
- `verify: { mode: 'always', requireMarker: ... }` → `verifyMarker: 'onFirstUse'`. The `'always'` mode (re-verify on every query) is dropped; verification is now once-per-runtime regardless of mode. The CLI `db-verify` command remains the explicit-verification surface.
- `verify: { mode: 'startup', requireMarker: ... }` → `verifyMarker: 'onFirstUse'`. The `'startup'` mode is dropped for the same reason — without the throw-on-mismatch semantic, the `'startup'` vs `'onFirstUse'` distinction collapsed to "same behaviour, different timing." Verification fires lazily on the first `execute()` call.
- If you explicitly want to skip marker verification entirely (e.g. during a known-skewed deploy window where contract drift is expected and tolerated): `verifyMarker: false`.

### Before 0.12

```ts
const runtime = createRuntime({
  stackInstance,
  context,
  driver,
  verify: { mode: 'onFirstUse', requireMarker: false },
});

try {
  for await (const row of runtime.execute(plan)) {
    // ...
  }
} catch (err) {
  if (err.code === 'CONTRACT.MARKER_MISMATCH') {
    // deploy-skew detected — crash and let the orchestrator restart us
    process.exit(1);
  }
  throw err;
}
```

### Starting at 0.12

```ts
const runtime = createRuntime({
  stackInstance,
  context,
  driver,
  log: {
    info: console.info,
    warn: (payload) => {
      console.warn(payload);
      if (
        payload.code === 'CONTRACT.MARKER_MISMATCH' ||
        payload.code === 'CONTRACT.MARKER_MISSING'
      ) {
        // optional: forward to your observability surface
        sendToTelemetry(payload);
      }
    },
    error: console.error,
  },
  // verifyMarker omitted — 'onFirstUse' is the default
});

for await (const row of runtime.execute(plan)) {
  // ...
}
```

The runtime now does not crash on drift — it emits one structured log line per runtime instance, then proceeds. Operators who want fail-fast verification at deploy time (rather than as a per-runtime diagnostic) should invoke the `db-verify` CLI as part of their deployment pipeline.

### Type-level change

The `RuntimeVerifyOptions` type is removed from `@internal/sql-runtime` exports; replaced by `VerifyMarkerOption = 'onFirstUse' | false`. Any consumer code that imports `RuntimeVerifyOptions` will fail to compile after the bump.

```diff
-import type { RuntimeVerifyOptions } from '@internal/sql-runtime';
+import type { VerifyMarkerOption } from '@internal/sql-runtime';
```

### Validation

After applying the rule above, run `pnpm typecheck && pnpm test` (or your application's equivalent). The change is mechanical: TypeScript flags every `verify: {...}` call site as a type error after the bump, and every `RuntimeVerifyOptions` import similarly. Once those errors are resolved, the behaviour change (warn-log instead of throw on drift) shows up only at runtime when a marker mismatch actually occurs.

## `remove-capabilities-from-define-contract`

Starting at the 0.12 release, the `capabilities` field on the first argument of `defineContract({...}, ...)` is removed. Capabilities are now contributed automatically by the target's components and the extension packs you load via `extensionPacks: { ... }`; the contract builder will refuse a literal `capabilities` key. Hand-declaring capabilities was redundant with — and frequently drifted from — the contributor-declared set, so the authoring surface drops the field outright.

Two consumer-visible consequences:

- **Source change**: delete the `capabilities: { ... }` block from every `defineContract` call site.
- **Emitted artefacts**: the regenerated `contract.json` / `contract.d.ts` will pick up the contributor-declared capabilities. In the 0.12 line, two new capability keys land automatically — `postgres.distinctOn` and `sql.lateral` — when the matching adapter / target component is in the contract's component graph.

### Before 0.12

```ts
import { defineContract } from '@internal/postgres/contract-builder';
import { pgvector } from '@internal/pgvector';

export const contract = defineContract(
  {
    extensionPacks: { pgvector },
    capabilities: {
      postgres: {
        lateral: true,
        jsonAgg: true,
        returning: true,
        'pgvector.cosine': true,
      },
    },
  },
  ({ field, model }) => {
    // … model definitions …
  },
);
```

### Starting at 0.12

```ts
import { defineContract } from '@internal/postgres/contract-builder';
import { pgvector } from '@internal/pgvector';

export const contract = defineContract(
  {
    extensionPacks: { pgvector },
  },
  ({ field, model }) => {
    // … model definitions …
  },
);
```

If your first argument becomes `{}` after the deletion (the only field it carried was `capabilities`), simplify to `defineContract({}, ({ field, model }) => { … })`. TypeScript flags any remaining `capabilities:` key on a `defineContract` call as an excess-property error after the bump, so every affected site is pinpointed at compile time.

### Re-emit your contract

After updating the source, regenerate the emitted artefacts so the new contributor-declared capabilities land in `contract.json` and `contract.d.ts`:

```bash
pnpm emit
# (runs `prisma-next contract emit` under the hood)
```

You should see capability keys appear in the regenerated `contract.json` — for SQL targets, expect `postgres.distinctOn: true` and `sql.lateral: true` to show up if your contract uses the matching adapter / extensions.

### Validation

After applying the rule above, run `pnpm typecheck && pnpm test` (or your application's equivalent). The change is mechanical and TypeScript pinpoints every affected call site; the regenerated `contract.json` diff confirms the capabilities flowed through unchanged.

## `strip-migration-labels-hints`

Starting at the 0.12 release, the migration manifest schema is closed (`'+': 'reject'`) and the metadata model no longer carries `labels` or `hints`. Any on-disk `migration.json` that still holds either key fails to load: the loader rejects the manifest with `INVALID_MANIFEST`, naming the first offending key (`labels` or `hints`). The two fields are also removed from the content-addressed migration identity — `migrationHash` is now computed over `{ from, to, providedInvariants, createdAt }` plus the sibling `ops.json` — so every migrated manifest additionally needs its hash recomputed over the slimmed envelope, or it fails hash verification on the next load.

Run the colocated codemod from your project root:

```bash
pnpm exec tsx ./strip-migration-labels-hints.ts
```

It walks every `migration.json` that has a sibling `ops.json` (a complete on-disk migration package), removes the `labels` and `hints` keys, and recomputes `migrationHash` over the slimmed metadata plus the operations. The edit is format-preserving — only the two key lines are removed and the hash value is swapped in place, so the rest of each manifest (key order, indentation, inline-vs-expanded arrays) is left untouched and the diff stays minimal. The codemod is idempotent: re-running it over already-migrated manifests makes no further changes.

### Confirm every manifest is migrated

Run the codemod in dry-run mode to confirm no manifest still carries the removed keys or a stale hash:

```bash
pnpm exec tsx ./strip-migration-labels-hints.ts --check
```

`--check` lists every manifest that still needs fixing and exits non-zero if any remain, so wire it into a pre-commit hook or CI step to keep stale manifests out of the tree. A fully migrated tree reports `0 needing fix` and exits `0`.

### Validation

After running the codemod, exercise any command that loads your migrations (your deploy or migration-status step). The loader recomputes and verifies each manifest's `migrationHash` on read: a manifest that still carried `labels`/`hints` would have thrown `INVALID_MANIFEST`, and a manifest with a stale hash would fail verification. Once the codemod has run, every manifest loads cleanly and its recomputed hash verifies against the slimmed envelope.

## `re-emit-closed-mongo-contracts`

Starting at the 0.12 release, MongoDB emits **closed** `$jsonSchema` validators by default. Every object schema in the emitted contract — collection validators, nested objects, and each branch of a polymorphic `oneOf` — carries `additionalProperties: false`. The contract canonicalizer also preserves `additionalProperties` through emission, so the on-disk migration for consumers is to re-emit their Mongo contracts and apply the resulting validator change to the database.

Two authoring constraints apply before emit succeeds:

- **Closed validators** land automatically on re-emit; no hand-editing of `contract.json` is required.
- **Non-variant models need an `objectId` `_id`**. The new interpret-time rule `PSL_MONGO_ID_REQUIRED` rejects any non-variant Mongo model whose `_id` field does not resolve to `objectId`. Fix the PSL or TS contract source first — for example, ensure `@id` is present and typed as MongoDB's default `ObjectId` — then re-emit.

### Re-emit your Mongo contracts

Run the colocated script from your project root:

```bash
pnpm exec tsx ./re-emit-closed-mongo-contracts.ts
```

It finds every directory with a `prisma.config.ts` and a committed Mongo `contract.json`, then runs `pnpm emit` (or `prisma-next contract emit` when no emit script exists) in each. The regenerated `contract.json` / `contract.d.ts` pick up closed validators and an updated `storageHash`.

Use `--check` to list contracts that still need re-emitting without writing files:

```bash
pnpm exec tsx ./re-emit-closed-mongo-contracts.ts --check
```

### Apply the validator migration

Re-emitting changes the contract's `$jsonSchema` shape. The planner classifies the open→closed validator tightening as **`destructive`** — MongoDB replaces collection validators, and documents with fields outside the closed schema will fail validation after apply.

Plan first to review the ops:

```bash
pnpm prisma-next db update --plan-only
# or: prisma-next migration plan
```

Then apply with explicit confirmation:

```bash
pnpm prisma-next db update -y
```

Wire `-y` into your deploy pipeline only after you have reviewed the plan in a lower environment. Without `-y`, apply refuses when destructive ops are present.

### Validation

After re-emitting and applying, run `pnpm typecheck && pnpm test` (or your application's equivalent). Contract hash/type drift shows up immediately in TypeScript imports of `StorageHash`. At runtime, confirm `db verify` passes against the updated validators.

## `public-default-namespace`

Starting at the 0.12 release, un-namespaced Postgres models resolve to the `public` namespace id instead of falling back to the `__unbound__` sentinel. The emitted contract's default storage namespace key changes from `__unbound__` with `"kind": "postgres-unbound-schema"` to `public` with `"kind": "postgres-schema"`. Domain roots, FK `namespaceId` fields, and `contract.d.ts` namespace literals follow the same rename.

Explicit opt-in to the sentinel remains available: `namespace unbound { … }` in PSL still round-trips to `__unbound__` on Postgres. Only contracts whose *default* namespace is still the old sentinel shape need this migration.

### Re-emit Postgres contracts

Run the colocated script from your project root:

```bash
pnpm exec tsx ./re-emit-postgres-public-default.ts
```

It finds every committed `contract.json` whose storage tree still carries `"kind": "postgres-unbound-schema"`, then runs `pnpm emit` (or `prisma-next contract emit`) in the matching contract space. Use `--check` to list spaces that still need re-emitting without writing files:

```bash
pnpm exec tsx ./re-emit-postgres-public-default.ts --check
```

### After re-emit

If your database marker or migration head still references the old contract hash, plan and apply the resulting migration (`prisma-next db update --plan-only`, then `prisma-next db update -y` once reviewed). The schema ops are typically hash/metadata drift only when your PSL source did not change.

### Validation

After re-emitting, run `pnpm typecheck && pnpm test`. Inspect the `contract.json` diff: default models should sit under `storage.namespaces.public` and `domain.namespaces.public`, not `__unbound__`.

## `domain-plane-namespaced-contract`

Starting at the 0.12 release, the application plane is symmetric with storage: models and value objects live under `contract.domain.namespaces.<ns>` instead of flat `contract.models` / `contract.valueObjects` at the contract root (ADR 221). Emitted `contract.d.ts` exports `Models` via `ContractModelsMap<Contract>` rather than `Contract['models']`.

### Re-emit your contracts

Run the colocated script from your project root:

```bash
pnpm exec tsx ./re-emit-domain-namespaced-contracts.ts
```

It finds contract spaces whose on-disk artefacts still use the flat domain shape (JSON missing `domain.namespaces`, or `contract.d.ts` still referencing `Contract['models']`), then re-emits each space. Use `--check` for a dry-run:

```bash
pnpm exec tsx ./re-emit-domain-namespaced-contracts.ts --check
```

If you already re-emitted for `public-default-namespace` on 0.12, a single emit pass covers both transitions — run whichever entry's detection matches your tree.

### Validation

After re-emitting, run `pnpm typecheck && pnpm test`. The regenerated `contract.json` should carry a `domain.namespaces` envelope; `contract.d.ts` should export a `Models` alias derived from the contract type (on current 0.12 builds this is typically `Contract extends ContractType<StorageBase, infer TModels> ? TModels : never`, not `ContractModelsMap`, which was removed with runtime default-namespace qualification — see `runtime-qualified-sql-default-namespace` below).

## `runtime-qualified-sql-default-namespace`

Starting at the 0.12 release, runtime SQL on Postgres qualifies table identifiers with the storage namespace the flat DSL/ORM surface resolved ([ADR 223](../../../../docs/architecture%20docs/adrs/ADR%20223%20-%20Target-owned%20default%20namespace.md)). Un-namespaced Postgres models continue to resolve through the `public` default; explicit `namespace unbound { … }` in PSL still maps to `__unbound__`.

### Application code

No change is required for normal query code:

```ts
await db.sql.user.findMany();
await db.User.findMany();
```

Bare names still resolve default-namespace-first; only the emitted SQL changes.

### Tests and observability

If you assert raw SQL strings (integration tests, query logs, migration snapshots), expect qualified Postgres identifiers:

```diff
-FROM "user"
+FROM "public"."user"
```

SQLite and Mongo behaviour for bare names is unchanged at the SQL/collection string level (SQLite `qualifyTable` is a no-op; Mongo has no SQL-style qualification).

### Contract artefacts

Re-emit (`pnpm emit` / `prisma-next contract emit`) is **not** required solely for this change when your PSL/contract source is already on the 0.12 namespaced shape. If you have not yet run the `domain-plane-namespaced-contract` or `public-default-namespace` transitions, complete those first — a single emit pass covers all on-disk contract updates.

### Emitted types note

If you maintain hand-written code against generated `contract.d.ts`, replace any use of removed `ContractModelsMap<Contract>` with the emitted `Models` export or `ContractModelDefinitions<YourContract>` from `@internal/contract/types`. That removal affects extension authors directly; application projects that only import the generated `Models` alias pick up the new shape on re-emit.
