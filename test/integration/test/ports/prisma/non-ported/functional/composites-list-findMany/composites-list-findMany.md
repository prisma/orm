# Non-ported — composites-list-findMany

- `packages/client/tests/functional/composites/list/findMany.ts` › `select` — projects a composite subfield (`contents: { select: { text: true } }`) — no embedded value-object subfield projection surface.
- `packages/client/tests/functional/composites/list/findMany.ts` › `orderBy` — `orderBy: { contents: { _count: 'desc' } }` — no order-by-embedded-list-count surface.
- `packages/client/tests/functional/composites/list/findMany.ts` › `filter every` — `contents: { every: { upvotes: { every: { vote: true } } } }` — Prisma 8 `where` is equality-only; no `every` composite-list quantifier.
- `packages/client/tests/functional/composites/list/findMany.ts` › `filter some` — `contents: { some: { upvotes: { some: { vote: false } } } }` — no `some` composite-list quantifier.
- `packages/client/tests/functional/composites/list/findMany.ts` › `filter none` — `contents: { none: { upvotes: { isEmpty: true } } }` — no `none`/`isEmpty` composite-list quantifiers.
- `packages/client/tests/functional/composites/list/findMany.ts` › `filter empty` — `contents: { some: { upvotes: { isEmpty: true } } }` — no `some`/`isEmpty` composite-list quantifiers.
