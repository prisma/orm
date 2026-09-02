# Journey tests

These are **Markdown checklists**, not automated tests. Each file describes a prompt, the example app to point an agent at, and the expected end state. Run them by hand against an agent runtime (Claude / Cursor / a partner-hosted runtime) with the skill set installed.

Cross-runtime automation against a moving model surface is its own research project and is deferred from this milestone.

## How to run a journey test

1. Check out the example app named at the top of the journey file.
2. Install the user-facing skill cluster at the project level. The URL points at the `skills/` subpath of the Prisma Next repository, which is the same source `prisma orm init` uses. Contributor skills (which live under `skills-contrib/`) are *not* on upstream's priority-discovery allowlist and never reach end-users through this URL. `--all` installs every skill in the user-facing cluster to every detected agent without prompting (the cluster is meant to be installed as a unit):

   ```bash
   pnpm dlx skills add prisma/prisma/skills#v<prisma-next-version> --all
   ```

   To test against an in-flight branch or commit instead of a tagged release:

   ```bash
   pnpm dlx skills add prisma/prisma/skills#<branch-or-sha> --all
   ```

   To test a local checkout, point the CLI at the `skills/` directory directly:

   ```bash
   pnpm dlx skills add /absolute/path/to/prisma-next/skills --all
   ```

3. Open the project in your agent's IDE (or attach the agent via its CLI).
4. Paste the prompt verbatim. Do not paste any additional context, do not paste Prisma Next documentation.
5. Observe each step the agent takes. Tick each checklist item as the agent completes it. Note any deviations.
6. At the end, verify the success criteria. If any step is missed or any criterion fails, the journey **fails** — the skill needs refinement.

## Journey index

The *Skill (references) under test* column names the installed skill and, in parentheses, the reference files inside it the journey exercises.

| File | Skill (references) under test | Acceptance criterion |
|---|---|---|
| [`01-onboarding-first-query.md`](01-onboarding-first-query.md) | prisma-orm-core-concepts (quickstart, contract, queries), prisma-orm-migrations (migrations) | AC4 |
| [`02a-add-relation.md`](02a-add-relation.md) | prisma-orm-core-concepts (contract, queries), prisma-orm-migrations (migrations) | AC5a |
| [`02b-rename-with-hint.md`](02b-rename-with-hint.md) | prisma-orm-core-concepts (contract), prisma-orm-migrations (migrations) | AC5b |
| [`02c-data-transform-placeholder.md`](02c-data-transform-placeholder.md) | prisma-orm-migrations (migrations) | AC5c |
| [`02d-capability-gate.md`](02d-capability-gate.md) | prisma-orm-core-concepts (queries, contract) | AC5d |
| [`02e-hash-mismatch.md`](02e-hash-mismatch.md) | prisma-orm-core-concepts (failure-modes), prisma-orm-migrations (migrations) | AC5e |
| [`02f-merge-preview.md`](02f-merge-preview.md) | prisma-orm-migrations (migration-review) | AC5f |
| [`02g-diamond-convergence.md`](02g-diamond-convergence.md) | prisma-orm-migrations (migration-review, migrations) | AC5g |
| [`02h-query-interface.md`](02h-query-interface.md) | prisma-orm-core-concepts (queries) | AC5h |
| [`02i-greenfield-trap.md`](02i-greenfield-trap.md) | prisma-orm-migrations (migration-model, migrations) | — |
| [`03-capability-gaps.md`](03-capability-gaps.md) | prisma-orm-core-concepts (contract, queries, build, failure-modes, feedback), prisma-orm-migrations (migrations) | AC6 |
| [`05-build-vite.md`](05-build-vite.md) | prisma-orm-core-concepts (build) | AC8b |
| [`05b-build-nextjs-gap.md`](05b-build-nextjs-gap.md) | prisma-orm-core-concepts (build, feedback) | AC8b (Next.js path) |
| [`06-feedback-bug.md`](06-feedback-bug.md) | prisma-orm-core-concepts (feedback) | AC8c (bug path) |
| [`06b-feedback-feature.md`](06b-feedback-feature.md) | prisma-orm-core-concepts (contract, feedback) | AC8c (feature path) |
| [`07-first-touch-orientation.md`](07-first-touch-orientation.md) | prisma-orm-core-concepts (quickstart first-touch path, queries, contract, runtime, build) | AC4 (orientation entry point) |
