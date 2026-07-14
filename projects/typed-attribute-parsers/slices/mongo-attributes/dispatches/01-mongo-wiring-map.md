# Brief: D1 — Mongo `InterpretCtx` wiring + `@map`/`@@map` migration

> Fresh implementer. Slice `mongo-attributes`, branch `tml-2956-mongo-attributes` (off `origin/main`). Do NOT push or touch GitHub. ONE signed commit. Tests-first.

## ⛔ TOOLING RULE (operator standing order — non-negotiable)
**NEVER call the regex / codebase-search MCP tool — it HANGS and deadlocks the run.** SEARCH-FREE brief. Use `rg`/`grep` in the **terminal** only; reading named files/line-ranges with the file reader is fine. If genuinely under-specified, STOP and report "brief under-specified: <what>".

## Why
The Mongo family still parses every attribute imperatively off `ResolvedAttribute` + string helpers; it does not use the declarative kit at all. This dispatch lands the Mongo-side kit wiring (a `mongo-attribute-specs.ts` mirroring the SQL family's) and migrates the simplest attribute — `@map`/`@@map` — end-to-end through `interpretAttribute`, proving the seam. No new kit combinators are needed (`str`, `fieldAttribute`, `modelAttribute`, `interpretAttribute` already exist). No `packages/1-framework` or `packages/2-sql` changes.

## The pattern to mirror
The SQL family's wiring lives in `packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts` (lines ~36-146): `findModelAttributeNode`, `findFieldAttributeNode`, `buildModelInterpretCtx`, `buildFieldInterpretCtx`, `interpretModelAttribute`, `interpretFieldAttribute`, and the `mapModelSpec`/`mapFieldSpec` constants. **Read that file first** — you will reproduce those functions in the Mongo package (they are family-agnostic: they take `ModelSymbol`/`FieldSymbol`/`SourceFile`/`sourceId`/`diagnostics`). Do NOT import them from `@prisma-next/sql-contract-psl` — that is a forbidden cross-family dependency; copy the wiring into the Mongo package.

## Step 1 — new file `packages/2-mongo-family/2-authoring/contract-psl/src/mongo-attribute-specs.ts`
Reproduce, adapted to this package, from the SQL template:
- `findModelAttributeNode(model, name)` and `findFieldAttributeNode(field, name)` (iterate `model.node.attributes()` / `field.node.attributes()`, return the AST node whose `.name()?.isSimpleName(name) === true`).
- `buildModelInterpretCtx({ selfModel, sourceFile, sourceId })` → `InterpretCtx` (level `'model'`, `resolveReferencedModel: () => undefined`).
- `buildFieldInterpretCtx({ selfModel, field, sourceFile, sourceId, resolveReferencedModel? })` → `InterpretCtx` (level `'field'`).
- `interpretModelAttribute<Out>({ node, spec, model, sourceFile, sourceId, diagnostics })` and `interpretFieldAttribute<Out>({ node, spec, model, field, sourceFile, sourceId, diagnostics, resolveReferencedModel? })` — call `interpretAttribute(node, spec, ctx)`, drain `result.failure` into `diagnostics` and return `undefined` on failure, else `result.value`.
- The two map specs:
```ts
export const mapModelSpec = modelAttribute('map', { positional: [{ key: 'name', type: str() }] });
export const mapFieldSpec = fieldAttribute('map', { positional: [{ key: 'name', type: str() }] });
```
Imports: from `@prisma-next/psl-parser` — `fieldAttribute, modelAttribute, str, interpretAttribute` (values) and `type { AttributeSpec, FieldSymbol, InterpretCtx, ModelSymbol }`; from `@prisma-next/psl-parser/syntax` — `type { FieldAttributeAst, ModelAttributeAst, SourceFile }`; from `@prisma-next/config/config-types` — `type { ContractSourceDiagnostic }`. (Match the exact import specifiers the SQL file uses.)

## Step 2 — migrate the three `getMapName` sites in `interpreter.ts`
(a) **Field `@map`** — `resolveFieldMappings` (currently ~L132-139). Change its signature to take the interpret context and use the spec:
```ts
function resolveFieldMappings(input: {
  readonly model: ModelSymbol;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): FieldMappings {
  const { model, sourceFile, sourceId, diagnostics } = input;
  const pslNameToMapped = new Map<string, string>();
  for (const field of Object.values(model.fields)) {
    const mapNode = findFieldAttributeNode(field, 'map');
    const mapped =
      (mapNode
        ? interpretFieldAttribute({ node: mapNode, spec: mapFieldSpec, model, field, sourceFile, sourceId, diagnostics })?.name
        : undefined) ?? field.name;
    pslNameToMapped.set(field.name, mapped);
  }
  return { pslNameToMapped };
}
```
(b) **Collection `@@map`** — `resolveCollectionName` (currently ~L141-143):
```ts
function resolveCollectionName(input: {
  readonly model: ModelSymbol;
  readonly sourceFile: SourceFile;
  readonly sourceId: string;
  readonly diagnostics: ContractSourceDiagnostic[];
}): string {
  const { model, sourceFile, sourceId, diagnostics } = input;
  const mapNode = findModelAttributeNode(model, 'map');
  const name = mapNode
    ? interpretModelAttribute({ node: mapNode, spec: mapModelSpec, model, sourceFile, sourceId, diagnostics })?.name
    : undefined;
  return name ?? lowerFirst(model.name);
}
```
(c) **Variant presence check** — currently `interpreter.ts` ~L343: `const hasExplicitMap = getMapName(variantModelView.attributes) !== undefined;`. `variantModelView` is a resolved model view (not a `ModelSymbol` with `.node`), so keep this a presence check via the surviving `getAttribute` helper:
```ts
const hasExplicitMap = getAttribute(variantModelView.attributes, 'map') !== undefined;
```
(For a well-formed `@@map("x")` both forms are equivalent; a valueless `@@map()` is invalid PSL upstream.)

## Step 3 — thread context into the callers
The two call sites are `interpreter.ts` ~L1017-1018:
```ts
const collectionName = resolveCollectionName(pslModel);
const fieldMappings = resolveFieldMappings(pslModel);
```
Read the enclosing function (`interpretPslDocumentToMongoContract`, ~L952 onward) to find the in-scope `sourceFile`, `sourceId`, and the `diagnostics` accumulator (they exist — the entry emits diagnostics with `sourceId`/`sourceFile` already). Pass them:
```ts
const collectionName = resolveCollectionName({ model: pslModel, sourceFile, sourceId, diagnostics });
const fieldMappings = resolveFieldMappings({ model: pslModel, sourceFile, sourceId, diagnostics });
```
If `resolveFieldMappings`/`resolveCollectionName` are called from any other site, thread context there too (grep in the terminal to confirm the call sites).

## Step 4 — retire `getMapName`
Delete `getMapName` from `packages/2-mongo-family/2-authoring/contract-psl/src/psl-helpers.ts` and remove it from the `interpreter.ts` import list. **Keep** `getAttribute`, `stripQuotes`, `lowerFirst`, and the other helpers (still used by not-yet-migrated attributes). Confirm with `rg -n "getMapName" packages/2-mongo-family` → zero after the edit.

## Tests
`@map`/`@@map` behaviour must be **byte-identical** — the existing Mongo contract-psl suite + `fixtures:check` are the primary signal (a real `str()`-decoded map name equals the old `stripQuotes` value). Run them. If the suite has no direct coverage of a mapped field/collection name, add one concise case (a model with `@@map("things")` and a field with `@map("_id")`) asserting the emitted `storage.collection` and the mapped field name. Tests-first for any added case.

## Scope
**In:** the new `mongo-attribute-specs.ts` wiring + map specs; the three `interpreter.ts` migration sites + caller threading; deleting `getMapName`. **Out:** every other Mongo attribute (later dispatches); any `packages/1-framework` or `packages/2-sql` change; the interpreter's semantic checks.

## Constraints
No `any`; no bare `as` (a narrow justified `blindCast` is acceptable only if the SQL template itself uses one at the same spot — mirror it exactly, no wider); no file-ext imports; never suppress biome; `pnpm` not `npm`. Commit once: `git commit -s` (DCO), explicit staging, no `--amend`, NO push, no GitHub. Read-only on `projects/**`, `.agents/**`.

## Gates (all green, in order)
1. `pnpm --filter @prisma-next/mongo-contract-psl build && typecheck && test` (confirm the exact package name from `packages/2-mongo-family/2-authoring/contract-psl/package.json`; use that in the filter)
2. `pnpm fixtures:check` — clean, no Mongo contract drift
3. `pnpm lint:deps` (0 — catches any forbidden cross-family import) and `pnpm lint:framework-vocabulary` (threshold unchanged; the edits are in `packages/2-mongo-family`, not `1-framework`, so it should not move)

## Report back
The `mongo-attribute-specs.ts` exports; the three migration sites + how you threaded `sourceFile`/`sourceId`/`diagnostics` (and the exact local names you found in the entry); confirmation `getMapName` is gone (`rg` → zero) and `getAttribute`/`stripQuotes` retained; whether you added a map test or relied on existing coverage; all gate results; the commit SHA. If the SQL template uses an import specifier or a `blindCast` you can't cleanly mirror, or a caller can't reach `diagnostics`, STOP and report rather than guessing.
