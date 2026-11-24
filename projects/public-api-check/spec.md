# Public API check: spec

Status: design agreed on 2026-11-24, not yet built. This project belongs to the work on the Prisma 8 compatibility policy: from `8.0.0`, an application upgrades to any later `8.x` release with no changes. The policy is in `projects/ga-compatibility/` on the branch `ga-compatibility` (draft pull request prisma/orm#31193): `spec.md` sections 5 and 12, and `maturity-levels.md`.

## Purpose

We find out before a release, not from a user, that a change breaks code written against an earlier release. We also find out when something became importable that we did not mean to support, because from `8.0.0` an export we publish by accident is one we must keep until Prisma 9.

## At a glance

Every published package gets one generated text file, `api.txt`, beside its `package.json`. It lists everything a user can import from the package, one item per line. These lines are from a trial run on `@prisma/orm-postgres`:

```text
./config: function defineConfig(options: PostgresConfigOptions): PrismaConfig<'sql', 'postgres'>
./config: function prisma7Schema(schemaPath: string): ContractConfig
./config: interface PostgresConfigOptions
./config: interface PostgresConfigOptions, readonly optional property output?: string
./config: interface PostgresConfigOptions, readonly required property contract: string | ContractConfig
./orm-client: everything from @prisma/orm-family-sql/orm-client
```

The file is committed and CI fails when it does not match the code. A pull request that adds an export therefore adds a line, and it cannot merge until its description names the export and says why it is public.

Breaks are found a different way: by the compiler. For each export of the last release, a generated test asks whether the old type still fits the new one. The example apps as they were at the last release, with their type tests, are also compiled against the current build.

## Decisions

### One reading of each package's exports, three uses

A single step reads what each published package exports. Three things are made from its output:

1. the `api.txt` list (this project);
2. the generated type tests that detect breaks (this project);
3. the reference documentation (a later project). The compatibility policy makes the reference, generated from the code, the definition of what is public and how it behaves.

Nothing reads the packages' API a second way.

The reading has two parts, joined by one function:

- **What each import path exports is decided by the TypeScript compiler** reading the built declarations: every export name, every member, forwards to another package's path (such as `export * from "@prisma/orm-family-sql/orm-client"`), and members a package adds to another package's interface with `declare module` (`@prisma/orm-target-postgres` and `@prisma/orm-extension-pgvector` do this today).
- **How each declaration is written out is taken from Microsoft's API Extractor**, the established tool for this: Angular, Backstage, Firebase, the Azure SDK, Fluent UI, tldraw and Apollo Client all run it over their built type declarations. It handles one import path per run, so, like those projects, we run it once per path.

API Extractor's own output alone is not the reading: it misses forwards, augmentations and second names of a declaration, and it renames exports that clash with global names (`Document_2`). The joined result is. The first slice builds the join inside the list generator; the next slice makes it a function that the list and the type-test generator both call.

Every run checks the reading against the compiler: an export name or a member that the compiler sees and that has no line fails the run.

Trials on 2026-11-24 ran this over the built declarations of all 22 published packages, 1,037 import paths. Every path succeeded, in about 70 seconds with four processes, and two runs gave identical output.

### The list: `api.txt`

- One line for each export of each import path, and one for each member: property, method, constructor, call signature, enum member. A member's line says whether it is required or optional.
- A type that a signature uses but that is not exported is listed once per package and marked `(not exported)`.
- A path that forwards another package's path is one line that names that path. 140 of the 163 paths of `@prisma/orm-postgres` are of this kind.
- Types are written in a normal form, so that the list depends on the code and not on how a particular build printed it. Two builds of the same source were found to print some inferred types differently. So the members of a union are sorted, and a type the build printed as `import("@prisma/x").Name` is written `Name`. The list shows what is importable; it does not decide what is a break, so this loses nothing it needs.
- Private members are left out.
- The file is not published, because each package publishes only `dist` (and, for the facades, `skills`).

The list has two jobs. It makes an added export visible, which the type tests cannot do, because nothing in the last release refers to a new export. And it is what the next project reviews when it removes exports.

The format is our own. Go lists its standard library the same way (`api/go1.*.txt`, "API features, one per line"), but no TypeScript project does. We did not commit API Extractor's own Markdown reports, as the projects above do, because here they total 260,000 lines and repeat one declaration in up to 40 files. The list is about 30,000 lines.

CI fails when a committed `api.txt` does not match the build. The fix is one command, `pnpm api:update`, which is also how a merge conflict in a list is resolved.

### Breaks: generated type tests against the last release

Microsoft's Fluid Framework does this. A generator writes one test for each export of the previous release. The test imports the type from the previous release and from the current build and asks the compiler whether the old one still fits the new one. CI compiles the tests.

- Adding an optional parameter or property passes. Removing an export, narrowing an input, widening an output, or adding a required member to something users supply fails. No person and no text comparison judges compatibility.
- A deliberate break is recorded as an expected failure for that export, with its reason. If the break is later undone, the expected failure itself fails, so the record cannot go stale. Each one is also named in the release notes, which is where a user learns of it.
- The previous release is installed from the registry beside the current build. The release process moves it forward at each release.
- Only GA is checked: the package's version at the last release is a plain version with no pre-release part, and the export's name does not start with `preview_` or `ea_`. A GA package depends only on GA packages, so a path that a facade forwards is checked in the package that owns it.

This is the one part not yet tried on our packages. Fluid found that some types do not fit themselves across two copies of a package (a class with private members, a `unique symbol`), and it works around them. A trial comes first. If it fails, the fallback is to compare the `api.txt` lines of the last release's git tag with today's and fail on a removed line, with an exceptions file, as Go does. That fallback is weaker than it was first designed: because the list writes `import("@prisma/x").Name` as `Name`, a type that changes to another package's type of the same name changes no line.

### Result types: the last release's example apps

A query's result type is worked out from the user's contract and query, so it can change while every exported declaration stays the same. The generated tests do not see that.

The example apps do. They import the published packages by name, and 13 type test files in them, mostly in `examples/prisma-8-demo`, state exact types against a real contract: collection methods, chaining, fragments, filters, update inputs, enums. CI already type-checks and tests the apps on every pull request, but the same pull request can edit an app to fit a break.

CI therefore also compiles the example apps as they were at the last release's git tag, type tests included, against the current build. A failure there is a break for users. Coverage grows by adding type tests to the example apps.

### Human oversight

A maintainer who is a person already approves every pull request: `CODEOWNERS` gives every file to the maintainer team, and the repository's bot is not in it. What is missing is that the person may not notice an API change. Three things fix that:

- **The pull request's description must name it.** When a pull request changes any `api.txt`, a check fails until the description has a section that names each added and each removed export and says why. The control plane's repository does the same for destructive migrations, which fail until the description carries an approval line.
- **A comment lists the changes.** The check posts one comment with the lines the pull request adds and removes, and keeps it current. A pull request from a fork gets the same text in the job's summary, because its token cannot comment.
- **The review agents are told what to check.** `packages/9-public/AGENTS.md` states the review criteria: is each addition meant to be supported until the next major, and is each removal or change allowed by the policy. Gizmo reads guideline files near the changed files, and so do our own agents. CodeRabbit gets the same text as a path instruction for `**/api.txt` in `.coderabbit.yml`.

### Until `8.0.0`

Every package's version is `8.0.0-rc.N`, a pre-release, so nothing is GA. The generated tests and the last release's example apps run and report, and do not fail. They start to fail at the first release with a plain version, with nothing to switch on.

The list and the description check apply from the first day. They block no change; they make it visible.

## What the checks do not see

- **Result types the example apps do not exercise.** Covered only as far as the apps' code and type tests go.
- **Types from other publishers' packages.** A change inside `pg` or `arktype` is seen only if it changes how our types fit.
- **Behaviour.** Runtime behaviour, error codes, CLI output and file formats belong to other projects in the compatibility work.

## Known costs

- **Noise in the list.** About 260 lines carry a name the script gives a non-exported type to keep it apart from another of the same name, such as `Options_2`. Adding a type with a name already in use, or an export name that sorts earlier, can change such lines without an API change. Since the list does not decide what is a break, this costs a longer diff and description, not a failed build. A tool upgrade that prints types differently has the same cost.
- **Time.** About 70 seconds for the reading, plus the compile of the generated tests and of the last release's example apps. To be measured on a CI runner.
- **Search.** About 30,000 generated lines match repository searches. The files are added to the ignore lists that search tools read.

## Non-goals

- Removing or renaming exports. That is the next project, which reduces what the packages export.
- The reference documentation. This project only makes its input.
- Recording which interfaces users implement. The compiler decides whether a new required member breaks.
- A check on the `exports` field. The build writes `exports` into each `package.json` on a developer's machine and not in CI, so CI does not notice a committed `exports` that is out of date. This project reads `exports`, so it records the gap for a separate fix.

## Place in the larger world

- The list check runs in the `Lint` job of `.github/workflows/ci.yml`, which restores the build from the cache. `pnpm fixtures:check` is the existing example of committed generated files that CI regenerates and compares. The job also runs in the merge queue, where it checks and does not comment.
- The comment uses the pull request's own token on the `pull_request` event with `pull-requests: write`, as the bundle-size workflow does. `pull_request_target` is not used.
- The packages are built by `defineShellConfig` (`packages/0-config/tsdown/shell-build.ts`). The checks read only the build's output and each `package.json`.
- The scripts live in `scripts/`, with tests run by `pnpm test:scripts`.
- The pull request that turns on break detection also carries its documentation: a decision record, the contributor's guide, and what the check does before and from `8.0.0`.
- Once packages have different versions, what counts as GA depends on how the release process writes versions. That is decided by the project that gives each package its own maturity level.

## Definition of done

- Every published package has a committed `api.txt`, and CI fails when it does not match the build. The file generated on a laptop and the one generated in CI are identical.
- A pull request that adds an export fails until its description names the export, and shows the comment. Shown on a real pull request.
- In a test with a package treated as GA: removing an export fails; narrowing a parameter fails; adding an optional parameter passes; a recorded expected failure passes, and fails once the break is undone. With today's `rc` version the same changes are reported and do not fail.
- CI compiles the last release's example apps against the current build, and a deliberate break in a trial run is reported.
- `packages/9-public/AGENTS.md` and `.coderabbit.yml` carry the review criteria. A decision record and a contributor's guide in `docs/` state what the checks do, how to update the lists, and how to record a deliberate break.
- The gap in `exports`, and the rule that a GA package depends only on GA packages, are recorded where the owner of the compatibility work will see them.

## Alternatives considered

- **Compare the text of the lists to find breaks**, as Go does. Kept only as the fallback: text cannot tell a harmless change from a break, so every changed line would need a person and an exceptions file. AWS CDK's exceptions file has grown to about 4,200 lines.
- **API Extractor's Markdown reports as the committed files.** Rejected for size and repetition, as above.
- **Commit nothing and compare with the registry only.** Rejected: a pull request would not show its added exports, and the next project would have nothing in which to review its removals.
- **A named approver for the list files**, as Angular has. Not needed: a person already approves every pull request.
- **Only type tests and example apps, with no list**, as Drizzle, Kysely, Zod, tRPC and the other database and type libraries do. Rejected: none of them promises no code changes within a major across a thousand import paths, and nothing in that approach notices an accidental export.
- **API Extractor's stability labels on each API** (`@public`, `@beta`). Rejected: the maturity levels are already written in the package's version and the API's name.
