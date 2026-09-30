---
changes:
  - id: consume-nested-list-cardinality
    summary: Update contract producers and consumers for explicit cardinality and nested element nullability.
  - id: reemit-extension-list-contracts
    summary: Re-emit bundled extension contracts and reconcile changed snapshot hashes and references.
---

## Update contract producers and consumers

`ContractField.many` and `StorageColumn.many` are now `false | { elementNullable: boolean }`. Emit explicit `many: false` for non-list domain fields and non-array storage columns. Replace legacy `many: true` with `many: { elementNullable: false }` for existing strict-element lists. Move any intermediate sibling `elementNullable` property into the list descriptor and remove the sibling; neither the old `true` form nor the sibling property is accepted.

Change list detection from `field.many === true` or `column.many === true` to `many !== false`, and narrow this union before reading `many.elementNullable`. Update conditional types that matched `{ many: true }` to match the descriptor. Do not broaden this replacement to unrelated booleans or relation cardinality. For example, the included-column decoder in an ORM extension must replace `ref.storageColumn.many === true` with `ref.storageColumn.many !== false` so native arrays still take the element-decoding path.

Preserve the independent meaning of `nullable` (the whole field value) and `many.elementNullable` (each element). Type generators must produce `ReadonlyArray<T | null>` for nullable elements and add an outer `| null` only for a nullable container. Array encoders and decoders must preserve a whole-list `null` without traversal and bypass the element codec for null elements, while processing non-null elements normally. Do not pass null elements into scalar codecs or collapse null lists into empty arrays.

For native SQL arrays, propagate element semantics to both the domain field and storage column. For JSON-backed value-object lists, retain the domain descriptor but do not add a native-array descriptor to storage. Do not add `elementNullable` to schema IR: PostgreSQL migration comparison observes the derived check constraints. Generate `elementNotNull` only for strict-element arrays, then apply explicit `noCheck` waivers. Never infer element nullability from `noCheck`, and reject an `elementNotNull` waiver on a nullable-element list as inapplicable. MongoDB array-item validators must admit null only when the domain descriptor permits it, including enum membership and value-object items.

If exposing list authoring, use `.many({ elementsNullable: true })` to request nullable elements; the option uses plural `elementsNullable`, whereas the emitted descriptor uses singular `elementNullable`. Omitted or literal `false` retains strict elements. Keep whole-list `.nullable()` independent. PSL equivalents are `T[]`, `T?[]`, `T[]?`, and `T?[]?`; this change does not enable nullable relation-list elements or scalar lists on SQLite.

## Re-emit bundled contracts

Regenerate bundled `contract.json` and `contract.d.ts` together from the extension's original authoring source and configuration, including each owned contract space. Use the existing contract-space emission command rather than hand-editing generated fields or hashes. For the Supabase extension in this repository, `pnpm --filter @internal/extension-supabase build:contract-space` regenerates `src/contract/contract.json` and `src/contract/contract.d.ts`; its separate `emit` script targets test fixtures, not this bundled contract.

Preserve existing strict-element declarations and explicit `elementNotNull` waivers. In particular, a Supabase native-array column with `noCheck: ['elementNotNull']` remains `many: { elementNullable: false }`, not a nullable-element list. Scalar domain fields gain `many: false`, native-array descriptors change, and generated contract hashes may change; retaining old hash literals is not a valid regeneration.

For extension-owned migration snapshots, regenerate each historical state from its own source, not the latest extension schema. Write the JSON/declaration pair through the snapshot store and regenerate dependent migration metadata in dependency order. If a snapshot hash changes, preserve the old entry while it is referenced, create the new content-addressed entry, and update both JSON/type imports, start/end contract hashes, and derived migration identifiers and parent references consistently. Preserve recorded operations unless intentionally changing the schema. Do not blanket-rename hash paths, drop migration references, or rewrite applied history. Coordinate already-applied migration identities and database contract markers through the consumer project's supported migration procedure and verify the transition on a disposable database. Stop if historical sources or the reference mapping cannot be recovered.
