# Journey 02g — Resolve a diamond-convergence conflict

**Skills under test:** `prisma-8-migration-review`, `prisma-8-migrations`.

**Acceptance criterion:** AC5g.

## Setup

Topic branch with a planned migration. Meanwhile, `main` advanced with a different migration from another developer.

## Prompt

> I rebased my branch onto main and now `db migrate` fails. My migration says it's from hash X but the previous one wrote hash Y.

## Expected agent behavior

The 5-step diamond-convergence procedure:

- [ ] **1.** Rebase the topic branch onto `main` (likely already done).
- [ ] **2.** Identify the topic-branch migration directory under `migrations/` (e.g. `migrations/app/20241112-add-tags/`) and treat it as the stale plan. Leave it on disk: it is still an edge any database that already applied it needs. No `rm -rf`.
- [ ] **3.** Run `contract emit` then `migration plan --from <main's head ref or hash> --name <slug>` to plan a fresh edge from the post-merge origin. The graph now has two edges off the old parent; that is a legal shape. If a database (e.g. the dev database) already applied the topic-branch migration, its marker sits at that tip and has no path to the new head: plan a second edge for it with `migration plan --from <topic tip hash> --name <slug>`, or reset that database.
- [ ] **4.** Open the stale topic-branch `migration.ts`; port any custom data-transform logic into the new one.
- [ ] **5.** Self-emit (`node migrations/app/<dir>/migration.ts`).

## Success criteria

- [ ] New migration chains from `main`'s head.
- [ ] Custom data transforms (if any) preserved.
- [ ] `db migrate --show` finds a path from each target database's marker to the new head (via the topic-tip edge where that database applied the topic migration).
- [ ] Agent did NOT delete the topic-branch migration directory.
- [ ] Agent did NOT attempt to manually rewrite `migration.json` hashes.
