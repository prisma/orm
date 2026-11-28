# Dispatch 3: what users read

**State on 2026-11-26: built, not yet reviewed.**

## What was built

- The skill's `migrations.md` and `quickstart.md`, and the React Router example's README, name the `_prisma` schema.
- Example and app test helpers that name the schema in SQL use `_prisma`.
- Upgrade instructions as unversioned fragments under `upgrade-instructions/pending/prisma-tables-in-prisma-schema/`, one for applications and one for extension authors. A release's guide is assembled from the fragments by hand when the release is prepared, so nothing was generated.

## To check in review

Three pieces of advice in the application fragment were written by the implementer and are not stated by the code:

1. When both schemas exist and `prisma_contract.marker` has no rows while `_prisma.marker` has rows, drop `prisma_contract` after a backup; otherwise stop and ask.
2. For tables in a form from before the release candidates: after a backup, drop `prisma_contract` and run `prisma db sign`. The application's tables are kept and the old ledger history is lost.
3. "Update Prisma Studio to a version that reads `_prisma`". No such version exists until the Studio change is released; the wording must name it or be removed.

## Left for dispatch 2

- `packages/3-extensions/pgvector/test/migrations/vector-list-default.integration.test.ts:128` resets only `prisma_contract`.
- Check that `packages/1-framework/3-tooling/cli/scripts/record.ts` drops both schemas.
- The first migration's failure text says "the upgrade instructions of Prisma 8". It should name the address in `APP_UPGRADE_GUIDES_URL` (`packages/1-framework/1-core/errors/src/upgrade-guides.ts`).
