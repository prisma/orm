# Manual QA: the committed API lists

Who uses this: a contributor to this repository, human or agent, who changes what a published package exports. End users of Prisma 8 see no change, because nothing published changes. The QA confirms the contributor's path works on a real change to source code, not only on an edited build file.

Run on the pull request's head after `pnpm install` and `pnpm build`. Work in this worktree; put every file you create under `wip/qa/`. Revert every change to tracked files at the end and confirm `git status` is clean. Never run whole test suites. Record each step's command, its output (shortened), and pass or fail in the report.

## Setup

1. `git status` is clean and `pnpm api:check` prints that all lists match. Pass if both hold.

## Scenarios

2. **A new export in source.** Add an exported function to a source file that a published import path re-exports, in a package whose build is quick to check (for example the source behind `@prisma/orm-extension-middleware-cache`, found from its `package.json` and build config). Run `pnpm build`, then `pnpm api:check`. Pass if the check fails, names that package's `api.txt`, shows the new line with its import path, and says to run `pnpm api:update`.
3. **Update.** Run `pnpm api:update`. Pass if exactly that package's `api.txt` changes, by exactly the new line or lines, and `pnpm api:check` then passes.
4. **A changed signature.** Make an existing optional property or parameter of an exported interface or function required, in source. Build, check. Pass if the check fails and shows the old line removed and the new line added, with the old and new wording readable in the output.
5. **A type-only export turned into a value export.** Find, in source, an export written `export type { X }` or `export { type X }` that reaches a published path. Change it to a value export. Build, check. Pass if a line changes.
6. **A merge conflict in a list.** On a scratch branch made from the head, commit one export change and its regenerated list; on a second scratch branch from the head, commit a different export change in the same package and its list. Merge one into the other. Pass if the contributor note's instruction (rebuild, `pnpm api:update`, never hand-merge) resolves the conflict and `pnpm api:check` passes afterwards. Delete both scratch branches afterwards.
7. **A missing build.** Move one package's `dist` folder under `wip/qa/`, run `pnpm api:check`, then move it back. Pass if the check fails with a message that names the package and says to run `pnpm build`.
8. **Reading the list.** Open `packages/9-public/@prisma/orm-postgres/api.txt` and pick five lines of different kinds: a function, an interface member, a forward to another package, a type-only export, a `(not exported)` type. For each, confirm by reading the built declarations that it says what is importable and nothing else. Pass if all five are right.
9. **The contributor note.** Follow `docs/onboarding/Common-Tasks-Playbook.md` "Update a Package's API List" as written, without other knowledge. Pass if every step it gives works and nothing needed is missing.

## Cleanup

10. Revert all source changes, run `pnpm build` and `pnpm api:check`. Pass if the lists match and `git status` is clean.

## Report

Write `projects/public-api-check/manual-qa-reports/<date>-<runner>.md` with each step's result. Name each problem found as a finding (`Q01`, `Q02`…), with what you did, what happened, and what you expected.
