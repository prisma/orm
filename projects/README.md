## Projects

This repo keeps **project-specific** specs, plans, ADR drafts, reference notes, and assets under `projects/`.

Anything in `projects/` is **transient**: once the project is complete, migrate long-lived docs to `docs/` and delete the project folder.

### Directory layout

- **Project root**: `projects/<project>/`
- **Project spec** (shaping output): `projects/<project>/spec.md`
- **Project plan**: `projects/<project>/plan.md`
- **Task/feature specs**: `projects/<project>/specs/<task>.spec.md`
- **Task/feature plans**: `projects/<project>/plans/<task>.plan.md`
- **Reference material / assets**: `projects/<project>/**`

### Workflow

- Start with `drive-start-workflow` (which routes new work into direct change / slice / project) or invoke `drive-create-project` directly when you already know it's a project, then shape the work as **spec → plan → implement**. Methodology and skill map: [`docs/engineering/drive-process.md`](https://github.com/prisma/ignite/blob/main/docs/engineering/drive-process.md).

### Project lifecycle

1. **Shaping**: Create the initial spec + plan under `projects/<project>/` and open the first PR containing these artifacts.
   - Validate the spec with the PM/stakeholders and the plan with the team.
2. **Execution**: Implement tasks via as many follow-on branches/PRs as needed. Keep project docs and Linear up to date.
3. **Stakeholder verification**: Confirm objectives/acceptance criteria are met.
4. **Close-out**: Finalize long-lived docs into `docs/`, strip repo-wide references to `projects/<project>/**` (replace with canonical `docs/` links or remove), then the last PR deletes `projects/<project>/`.

