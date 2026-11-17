# Non-ported — composites-object-findFirst

- `packages/client/tests/functional/composites/object/findFirst.ts` › `select` — `findFirst({ where, select: { content: { select: { text: true } } } })` returns `{ content: { text } }` — Prisma 8's mongo ORM `select(...fields)` is top-level only; nested composite sub-selection is not expressible.
- `packages/client/tests/functional/composites/object/findFirst.ts` › `orderBy` — `findFirst({ where, orderBy: { content: { upvotes: { _count: 'desc' } } } })` — Prisma 8's mongo ORM orderBy is `Record<field, 1|-1>`; nested `content.upvotes._count` ordering is not expressible.
- `packages/client/tests/functional/composites/object/findFirst.ts` › `filter isSet` — `findFirst({ where: { id, country: { isSet: true } } })` returns null — Prisma 8's mongo `where` maps a scalar field to its bare codec-output value (equality only); it has no `{ isSet: true }` operator.
