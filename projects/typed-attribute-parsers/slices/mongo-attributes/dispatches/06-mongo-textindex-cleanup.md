# Brief: D6 — migrate Mongo `@@textIndex` + delete the legacy parsers (slice finish)

> Fresh implementer. Slice `mongo-attributes`, branch `tml-2956-mongo-attributes`. Do NOT push or touch GitHub. ONE signed commit. Tests-first. Builds on D1–D5 (all on the branch). **This is the last implementation dispatch — after it the Mongo family is fully spec-driven.**

## ⛔ TOOLING RULE (operator standing order — non-negotiable)
**NEVER call the regex / codebase-search MCP tool — it HANGS and deadlocks.** SEARCH-FREE brief. Use `rg`/`grep` in the **terminal** only; reading named files/line-ranges is fine. If under-specified, STOP and report.

## Why
D5 migrated `@@index`/`@@unique` to specs but left `@@textIndex` on the old parsing branch inside `collectIndexes` (`interpreter.ts`). Migrate that branch to a spec too — which orphans the remaining legacy parsers, so they must be deleted in this same commit (biome `noUnusedVariables: error` forbids leaving dead code). Read `collectIndexes` in full first; the D5 structure (a `if (isTextIndex) {…} else {…}` block feeding shared normalized locals, then unchanged validation/key-building/`MongoIndex`) is what you extend.

## Step 1 — add `buildTextIndexModelSpec` to `mongo-attribute-specs.ts`
Reuse the D5 helpers (`indexFieldElement`, `collationNamedArgs`) already in that file. `@@textIndex` accepts: the field list + `filter` (json), `include`/`exclude` (str), `weights` (json), `language` (str — note: `language`, NOT `default_language`), `languageOverride` (str), and the collation args. It does **not** take `type`/`sparse`/`expireAfterSeconds`/`default_language`.
```ts
export function buildTextIndexModelSpec(fieldNames: readonly string[]) {
  return modelAttribute('textIndex', {
    positional: [{ key: 'fields', type: list(indexFieldElement(fieldNames), { nonEmpty: true }) }],
    named: {
      filter: optional(json()),
      include: optional(str()),
      exclude: optional(str()),
      weights: optional(json()),
      language: optional(str()),
      languageOverride: optional(str()),
      ...collationNamedArgs,
    },
  });
}
```

## Step 2 — migrate the `isTextIndex` branch in `collectIndexes`
Replace the old-path body of the `if (isTextIndex) {…}` block (the `getPositionalArgument`/`parseIndexFieldList`/`parseJsonArg`/`parseCollation`/`stripQuotesHelper`/`getNamedArgument` reads) with a spec interpretation that fills the same normalized locals. Prefer unifying both branches — since both now interpret a spec, select the spec by kind and normalize with `isTextIndex` conditionals:
```ts
const node = attributeNodes[attrIndex];
if (node === undefined) continue;
const spec = isTextIndex
  ? buildTextIndexModelSpec(specFieldNames)
  : buildIndexModelSpec(isUnique ? 'unique' : 'index', specFieldNames);
const parsed = interpretModelAttribute({ node, spec, model: pslModel, sourceFile, sourceId, diagnostics });
if (parsed === undefined) continue;
parsedFields = parsed.fields.map(normalizeIndexField);
if (parsedFields.length === 0) continue;
typeValue = isTextIndex ? undefined : parsed.type;
sparse = isTextIndex ? undefined : parsed.sparse;
expireAfterSeconds = isTextIndex ? undefined : parsed.expireAfterSeconds;
partialFilterExpression = parsed.filter;
includeArg = parsed.include;
excludeArg = parsed.exclude;
collation = buildCollationFromSpec(parsed);
default_language = isTextIndex ? parsed.language : parsed.default_language;
language_override = parsed.languageOverride;
weights = isTextIndex ? extractWeights(parsed.weights) : undefined;
```
- `parsed.weights` from `json()` is `Record<string, unknown> | undefined`; keep the existing number-filter (`extractWeights` = for each entry, keep only `typeof v === 'number'`) — extract it to a small local helper or inline it, cast-free (`unknown` narrowed by `typeof`).
- `buildCollationFromSpec(parsed)` (the D5 helper) already reads the collation args + preserves the `collationLocale`-required `PSL_INVALID_INDEX` rule — it works for the textIndex spec too since it carries `collationNamedArgs`.
- **Union the `parsed` types cleanly**: `buildTextIndexModelSpec` and `buildIndexModelSpec` infer different named-arg shapes. Read each field off `parsed` only in the branch where its spec declares it (guard the index-only reads with `isTextIndex ? undefined : parsed.<x>` and the textIndex-only `parsed.language`/`parsed.weights` with `isTextIndex ? … : undefined`). If TypeScript can't reconcile the two `parsed` shapes in one binding, keep the two-branch `if (isTextIndex) {…} else {…}` structure (each branch interprets its own spec and fills the locals) rather than forcing a cast — no bare `as`.

Everything after the normalized locals — the `textIndexCount`/one-per-collection guard, the wildcard/hashed/type/expireAfterSeconds/include-exclude `PSL_INVALID_INDEX` checks, `PSL_INDEX_FIELD_NOT_FOUND`, key-building, `parseProjectionList`-based `wildcardProjection`, and `new MongoIndex({...})` — stays **exactly as is**.

## Step 3 — delete the now-dead legacy parsers
After Step 2, migrate-then-`rg` to confirm zero remaining uses, then delete (biome will fail otherwise):
- In `interpreter.ts`: `parseCollation`, `parseNumericArg`, `parseBooleanArg`, `parseJsonArg`, `stripQuotesHelper`, and the `parseIndexFieldList`/`getNamedArgument`/`getPositionalArgument` imports (drop from the `./psl-helpers` import).
- In `psl-helpers.ts`: `parseIndexFieldList`, `parseIndexFieldSegment`, `parseFieldList`, `splitTopLevel`, `getNamedArgument`, `getPositionalArgument`.
- **Keep** (still used): `parseProjectionList` (splits the spec's `include`/`exclude` bracket-string → `wildcardProjection`), `getAttribute` (field `@id`/`@unique` presence checks), `lowerFirst` (collection naming), `parseQuotedStringLiteral` if still referenced, and anything else `rg` shows still-used.
- **Verify each deletion with `rg` first** — if any candidate still has a use outside the index loop, keep it and report.

## Step 4 — reword the stale comment
`interpreter.ts` ~L536 has a comment naming the removed `parseIndexDirection` ("Replaces `parseIndexDirection` for…"). Reword it to describe the function's purpose without naming removed code (e.g. "Normalizes the index `type` value to a Mongo key direction, defaulting to ascending (1) when absent.").

## Diagnostic-code shifts (operator "Option A")
`@@textIndex` now rejects args it doesn't declare (`type`/`sparse`/`expireAfterSeconds`/`default_language`) as `PSL_INVALID_ATTRIBUTE_SYNTAX` (the old path silently ignored them). And bad-shape textIndex args (non-JSON `weights`/`filter`, malformed field element) become grammar errors. Non-existent-field references shift to `PSL_INVALID_ATTRIBUTE_SYNTAX` (via `fieldRef`), same as D5's split; relation-field-not-indexable stays `PSL_INDEX_FIELD_NOT_FOUND`. Grep the `@@textIndex` tests and update shifted assertions; keep the `PSL_INVALID_INDEX` (one-per-collection, textIndex+wildcard) cases.

## Tests
`@@textIndex` lowering must be byte-identical for valid schemas — the Mongo contract-psl suite (`interpreter.test.ts` has textIndex coverage: basic, weights, language/languageOverride, one-per-collection, textIndex+wildcard) + `fixtures:check` are the primary signal. Update only shifted bad-arg assertions. Tests-first for anything added.

## Scope
**In:** `buildTextIndexModelSpec`; the textIndex branch migration; deleting the orphaned parsers; the stale-comment reword; code-shift test updates. **Out:** `packages/1-framework` / `packages/2-sql`; the index-shape semantics (unchanged); `parseProjectionList`/`getAttribute`/`lowerFirst` (kept).

## Constraints
No `any`; no bare `as` (narrow the `weights`/element unions with `typeof`; keep the two-branch structure if a union forces a cast); no file-ext imports; never suppress biome; `pnpm` not `npm`. Commit once: `git commit -s` (DCO), explicit staging, no `--amend`, NO push, no GitHub. Read-only on `projects/**`, `.agents/**`.

## Gates (all green, in order)
1. `pnpm --filter @prisma-next/mongo-contract-psl build && typecheck && test`
2. `pnpm fixtures:check` — clean, no Mongo contract drift
3. `pnpm lint:deps` (0) and `pnpm lint:framework-vocabulary` (threshold unchanged; reword rather than bump)
4. **Grep gate:** `rg -n "parseCollation|parseIndexFieldList|parseFieldList|splitTopLevel|parseNumericArg|parseBooleanArg|parseJsonArg|stripQuotesHelper|getNamedArgument|getPositionalArgument|parseIndexDirection" packages/2-mongo-family/2-authoring/contract-psl/src` → **zero** (all Mongo attribute-argument parsing is now spec-driven).

## Report back
`buildTextIndexModelSpec` shape; how you migrated the textIndex branch (unified vs two-branch) + how you handled the `parsed`-type union cast-free; the weights number-filter; which parsers you deleted (with the `rg`-confirmed zero) and which you kept + why; the stale-comment reword; which textIndex bad-arg tests shifted; the grep-gate result; all gate results; the commit SHA. If a `parsed`-type union forces a bare `as`, a deletion candidate is still used unexpectedly, or a `PSL_INVALID_INDEX`/textIndex assertion breaks in a way the brief doesn't cover, STOP and report.
