# Brief: D5 — migrate Mongo `@@index` / `@@unique` (model) to specs

> Fresh implementer. Slice `mongo-attributes`, branch `tml-2956-mongo-attributes`. Do NOT push or touch GitHub. ONE signed commit. Tests-first. Builds on D1–D4 (the `mongo-attribute-specs.ts` wiring + `str(value)`/`json()` combinators are on the branch).

## ⛔ TOOLING RULE (operator standing order — non-negotiable)
**NEVER call the regex / codebase-search MCP tool — it HANGS and deadlocks.** SEARCH-FREE brief. Use `rg`/`grep` in the **terminal** only; reading named files/line-ranges is fine. If under-specified, STOP and report.

## Why
Migrate the **argument parsing** of the model-level `@@index` and `@@unique` attributes off the imperative string helpers onto specs through `interpretAttribute`. The dense index-shape **validation stays** in the interpreter — only the arg *source* changes. `@@textIndex` stays on its current path in this dispatch (migrated in D6); the loop branches to keep textIndex working.

All the code lives in `collectIndexes` (`packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts`, ~L626-880). Read that whole function first — you will preserve all of its validation, key-building, and `MongoIndex` construction; you only replace where the argument *values* come from.

## The argument surface (grounded)
Positional `fields` = an array of index elements, each one of:
- a bare field → `fieldRef('self')` → the field-name string;
- `field(sort: Asc|Desc)` → a per-field sorted ref;
- `wildcard()` / `wildcard(scope)` → a wildcard path.

Named args (`@@index`/`@@unique`): `type` (`1`/`-1`/`"text"`/`"2dsphere"`/`"2d"`/`"hashed"`), `sparse` (bool), `expireAfterSeconds` (number), `filter` (quoted JSON → object), `include` / `exclude` (quoted bracket-string, e.g. `"[a, b]"`), `default_language` (quoted string), `languageOverride` (quoted string), and the 9 collation args: `collationLocale`/`collationCaseFirst`/`collationAlternate`/`collationMaxVariable` (quoted strings), `collationStrength` (number), `collationCaseLevel`/`collationNumericOrdering`/`collationBackwards`/`collationNormalization` (bools).

## Step 1 — spec infrastructure in `mongo-attribute-specs.ts`
Add, composed dynamically per model from its field names (exactly like `buildDefaultSpec` composes from the registry):

**(a) The field element** (the plan's `sortedFieldRef`/`wildcardPath` dissolve into `funcCall` composition — no new combinators):
```ts
const sortSig = { named: { sort: oneOf(identifier('Asc'), identifier('Desc')) } } satisfies FuncCallSig;
function indexFieldElement(fieldNames: readonly string[]) {
  const fieldArms = fieldNames.map((name) => funcCall(name, sortSig)); // `field(sort: X)` → { fn: name, args: { sort } }
  return oneOf(
    fieldRef('self'),                                                                 // bare field → "name"
    funcCall('wildcard', { positional: [{ key: 'scope', type: optional(fieldRef('self')) }] }), // wildcard(scope) → { fn: 'wildcard', args: { scope? } }
    ...fieldArms,
  );
}
```
Element output is `string | { fn: string; span; args: { sort?: 'Asc'|'Desc'; scope?: string } }`. (If `fieldNames` is empty the model has no fields — guard so the `oneOf` tuple stays non-empty, e.g. skip the field arms; a bare `oneOf(fieldRef('self'), funcCall('wildcard', …))` is still valid.)

**(b) A shared collation named-args object:**
```ts
const collationNamedArgs = {
  collationLocale: optional(str()),
  collationStrength: optional(int()),
  collationCaseLevel: optional(bool()),
  collationCaseFirst: optional(str()),
  collationNumericOrdering: optional(bool()),
  collationAlternate: optional(str()),
  collationMaxVariable: optional(str()),
  collationBackwards: optional(bool()),
  collationNormalization: optional(bool()),
};
```

**(c) An index-spec factory** (one shape for both `@@index` and `@@unique`; the attribute name differs, args are the same):
```ts
export function buildIndexModelSpec(name: 'index' | 'unique', fieldNames: readonly string[]) {
  return modelAttribute(name, {
    positional: [{ key: 'fields', type: list(indexFieldElement(fieldNames), { nonEmpty: true }) }],
    named: {
      type: optional(oneOf(num(1), num(-1), str('text'), str('2dsphere'), str('2d'), str('hashed'))),
      sparse: optional(bool()),
      expireAfterSeconds: optional(int()),
      filter: optional(json()),
      include: optional(str()),
      exclude: optional(str()),
      default_language: optional(str()),
      languageOverride: optional(str()),
      ...collationNamedArgs,
    },
  });
}
```
Add the needed imports (`bool, fieldRef, funcCall, identifier, int, json, list, num, oneOf, optional, str`, and `type FuncCallSig`).

## Step 2 — normalize + migrate `collectIndexes`
Introduce a helper that turns a spec-interpreted `@@index`/`@@unique` into the same normalized values the loop already uses, so the **rest of the loop is unchanged**. The loop today derives, per attribute: `parsedFields: ParsedIndexField[]` (`{ name, isWildcard, direction? }`), then `typeArg`, `sparse`, `expireAfterSeconds`, `partialFilterExpression` (filter), `include`/`exclude` → `wildcardProjection`, `collation`, `default_language`, `language_override`. Produce those from the spec output instead of the `getNamedArgument`/`parse*` calls:

- **Field elements → `ParsedIndexField[]`:** map each interpreted element:
  - `string` → `{ name, isWildcard: false }`
  - `{ fn: 'wildcard', args: { scope? } }` → `{ name: scope ? \`${scope}.$**\` : '$**', isWildcard: true }`
  - `{ fn, args: { sort } }` (fn is the field name) → `{ name: fn, isWildcard: false, direction: sort === 'Desc' ? -1 : 1 }`
- **`type`:** the interpreted value is already `1 | -1 | 'text' | '2dsphere' | '2d' | 'hashed' | undefined`; feed it where `parseIndexDirection(typeArg)` was used (default `1` when absent). This replaces `parseIndexDirection` for the index/unique path.
- **`filter`** → the `json()` object (was `parseJsonArg`).
- **`include`/`exclude`** → the raw `str()` value; feed to the existing `parseProjectionList(value, 1|0)` (parseProjectionList stays — it splits the bracket-string; the spec only supplies the decoded string).
- **collation** → build the `CollationOptions` from the interpreted collation args (locale/strength/etc.), replacing `parseCollation`. **Preserve the semantic rule:** if any collation arg is present but `collationLocale` is absent → the existing `PSL_INVALID_INDEX` "collationLocale is required" diagnostic. Keep that check (it is genuinely semantic, not arg-shape).
- **`default_language`/`languageOverride`** → the `str()` values (was `stripQuotesHelper`).

Structure it cleanly: for `@@textIndex` keep the **existing** old-path parsing (branch `if (isTextIndex) { …old parseIndexFieldList/getNamedArgument path… } else { …spec path… }`); for `@@index`/`@@unique` use `interpretModelAttribute({ node: findModelAttributeNode(model, name), spec: buildIndexModelSpec(name, fieldNames), model, sourceFile, sourceId, diagnostics })`. Everything after normalization — the wildcard-count / unique+wildcard / hashed-single-field / wildcard+type / wildcard+expireAfterSeconds / include-xor-exclude / include-requires-wildcard checks, the `PSL_INDEX_FIELD_NOT_FOUND` existence check, the key mapping, and the `new MongoIndex({...})` construction — stays **exactly as is**, reading the normalized values.

Note: `collectIndexes(pslModel, …)` currently takes `(pslModel, fieldMappings, modelNames, sourceId, diagnostics, indexSpans)` — it will also need `sourceFile` (thread it from the caller; the entry has it in scope). `fieldNames` for the spec = the model's field names (`Object.keys(pslModel.fields)`), the same set the existence check uses.

## Diagnostic-code shifts (operator "Option A")
Arg-shape errors that were silent or bespoke become grammar `PSL_INVALID_ATTRIBUTE_SYNTAX`: an unknown `type` value (was silently defaulted to `1` by `parseIndexDirection`), a non-bool `sparse`, a non-numeric `expireAfterSeconds`, a malformed field element, a bad `sort` direction, invalid `filter`/`weights` JSON. The genuinely-semantic index-shape codes (`PSL_INVALID_INDEX` in all its forms, `PSL_INDEX_FIELD_NOT_FOUND`, the collation-locale-required rule) are **preserved**. Grep the Mongo index tests and update any shifted assertions per Option A; keep the `PSL_INVALID_INDEX`/`PSL_INDEX_FIELD_NOT_FOUND` cases as-is.

## Step 3 — no parser deletions yet
`parseIndexDirection`, `parseCollation`, `parseNumericArg`, `parseBooleanArg`, `stripQuotesHelper`, `parseIndexFieldList`, `getNamedArgument`, `getPositionalArgument` are **still used by the `@@textIndex` old-path branch** — do NOT delete them here (D6 migrates textIndex, D7 deletes them). `parseProjectionList` and `parseJsonArg`-for-weights stay for now too. Confirm they're all still used after your edit.

## Tests
`@@index`/`@@unique` lowering must be byte-identical for valid schemas — the Mongo contract-psl suite (`test/interpreter.test.ts` has extensive index coverage: ascending/descending/compound, `type`, `sparse`/`expireAfterSeconds`, `filter`, `include`/`exclude`, wildcard, collation, `@@unique` variants) + `fixtures:check` are the primary signal. Run them; update only the code-shifted bad-arg assertions. Tests-first for any added case.

## Scope
**In:** the field-element helper + collation args + `buildIndexModelSpec`; the `@@index`/`@@unique` normalization + migration in `collectIndexes` (textIndex kept on the old branch); the `sourceFile` threading; code-shift test updates. **Out:** `@@textIndex` migration (D6); parser deletions (D7); `packages/1-framework` / `packages/2-sql`; all the index-shape semantics (unchanged).

## Constraints
No `any`; no bare `as` (a narrow justified `blindCast` is acceptable only where mapping the heterogeneous element union forces it — narrow it as far as possible, prefer discriminating on `typeof x === 'string'` / `x.fn === 'wildcard'`); no file-ext imports; never suppress biome; `pnpm` not `npm`. Commit once: `git commit -s` (DCO), explicit staging, no `--amend`, NO push, no GitHub. Read-only on `projects/**`, `.agents/**`.

## Gates (all green, in order)
1. `pnpm --filter @prisma-next/mongo-contract-psl build && typecheck && test`
2. `pnpm fixtures:check` — clean, no Mongo contract drift
3. `pnpm lint:deps` (0) and `pnpm lint:framework-vocabulary` (threshold unchanged; reword rather than bump)

## Report back
The field-element helper + `buildIndexModelSpec` shape; how you normalized the element union to `ParsedIndexField` (and any `blindCast` used); confirmation the index-shape validation + `MongoIndex` construction are unchanged and `@@textIndex` still works via the old branch; which bad-arg tests shifted to `PSL_INVALID_ATTRIBUTE_SYNTAX`; confirmation the legacy parsers are still used (not deleted); all gate results; the commit SHA. If the element-union normalization forces a wide cast, if a `PSL_INVALID_INDEX` span/message assertion breaks, or a gate goes red you can't resolve from the brief, STOP and report the exact blocker.
