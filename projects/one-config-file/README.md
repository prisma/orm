# One config file for Composer

Prisma 8 ships one CLI, `prisma`, and one config file, `prisma.config.ts`. Composer still has a second config file and a second binary. This project removes both.

- [`spec.md`](./spec.md) — what is true at the project level and when the project is done
- [`design-notes.md`](./design-notes.md) — the decisions, with the alternatives that were rejected and why
- [`plan.md`](./plan.md) — the slices, their order, and what each hands to the next
- `slices/` — one folder per slice, written when the slice is picked up

Almost all code changes land in [prisma/composer](https://github.com/prisma/composer) and [prisma/prisma-cli](https://github.com/prisma/prisma-cli). The artifacts live here because this repo already holds the cross-repo planning: [`projects/consolidate-clis/`](../consolidate-clis/) and the GA plan on the `planning/prisma-8-ga` branch.

Everything under this folder is transient and is deleted at close-out.
