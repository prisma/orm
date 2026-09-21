# Non-ported — json-list-push

- `packages/client/tests/functional/json-list-push/tests.ts` › `push with single element` — `update({ data: { jsons: { push: 1 } } })` appends a single JSON value to a `Json[]` list field — `MutationUpdateInput` is `Partial<DefaultModelRow>` (plain scalar assignment only); the `{push: ...}` array-append operator is absent from the Prisma 8 ORM mutation surface.
- `packages/client/tests/functional/json-list-push/tests.ts` › `push with array value` — `update({ data: { jsons: { push: [1, 2] } } })` appends an array as a single JSON element to a `Json[]` list field — same gap: no `{push}` operator in MutationUpdateInput.
