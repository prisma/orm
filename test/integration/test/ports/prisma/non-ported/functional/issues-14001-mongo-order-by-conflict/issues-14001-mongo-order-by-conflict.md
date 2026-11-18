# non-ported: issues-14001-mongo-order-by-conflict

Source: `packages/client/tests/functional/issues/14001-mongo-order-by-conflict/tests.ts`

Regression test for #14001: a model with a field literally named `OrderBy` (which could collide with
Mongo's query-operator name) must produce a valid MongoDB query across findFirst/findMany/aggregate/groupBy.

- `packages/client/tests/functional/issues/14001-mongo-order-by-conflict/tests.ts` › `findFirst` — subject: field named `OrderBy` works in a findFirst query combining `where:{OrderBy:{gt:0}}`, `orderBy:{OrderBy:'asc'}`, `cursor:{OrderBy:1}`, and `distinct:['OrderBy']` — non-ported (Prisma 8 mongo ORM has no `cursor` or `distinct` operation; omitting them changes the test subject)
- `packages/client/tests/functional/issues/14001-mongo-order-by-conflict/tests.ts` › `findMany` — subject: field named `OrderBy` works in a findMany query combining `where:{OrderBy:{gt:0}}`, `orderBy:{OrderBy:'asc'}`, `cursor:{OrderBy:1}`, and `distinct:['OrderBy']` — non-ported (Prisma 8 mongo ORM has no `cursor` or `distinct` operation; omitting them changes the test subject)
- `packages/client/tests/functional/issues/14001-mongo-order-by-conflict/tests.ts` › `aggregate` — subject: field named `OrderBy` works in an aggregate with `_count:true` (all-relations count), `orderBy:{OrderBy:'asc'}`, and `cursor:{OrderBy:1}` — non-ported (Prisma 8 mongo ORM has no aggregate operation and no `_count:true` all-relations-count surface)
- `packages/client/tests/functional/issues/14001-mongo-order-by-conflict/tests.ts` › `groupBy` — subject: field named `OrderBy` works in a groupBy with `by:['OrderBy']`, `orderBy:{OrderBy:'asc'}`, and `having:{OrderBy:1}` — non-ported (Prisma 8 mongo ORM has no `groupBy` operation)
