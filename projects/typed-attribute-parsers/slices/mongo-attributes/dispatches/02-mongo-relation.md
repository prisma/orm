# Brief: D2 — migrate Mongo `@relation` to a spec

> Fresh implementer. Slice `mongo-attributes`, branch `tml-2956-mongo-attributes`. Do NOT push or touch GitHub. ONE signed commit. Tests-first. Builds on D1 (the Mongo `mongo-attribute-specs.ts` wiring already exists).

## ⛔ TOOLING RULE (operator standing order — non-negotiable)
**NEVER call the regex / codebase-search MCP tool — it HANGS and deadlocks the run.** SEARCH-FREE brief. Use `rg`/`grep` in the **terminal** only; reading named files/line-ranges is fine. If under-specified, STOP and report.

## Why
Mongo `@relation` is parsed by the hand-written `parseRelationAttribute` (string extraction of `name`/`fields`/`references`). Replace it with a declarative spec through `interpretAttribute`, reusing D1's `mongo-attribute-specs.ts` wiring. The SQL family already did this — its spec is the template.

## The template
`packages/2-sql/2-authoring/contract-psl/src/psl-relation-resolution.ts` (lines ~99-126) defines `sqlRelation`. Read it. The Mongo spec is a **subset**: Mongo `@relation` carries only `name` (alias) + `fields` + `references` — **no `map`, no `onDelete`/`onUpdate`, and no `refine`** (see the behaviour note below). Also note (from `combinators/field-ref.ts`): `fieldRef(scope)` returns `ArgType<string>` — it yields the field-name string (with an existence check against the scoped model), so `list(fieldRef('self'))` produces `string[]`, matching the old parser's output.

## Step 1 — add the Mongo relation spec to `mongo-attribute-specs.ts`
```ts
export const relationFieldSpec = fieldAttribute('relation', {
  positional: [{ key: 'name', type: optional(str()) }],
  named: {
    name: optional(str()),
    fields: optional(list(fieldRef('self'), { nonEmpty: true, unique: true })),
    references: optional(list(fieldRef('referenced'), { nonEmpty: true, unique: true })),
  },
});
export type RelationFieldOutput = InferAttr<typeof relationFieldSpec>;
```
Add the needed imports to `mongo-attribute-specs.ts`: `fieldRef, list, optional` (values) and `type { InferAttr }` from `@prisma-next/psl-parser` (mirror the SQL file's specifiers). Output shape: `{ name?: string; fields?: string[]; references?: string[] }`.

**No `refine`.** SQL's `relationInvariants` errors when `fields` XOR `references` is present; Mongo must NOT adopt that — the Mongo interpreter (below) treats "not both `fields` and `references`" as a **backrelation candidate**, not an error. Adding the refine would change Mongo behaviour. Omit it.

## Step 2 — migrate the consumption in `interpreter.ts` (~L1088-1133)
The single call site is `const relation = parseRelationAttribute(field.attributes);` (~L1090), inside `for (const field of Object.values(pslModel.fields))` guarded by `isRelationField(field, modelNames)`. Replace with:
```ts
const relationNode = findFieldAttributeNode(field, 'relation');
const relation = relationNode
  ? interpretFieldAttribute({
      node: relationNode,
      spec: relationFieldSpec,
      model: pslModel,
      field,
      sourceFile,
      sourceId,
      diagnostics,
      resolveReferencedModel: () => allModels.find((m) => m.name === field.typeName),
    })
  : undefined;
```
Add `relationFieldSpec` (and `findFieldAttributeNode`, `interpretFieldAttribute` if not already imported) to the `import { … } from './mongo-attribute-specs'` line. `allModels`, `sourceFile`, `sourceId`, `diagnostics` are all in scope here (confirm by reading ~L1016-1090).

Then update the two reads of the old `relationName` key — the spec output uses `name`, not `relationName`. The **output** key stays `relationName`:
- `...ifDefined('relationName', relation?.relationName)` → `...ifDefined('relationName', relation?.name)` (the backrelation-candidate push, ~L1097)
- `...ifDefined('relationName', relation.relationName)` → `...ifDefined('relationName', relation.name)` (the FK-relation push, ~L1128)

`relation?.fields` and `relation?.references` are `string[]` exactly as before — the `.map((f) => fieldMappings.pslNameToMapped.get(f) ?? f)` lines are unchanged, as is the `if (field.list || !(relation?.fields && relation?.references))` backrelation branch.

## Behaviour note — new field-existence validation
The old `parseRelationAttribute` did no validation; `fieldRef('self')`/`fieldRef('referenced')` now check that each named field exists on the self / referenced model (the referenced check is skipped when `resolveReferencedModel()` returns `undefined`, e.g. a cross-space target). For **valid** schemas this is byte-identical (the names resolve and the same `string[]` comes out). For a schema naming a non-existent relation field, a `PSL_INVALID_ATTRIBUTE_SYNTAX` now fires at parse time. Run the suite: if an existing test asserted a different code/behaviour for a bad relation field ref, update it per operator "Option A" (shape/existence → `PSL_INVALID_ATTRIBUTE_SYNTAX`) and note it; if no such test exists, rely on the green suite + `fixtures:check`.

## Step 3 — retire the dead parser
Delete `parseRelationAttribute` and the `ParsedRelationAttribute` interface from `psl-helpers.ts`, and remove `parseRelationAttribute` from the `interpreter.ts` import list. Then `rg` in the terminal for the now-possibly-unused helpers: **`parseRelationAttribute`** must be zero. `stripQuotes` was used only by the (already-deleted) `getMapName` and by `parseRelationAttribute` — if `rg -n "stripQuotes" packages/2-mongo-family` is now zero outside its own definition, delete `stripQuotes` too. **Keep `parseFieldList`** (still used by `parseIndexFieldList`, migrated in a later dispatch) and `getAttribute`/`lowerFirst`/`getPositionalArgument`/`getNamedArgument`.

## Tests
`@relation` lowering must stay byte-identical for valid schemas — the Mongo contract-psl suite + `fixtures:check` are the primary signal. If the suite lacks a direct FK-relation case (a model with `@relation(fields: [x], references: [y])` producing `relations[...]` with `on.localFields`/`on.targetFields`) or a named-relation/backrelation case, add one concise case. Tests-first for anything added.

## Scope
**In:** the Mongo `relationFieldSpec`; the `interpreter.ts` relation call-site migration + the `relationName`→`name` read changes; deleting `parseRelationAttribute`/`ParsedRelationAttribute` (+ `stripQuotes` if now dead). **Out:** every other Mongo attribute; `packages/1-framework` / `packages/2-sql` changes; the interpreter's relation semantics (backrelation matching, FK indexing) — only the argument parse changes.

## Constraints
No `any`; no bare `as` (a narrow justified `blindCast` only if the SQL template uses one at the same spot); no file-ext imports; never suppress biome; `pnpm` not `npm`. Commit once: `git commit -s` (DCO), explicit staging, no `--amend`, NO push, no GitHub. Read-only on `projects/**`, `.agents/**`.

## Gates (all green, in order)
1. `pnpm --filter @prisma-next/mongo-contract-psl build && typecheck && test` (use the exact package name from its package.json)
2. `pnpm fixtures:check` — clean, no Mongo contract drift
3. `pnpm lint:deps` (0) and `pnpm lint:framework-vocabulary` (threshold unchanged)

## Report back
The `relationFieldSpec` shape + confirmation no `refine` was added; the migration site + `relationName`→`name` read changes; whether any field-existence-validation test shifted (and how); `parseRelationAttribute` gone (`rg` → zero) and whether `stripQuotes` was also removed; the test path (added vs relied-on); all gate results; the commit SHA. If the SQL template diverges from this brief, or `stripQuotes` turns out still-used, or a gate goes red you can't resolve from the brief, STOP and report.
