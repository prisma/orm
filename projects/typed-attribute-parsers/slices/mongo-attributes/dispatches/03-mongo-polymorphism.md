# Brief: D3 — migrate Mongo `@@discriminator` / `@@base` to specs

> Fresh implementer. Slice `mongo-attributes`, branch `tml-2956-mongo-attributes`. Do NOT push or touch GitHub. ONE signed commit. Tests-first. Builds on D1 (the `mongo-attribute-specs.ts` wiring exists) and D2 (already merged into the branch).

## ⛔ TOOLING RULE (operator standing order — non-negotiable)
**NEVER call the regex / codebase-search MCP tool — it HANGS and deadlocks.** SEARCH-FREE brief. Use `rg`/`grep` in the **terminal** only; reading named files/line-ranges is fine. If under-specified, STOP and report.

## Why
Mongo `@@discriminator` / `@@base` argument shapes are parsed imperatively in `collectPolymorphismDeclarations` (`interpreter.ts`) via `getPositionalArgument` + `parseQuotedStringLiteral`. Migrate the **argument parsing** to specs through `interpretAttribute`. The polymorphism cross-model semantics (`resolvePolymorphism`) are untouched — only the per-attribute argument parse changes.

## The templates
SQL's `sql-attribute-specs.ts` already defines `discriminatorModelSpec` and `baseModelSpec` (near the bottom of the file). Read them. They are exactly what Mongo needs:
```ts
export const discriminatorModelSpec = modelAttribute('discriminator', {
  positional: [{ key: 'field', type: fieldRef('self') }],
});
export const baseModelSpec = modelAttribute('base', {
  positional: [
    { key: 'base', type: entityRef() },
    { key: 'value', type: str() },
  ],
});
```
`fieldRef('self')` → the field-name string (validates it exists on the model); `entityRef()` → the model-name string (existence deferred downstream, exactly as today); `str()` → the decoded quoted-string value.

## Step 1 — add the two specs to `mongo-attribute-specs.ts`
Copy the two spec constants above into `mongo-attribute-specs.ts` (do NOT import from the SQL package). Add imports `entityRef, fieldRef` to the `@prisma-next/psl-parser` value import (it already imports `modelAttribute`, `str`). Export both.

## Step 2 — migrate `collectPolymorphismDeclarations` (`interpreter.ts` ~L208-274)
The function loops `for (const model of models) { for (const attr of model.attributes) { if (attr.name === 'discriminator') {…} if (attr.name === 'base') {…} } }`. Replace the inner `attr`-loop with two `findModelAttributeNode` lookups per model (there is at most one of each):

```ts
for (const model of models) {
  const discNode = findModelAttributeNode(model, 'discriminator');
  if (discNode) {
    const parsed = interpretModelAttribute({ node: discNode, spec: discriminatorModelSpec, model, sourceFile, sourceId, diagnostics });
    if (parsed) {
      const fieldName = parsed.field;
      const discField = model.fields[fieldName];
      // Semantic check — stays: the discriminator field must be a String.
      if (discField && discField.typeName !== 'String') {
        diagnostics.push({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: `Discriminator field "${fieldName}" on model "${model.name}" must be of type String, but is "${discField.typeName}"`,
          sourceId,
          span: nodePslSpan(discNode.syntax, sourceFile),
        });
      } else {
        discriminatorDeclarations.set(model.name, { fieldName, span: nodePslSpan(discNode.syntax, sourceFile) });
      }
    }
  }
  const baseNode = findModelAttributeNode(model, 'base');
  if (baseNode) {
    const parsed = interpretModelAttribute({ node: baseNode, spec: baseModelSpec, model, sourceFile, sourceId, diagnostics });
    if (parsed) {
      const collectionName = resolveCollectionName({ model, sourceFile, sourceId, diagnostics });
      baseDeclarations.set(model.name, { baseName: parsed.base, value: parsed.value, collectionName, span: nodePslSpan(baseNode.syntax, sourceFile) });
    }
  }
}
```
- Add `discriminatorModelSpec`, `baseModelSpec` (and `interpretModelAttribute`, `findModelAttributeNode` if not already) to the `import { … } from './mongo-attribute-specs'` line. `nodePslSpan` is already imported from `@prisma-next/psl-parser`.
- The `discField.typeName !== 'String'` check keeps its `PSL_INVALID_ATTRIBUTE_ARGUMENT` code (it is genuinely semantic, not arg-shape).
- Delete the now-dead imperative bodies (the `getPositionalArgument(attr)` / `getPositionalArgument(attr, 0|1)` / `parseQuotedStringLiteral(rawValue)` blocks and their `PSL_INVALID_ATTRIBUTE_ARGUMENT` "requires …" / "must be a quoted string literal" diagnostics).

## Diagnostic-code shifts (operator "Option A")
These arg-shape errors move from `PSL_INVALID_ATTRIBUTE_ARGUMENT` to the grammar's `PSL_INVALID_ATTRIBUTE_SYNTAX`:
- `@@discriminator` with no field arg → missing-required-arg (was "requires a field name argument").
- `@@discriminator` naming a non-existent field → `fieldRef` existence failure (previously silently recorded).
- `@@base` with fewer than two args → missing-required-arg (was "requires two arguments").
- `@@base` whose value isn't a quoted string → `str()` rejection (was "must be a quoted string literal").
The base-model-existence check and the discriminator⇄base consistency checks in `resolvePolymorphism` are unchanged. **Grep the Mongo test suite for these cases and update the asserted codes/messages per Option A** (search for `discriminator`/`@@base`/`PSL_INVALID_ATTRIBUTE_ARGUMENT` in `packages/2-mongo-family/2-authoring/contract-psl/test`), keeping the String-type-check test (`PSL_INVALID_ATTRIBUTE_ARGUMENT`) as-is. Tests-first for any new case.

## Step 3 — no parser deletions yet
`getPositionalArgument` and `parseQuotedStringLiteral` are still used by the index attributes (migrated in D4). Do NOT delete them here — only their `@@discriminator`/`@@base` call sites go away. Confirm they are still imported/used after your edit.

## Tests
Polymorphism lowering must be byte-identical for valid schemas — the Mongo contract-psl suite + `fixtures:check` are the primary signal. Update any bad-arg diagnostic-code assertions per the shifts above. If a valid `@@base`/`@@discriminator` round-trip case is missing, add one.

## Scope
**In:** the two Mongo polymorphism specs; the `collectPolymorphismDeclarations` argument-parse migration; the diagnostic-code-shift test updates. **Out:** `resolvePolymorphism` semantics; every other attribute; `packages/1-framework` / `packages/2-sql`; helper deletions (D6).

## Constraints
No `any`; no bare `as` (mirror the SQL template's justified `blindCast` only if it uses one at the same spot); no file-ext imports; never suppress biome; `pnpm` not `npm`. Commit once: `git commit -s` (DCO), explicit staging, no `--amend`, NO push, no GitHub. Read-only on `projects/**`, `.agents/**`.

## Gates (all green, in order)
1. `pnpm --filter @prisma-next/mongo-contract-psl build && typecheck && test`
2. `pnpm fixtures:check` — clean, no Mongo contract drift
3. `pnpm lint:deps` (0) and `pnpm lint:framework-vocabulary` (threshold unchanged)

## Report back
The two specs added; the `collectPolymorphismDeclarations` migration + confirmation the String-type check kept `PSL_INVALID_ATTRIBUTE_ARGUMENT`; which bad-arg tests shifted to `PSL_INVALID_ATTRIBUTE_SYNTAX`; confirmation `getPositionalArgument`/`parseQuotedStringLiteral` are still used (not deleted); the test path; all gate results; the commit SHA. If a span change breaks a diagnostic-span assertion, or the SQL template diverges, STOP and report.
