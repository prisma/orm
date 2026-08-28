# Manual QA — attribute-registry

> **Be the user.** Author a Mongo schema, run `prisma contract emit`, and judge what unit tests cannot: whether the new unknown-attribute diagnostics read clearly at the CLI and whether a clean schema still emits byte-identical output.
>
> **Out of scope of this script.** Do not re-run `pnpm test`; do not re-run CI lints; do not verify fixture shapes — CI owns those gates.
>
> **Spec:** `projects/attribute-registry/spec.md` · slice specs under `projects/attribute-registry/slices/<slice>/spec.md`

## Slice `registry-core` — N/A

No user-observable change: authoring-time machinery only; emitted contracts byte-identical; no CLI, output, or error-copy surface touched.

## Slice `mongo-attributes-registered`

**What changed for the user.** A Mongo schema that carries an attribute the Mongo interpreter does not implement — `@default`, `@updatedAt`, `@db.ObjectId`, a typo, anything not in the registered namespace — used to emit silently with the attribute dropped. It now fails `prisma contract emit` with `PSL_UNSUPPORTED_MODEL_ATTRIBUTE` / `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` pointing at the attribute. `@id` / `@unique` with arguments now diagnose too.

**Audiences.** End users authoring Mongo schemas (`examples/retail-store`, `examples/mongo-demo`); extension authors go through the same provider (`@internal/mongo/config` → `mongoContract`), so one path covers both.

### Table of contents

| # | Scenario | What it proves | Isolation | Covers |
| - | -------- | -------------- | --------- | ------ |
| 1 | Clean Mongo schema still emits byte-identical output | Registration + call-site rewiring changed no emitted artifact | workspace | fixtures constraint |
| 2 | Unknown model attribute fails emit with a located diagnostic | Model-level unknown-name diagnostic reaches the CLI legibly | workspace | project DoD "unknown attribute names diagnose … model level" |
| 3 | `@default` on a Mongo field fails emit (formerly silent) | Field-level unknown-name diagnostic reaches the CLI legibly | workspace | project DoD "… field level" |
| 4 | Dotted `@db.ObjectId` reports its full name | Namespaced attributes are not misread as bare names | workspace | edge case § dotted names |

### Pre-flight

1. `git status --short` → clean (only `projects/` artefacts may be pending).
2. `pnpm build` → green.
3. `cd examples/retail-store && pnpm emit` → exit 0 and `git status --short -- examples/retail-store` empty (this is scenario 1's baseline).

### Scenario 1 — Clean Mongo schema still emits byte-identical output

**Steps.** From `examples/retail-store`: `pnpm emit`, then `git status --short -- .`.
**Oracle.** Exit 0; no diff under `examples/retail-store/` (contract.json, contract.d.ts unchanged).

### Scenario 2 — Unknown model attribute fails emit with a located diagnostic

**Steps.** In `examples/retail-store/src/contract.prisma`, add `@@shardKey([id])` inside `model Product`. Run `pnpm emit`. Revert the edit afterwards.
**Oracle.** Non-zero exit. Output names the code `PSL_UNSUPPORTED_MODEL_ATTRIBUTE`, the text `Model "Product" uses unsupported attribute "@@shardKey"`, and a file location (line of the added attribute). No stack trace; no generated files changed.

### Scenario 3 — `@default` on a Mongo field fails emit (formerly silent)

**Steps.** In `examples/retail-store/src/contract.prisma`, restore `@default(Active)` on `Product.status` (the exact attribute this slice removed). Run `pnpm emit`. Revert.
**Oracle.** Non-zero exit; `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` with `Field "Product.status" uses unsupported attribute "@default"` and a location on the `status` line.

### Scenario 4 — Dotted `@db.ObjectId` reports its full name

**Steps.** Add `@db.ObjectId` to `Product.id`. Run `pnpm emit`. Revert.
**Oracle.** `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` naming `"@db.ObjectId"` (not `"@db"`), located on the `id` line.
