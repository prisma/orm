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

| File | Skill(s) under test | Acceptance criterion |
|---|---|---|
| [`01-onboarding-first-query.md`](01-onboarding-first-query.md) | quickstart, contract, migrations, queries | AC4 |
| [`02a-add-relation.md`](02a-add-relation.md) | contract, migrations, queries | AC5a |
| [`02b-rename-with-hint.md`](02b-rename-with-hint.md) | contract, migrations | AC5b |
| [`02c-data-transform-placeholder.md`](02c-data-transform-placeholder.md) | migrations | AC5c |
| [`02d-capability-gate.md`](02d-capability-gate.md) | queries, contract | AC5d |
| [`02e-hash-mismatch.md`](02e-hash-mismatch.md) | debug, migrations | AC5e |
| [`02f-merge-preview.md`](02f-merge-preview.md) | migration-review | AC5f |
| [`02g-diamond-convergence.md`](02g-diamond-convergence.md) | migration-review, migrations | AC5g |
| [`02h-query-interface.md`](02h-query-interface.md) | queries | AC5h |
| [`02i-greenfield-trap.md`](02i-greenfield-trap.md) | migration-model, migrations | — |
| [`03-capability-gaps.md`](03-capability-gaps.md) | contract, migrations, queries, build, debug, feedback | AC6 |
| [`05-build-vite.md`](05-build-vite.md) | build | AC8b |
| [`05b-build-nextjs-gap.md`](05b-build-nextjs-gap.md) | build, feedback | AC8b (Next.js path) |
| [`06-feedback-bug.md`](06-feedback-bug.md) | feedback | AC8c (bug path) |
| [`06b-feedback-feature.md`](06b-feedback-feature.md) | contract, feedback | AC8c (feature path) |
| [`07-first-touch-orientation.md`](07-first-touch-orientation.md) | quickstart (first-touch path), queries, contract | AC4 (orientation entry point) |
