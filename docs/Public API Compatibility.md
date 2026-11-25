# Public API compatibility checks

From `8.0.0`, Prisma 8 promises that an application upgrades to any later `8.x` release with no code changes. CI checks every pull request against that promise. This guide says what each check does and what to do when one fails. The decision and its reasons are in [ADR 330](architecture%20docs/adrs/ADR%20330%20-%20CI%20finds%20breaking%20API%20changes%20by%20compiling%20against%20the%20last%20release.md).

## The four checks

| Check | Where | What it does | Before `8.0.0` | From `8.0.0` |
| --- | --- | --- | --- | --- |
| The API lists are current | `Lint` job, `pnpm api:check` | Each published package's `api.txt` matches the build | Fails | Fails |
| The description names each change | `API changes` workflow | A pull request that changes an `api.txt` gets a comment listing the changed lines, and its description must name each changed export | Fails | Fails |
| Type tests against the last release | `api-compat` job, `pnpm api:compat` | Each export of the last release still fits the current build | Reports | Fails |
| The last release's example apps | `typecheck` job, `pnpm api:examples` | The example apps as they were at the last release compile against the current build | Reports | Fails |

"Reports" means the job lists what it found in its summary and passes. The type tests and the example apps start to fail by themselves at the first release whose version has no pre-release part; nothing is switched on.

Only what is generally available is checked strictly: a package whose last release has a plain version, and an export whose name does not start with `preview_` or `ea_`.

## `api.txt` is out of date

Each package under `packages/9-public/@prisma/` has a generated `api.txt` beside its `package.json`: one line for each export of each import path and each member.

```text
./config: function defineConfig(options: PostgresConfigOptions): PrismaConfig<'sql', 'postgres'>
./config: interface PostgresConfigOptions, readonly optional property output?: string
./orm-client: everything from @prisma/orm-family-sql/orm-client
(not exported) interface EnumMember_2<Name extends string, Value>
```

Run `pnpm build`, then `pnpm api:update`, and commit the changed lists. Never edit an `api.txt` by hand, and after a merge conflict in one, rebuild and run `pnpm api:update` instead of merging it. The steps are also in the [Common Tasks Playbook](onboarding/Common-Tasks-Playbook.md).

If `pnpm api:update` writes no change on your machine and CI still fails, the scripts have a bug: download the `api-lists` artifact from the failed run and compare.

Some lines change without an API change:

- A type that is not exported but appears in a signature is listed as `(not exported)`. When two share a name, the later ones are numbered (`_2`), so adding one can renumber the others.
- A declaration exported under several names is referred to by the name that sorts first.
- An outside type whose name the package also exports is written with its package, such as `mongodb.MongoClient`, so adding an export can add that prefix elsewhere.

## The description must name each change

When a pull request changes an `api.txt`, a comment lists, per package, the lines it adds and removes, and offers a section to copy. The check fails until the description has a section headed `## API changes` in which each changed export is named in backticks, on a line that says why:

```markdown
## API changes

- `@prisma/orm-postgres/config: defineConfig`: takes the database URL, so a config file can name it.
- `@prisma/orm-family-sql`: regenerated after the TypeScript upgrade; no API change.
```

A package name in backticks covers every change in that package, which is how to describe a large change such as a tool upgrade. The failure message lists the exact names that are missing. Editing the description runs the check again.

Reviewers, people and agents, read the section to decide whether each addition is one we want to support until Prisma 9. Their criteria are in [`packages/9-public/AGENTS.md`](../packages/9-public/AGENTS.md).

## A break against the last release

The `api-compat` job installs the last release of each package and compiles a generated test per export that asks whether the current type can stand where the last release's stood. A failure is listed as a break, with the import path, the export, whether it is the type or the value, and TypeScript's message.

To run it locally: `pnpm build`, then `pnpm api:compat`. `--only <package>` checks one package, and `--ga` treats the last release as generally available, to see what will fail from `8.0.0`.

What is a break and what is not:

- Removing an export, narrowing a parameter, making an optional parameter required, widening a return type: breaks.
- Adding an optional parameter or property: not a break.
- A new member on an interface users implement: a break unless it is optional. A new member on a type users only receive: not a break.

An entry listed as **undecided** is a comparison TypeScript gave up on ("type instantiation is excessively deep"). It is neither a pass nor a break; look at the change yourself.

If the break is not intended, change the code. If it is, record it.

## Recording a deliberate break

A break in a generally available export is an exception to the compatibility policy, and the release notes must name it. Record it in the package's `api-breaks.json`, beside its `api.txt`:

```json
[{ "path": "./builder", "export": "Db", "release": "8.1.0", "reason": "Join scopes merge by name; see the release notes" }]
```

`release` is the last release the break is measured against, as the job reports it. The reason is one line. Once the break is undone, the record fails, so it cannot go stale silently. When the next release is published, records for the earlier one are skipped and listed as removable; delete them.

## The last release's example apps fail

`pnpm api:examples` replaces each app's files under `examples/`, apart from `node_modules`, with the last release's, runs the app's `typecheck` script, and puts the app's own files back. The apps' committed contracts are compiled as they were, because a contract must keep working without being emitted again.

An error there is a change a user's code would see. The apps' type tests assert exact types, so an addition the policy allows, such as a new optional property on a result row, also fails them. Record such an error, or a deliberate break, in `examples/last-release-errors.json`:

```json
[{ "app": "prisma-8-demo", "file": "test/rows.test-d.ts", "line": 12, "code": "TS2344", "release": "8.1.0", "reason": "Rows gain the optional createdBy field" }]
```

An error is identified by app, file, line and error code at the last release's tag, which do not change while that release is the last. A record that matches no error fails.

## What the checks do not see

Swapping one branded type for another; changes inside generic functions or between overloads; breaks inside types TypeScript gives up on; result types the example apps do not exercise; runtime behaviour, error codes, command output and file formats. A reviewer is the only check for these.
