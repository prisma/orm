<!--
Thanks for contributing to Prisma 8!

Before you submit:
- Have you read CONTRIBUTING.md?
- For substantive changes, did you open an issue first to discuss the direction?
- Have you signed off all commits with `git commit -s`? (DCO is required.)
-->

## Linked issue

<!-- Link the GitHub issue this PR addresses, e.g. "Fixes #123" or "Refs #123".
     If the change is small enough that no issue exists, put: "n/a — small change". -->

## Summary

<!-- One or two sentences focused on *why* the change exists, not file-by-file *what*. -->

## Testing performed

<!-- List the suites you ran. Examples:
     - `pnpm typecheck && pnpm lint && pnpm test:packages`
     - `pnpm test:integration` (because the change touches the SQL runtime)
     - Manual: ran the prisma-8-demo and verified <X> -->

## Skill update

<!-- If this PR changes any user-facing surface (CLI commands or flags, public
     TypeScript APIs, `prisma.config.ts` fields, error codes, glossary
     terminology, etc.), describe the skill update made in this PR (typically
     under `packages/0-shared/skills/`) or state why no update is required.
     If the change is purely internal / refactor with no user-visible delta,
     write "n/a — internal only". -->

## Checklist

- [ ] All commits are signed off (`git commit -s`) per the [DCO](../CONTRIBUTING.md#developer-certificate-of-origin-dco). The DCO status check will block merge if any commit is missing a `Signed-off-by:` trailer.
- [ ] I read [CONTRIBUTING.md](../CONTRIBUTING.md) and the change is scoped to one logical concern.
- [ ] Tests are updated (or `n/a` if the change is doc-only / refactor with no behavioural delta).
- [ ] The PR title is in `TML-NNNN: <sentence-case title>` form (Linear ticket prefix + concise title naming the concrete deliverable). See `.claude/skills/create-pr/SKILL.md` for the full convention.
- [ ] The **Skill update** section above is filled in (or stated `n/a — internal only`).

## Notes for the reviewer

<!-- Anything you'd like the reviewer to focus on, alternative approaches you considered,
     follow-ups intentionally deferred, etc. Optional. -->
