# Non-ported — composites-selection

- `packages/client/tests/functional/composites/selection/tests.ts` › `composites can be selected explicitly on multiple nesting levels` — sub-field selection inside a composite type (`profile: { select: { favoriteThings: true, name: { select: { firstName: true } } } }`) — Prisma 8's mongo ORM has no nested sub-field selection for composite value objects; `select()` operates at model root field level only.
