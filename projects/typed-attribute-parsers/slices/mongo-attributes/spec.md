# Slice: mongo-attributes

_(In-project slice. Parent: `projects/typed-attribute-parsers/`. Parallel group B of the project plan — independent of the SQL slices, builds only on slice 1's already-merged kit. Outcome it contributes: the **Mongo** family becomes spec-driven, completing "every attribute in every family validates its arguments through the kit".)_

## At a glance

Migrate the **Mongo** family's attribute argument-parsing off `ResolvedAttribute` + hand-written string helpers onto the declarative combinator kit (`interpretAttribute`), exactly as the SQL family already did. Mongo attributes in scope: `@id`, `@unique` / `@@unique`, `@@index`, `@@textIndex`, `@relation`, `@map` / `@@map`, `@@discriminator`, `@@base`.

Current state (grounded):
- `packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts` (~1363 lines) parses every attribute imperatively via `getPositionalArgument` / `getNamedArgument` and the `psl-helpers.ts` string parsers (`parseIndexFieldList`, `parseFieldList`, `parseRelationAttribute`, `stripQuotes`) plus interpreter-local `parseIndexDirection` / `parseNumericArg` / `parseBooleanArg` / `parseJsonArg` / `parseCollation`.
- **No kit usage yet** — Mongo does not import `interpretAttribute` / `fieldAttribute` / `modelAttribute` / `InterpretCtx`, and there is no `mongo-attribute-specs.ts` and no Mongo-side `InterpretCtx` wiring.

## Chosen design

Mirror the SQL family's shape, in the Mongo package:

1. **Mongo `InterpretCtx` wiring + wrappers.** A new `mongo-attribute-specs.ts` provides `buildFieldInterpretCtx` / `buildModelInterpretCtx` and `interpretFieldAttribute` / `interpretModelAttribute` (drain parse failures into `diagnostics`, return the typed value or `undefined`) — parallel to SQL's. Plus `findFieldAttributeNode` / `findModelAttributeNode`.
2. **Per-attribute specs**, composed from kit combinators, replacing each imperative parse site in `interpreter.ts`.
3. **New shared-kit combinators** (built in `psl-parser`, first-consumed here — the plan's carry-in):
   - `str(value)` — pinned string literal (parallel to `num(value)` from the SQL slice). First consumer: the index `type` set, whose digit-leading members (`"2dsphere"`, `"2d"`) can only be quoted-string literals.
   - `map(key, value)` — reads a `{…}` object literal into `Record<K,V>` (ADR § "Generic collections"). First consumer: `@@textIndex` `weights` (`map(fieldRef('self'), int())`). `record(value)` already exists as the `map(str(), value)` shorthand.
   - `sortedFieldRef(scope)` and `wildcardPath()` — the two non-plain index-element shapes, so a Mongo index element is `oneOf(fieldRef('self'), sortedFieldRef('self'), wildcardPath())` (ADR § "Alternatives and function calls").
4. **Mixed literal set as `oneOf`** (carry-in): the index `type` (`1`, `-1`, `"text"`, `"2dsphere"`, `"2d"`, `"hashed"`) becomes `oneOf(num(1), num(-1), str('text'), str('2dsphere'), str('2d'), str('hashed'))` — homogeneous-or-mixed with the quoted-vs-bare surface explicit per member (ADR § "Scalars").

**What moves into the grammar (specs):** argument syntax only — the relation args (`name` alias / `fields` / `references`), the index field-list element shapes, the index `type` set, the `@@textIndex` collation named-arg shapes and `weights` map, the `@map` name, `@@discriminator` / `@@base` argument shapes.

**What stays semantic (in the interpreter):** the index-shape validation that is not single-argument syntax — `PSL_INVALID_INDEX` (at-most-one wildcard, unique+wildcard forbidden, hashed→single-field, wildcard+`hashed`/`2dsphere`/`2d` forbidden), `PSL_INDEX_FIELD_NOT_FOUND` (field-existence against the model), the **one-`@@textIndex`-per-collection** rule (stays in Mongo's model-level aggregation, per the project spec — not a per-attribute `refine`), and the polymorphism cross-model rules (`@@discriminator`/`@@base` consistency across models).

**Diagnostic codes:** shape/arity errors that today produce bespoke codes move to `PSL_INVALID_ATTRIBUTE_SYNTAX` where that is honest (operator "Option A", consistent with the SQL slices); genuinely-semantic codes (`PSL_INVALID_INDEX`, `PSL_INDEX_FIELD_NOT_FOUND`, the polymorphism codes) are preserved. Per-case shifts are pre-investigated at dispatch-authoring time and the asserting tests updated.

## Coherence rationale

One outcome — "the Mongo family is spec-driven on every attribute; the Mongo string parsers (`psl-helpers.ts` arg helpers + `parseIndexFieldList` / `parseRelationAttribute` / the interpreter-local collation/number/bool/json parsers) are deleted; no legacy Mongo attribute-argument parser remains (grep gate)." It parallels the SQL family migration and shares no mutable surface with it beyond the already-merged kit.

## Scope

**In:** `mongo-attribute-specs.ts` (wiring + wrappers + per-attribute specs); the `interpretAttribute` call-site migration in `interpreter.ts` for all in-scope attributes; the four new kit combinators (`str(value)`, `map`, `sortedFieldRef`, `wildcardPath`) with unit tests; deletion of the now-dead Mongo string parsers.

**Out:**
- **The interpreter's semantic checks** — `PSL_INVALID_INDEX` shape rules, `PSL_INDEX_FIELD_NOT_FOUND`, one-`@@textIndex`-per-collection, polymorphism cross-model consistency — all stay.
- **SQL family** — already migrated (slices `sql-attributes` + `sql-default`).
- **Language-server autocomplete** — project non-goal / deferred follow-up.
- **`@db.*` native types** — project-wide out of scope.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| Index element `wildcard(scope)` / `field(sort: Desc)` / bare field | Grammar: `oneOf(fieldRef('self'), sortedFieldRef('self'), wildcardPath())` | Replaces `parseIndexFieldSegment`'s regexes. `sortedFieldRef` carries the `Asc`/`Desc` → `1`/`-1` direction; `wildcardPath` yields the `$**` / `scope.$**` path. |
| Index `type` mixed str/num set | Grammar: `oneOf(num(1), num(-1), str('text'), str('2dsphere'), str('2d'), str('hashed'))` | Replaces `parseIndexDirection`. |
| `@@textIndex` `weights: {field: n}` | Grammar: `map(fieldRef('self'), int())` (new `map` combinator) | Replaces `parseJsonArg` + the manual number-coercion loop. |
| `@@textIndex` collation (`collationLocale`, `collationStrength`, …) | Grammar: named optional args (str / int / bool) on the spec | Replaces `parseCollation` + `parseNumericArg` / `parseBooleanArg`. The both-or-neither / dependency rules (if any) go in the spec's `refine`. |
| Index-shape validity (wildcard count, unique+wildcard, hashed single-field, textIndex-per-collection) | Semantic; stays | `PSL_INVALID_INDEX` + the model-level textIndex-count guard remain in `interpreter.ts`. |
| Index field existence | Semantic; stays | `PSL_INDEX_FIELD_NOT_FOUND` stays (checked against the model's indexable fields). |
| `@relation` name positional-or-named alias | Grammar: positional `key:'name'` sharing the output key with named `name` | The alias mechanic the kit already models (ADR § "Positional and named arguments"). |
| `@@discriminator` / `@@base` args | Grammar for arg shapes; cross-model consistency stays semantic | Field name / (base, value) argument shapes move to specs; the `@@discriminator`⇄`@@base` cross-model rules stay in `resolvePolymorphism`. |

## Slice-specific done conditions

- [ ] Every in-scope Mongo attribute is validated + lowered via a spec through `interpretAttribute`.
- [ ] `psl-helpers.ts` arg-parsing (`getPositionalArgument`, `getNamedArgument`, `parseFieldList`, `parseIndexFieldList` + `parseIndexFieldSegment`, `parseRelationAttribute`, `stripQuotes`) and the interpreter-local `parseIndexDirection` / `parseNumericArg` / `parseBooleanArg` / `parseJsonArg` / `parseCollation` are deleted (`rg` each → zero) for every migrated attribute. Retained: `getMapName`/`getAttribute` only if still needed by surviving semantic code; `lowerFirst` (collection naming) stays.
- [ ] Semantic codes preserved: `PSL_INVALID_INDEX`, `PSL_INDEX_FIELD_NOT_FOUND`, the polymorphism codes; the one-`@@textIndex`-per-collection guard intact.
- [ ] `pnpm fixtures:check` clean (byte-identical Mongo contract output); the Mongo contract-psl test suite green; the four new combinators unit-tested; vocab green.

## Open Questions

_Open (surface to operator before the index/textIndex dispatches):_

1. **One slice or two?** This slice migrates the whole Mongo family including the heavy `@@index` / `@@textIndex` (collation + weights + wildcard element grammar). If the diff outgrows a single-sitting review, the index/textIndex portion is the natural split into its own slice/PR (as `@default` was split out of `sql-attributes`). Recommendation: build in the dispatch order below and re-evaluate at D5; split if the review can't hold it.
2. **`@@textIndex` collation surface.** Confirm whether the collation named args should stay a flat set of optional args on the `@@textIndex` spec (matches today's PSL surface) or move to a nested `map`/object — likely "flat optional args", but confirm against the ADR's native-literal surface policy at dispatch time.

## References

- Parent project: `projects/typed-attribute-parsers/spec.md`; project plan `projects/typed-attribute-parsers/plan.md` (slice `mongo-attributes`, parallel group B, with the D6 carry-in note).
- SQL precedent to mirror: `packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts` (wiring + wrappers + specs); the merged `sql-default` slice under `projects/typed-attribute-parsers/slices/sql-default/`.
- Mongo current state: `packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts`, `.../src/psl-helpers.ts`.
- Kit: `packages/1-framework/2-authoring/psl-parser/src/attribute-spec/**`; ADR 231 (§ "The combinator kit", § "Alternatives and function calls").
