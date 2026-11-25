# ADR 330 - CI finds breaking and accidental API changes against the last release

## At a glance

A pull request makes the options of `createCacheMiddleware`, in `@prisma/orm-extension-middleware-cache`, required:

```diff
-export function createCacheMiddleware<TMeta = unknown>(options?: CacheMiddlewareOptions<TMeta>): CacheMiddleware<TMeta>;
+export function createCacheMiddleware<TMeta = unknown>(options: CacheMiddlewareOptions<TMeta>): CacheMiddleware<TMeta>;
```

An application written against the last release that calls `createCacheMiddleware()` no longer compiles: TypeScript now expects one argument. Three things in CI react to the pull request:

| Check | The question it answers | What it says here |
| --- | --- | --- |
| Type tests against the last release | Does code written against the last release still compile? | A break of `createCacheMiddleware` |
| The last release's example apps | Do the example apps, as they were at the last release, still compile? | Nothing, unless an app calls it without options |
| The API list and the description check | What did this pull request change in the API, and does its author say why? | One changed line, which the description must name |

The changed line is in the package's committed `api.txt`:

```diff
-.: function createCacheMiddleware<TMeta = unknown>(options?: CacheMiddlewareOptions<TMeta>): CacheMiddleware<TMeta>
+.: function createCacheMiddleware<TMeta = unknown>(options: CacheMiddlewareOptions<TMeta>): CacheMiddleware<TMeta>
```

No reviewer had to spot the missing `?`. The compiler did.

## Decision

Every pull request is checked against the last release in three ways.

1. **Generated type tests.** The last release of every published package is installed from the registry beside the current build. For each export of the last release, a generated test asks the TypeScript compiler whether the current export can stand where the last release's stood. A test that does not compile is a break.
2. **The last release's example apps.** Each app under `examples/` is compiled as it was at the last release, with its type tests, against the current build. An error is a break.
3. **A visible list of every API change.** Each published package commits a generated `api.txt` that lists everything a user can import from it. CI fails when a list does not match the code. When a pull request changes a list, a comment shows the added and removed lines, and a check fails until the pull request's description has a section headed `## API changes` that names, in backticks and with a reason, each changed export, or the whole package when its changes are many or are only renamed internal types.

**When the first two fail.** They fail for a package whose version at the last release has no pre-release part (such as `8.1.0`), and only for an export whose name does not start with `preview_` or `ea_`, the prefixes that mark an API below general availability. For anything else they list what they find in the job summary and pass. The third check always applies, because it blocks nothing that a description cannot fix.

**The last release** is the version under the registry's `latest` tag for `@prisma/orm-postgres`, and its git tag is `v<version>`. This assumes every package is released at one version; when packages get versions of their own, the lookup becomes per package.

**A deliberate break** is recorded with the release it is measured against and its reason. A record for the last release must match a break, or the check fails, so a record cannot outlive its break. A record for an earlier release is skipped and listed as removable in the job's report.

## Why

From `8.0.0`, Prisma 8 promises that an application upgrades to any later `8.x` release with no code changes. Three kinds of change undo that promise without anyone meaning to:

- **A changed declaration.** An export removed, a parameter narrowed, a return type widened, a required member added to an interface users implement. Existing code stops compiling.
- **A changed result type.** A query's result type is computed from the user's contract and the query, so it can change while every exported declaration stays the same.
- **An accidental export.** Once a release that is generally available exports something, it must stay until the next major. A pull request that makes a helper importable without meaning to has made that promise.

Each needs its own check. The first is judged best by the compiler, against declarations. The second needs real code that uses real contracts, which is what the example apps are. The third cannot be found by any test written against the last release, because an addition breaks nothing; it needs a person to see it.

## How the type tests judge compatibility

The method adapts Microsoft's Fluid Framework, which generates one compile-time test per export of its previous release. We keep its structure: install the previous release, generate a test per export, record deliberate breaks as expected errors. We change how two types are compared, as below.

**The test.** For each export the release declares, the generator writes one line. For `createCacheMiddleware` it is:

```ts
import type * as r0 from 'release-orm-extension-middleware-cache';
import type * as c0 from 'current-orm-extension-middleware-cache';

type t4 = [requireAssignableTo<StructuralNew<typeof c0.createCacheMiddleware>, StructuralOld<typeof r0.createCacheMiddleware>>];
```

`release-…` is the last release, installed under that alias; `current-…` links to the current build. `requireAssignableTo<A, B>` compiles only when `A` is assignable to `B`. `StructuralNew` and `StructuralOld` remove what makes two copies of one declaration differ without mattering to a user. Each test is a type named after its line in the generated file, so an error maps back to its export. A type export gets the same test without `typeof`.

**Only one direction.** Fluid asks in both directions and needs every interface tagged as one users implement or one they only receive, because a new member breaks the first kind and not the second. We ask only whether the current export is assignable to the last release's, and the tags become unnecessary. A new required member on `CacheStore`, which users implement, fails through the exported function that accepts a `CacheStore`: the current `createCacheMiddleware` no longer accepts an old store, so it is not assignable to the old `createCacheMiddleware`. A new member on `CacheMiddleware`, which users only receive, passes, because a type with more members is still assignable to the old one. This relies on an exported function or type accepting the interface; one that nothing accepts cannot be implemented in any useful way.

**Signatures are kept.** Fluid's helper replaces every function and method with an empty object type, so it checks only that a function exists. Ours removes private members, unique-symbol keys and brands on primitives, and keeps call and construct signatures. It also turns each method into a property of function type. TypeScript lets a method accept a narrower parameter than the method it replaces, so with methods left as methods, this narrowing passes:

```ts
interface Last { get(key: string | number): void }
interface Now  { get(key: string): void }   // assignable to Last as a method, not as a property
```

The helper is written twice, once for each side, because when both sides use one generic alias, TypeScript compares the two by a shortcut that misses the same narrowing.

**Making sure the comparison is real.**

- The current build and the last release can have the same name and version, and TypeScript then treats them as one package and compares nothing. The installed release is stamped with a version of its own, and the run fails if TypeScript still merged any of our packages.
- The release's third-party dependencies are installed at the versions in the repository's lockfile, so that a difference in, say, `pg` is not reported as ours.
- Every generated file ends with a line that must not compile. If it compiles, the compiler did not check the file, and the run fails.
- A type from the release that cannot be resolved would be treated as `any` and pass everything; an unresolved import is reported as a failure.

**Re-exports.** A database's package, such as `@prisma/orm-postgres`, re-exports most of the import paths of the database-independent packages it is built on. A re-exported name gets only a test that it still exists; its type is compared in the package that declares it.

**Generic types.** A type parameter without a default is set to `never`, as Fluid does, because inventing arguments would mean guessing how users instantiate it. A test whose release side then resolves to `never` or `any` compares nothing and is counted as not compared.

**Comparisons TypeScript gives up on.** For some recursive types, such as JSON values, TypeScript stops with "type instantiation is excessively deep". Such a test is reported as undecided, neither a break nor a pass. Because TypeScript caches the failure and lets later tests of the same type pass unchecked, every test after an undecided one is compiled again without it.

## How the example apps cover result types

The apps under `examples/` import the published packages by name, and their type tests state exact result types against real contracts (the `contract.json` and `contract.d.ts` files that `prisma contract emit` writes from the app's contract source, which each app commits).

Compiling the apps as they are on the pull request's branch is not enough, because the same pull request can edit an app to fit its own break. So CI extracts each app's files at the last release's git tag into a folder of its own, at the same depth as in the repository, links the app's installed dependencies into it, and compiles it. The installed dependencies are links into the repository's workspace, so `@prisma/*` resolves to the current build through each package's `exports`, as it would for a user who upgraded.

The committed contracts are compiled as they were at the tag and never emitted again, because the compatibility policy promises that a contract and its generated types keep working in every later release without being emitted again.

The apps' type tests assert exact types, so they also fail on additions the policy allows, such as a new optional property on a result row. Such an error is recorded with its reason, like a deliberate break. A record names the app, file, line, error code and message, and must match exactly one error, so a later break on a recorded line is not hidden by it. The tag's files never change, so a record stays valid while that release is the last and its build's types do not change again, and records are replaced when the next release becomes the last.

## How a change is made visible

The packages in `packages/9-public/` are the ones we publish. Each has an `api.txt` beside its `package.json`, with one line for each export of each import path and one for each member:

```text
./config: function defineConfig(options: PostgresConfigOptions): PrismaConfig<'sql', 'postgres'>
./config: interface PostgresConfigOptions, readonly optional property output?: string
./orm-client: everything from @prisma/orm-family-sql/orm-client
```

The TypeScript compiler decides what each import path exports, and Microsoft's API Extractor writes each declaration out as text. The lists are committed, not generated per pull request, so a pull request's diff shows its API changes and every release's tag records what it exported.

The description check makes the author say why each change is meant. A whole package can be named with one reason, because some changes touch many lines without changing the API: the list numbers non-exported types that share a name (`Options_2`) and qualifies an outside type with its package when the package exports a type of the same name, and adding one type can shift those for others.

Review agents are told what to look for, in `packages/9-public/AGENTS.md` and in a path instruction for `api.txt` in `.coderabbit.yml`: is each addition meant to be supported until the next major, at the right maturity; does a generally available package now depend on something that is not; is a new member on an interface users implement optional; is each removal either below general availability or recorded as a deliberate break. A person still approves every pull request.

## Consequences

- A break in a generally available export cannot merge unless someone records why, and the release notes must name it. A new export cannot merge unless the description names it.
- Some changed lines are not API changes, and the description must still mention them, at least by package.
- The type tests install a release from the registry on every run, so they depend on the registry being reachable. Measured in November 2026, a run over all packages took under a minute on a laptop and up to 3 GB of memory for the largest package.
- When the last release moves forward, its records stop applying and are listed as removable.

## What the checks do not see

- **Brands.** A branded string is compared as a string, so swapping one brand for another is not seen.
- **Overloads and generic functions.** Only an overloaded function's last signature is compared, and a generic function is compared at its constraints. A generic type is compared only with `never` for parameters without a default.
- **Some modifiers.** A property made `readonly`, or a change to a `protected` member, is not seen.
- **Members of a namespace that holds only types.**
- **Third-party types.** Both sides use the same third-party versions, so a dependency upgrade that changes our API is not seen.
- **Types TypeScript gives up on.** A break inside an undecided comparison is not seen.
- **Result types the example apps do not exercise.** Coverage grows with the apps' type tests.
- **Behaviour.** Runtime behaviour, error codes, command output and file formats are outside these checks.

## Alternatives considered

- **Comparing the text of the lists**, as Go compares its `api/go1.*.txt` files. Text cannot tell an added optional parameter from a removed one, so every changed line needs a person and an entry in an exceptions file. AWS CDK's grew to about 4,200 lines.
- **Fluid Framework's method as it is.** Because its helper erases signatures, it checks only that each function exists; in a test with known signature changes on our packages it missed every one. It then needs every interface tagged by hand.
- **API Extractor's own reports as the committed files**, as Angular and Backstage commit them. For our packages they are about ten times the size of the lists and repeat one declaration in up to 40 files.
- **Only type tests and example apps, with no list**, as Drizzle, Kysely, Zod and tRPC do. Nothing in that approach notices an accidental export.
- **Compiling the example apps from the pull request's branch.** The pull request can change an app to fit its own break.
- **Recording which interfaces users implement.** The exported functions that accept an interface already decide it.
