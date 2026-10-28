# One copy of the framework: plan across four repositories

## The problem

`prisma contract emit` failed on every literal default in a project that used Composer with bun. Three packages bring Prisma ORM into such a project:

| Package | How it brings the ORM | On 2026-10-22 |
| --- | --- | --- |
| The application's `@prisma/orm-postgres` | Installed by the app. Composer requires it as an exact peer. | rc.19 |
| `@prisma/composer-prisma-cloud` | Its own `@prisma/orm-toolchain`, a regular dependency | rc.19 |
| `prisma` (the CLI) | Its own `@prisma/orm-toolchain`, a regular dependency | rc.20 |

The CLI's toolchain loads `prisma.config.ts`, which imports the application's database package. So when the CLI's ORM version differs from the application's, two copies of `@prisma/orm-framework` load, whatever the package manager does. Values and registries from one copy are not recognised by the other ([spec.md](spec.md) explains why).

On 2026-10-23, Composer 0.34.0 (06:03) and `prisma` 8.0.0-rc.27 (06:28) both moved to ORM rc.20, and the ticket's bun reproduction now emits. The work below stops a recurrence and makes the failure readable.

## Decisions

- **One copy, never values across copies.** ADR 242 requires one copy; registries and `instanceof` checks also break with two, just less visibly.
- **Every ORM version must match, and nothing guarantees it today.** Two pieces enforce it:
  - A runtime error, because peer dependencies refuse a conflicting install only under npm; pnpm and bun warn and install anyway.
  - A release check in the CLI, because the CLI is where a lagging Composer and a newer ORM meet.
- **No new peer dependencies on `@prisma/orm-toolchain`.** The CLI carries its own toolchain by design (prisma-cli ADR 0004), and an application gets its toolchain through its database package. A library's toolchain peer would resolve to whichever copy reached the top of `node_modules`.
- **The CLI does not load the project's toolchain.** That toolchain may expect a different CLI engine than the one the CLI ships, which prisma-cli ADR 0004 rules unsupported.
- **A CLI release waits for Composer.** The CLI mounts Composer's commands, and the getting-started guide uses Composer. Composer's automated version bump keeps the wait short.

## Slices

### 1. prisma/orm: report a second copy

[spec.md](spec.md). Ships first, and on its own: it doesn't depend on the other slices.

### 2. prisma/prisma-cli: a release check that installs Composer beside the CLI

- **Where:** the tarball check in `packages/cli-conformance` (`checks/tarball.ts`), run by `pnpm check:conformance` on the release channel only. Dev builds of the toolchain are newer than any Composer release by design, so a dev-channel check would always fail.
- **What:**
  - In the clean sandbox the check already installs, also install `@prisma/composer-prisma-cloud` at the version of the committed `@prisma/composer-cli` pin, with its `@prisma/orm-postgres` peer.
  - Require exactly one folder holding `@prisma/orm-framework`.
  - The finding names each folder and version, and says the release waits for a Composer release on the CLI's ORM version.
- **Why the install:** counting folders tests the outcome users get, whatever the manifests say.
- **To verify while building:** that Composer always releases `composer-cli` and `composer-prisma-cloud` at one version. Both are 0.34.0 today. If they can differ, read the library version from the registry instead.
- **Test:** the check's unit tests, with a fixture tree that holds two copies and one that holds one.
- **Docs:** the conformance list in `docs/oss/versioning.md` and the release automation page.

### 3. prisma/composer: open an ORM version bump automatically

- **What:** a workflow, `update-orm-version.yml`, triggered by a daily schedule, `workflow_dispatch`, and a `repository_dispatch` event of type `orm-published`.
  - It reads `@prisma/orm-postgres` at `latest`.
  - When that's newer than the workspace's ORM version, it rewrites every `@prisma/orm-*` version (`lint-orm-pins` requires them to be equal) and refreshes the lockfile.
  - It opens a pull request with `DEPLOY_GITHUB_TOKEN` and arms auto-merge. An RC that breaks Composer fails CI, and the open pull request is then the signal to the team.
- **Pattern:** prisma-cli's `update-product-versions.yml` and its script: close any earlier open bump PR first, and fail when the token is missing rather than skip.
- **prisma/orm side:** `publish.yml` already sends `product-published` to prisma-cli after a release. Add the same step for `orm-published` to prisma/composer.
- **Operator step (Will):** `DEPLOY_GITHUB_TOKEN` is scoped to prisma/prisma-cli only. It needs Contents and Pull requests write on prisma/composer as well, both to push the branch there and to receive the dispatch.
- **Docs:** Composer's ADR-0046 Consequences says upgrading the ORM is a coordinated release. Add that the bump PR now opens automatically. Also update prisma-cli's release automation page, which lists what each product repository sends.

### 4. prisma/web: the dependency rule for extension authors

- **Where:** the "Publish your own" section of `apps/docs/content/docs/orm/extensions/index.mdx`, and a short packaging note in `apps/docs/content/docs/orm/middleware/authoring-custom-middleware.mdx`.
- **What:** the rule from slice 1's documentation, in reader terms:
  - Pin every `@prisma/orm-*` package at the version your users' database package uses.
  - Take the target package as a peer dependency.
  - What the error means when versions differ.
  - Link the error-reference entry. The error reference itself syncs from prisma/orm through `sync-error-reference-docs.yml`.
- **Order:** after slice 1 merges, so the error code exists.
- **Checks:** the writing checks in prisma/web's `.claude/skills/docs-reader-review/scripts/`.

## Order

Slices 1, 2 and 3 are independent and can run in parallel. Slice 4 follows slice 1. Slice 3's dispatch step in prisma/orm can land in slice 1's PR or its own; it touches only `publish.yml`.

## Follow-ups filed separately

- The `contract.d.ts` warning about `@internal/target-postgres`, seen in the same run.
