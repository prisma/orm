# Journey 02g — Resolve a diamond-convergence conflict

**Skills under test:** `prisma-8-migration-review`, `prisma-next-migrations`.

**Acceptance criterion:** AC5g.

## Setup

Topic branch with a planned migration. Meanwhile, `main` advanced with a different migration from another developer.

## Prompt

> I rebased my branch onto main and now `db migrate` fails. My migration says it's from hash X but the previous one wrote hash Y.

## Expected agent behavior

The 5-step diamond-convergence procedure:

- [ ] **1.** Rebase the topic branch onto `main` (likely already done).
- [ ] **2.** Identify the exact topic-branch migration directory under `migrations/` (e.g. `migrations/20241112-add-tags/`), verify the path exists and is scoped to that directory, then delete only that directory (`rm -rf migrations/<dir>`). No unscoped `rm -rf`.
- [ ] **3.** Run `contract emit` then `migration plan --name <slug>` to re-plan from the post-merge contract head.
- [ ] **4.** Open the old migration from git history; port any custom data-transform logic into the new `migration.ts`.
- [ ] **5.** Self-emit (`node migrations/<dir>/migration.ts`).

## Success criteria

- [ ] New migration chains cleanly from `main`'s head.
- [ ] Custom data transforms (if any) preserved.
- [ ] `migration status` reports a clean chain.
- [ ] Agent did NOT attempt to manually rewrite `migration.json` hashes.
