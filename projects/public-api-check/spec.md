# Public API check: spec

Status: design, not yet built. This project belongs to the work on the Prisma 8 compatibility policy: from `8.0.0`, an application upgrades to any later `8.x` release with no changes. The policy is in `projects/ga-compatibility/` on the branch `ga-compatibility` (draft pull request prisma/orm#31193): `spec.md` sections 5 and 12, and `maturity-levels.md`.

## Purpose

We find out before a release, not from a user, that a change breaks code written against an earlier release. We also find out when something became importable that we did not mean to support, because from `8.0.0` an export we publish by accident is one we must keep until Prisma 9.

## At a glance

Every published package gets one generated text file, `api.txt`, beside its `package.json`. It lists everything a user can import from the package, one item per line: each import path, each export, and each member of an export, with its full signature. These lines are from a trial run on `@prisma/orm-postgres`:

```text
./config: function defineConfig(options: PostgresConfigOptions): PrismaConfig<'sql', 'postgres'>
./config: function prisma7Schema(schemaPath: string): ContractConfig
./config: interface PostgresConfigOptions
./config: interface PostgresConfigOptions, readonly optional property output?: string
./config: interface PostgresConfigOptions, readonly required property contract: string | ContractConfig
./orm-client: everything from @prisma/orm-family-sql/orm-client
```

The file is committed, and CI fails when it does not match the code. So a pull request that removes `prisma7Schema` removes that line in its diff, and one that adds an export adds a line.

CI then does two things with the files:

1. It compares them with the same files at the last release. A line of a GA package that the release had and that is now gone fails the check, unless it is listed in an exceptions file with a reason.
2. It comments on the pull request with the lines the pull request adds and removes. A change to any `api.txt` needs the approval of a named person, so an added export cannot merge on an agent's approval alone.

## Decisions

### The file follows Go; the reading is done by API Extractor

Go has kept its standard library compatible this way since Go 1. The files `api/go1.*.txt` in its repository list "API features, one per line", a tool (`cmd/api`) generates the list from the code, and a test fails when a line of a released file is missing. Comparing two versions is then a comparison of two sets of lines, with no judgement in it.

No tool produces such a list for TypeScript directly. Microsoft's API Extractor is the established tool that reads a package's built type declarations: Angular, Fluent UI and tldraw commit its output and fail CI when the committed copy is out of date. We run it once per import path, as Angular does, because it handles one path per run. It writes a structured description of the path's API, and a script of ours prints that as lines. API Extractor leaves out two things the list needs, and the script reads both from the declarations with the TypeScript compiler:

- an import path that forwards another package's path, such as `export * from "@prisma/orm-family-sql/orm-client"`;
- members that a package adds to another package's interface with `declare module`. `@prisma/orm-target-postgres` and `@prisma/orm-extension-pgvector` do this today.

Two trials on 2026-11-24 ran this over the built declarations of all 22 published packages, 1,037 import paths. Every path succeeded. The run takes about 70 seconds with four processes. Two runs gave identical files, with no file paths and no build-specific names in them. The files total about 73,000 lines. Two thirds of those are types that a signature uses but that are not themselves exported, repeated under every path that reaches them; listing each once per package brings the total to about 30,000 lines, and the design does that.

We did not choose API Extractor's own Markdown reports as the committed file. The first trial used them: they total 260,000 lines, the same declaration appears in up to 40 files, and telling an addition from a removal would need a program that understands the Markdown.

### What a line is

- One line for each import path's each export, and one for each member: property, method, constructor, call signature, enum member. A member's line says whether it is required or optional.
- A type that a signature uses but that is not exported is listed once per package and marked `(not exported)`. It must be listed: `PostgresClient` extends `PostgresStaticMembers`, which is not exported, and a change to it changes what users get.
- A path that forwards another package's path is one line that names that path. 140 of the 163 paths of `@prisma/orm-postgres` are of this kind. The line is accurate: the decision record on the published packages requires the two paths to be one module. The names are in the other package's file.
- A deprecated export has an extra line that says so. Deprecating something therefore adds a line and removes none.
- Private members are left out.

### The last release's API is read from the release's git tag

The publish workflow tags every release (`v8.0.0-rc.25`). The `api.txt` files at that tag are that release's API, because CI did not let them differ from the code. The check reads them with `git show`. Nothing is copied, and the release process does not change. A package's version at the release is read from its `package.json` at the same tag.

"The last release" is the newest release tag that the pull request's base branch contains, ignoring the `-dev` builds published on every push. A pull request against a maintenance branch is therefore compared with that branch's own last release.

### What fails, and from when

- **Removed.** A line that the last release had and that is now gone fails the check when it is GA. A changed signature is one line removed and one added, so it fails too.
- **GA** is as `maturity-levels.md` defines it: the package's version at the last release is a plain version with no pre-release part, and neither the item's name nor the name of the class or interface that contains it starts with `preview_` or `ea_`.
- **Forwarded paths.** A removal on a path that a facade forwards is judged in the package that owns the path. That is enough, because a GA package depends only on GA packages: a package cannot be more reliable than what it is built on.
- **A GA signature that uses a type below GA.** A line of a GA package that names a type starting with `preview_` or `ea_` fails, for the same reason. Deno's standard library has the equivalent check for its unstable modules.
- **Exceptions.** The check compares text. It cannot tell that a changed signature still accepts all existing code, and a security fix may require a break. `api/exceptions.txt` at the repository root holds the exact removed lines that are allowed, each with its reason, as Go's `api/except.txt` does. An entry that matches no removed line fails the check, so entries are deleted once the next release makes them unnecessary. Each exception is also named in the release notes, which is where a user learns of it.
- **Until `8.0.0`.** Every package's version is `8.0.0-rc.N`, a pre-release, so by the rule above nothing is GA and nothing fails. The check still runs and reports. It starts to fail at the first release with a plain version, with nothing to switch on.

One part fails from the first day: a committed `api.txt` that does not match the code. The fix is one command, `pnpm api:update`. It blocks no change. When two pull requests conflict in an `api.txt`, the fix is the same command, never a hand merge.

### Additions need a named person's approval

The check posts one comment on the pull request and keeps it current. It lists the lines this pull request adds and removes, compared with its base branch. A pull request from a fork gets the same text in the job's summary, because its token cannot comment.

A comment can be ignored, so the approval is enforced. `CODEOWNERS` names the owners of every `api.txt`, and the branch rules require an owner's approval for a pull request that changes one. The repository's bot is not an owner. Angular does this for its API files: a change under `goldens/public-api/` needs approval from a short list of people. Turning on the branch rule is a repository setting, which the maintainers change.

### A new required member

A new required member breaks code in two cases: on an interface that users implement, such as a middleware, and on an object that users build and pass to us, such as `PostgresConfigOptions`. It is harmless on an object that only Prisma creates, such as a result. The check cannot tell these apart.

This project does not teach the check the difference. A new required member is an added line, so the check does not fail on it. The comment on the pull request lists new required members under their own heading, and the person who approves the change decides.

The project that makes additions safe (new error codes, built-in names and builder methods) records which interfaces users implement. When that list exists, the check can fail on a new required member of a listed type; the list would be a text file beside the exceptions file.

### The last release's example apps must still compile

The 16 applications under `examples/` import the published packages by name, and CI type-checks and tests them on every pull request. So a change that breaks user code already fails CI, unless the same pull request edits the example to fit. After `8.0.0` such an edit hides a break.

CI therefore also type-checks the example apps as they were at the last release's tag, against the current build. This tests the policy's promise directly: code written for one release compiles on the next. It also covers what the line comparison cannot see, a query's result type, as far as the examples use it. Like the line comparison, it reports until `8.0.0` and fails from then on.

### One reading of the API, shared with the reference documentation

The compatibility policy makes the reference documentation the definition of what is public, generated from the code. API Extractor's structured description is the input Microsoft's documentation generator takes. The step that produces it is written so the reference documentation can use the same output, and nothing else reads the packages' API a second way.

## What the check does not see

- **Types computed from the user's input.** A query's result type is worked out from the user's contract and query. It can change while every line stays the same. The example apps catch such a change only where their code depends on it; they do not state the exact type of each result. Tests that do are a possible follow-up (see Non-goals).
- **Types from other publishers' packages.** A type from `pg` or `arktype` appears by name. A change inside that package does not change the line.
- **Behaviour.** Runtime behaviour, error codes, CLI output and file formats belong to other projects in the compatibility work.
- **Whether a change is compatible.** Any change to a released GA line fails until it has an exception.

## Known costs

- **Lines that change without an API change.** About 1,150 lines carry a name that a tool made up to avoid a clash, such as `Document_2`. About 1,200 contain an inferred type that TypeScript printed with an `import("...")` reference. 158 lines are longer than 1,000 characters, because an inferred type is printed in full. A refactor or a tool upgrade can change such lines. Before `8.0.0` that is noise in a diff. After it, each is a failure that needs an exception. The first pull request measures this on real changes, and the cure for the worst cases is an explicit type in the source.
- **Union types.** API Extractor has an open issue (microsoft/rushstack#1958) that an inferred union type can print its members in a different order from one build to the next. The first pull request checks whether it happens here.
- **Tool upgrades.** API Extractor and TypeScript are pinned for the check. An upgrade that prints types differently changes lines in bulk, and after `8.0.0` needs its lines accepted as exceptions in the same pull request.
- **Time.** About 70 seconds on a laptop with four processes, in the `Lint` job. To be measured on a CI runner.
- **Search.** About 30,000 generated lines match repository searches. The files are added to the ignore lists that search tools read.

## Non-goals

- Removing or renaming exports. That is the next project, which reduces what the packages export; it reviews its removals in these files.
- Deciding which interfaces users implement.
- Tests that state the exact result type of representative queries against the published packages.
- A check that fails on a new required member, and a compiler-checked comparison of the old types with the new ones, as Microsoft's Fluid Framework does. Either can be added if approvals or exceptions prove too many.
- Reference documentation.
- A check on the `exports` field. The build writes `exports` into each `package.json` on a developer's machine and not in CI, so CI does not notice a committed `exports` that is out of date. This project reads `exports`, so it records the gap for a separate fix.

## Place in the larger world

- The check runs in the `Lint` job of `.github/workflows/ci.yml`, which restores the build from the cache and already fetches tags. `pnpm fixtures:check` is the existing example of committed generated files that CI regenerates and compares. The job also runs in the merge queue, where it checks and does not comment.
- The comment uses the pull request's own token on the `pull_request` event with `pull-requests: write`, as the bundle-size workflow does. `pull_request_target` is not used.
- The packages are built by `defineShellConfig` (`packages/0-config/tsdown/shell-build.ts`). The check reads only the build's output and each `package.json`.
- The scripts live in `scripts/`, with tests run by `pnpm test:scripts`.
- Once packages have different versions, the rule for GA depends on how the release process writes them. That is decided by the project that gives each package its own maturity level; this check reads whatever version the tag holds.

## Definition of done

- Every published package has a committed `api.txt`, and CI fails when it does not match the build. The file generated on a laptop and the one generated in CI are identical.
- A pull request that adds an export shows the comment, and cannot merge without an owner's approval. Shown on a real pull request.
- In a test with a package's version set to a plain version: removing an export fails; changing a signature fails; an exception makes it pass; a stale exception fails; a line that names a `preview_` type fails. With today's `rc` version the same changes are reported and do not fail.
- CI type-checks the last release's example apps against the current build, and a deliberate break in a trial run is reported.
- A contributor's guide in `docs/` says what the check does, how to update the files, and when an exception is right. A decision record states the decisions above.
- The gap in `exports`, and the rule that a GA package depends only on GA packages, are recorded where the owner of the compatibility work will see them.

## Alternatives considered

- **API Extractor's Markdown reports as the committed files**, as Angular commits them. Rejected for the reasons under the first decision.
- **Compare the build with the packages on the registry, and commit nothing**, as `cargo-semver-checks` and .NET package validation do. Rejected: a pull request's diff would not show its API changes, there would be no file for an owner to approve, and the next project would have nothing in which to review its removals.
- **A frozen copy of the files for each release, committed beside the current ones**, as Go does. Rejected: the release tag already holds that copy.
- **A comment on the pull request as the only notice of an addition.** Rejected: an agent can regenerate the files and another can approve without either reading the comment.
- **Fail on every addition until it is recorded with a reference to its approval**, as Go does with `api/next/`. Rejected for now: the owner's approval gives the same assurance with less to maintain.
- **API Extractor's stability labels on each API** (`@public`, `@beta`). Rejected: the maturity levels are already written in the package's version and the API's name.
