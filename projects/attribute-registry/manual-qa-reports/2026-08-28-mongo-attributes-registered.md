# Manual QA report — attribute-registry / slice `mongo-attributes-registered` — 2026-08-28

> **Script:** `projects/attribute-registry/manual-qa.md` § Slice `mongo-attributes-registered`
> **Runner:** slice orchestrator (Claude Fable 5), orchestrator-direct
> **Environment:** Linux, Node v24.19.0, pnpm 10.27.0, branch `tml-3229-mongo-attributes-registered` at `a92e09629b`
> **Verdict:** ✅ Pass — 4/4 scenarios, no findings

## Summary

Every scenario ran through `pnpm emit` in `examples/retail-store` (the `@prisma/orm-mongo/config` path, which is the same `mongoContract` provider extension authors reach through `@internal/mongo/config`). The clean schema emits with no working-tree diff; each injected attribute fails emission with the expected code, message, and a `file:line:column` location on the offending attribute, rendered by the CLI as a `CONTRACT.SOURCE_LOAD_FAILED` envelope whose `issues[]` line reads, e.g., `Model "Product" uses unsupported attribute "@@shardKey" (./src/contract.prisma:75:3)`. No stack traces; no generated files touched in the failing runs.

## Scenario results

| # | Scenario | Result | Evidence |
| - | -------- | ------ | -------- |
| 1 | Clean Mongo schema still emits byte-identical output | ✅ | exit 0; `git status --short -- examples/retail-store` empty |
| 2 | Unknown model attribute (`@@shardKey([id])` on `Product`) | ✅ | exit 2; `PSL_UNSUPPORTED_MODEL_ATTRIBUTE` — `Model "Product" uses unsupported attribute "@@shardKey"` at `./src/contract.prisma:75:3` |
| 3 | `@default(Active)` on `Product.status` (formerly silent) | ✅ | exit 2; `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` — `Field "Product.status" uses unsupported attribute "@default"` at `./src/contract.prisma:74:32` |
| 4 | Dotted `@db.ObjectId` on `Product.id` | ✅ | exit 2; `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` — `Field "Product.id" uses unsupported attribute "@db.ObjectId"` at `./src/contract.prisma:63:43` |

## Findings

None.

## Observations (not findings)

- The diagnostic for a formerly-silent `@default` gives no hint that Mongo has no default-value support at all; the message is accurate and located, so it meets the oracle. A migration hint (as the SQL interpreter gives for `@updatedAt`) would be a separate product decision.
