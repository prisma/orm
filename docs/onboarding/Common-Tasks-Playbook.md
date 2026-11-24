# Common Tasks Playbook

Add SQL Operation
- Plan: `.cursor/plans/add-sql-operation.md`
- See: `packages/2-sql-family/5-runtime`, SQL family packages under `packages/2-sql-family/**`, and rulecards in `.cursor/rules`. The top-level `packages/3-targets/**` is reserved for concrete target packs (e.g., postgres, mysql).

Split Monolith into Modules
- Plan: `.cursor/plans/split-into-modules.md`
- See: `.cursor/rules/modular-refactoring-patterns.mdc`, `no-barrel-files.mdc`

Fix Import Violation
- Plan: `.cursor/plans/fix-import-violation.md`
- See: `.cursor/rules/import-validation.mdc`, `architecture.config.json`

Update a Package's API List
- Each package under `packages/9-public/@prisma/` has a generated `api.txt` beside its `package.json`: one line for each export of each import path and each member, read from the built declarations. It is not published.
- CI's `Lint` job runs `pnpm api:check`, which fails when a committed `api.txt` does not match the build. To fix it, run `pnpm build` and then `pnpm api:update`, and commit the changed lists. A changed line in the pull request shows a change to what users can import.
- A type that a signature uses but that no path exports is listed once as `(not exported)`. When two such types share a name, the later ones get `_2`, `_3`, so adding one with a name already in use can renumber the others. Likewise, a declaration exported under several names is referred to by the name that sorts first, so adding an export name that sorts earlier changes how other lines refer to it. Lines changed only in these ways are not API changes.
- Never edit an `api.txt` by hand. After a merge conflict in one, rebuild and run `pnpm api:update` in place of merging it.
- The scripts are in `scripts/public-api/`. They also leave API Extractor's structured output in each package's `dist-api/` folder.
