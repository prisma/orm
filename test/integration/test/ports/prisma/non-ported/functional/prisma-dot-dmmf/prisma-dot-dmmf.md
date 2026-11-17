# Non-ported — prisma-dot-dmmf

- `packages/client/tests/functional/prisma-dot-dmmf/tests.ts` › `Prisma.dmmf in JS client > exports Prisma.dmmf (default)` — asserts the generated JavaScript client's static `Prisma.dmmf` metadata export against its snapshot — non-portable because prisma-8 emits contract artifacts rather than a generated executable client namespace and exposes no `Prisma.dmmf`-equivalent static runtime export.
