# Non-ported — field-reference-list

- `packages/client/tests/functional/field-reference/list/tests.ts` › `in` — scalar/enum `in` filter against a list field reference — the ORM's `in` and `notIn` take an array of values, not a list field (comparing two scalar fields with `eq`, `gt` and the like is expressible)
- `packages/client/tests/functional/field-reference/list/tests.ts` › `notIn` — scalar/enum `notIn` filter against a list field reference — the ORM's `in` and `notIn` take an array of values, not a list field (comparing two scalar fields with `eq`, `gt` and the like is expressible)
- `packages/client/tests/functional/field-reference/list/tests.ts` › `via extended client` — list field-reference notIn through $extends client — no `$extends` client in Prisma 8, and `in` / `notIn` take an array of values, not a list field
