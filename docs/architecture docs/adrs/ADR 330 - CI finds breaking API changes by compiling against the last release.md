# ADR 330 - CI finds breaking API changes by compiling against the last release

## At a glance

A pull request makes the options of `createCacheMiddleware` in `@prisma/orm-extension-middleware-cache` required:

```ts
// last release
export function createCacheMiddleware<TMeta = unknown>(options?: CacheMiddlewareOptions<TMeta>): CacheMiddleware<TMeta>;
// this pull request
export function createCacheMiddleware<TMeta = unknown>(options: CacheMiddlewareOptions<TMeta>): CacheMiddleware<TMeta>;
```

An application written against the last release that calls `createCacheMiddleware()` no longer compiles. CI generates, among others, this test, and it does not compile:

```ts
import type * as r0 from 'release-orm-extension-middleware-cache';
import type * as c0 from 'current-orm-extension-middleware-cache';

type t4 = [requireAssignableTo<StructuralNew<typeof c0.createCacheMiddleware>, StructuralOld<typeof r0.createCacheMiddleware>>];
```

(`r0` is the last release, installed from the registry; `c0` is the current build.)

The `api-compat` job reports it as a break of `createCacheMiddleware` on the import path `.`, and, once the last release is generally available, fails.

Nobody judged that change by reading it. The TypeScript compiler did, by asking whether the current build's `createCacheMiddleware` can stand where the last release's stood.

## Decision

Every pull request is checked for changes that break code written against the last release, in three parts:

1. **Generated type tests** (`pnpm api:compat`, the `api-compat` job). The last release of every published package is installed from the registry beside the current build. For each export of each import path a package owns, a generated test asks the compiler whether the current type is assignable to the last release's type. A test that does not compile is a break.
2. **The last release's example apps** (`pnpm api:examples`, in the `typecheck` job). Each app under `examples/` is compiled as it was at the last release's git tag, type tests and committed contracts included, against the current build. An error is a break.
3. **A visible list of every API change.** Each published package commits an `api.txt` that lists everything a user can import from it, one line per import path, export and member. CI fails when it is out of date. When a pull request changes one, a comment lists the added and removed lines, and a check fails until the description has an `## API changes` section that names each changed export and says why.

The type tests and the example apps fail only when the last release is generally available (GA). While it is a pre-release (`8.0.0-rc.N`) they report in the job summary and pass. The list and the description check apply always.

A deliberate break is recorded, with the release it applies to and the reason, and the record is itself checked: a record that no longer matches a break fails.

## Why

From `8.0.0`, Prisma 8 promises that an application upgrades to any later `8.x` release with no code changes. A promise that nothing checks is broken by the first pull request that does not think about it. Two failures matter:

- **A break reaches users.** An export removed, a parameter narrowed, a return type widened, a required member added to an interface users implement. Each stops existing code compiling.
- **An accidental export becomes permanent.** Once a GA release exports something, it must stay until the next major. A pull request that makes a helper importable without meaning to has made that promise.

The first needs a judge of compatibility; the second needs a reviewer who can see the addition. They are different tools because an addition breaks nothing: no test written against the last release can notice it.

## How the type tests judge compatibility

**One direction is enough.** Each test asks whether the current type is assignable to the last release's: for a type, `requireAssignableTo<StructuralNew<c0.Name>, StructuralOld<r0.Name>>`; for a value, the same over `typeof`. That single question gives the right answer for both kinds of interface. A new required member on `CacheStore`, which users implement, fails through the function that accepts it: the current `createCacheMiddleware` no longer accepts an old `CacheStore`, so it is not assignable to the old `createCacheMiddleware`. A new member on `CacheMiddleware`, which users only receive, passes, because a type with more members is still assignable to the old one. So nobody records which interfaces users implement; the exported functions already say.

**Signatures are kept.** Before the comparison, a helper (`scripts/public-api/compat-structural.ts`) removes what makes two copies of one declaration differ without mattering to a user: private members, unique-symbol keys and brands on primitives. It keeps call and construct signatures, and it turns methods into function-typed properties, because TypeScript compares method parameters in both directions and would let a narrowed method parameter pass. The helper is written twice, once per side, because through a single shared alias TypeScript compares two uses by the alias's measured variance and loses the same strictness.

**The two copies must not be one package.** The current build and the last release can have the same name and version, and TypeScript then treats them as one package without comparing them. The installed release is stamped with a version of its own, its third-party dependencies are pinned to the versions in the repository's lockfile so that a difference in `pg` is not reported as ours, and every generated file ends with a test that must fail. A run that compares nothing therefore fails.

**Each export is checked once.** A database's package re-exports most of the shared packages' import paths. Those forwarded names are checked in the package that declares them.

**Type parameters without a default are set to `never`.** This is how Microsoft's Fluid Framework, which this method follows, tests a generic type without inventing arguments for it.

## How the example apps cover result types

A query's result type is computed from the user's contract and the query. It can change while every exported declaration stays the same, so the generated tests do not see it. The example apps do: they import the published packages by name, and their type tests state exact result types against real contracts.

Compiling the apps as they are on the pull request's branch is not enough, because the same pull request can edit an app to fit a break. So CI takes each app's files from the last release's tag and compiles them against the current build. The app's installed dependencies already resolve `@prisma/*` to the current build through each package's `exports`, as a user's would. The committed contracts are compiled as they were at the tag and never re-emitted, because the compatibility policy says a contract and its generated types are read by every later release with no re-emit.

The apps' type tests assert exact types, so they also fail on additions the policy allows, such as a new optional property on a row. Such an error is recorded with its reason, like a deliberate break.

## How a change is made visible

The `api.txt` lists are generated: the TypeScript compiler decides what each import path exports, and Microsoft's API Extractor writes each declaration out as text. A pull request's diff therefore shows every addition and every change as a changed line, and the description check makes the author say why. The lists are committed rather than generated per pull request so that every release's tag records what it exported.

Two review agents read the same criteria: `packages/9-public/AGENTS.md`, which agents read for files under that folder, and a path instruction for `api.txt` in `.coderabbit.yml`. A person still approves every pull request.

## What counts

Only what is GA is checked strictly. A package counts as GA when its version at the last release has no pre-release part. An export counts unless its name starts with `preview_` or `ea_`. The rule follows from what is checked: nothing needs switching on at `8.0.0`.

The last release is the version under the registry's `latest` dist-tag for `@prisma/orm-postgres`, with its git tag `v<version>`. A package with no published version equal to it has no release yet and is not checked.

## Recording a deliberate break

A break in a GA export is an exception to the policy, and a user learns of it from the release notes. It is recorded beside the package's `api.txt`, in `api-breaks.json`:

```json
[{ "path": "./builder", "export": "Db", "release": "8.1.0", "reason": "Join scopes merge by name; see the release notes" }]
```

The generator writes `// @ts-expect-error <reason>` above that export's test, so once the break is undone the unused directive fails the compile and the record must go. A record for an earlier release describes a break users already have; it is skipped and listed as removable, so publishing a release never fails open pull requests. The example apps keep their own records in `examples/last-release-errors.json`, identified by app, file, line and error code, which stay valid for as long as one tag is the last release.

## Consequences

- A break in a GA export cannot merge unless someone writes down why. A new export cannot merge unless the description names it.
- Every change to an exported declaration costs a line in a generated file, and some lines change without an API change: a non-exported type renumbered (`Options_2`), an outside type that gains its package prefix. The description check counts those too; one line naming the package with a reason covers all of a package's changes.
- The type tests install a release from the registry on every run. They depend on the registry being reachable, and use about a minute and up to 3 GB of memory for the largest package.
- When the last release moves forward, its records stop applying and are listed as removable.

## What the checks do not see

- **Brands.** A branded string is compared as a string, so swapping one brand for another is not seen.
- **Generic functions and overloads.** A generic function is compared at its constraints, and an overloaded function by its last signature.
- **Very deep types.** When TypeScript reports "type instantiation is excessively deep", the comparison is reported as undecided, neither a break nor a pass. A real break inside such a type is not seen.
- **Result types the example apps do not exercise.** Coverage grows by adding type tests to the apps. A query whose result can be `null` is not exercised today.
- **Behaviour.** Runtime behaviour, error codes, command output and file formats are outside these checks.

## Alternatives considered

- **Comparing the text of the lists**, as Go compares `api/go1.*.txt`. Text cannot tell an added optional parameter from a removed one without a person reading every changed line, so every change needs an entry in an exceptions file. AWS CDK's grew to about 4,200 lines.
- **Fluid Framework's method as it is.** Its `TypeOnly` helper erases every function signature, so it checks only that functions exist; on our packages it missed every planted signature change and a real break. It then tests both directions and needs each interface tagged as sealed or as input, which our one-direction test does not.
- **API Extractor's own reports as the committed files**, as Angular and Backstage do. Here they total 260,000 lines and repeat one declaration in up to 40 files.
- **Only type tests and example apps, with no list**, as the database and type libraries we looked at do. Nothing in that approach notices an accidental export.
- **Compiling the example apps from the pull request's branch.** The pull request can change the app to fit its own break.
- **Recording which interfaces users implement.** Not needed: the exported functions that accept an interface already decide it.
