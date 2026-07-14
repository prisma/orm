# Slice `mongo-attributes` — dispatch plan

**Spec:** `./spec.md` · **Branch:** `tml-2956-mongo-attributes` (off `origin/main`) · **Linear:** umbrella [TML-2956](https://linear.app/prisma-company/issue/TML-2956).

Substrate-then-consumers within the slice: D1 lands the Mongo-side wiring and proves the seam on the simplest attribute; D2–D4 migrate the simple attributes; D5–D6 tackle the heavy index grammar (and build the kit pieces they consume); D7 removes the legacy parsers behind a grep gate. Each dispatch leaves the Mongo contract-psl suite + `fixtures:check` green.

| # | Dispatch | Outcome | Builds on | New kit |
| - | -------- | ------- | --------- | ------- |
| D1 ✅ | Mongo `InterpretCtx` wiring + `@map`/`@@map` | `mongo-attribute-specs.ts` exists (`buildFieldInterpretCtx`/`buildModelInterpretCtx`, `interpretFieldAttribute`/`interpretModelAttribute`, `findFieldAttributeNode`/`findModelAttributeNode`); `@map`/`@@map` lowered via a spec. Proves the seam end-to-end. **Done — commit `b6835dc09`.** | slice 1 kit | — |
| D2 | `@relation` (Mongo) | Mongo `@relation` (name positional/named alias, `fields`, `references`) spec-driven; `parseRelationAttribute` retired. | D1 wiring | — |
| D3 | `@@discriminator`, `@@base` | Polymorphism attribute **argument shapes** (field name; base/value) spec-driven; cross-model consistency (`resolvePolymorphism`) untouched. | D1 wiring | — |
| D4 | `@@index` / model `@@unique` core | Index field-element `oneOf(fieldRef, sortedFieldRef, wildcardPath)` + `type` `oneOf(num/str …)` spec-driven; `parseIndexFieldList`/`parseIndexDirection` retired; `PSL_INVALID_INDEX` + field-existence stay. | D1 wiring | `str(value)`, `sortedFieldRef`, `wildcardPath` |
| D5 | `@@textIndex` | Collation named args + `weights` (`map(fieldRef,int())`) + wildcardProjection spec-driven; `parseCollation`/`parseJsonArg`/`parseNumericArg`/`parseBooleanArg` retired; one-per-collection guard stays. | D4 | `map(key, value)` |
| D6 | Delete legacy Mongo parsers | Remove the now-dead `psl-helpers.ts` arg parsers + interpreter-local parsers; grep gate → zero; final `fixtures:check`. | D1–D5 | — |

> **Correction (post-D1 grounding).** Field `@id` and field `@unique` are **presence-only** in Mongo (`getAttribute(field.attributes, 'id'|'unique') !== undefined` — no arguments to parse), so they need no spec migration; `getAttribute` stays for them. Model `@@unique` is handled inside the index loop alongside `@@index`/`@@textIndex`, so it folds into D4, not a separate dispatch. The original "D2: @id/@unique/@@unique" is dropped and the remaining dispatches renumbered.

## Sequencing

Stack: D1 (done) → (D2, D3 disjoint after D1) → D4 → D5 → D6. D2 (`@relation`) and D3 (polymorphism) touch disjoint attribute sites but share `interpreter.ts` + `mongo-attribute-specs.ts` as a write surface, so they run **sequentially on the branch** (not as parallel sub-agents) to avoid clobbering. D4 builds the index grammar; D5 builds on it for `@@textIndex`; D6 is the closing sweep once every consumer is migrated.

## Sizing note (Open Question 1 in the spec)

Target ≤ ~7 dispatches. If, at D5, the index/textIndex diff plus the earlier attributes can't be held in one code review, split D5–D6 into a sibling slice/PR (`mongo-index`) — mirroring how `@default` split out of `sql-attributes`. Decision deferred to D5; surfaced to the operator then.

## Kit-additions provenance

- `num(value)` — already shipped (SQL slice, D8). Reused by the index `type` set.
- `str(value)` — D5 (first consumer: index `type` digit-leading members).
- `sortedFieldRef` / `wildcardPath` — D5 (index element `oneOf`).
- `map(key, value)` — D6 (`@@textIndex` `weights`). `record(value)` = `map(str(), value)` already exists.
