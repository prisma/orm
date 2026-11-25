# Public API compatibility checks

From `8.0.0`, Prisma 8 promises that an application upgrades to any later `8.x` release with no code changes. CI checks every pull request against that promise. This guide says what each check does and what to do when one fails. The decision and its reasons are in [ADR 330](architecture%20docs/adrs/ADR%20330%20-%20CI%20finds%20breaking%20and%20accidental%20API%20changes%20against%20the%20last%20release.md).

## The four checks

| Check | Where | What it does | Before `8.0.0` | From `8.0.0` |
| --- | --- | --- | --- | --- |
| The API lists are current | `Lint` job, `pnpm api:check` | Each published package's `api.txt` matches the build | Fails | Fails |
| The description names each change | `API changes` workflow | A pull request that changes an `api.txt` or a record of a break gets a comment listing the changes, and its description must name each changed export, package or app | Fails | Fails |
| Type tests against the last release | `api-compat` job, `pnpm api:compat` | Each export of the last release still fits the current build | Reports | Fails |
| The last release's example apps | `api-compat` job, `pnpm api:compat:examples` | The example apps as they were at the last release compile against the current build | Reports | Fails |

"Reports" means the job lists the breaks it found in its summary and passes. A problem still fails it at any version: a check that could not compare, or a record that no longer matches a break and must be removed. The type tests and the example apps start to fail by themselves at the first release whose version has no pre-release part; nothing is switched on.

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

Two limits of the lists are known and left as they are. An outside type imported under a local alias is written under the alias; writing API Extractor's referenced name instead made many lines worse, because that name is often not one any package exports. And types inside the members of a `declare module` augmentation are not qualified when their name clashes with one the package exports.

## The description must name each change

When a pull request changes an `api.txt`, or a record of a break (`api-breaks.json`, `packages/9-public/removed-packages.json` or `examples/last-release-errors.json`), a comment lists, per package, the lines and records it adds and removes, and offers a section to copy. The check fails until the description has a section headed `## API changes` in which each changed export is named in backticks, on a line that says why:

```markdown
## API changes

- `@prisma/orm-postgres/config: defineConfig`: takes the database URL, so a config file can name it.
- `@prisma/orm-family-sql`: regenerated after the TypeScript upgrade; no API change.
```

A package name in backticks covers every change in that package, which is how to describe a large change such as a tool upgrade. The failure message lists the exact names that are missing. Editing the description runs the check again.

Reviewers, people and agents, read the section to decide whether each addition is one we want to support until Prisma 9. Their criteria are in [`packages/9-public/AGENTS.md`](../packages/9-public/AGENTS.md).

## A break against the last release

The `api-compat` job installs the last release of each package and compiles a generated test per export that asks whether the current type can stand where the last release's stood. A failure is listed as a break, with the import path, the export, the kind of test (the export's type, its value, its constructor, and so on) and TypeScript's message, followed by a record that would cover it.

To run it locally: `pnpm build`, then `pnpm api:compat`. `--only <package>` checks one package, and `--ga` treats the last release as generally available, to see what will fail from `8.0.0`.

What is a break and what is not:

- Removing an export, narrowing a parameter, making an optional parameter required, widening a return type: breaks.
- Adding an optional parameter or property: not a break.
- A new member on an interface users implement: a break unless it is optional. A new member on a type users only receive: not a break.

An entry listed as **undecided** is a comparison the check could not settle: TypeScript gave up on it ("type instantiation is excessively deep", or the compiler ran out of stack), or it could not relate two copies of a generic type. The report says at which step it stopped. It is neither a pass nor a break; if your change touches that export, look at it yourself.

Some breaks are reported for changes the policy allows. The check treats any type an exported function accepts as one users may supply, so widening the return type of a method on an interface users only implement, for example, is reported. Record it with that reason.

If the break is not intended, change the code. If it is, record it.

## Recording an accepted failure

A break in a generally available export is an exception to the compatibility policy, and the release notes must name it. Record it in the package's `api-breaks.json`, beside its `api.txt`:

```json
[{ "path": "./builder", "export": "Db", "test": "type", "kind": "break", "lastRelease": "8.1.0", "fingerprint": "34261bf6461da021", "reason": "Join scopes merge by name; see the release notes" }]
```

Do not write the record by hand: the job prints one, ready to paste, under each break it reports, and the job summary has one block per package. `test` is the kind of test that broke: `type`, `value`, `constructor`, `abstract`, `exists`, `path` or `augments`. `kind` is `break` for a deliberate break, which the release notes must name, or `allowed` for a change the policy allows that the check reports anyway, such as widening the return type of a method on an interface users only implement. `lastRelease` is the release the break is measured against. `fingerprint` covers the export's lines in the package's `api.txt` and the lines of every declaration there that they use as a type, followed until nothing new is named. When the export, or a type of the same package that it uses, changes again, the fingerprint no longer matches, the record stops applying, and the break is reported again with a note, to be judged afresh. Run `pnpm build` and `pnpm api:update` before copying a printed record, so its fingerprint is taken from the lists you commit. Some changes that are not API changes also change a fingerprint: a non-exported type renumbered (`Options_2`), an outside type that gains its package prefix, or an upgrade of TypeScript or API Extractor. After one of those, paste the printed records again. A deleted package is recorded in `packages/9-public/removed-packages.json` as `{ "package", "lastRelease", "reason" }`.

## The last release's example apps fail

`pnpm api:compat:examples` extracts each app under `examples/` as it was at the last release into a folder of its own (`.api-examples/`), links the app's installed `node_modules` into it, and runs the app's `typecheck` script there. Your own app folders are not touched. The apps' committed contracts are compiled as they were, because a contract must keep working without being emitted again.

An error there is a change a user's code would see. The apps' type tests assert exact types, so an addition the policy allows, such as a new optional property on a result row, also fails them. Record such an error, or a deliberate break, in `examples/last-release-errors.json`:

```json
[{ "app": "prisma-8-demo", "file": "test/rows.test-d.ts", "line": 12, "code": "TS2344", "message": "<TypeScript's message, as the job reports it>", "kind": "allowed", "lastRelease": "8.1.0", "reason": "Rows gain the optional createdBy field" }]
```

A record matches one error by app, file, line, code and message, so copy the message from the job's report. `kind` is `allowed` for an error that an addition the policy allows causes in an exact type assertion, and `break` for a deliberate break, which the release notes must name. A record that matches no error, or more than one, fails.

## What the checks do not see

The decision record lists them in its section "What the checks do not see". In short: swapping one branded type for another, changes inside generic functions or between overloads, a property made `readonly`, breaks inside undecided comparisons, a change to another package's type behind a recorded export, third-party type changes, result types the example apps do not exercise, and behaviour. A reviewer is the only check for these.
