# Dispatch 4 — MongoDB fields keep their own names; `model.storage.fields` records the stored key

**Slice:** [`../spec.md`](../spec.md) · **Survey:** [`../investigation-field-mapping.md`](../investigation-field-mapping.md) · **Linear:** [TML-3247](https://linear.app/prisma-company/issue/TML-3247) · **Branch:** `tml-3247-mongo-field-storage-names`, stacked on PR 2 (`tml-3553-ts-validator-pr2`, prisma/orm#30773) · **PR:** 3 of the slice

## Why

Every contract separates the application's domain from its storage (ADR 172, ADR 182). A model's `fields` use the application's names; `model.storage` is the bridge to persistence. SQL records each field's column in `model.storage.fields`. A field takes its own name, and `@map` states a different storage name, on every surface (Data Contract doc, ADR 264). ADR 172 reserves `model.storage.fields` for MongoDB.

MongoDB does not follow this. The PSL interpreter keys `model.fields` by the stored key, so `id ObjectId @id @map("_id")` becomes a domain field `_id`, and application code reads `user._id`. The TypeScript builder has no way to name a field's storage. Will, 2026-10-19: presenting `_id` under another name is existing behaviour, it is not deferred, and MongoDB mirrors the Postgres design wherever it can.

## Outcome

```prisma
model User {
  id    ObjectId @id @map("_id")
  email String
  @@map("users")
}
```

emits

```json
"User": {
  "fields": { "id": { … }, "email": { … } },
  "storage": { "collection": "users", "fields": { "id": { "field": "_id" }, "email": { "field": "email" } } }
}
```

and application code reads `user.id`, writes `create({ email })`, filters `where({ id })`. The stored document still has `_id`. Storage hash, execution hash and validators do not change.

## Decisions (orchestrator, mirroring SQL)

1. **Shape:** `model.storage.fields: Record<field, { field: string }>`, **total** as SQL's is: every domain field has an entry. `{ field }` is the MongoDB bridge's existing word (`storage.relations.<rel>.field`). Variants, embedded models and roots all carry it. `validateMongoStorage` checks it like SQL's `validateModelStorageReferences`: every domain field has an entry, and no two fields of a model (with its base, for a variant) share a stored key. Refuse two fields mapped to the same key at build time, as SQL's lowering does (`CONTRACT.NAME_DUPLICATE`).
2. **Domain names everywhere in the domain:** relation `on.localFields`/`targetFields` and `discriminator.field` hold domain field names, as on SQL. Storage keeps stored keys: indexes, validators, execution default refs.
3. **One translation helper**, in `@internal/mongo-contract`, mirroring SQL's `collection-contract.ts` accessors: field → stored key (with inheritance from `base`), stored key → field, and the document id field (the field whose stored key is `_id`). PR 2 added `storedFieldNameOf`, `documentIdFieldOf`, `storesField`, `DOCUMENT_ID`; make them read `model.storage.fields` and route every reader through them. Value objects have no storage block: their fields are stored under their own names, and PSL refuses `@map` on a value-object field with a clear diagnostic (today it is silently ignored).
4. **TypeScript builder option:** `.mongo({ field: '_id' })` on a scalar field builder, mirroring SQL's `.sql({ column })`. If SQL also has a short method (`.column(name)`), add the matching short method only if it reads naturally; say what you chose. Index, relation and discriminator inputs keep naming fields by their domain names; the builder translates, as SQL's lowering does with `mapFieldNamesToColumnNames`.
5. **The ORM speaks domain names; the pipeline query builder speaks stored keys**, as SQL's ORM speaks fields and its query builder speaks columns. The ORM translates at the storage boundary in both directions (filters, select/projection, orderBy, include/$lookup, writes, upserts, field-accessor updates, discriminator writes and filters, `create()` results, decoding, execution defaults applied to the stored document as SQL does). A row never shows a stored key that is not a field (no stray `_id` when the field is `id`). An unknown caller field is refused with `ORM.FIELD_UNKNOWN`, with SQL's hint when the caller passed a stored key. The pipeline query builder's document shape is keyed by stored keys, derived from `storage.fields` in `contract.d.ts`.
6. **Migration statements name domain fields.** A rename statement compares stored keys on each side, like SQL's `fieldRenameStorageEffect`: equal stored keys plan nothing, different ones plan `renameField`. A field whose `@map` changes while its name stays: do exactly what SQL does for a column whose `@map` changes, and say what that is. Data-loss subjects name the domain field; filters and `$unset`/`$rename` use stored keys.
7. **Prisma 6 reader** emits the same shape: domain fields under their PSL names, stored keys in `storage.fields`.
8. **Contracts emitted by earlier versions.** Find out how earlier contract shape changes treated committed migration snapshot contracts (`migrations/*/contract.json`, ADR 197) and published `contract.json` files (for example the rc.14→rc.15 `data-type-in-contract` change), and follow the same approach. Say what you found and chose before building it.

## Steps

1. Contract shape, schema, types, emitter (`contract.d.ts` gets `storage.fields` with literal stored keys), `validateMongoStorage`, the helper. Tests first.
2. Authoring: PSL interpreter, Prisma 6 reader, TypeScript builder (`.mongo({ field })`). Side-by-side fixture: the TypeScript side uses `.mongo({ field: '_id' })` for `id`, so both surfaces emit the same contract.
3. Readers: validator derivation and refusals, relation-field helper, planner, ORM, query builder, runtime decoding. Survey §3 lists every place with line numbers.
4. Re-emit fixtures and examples; update examples' application code (`user._id` → `user.id`), the `prisma init` templates, docs and skills (survey §5), ADR 172 (it says MongoDB has no field indirection) and ADR 182's `MongoModelStorage`, the MongoDB Family doc, `7. Migration System.md` line 212.
5. Upgrade notes: app (re-emit; `_id` on a model declared `id … @map("_id")` is now `id` in code; examples of filters, creates and includes; migration snapshots if decision 8 needs it) and extension (the contract shape; the helper).

## Done when

- `id ObjectId @id @map("_id")` gives `user.id` in types and at runtime, through every ORM method, including `include`, `create()` results, upserts and field-accessor updates; the stored document has `_id`; tests against a real MongoDB prove it.
- A TypeScript contract with `.mongo({ field: '_id' })` emits the same contract as the PSL one (side-by-side, nothing stripped).
- `--rename User.name:User.title` on a field mapped to `display_name` plans nothing for storage, as SQL; changing the stored key plans `renameField`.
- No storage hash, execution hash or validator changes in any committed fixture (`fixtures:check` shows only `model.fields` keys and `model.storage.fields` changing).
- All checks: `pnpm build`, typecheck, `lint:deps`, `fixtures:check`, `check:error-reference`, `lint:throws`, `lint:casts`, `check:upgrade-coverage`, `lint:docs`; lint and tests with coverage in every touched package; every integration and e2e file under `test/integration` that mentions MongoDB, by name in groups; the MongoDB journeys by name; the CLI `init` template tests; the example apps' tests.
