# Plan: a database target built outside this repository works with `init` and generated files

**Spec:** [spec.md](spec.md)
**Linear project:** [P-TML-1170](https://linear.app/prisma-company/project/targets-built-outside-the-orm-repo-work-with-init-and-generated-files-fd0afcc6f7f2)

Three pull requests after the design is approved. The first two do not depend on each other.

## Design (this pull request)

[TML-3829](https://linear.app/prisma-company/issue/TML-3829). The spec, the two proposed design records, the instructions for the SQL Server team and this plan. No code.

Nothing below starts until the two design records are approved.

## Pull requests

### 1. Generated files import from the module the target package names

[TML-3830](https://linear.app/prisma-company/issue/TML-3830), and it closes [TML-3143](https://linear.app/prisma-company/issue/TML-3143).

- **Outcome:** `contract emit` and the migration commands take import names from the config. The CLI no longer reads `package.json` for them. An application whose target package Prisma did not write gets generated files that compile.
- **Builds on:** the approved design record.
- **Hands on:** the two config members, set by every facade; the packaging test's stand-in target package, which pull request 3 reuses.

### 2. `init` scaffolds from the target package's init contribution

[TML-3702](https://linear.app/prisma-company/issue/TML-3702).

- **Outcome:** the init contribution interface exists, Postgres and MongoDB provide one, and `init` installs the package before writing files. `--target` still takes the two short names. No file in the CLI branches on a target.
- **Builds on:** the approved design record. Independent of pull request 1: a contribution's templates name their own package, so `init` needs no import-name translation.
- **Hands on:** the interface and the reordered pipeline.

### 3. `init` accepts any package name

[TML-3831](https://linear.app/prisma-company/issue/TML-3831).

- **Outcome:** `prisma orm init --target <any package>` works. Prisma's SQLite and MySQL packages export an init contribution and are scaffolded by package name, as the first real test of the mechanism. The guide for authors of target packages exists.
- **Builds on:** pull requests 1 and 2. Its end-to-end test needs both: `init` on an unlisted package, then an emit that compiles.
- **Hands on:** the project's definition of done.

## Order

```text
design ──► 1 imports ─────────────┐
       └─► 2 init contribution ───┴─► 3 any package name
```

Pull requests 1 and 2 touch different files, except the facades' `package.json` exports, and can be built at the same time.

## Dependencies

- **Releases.** The SQL Server team can use each change only from a published release. After pull requests 1 and 3 merge, the plan is not done until a release containing them is published and the team has been told the version.
- **prisma/orm#31056** moves each target's minimum server version from `package.json` into code. Pull request 2 reads it from there for the probe, so it should merge first.
- **The `prisma` CLI repository** may test `orm init`'s flags and JSON output. Pull request 3 changes both; check that repository when it is opened.

## The SQL Server team

- Now: send them [sql-server-team.md](sql-server-team.md) once the design is approved. It does not depend on any of our changes.
- After the release with pull request 1: tell them the version. Their package must name its two modules in the same version, because that release removes the `package.json` lookup their interim setup relies on.
- After the release with pull request 3: tell them the version and point them to the author guide.

## Close-out

- [ ] Verify every item of the definition of done in [spec.md](spec.md).
- [ ] Final retro.
- [ ] Move the `init` design record into `docs/architecture docs/adrs/` with a number and status Accepted, and add it to the index. It moves with the pull request that implements it. The generated imports record already moved, with the pull request that implemented it, and the public packages record carries its supersession note.
- [ ] Move the durable parts of `sql-server-team.md` into the author guide; delete the rest.
- [ ] Strip repository references to `projects/external-target-integration/`.
- [ ] Delete `projects/external-target-integration/`.
