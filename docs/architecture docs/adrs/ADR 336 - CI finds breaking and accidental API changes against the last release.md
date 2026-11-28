# ADR 336 — CI finds breaking and accidental API changes against the last release

**Status:** Accepted
**Date:** 2026-11-27
**Domain:** Guardrails & CI
**Related:** [ADR 341 — A set of values that may grow is open, and its type says so](ADR%20341%20-%20A%20set%20of%20values%20that%20may%20grow%20is%20open%2C%20and%20its%20type%20says%20so.md) (which sets may gain a value, checked by `pnpm api:sets`), [ADR 242 — Public npm surface](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md) (which packages are published), [Versioning](../../oss/versioning.md) (the compatibility promise, maturity levels, and how a release is versioned), [Public API compatibility checks](../../Public%20API%20Compatibility.md) (the contributor guide)

---

## At a glance

A pull request makes the options of `createCacheMiddleware` required:

```diff
-export function createCacheMiddleware<TMeta = unknown>(options?: CacheMiddlewareOptions<TMeta>): CacheMiddleware<TMeta>;
+export function createCacheMiddleware<TMeta = unknown>(options: CacheMiddlewareOptions<TMeta>): CacheMiddleware<TMeta>;
```

Every application that calls `createCacheMiddleware()` would stop compiling when it upgrades. No reviewer has to spot the missing `?`. CI compares the build with the last release and fails:

```text
  break  @prisma/orm-extension-middleware-cache: createCacheMiddleware (value): Type 'undefined' is not assignable to type 'CacheMiddlewareOptions<TMeta>'.
```

A second pull request changes the type a query returns. No exported declaration changes, so the comparison above finds nothing. But the example apps from the last release assert their result types, and one of them no longer compiles against the build:

```text
prisma-8-demo: 1 error in 1 file (recorded: 0 allowed, 0 breaks); 3.3 s — FAILS
  test/codec-id-ergonomics.types.test-d.ts: 1
    test/codec-id-ergonomics.types.test-d.ts(14,55): TS2344 Type '"pg/timestamptz-temporal@1"' does not satisfy the constraint '"Expected: literal string: pg/timestamptz-temporal@1, Actual: string"'.
```

A third pull request adds an export. Nothing breaks, so no comparison with the last release can find it. But each published package commits a generated list of its API, `api.txt`, and that list gains a line. Each line starts with the import path, here `@prisma/orm-family-sql/relational-core/ast`:

```diff
+./relational-core/ast: function buildJoinPlan(query: SelectAst): JoinPlan
```

CI posts the changed lines as a comment on the pull request. The author sees the new line, and either removes an export that was an accident, or names it in the pull request's description and says why it is meant. CI fails until the description has that entry:

```markdown
## API changes

- `@prisma/orm-family-sql/relational-core/ast: buildJoinPlan`: exported for the Mongo family, which plans joins the same way.
```

## Decision

CI checks every pull request for changes that would break code written against the last release, in three ways.

| Check | What it catches | How | When it fails |
| --- | --- | --- | --- |
| Type tests | A changed declaration: an export removed, a parameter narrowed, a required member added to an interface users implement | For each export of the last release, a generated test asks TypeScript whether the current export can stand where the old one stood | On a break nobody has recorded |
| The last release's example apps | A changed query result type, which is computed from the user's contract and can change while no declaration does | The apps under `examples/`, as they were at the last release, are compiled against the current build | On an error nobody has recorded |
| The API list and the description | A new or changed export, including one made by accident | Each package commits a generated `api.txt`. A pull request that changes one must name each changed export in its description, with a reason | Until the description names each change |

Four rules complete the decision:

- **The last release** is the newest release tag at or below the version in the root `package.json` of the branch the pull request merges into. Development builds do not count, and the registry's `latest` tag is not consulted.
- **A break fails unless it is recorded as deliberate,** with a reason, in a file beside the package. The record stops applying when the export changes again.
- **An API whose name carries a maturity level may break.** A break in an export named `ea_…`, `preview_…` or `rc_…` is listed and never fails, with one exception described under [Names that carry a level](#names-that-carry-a-level).
- **A check that could not compare fails.** A registry that cannot be reached, or a package that cannot be read, must not look like a pass.

Whether a failing check blocks a merge is set in the repository's branch rules, outside the code.

A comparison in the type tests ends in one of four ways. The rest of this record uses these words, and so does the job's report:

| Result | Meaning | Effect on the job |
| --- | --- | --- |
| Pass | TypeScript accepts the current export where the last release's stood | None |
| **Break** | It does not, and the check has confirmed that the failure is real ([below](#when-typescript-cannot-settle-a-comparison)) | Fails, unless recorded |
| **Undecided** | TypeScript cannot settle the comparison | None. It is listed, so a person can look |
| **Not compared** | The test would pass whatever the export is, so it proves nothing. The usual cause is a generic type ([below](#the-test)) | None. It is listed |

## Why

The [versioning policy](../../oss/versioning.md#what-stays-compatible) promises that, from release 8.0, an application built on what is generally available upgrades to any later `8.x` release without changing its code. A record of kind `break` is then an exception to that promise, which the release notes must name. A release candidate makes users no such promise. But a break in one should still be a decision someone made, so the checks apply to every release, release candidates included, and a record is how the decision is written down. That also proves the checks on real changes.

Three kinds of change go unnoticed without a check, and each needs a different one.

- **A changed declaration** stops existing code compiling. The compiler is the best judge of that, given the old declarations and the new ones.
- **A changed result type.** The type of a query's result is computed from the user's contract and the query. It can change while every exported declaration stays the same, so only real code against a real contract shows it. The example apps are that code.
- **An accidental export.** Once a release exports something, users can depend on it, and removing it later is a break. An addition breaks nothing, so no test against the last release can find it. A person has to see it, and the list makes it visible.

## How the type tests work

The method adapts the one Microsoft's Fluid Framework uses: install the previous release, generate one compile-time test per export, and record deliberate breaks. How two types are compared is different, as described below.

### The test

The last release of each package is installed from the registry under an alias, beside the current build. For `createCacheMiddleware` the generated file contains:

```ts
import type * as r0 from 'release-orm-extension-middleware-cache';
import type * as c0 from 'current-orm-extension-middleware-cache'; import * as cv0 from 'current-orm-extension-middleware-cache';

cv0.createCacheMiddleware;
type t18 = [requireAssignableTo<typeof c0.createCacheMiddleware, typeof r0.createCacheMiddleware>, requireAssignableTo<IsNeverOrAny<typeof r0.createCacheMiddleware>, false>];
```

`requireAssignableTo<A, B>` compiles only when `A` is assignable to `B`. So the test compiles only when the current function can be used wherever the last release's could. The line `cv0.createCacheMiddleware;` uses the export as a value, because an export turned into a type-only export would otherwise pass. That is the `(value)` in the report. A type export gets a `(type)` test without `typeof`.

A generic type, interface or class has to be given type arguments before it can be compared. Each type parameter gets its default, or `never` when it has none, because any other argument would be a guess at how users fill it in. That has a cost. Many generic types evaluate to `never` when their parameter is `never`:

```ts
// in @prisma/orm-family-mongo/codec
type MongoCodecInput<T> = T extends MongoCodec<string, readonly MongoCodecTrait[], unknown, infer TInput, unknown> ? TInput : never;
// MongoCodecInput<never> is never
```

`never` is assignable to `never`, so the test would pass whatever `MongoCodecInput` really does. The second assertion in the tuple, `IsNeverOrAny`, finds this case, and the case of a release type of `any`, to which everything is assignable. Such a test is reported as not compared. A generic function needs no arguments: TypeScript compares the two generic signatures itself.

### One direction, which tests a type in both of its roles

The test asks only whether the current export is assignable to the last release's. Fluid Framework asks in both directions, and needs every interface tagged by hand as one users implement or one they only receive. One direction makes the tags unnecessary, because each type is tested in both roles by different tests:

- **The type's own test** treats it as something users receive and use. A method that now returns a wider type fails here.
- **The test of each exported function that accepts the type** treats it as something users supply. Suppose `CacheStore`, which users implement, gains a required `clear()`. Its own test passes, because a type with more members still fits where the old one did. But `createCacheMiddleware` accepts a `CacheStore`, and no longer accepts a store written without `clear()`, so the function's test fails.

The cost is that the check cannot know which role a type really has. A change that is safe in the type's real role can fail the test for the other role. A wider return type on a method of an interface that users only implement is safe for them, and fails the interface's own test. Such a report is [recorded](#recording-a-break-that-is-meant) with kind `allowed`. A list of which interfaces users implement would avoid these reports, but it would go out of date without anyone noticing. A wrong report costs the author one recorded line. A missed break reaches users.

Three more tests cover what the plain comparison misses. A class's constructor parameters must accept what the last release's accepted (`constructor`). For an abstract class users can extend, a subclass written against the last release must still compile, so a new abstract member is a break (`abstract`). And the members a package adds to another package's interface with `declare module` are compared as well (`augments`).

### Comparing two copies of one package

TypeScript compares the two exports itself. That handles recursive types, such as JSON values, which a comparison written by hand cannot. But for this purpose TypeScript's comparison is too loose in one way and too strict in two. So the declaration files are rewritten, on both sides, as TypeScript reads them.

**Too loose: methods become properties.** TypeScript lets a method accept a narrower parameter than the one it replaces, so this break would pass:

```ts
interface Last { get(key: string | number): void }
interface Now  { get(key: string): void }
```

Rewritten as `get: (key: string) => void`, it fails as it should.

**Too strict: private members become one marker.** TypeScript treats two copies of a class with private members as unrelated, even when they are identical. Users cannot reach private members, so they are replaced by one property that names the class:

```ts
declare class Pool { #sockets: Socket[]; acquire(): Socket }
// is read as
declare class Pool { readonly "private @prisma/orm-target-postgres:Pool": true; acquire: () => Socket }
```

Two copies of `Pool` now match, and a different class swapped in for `Pool` does not. Protected members are kept and compared, because extensions subclass our base classes and use them.

**Too strict: unique symbols become string literals** named after their package and name, because two copies of one `unique symbol` are different symbols.

Methods are rewritten only in our own packages, because rewriting them in third-party packages would change how TypeScript compares arrays and other built-in types. Both sides also read each third-party dependency from one copy, at the version in the repository's lockfile, so a difference in a dependency is not reported as ours. A dependency installed at two versions that cannot both be pinned is left as installed, with a warning.

A marker is made from a name. So if one package declares two classes with private members, or two unique symbols, under the same name, the check cannot tell one from the other. The package's report lists that name as not compared, and every export that uses one of the two is undecided, because a pass would prove nothing. Renaming one of the two restores the comparisons.

### When TypeScript cannot settle a comparison

For some generic types, TypeScript cannot tell that two copies of one declaration are the same, and the test fails although nothing changed. This function is one:

```ts
declare function required<P extends Record<string, Arg<unknown>>>(
  shape: P,
): { [K in keyof P as P[K] extends Optional ? never : K]: OutOf<P[K]> };
```

So a failure is checked before it counts. A second copy of the last release's declarations is made, and the failing test is run again between the release and that copy, where nothing can have changed. What happens next depends on the result:

| Step | If it passes | If it fails |
| --- | --- | --- |
| 1. TypeScript compares the build with the release | Pass | Go to step 2 |
| 2. The same test, between the release and its copy | The failure in step 1 is real: **break** | TypeScript cannot compare this type across copies. Go to step 3 |
| 3. The structural comparison: a second comparison, written for this check, that compares the two types member by member through a mapped type | Proves nothing, because it fills type parameters with their constraints. Go to step 4 | **Break** |
| 4. Steps 1 to 3 again, for each member of the type | When every member passes step 1, and the type has no call, construct or index signature or symbol key, which this step cannot compare: pass, reported as "decided member by member". Otherwise undecided | A break in that member, or **undecided** when a member cannot be settled either |

A type that has no members to split into, such as a function or a union, stops after step 3 as undecided. So does anything that is too deep for TypeScript to finish.

A comparison therefore counts as a pass only when TypeScript's own comparison passed, on the whole type or on each of its members. Each package has ten minutes. A failure that could not be confirmed in that time is reported as a break, so a slow machine cannot hide one.

### Making sure the tests ran

A check like this can pass because it compared nothing. Three safeguards prevent that:

- The installed release is given a version of its own. Without it, TypeScript treats the release and the build as one package when their name and version match, and compares a type with itself.
- Every generated file ends with a line that must not compile. If it compiles, the compiler did not check the file, and the run fails.
- A type from the release that cannot be resolved would become `any` and pass everything, so an unresolved import fails the run.

### Names re-exported from another package

A database's package, such as `@prisma/orm-postgres`, re-exports most of what it offers from the packages it is built on (`export … from '@prisma/orm-family-sql/orm-client'`). The job's report calls these forwarded names. A forwarded name is only checked to still exist (`exists`). Its type is compared once, in the package that declares it.

This relies on every package being released at one version, as every release candidate is. From release 8.0 the [versioning policy](../../oss/versioning.md#version-numbers) gives each package its own version and maturity level. If `@prisma/orm-postgres` and `@prisma/orm-family-sql` were at different versions or levels, a break in `Collection` would be judged by the family package's release, not by that of the package the user imports it from. Giving packages their own versions means making this rule, and the lookup of the last release, work per package.

### Names that carry a level

An API that may still change has its [maturity level](../../oss/versioning.md#maturity-levels) at the start of its name: `ea_` (Early Access), `preview_` or `rc_` (Release Candidate), capitalised on a type or class, as in `Ea_Search`. A break in such an export is listed and does not fail.

The exception is a name left behind by a promotion. When an API is promoted, the release adds the new name and keeps the old one, deprecated, until the next major version, so that code written against the old name keeps working. The old name then stands for an API that may no longer break. So a name with a level fails like any other export when the last release also exports the same thing under a name without a level. These three forms count as the same thing:

```ts
export declare function search(query: string): Result[];
export { search as ea_search };                        // the same declaration under two names
export declare const preview_search: typeof search;    // a constant typed as the original
export type Ea_Options<T> = Options<T>;                // an alias that passes its type parameters through
```

A similar name does not count. An `ea_createClient` with its own declaration, beside `createClient`, may be a new design, and stays Early Access.

### Recording a break that is meant

Under each break, the job prints a record. The author pastes it into the package's `api-breaks.json` and writes the reason:

```json
{"path":".","export":"createCacheMiddleware","test":"value","kind":"break","lastRelease":"8.1.0","fingerprint":"b0e322358c4a297e","reason":"A cache always needs a store; see the release notes."}
```

`kind` is `break` for a deliberate break, which the release notes must name. It is `allowed` for a change the policy permits and the check reports anyway: either the change is safe for users, or it breaks only an API with a level that the check cannot recognise as one. The fingerprint covers the export's lines in `api.txt` and the lines of every type of the same package that they use. When any of them changes, the record stops applying and the break is reported again, so a record cannot hide a later, different break. A record whose export no longer breaks fails the job, so it cannot outlive its break either. Changing a record file is itself an API change, which the description must name.

## How the example apps cover result types

Each app under `examples/` imports the published packages by name, and its type tests assert exact result types against a committed contract.

The apps are taken from the last release's git tag, not from the pull request, because a pull request could change an app to fit its own break. Each app's files are extracted into a folder of its own, linked to the current build, and compiled. The committed contract files are used as they were and never emitted again, because a contract and its generated types must keep working across releases.

The apps assert exact types, so they also fail on a change that is safe for users, such as a new optional property on a result row. Such an error is recorded in `examples/last-release-errors.json`, with its reason. A record matches one error by app, file, line, code and message.

## How an API change is made visible

Each package in `packages/9-public/` has an `api.txt` beside its `package.json`, with one line for each export of each import path and each of its members:

```text
./config: function defineConfig(options: PostgresConfigOptions): PrismaConfig<'sql', 'postgres'>
./config: interface PostgresConfigOptions, readonly optional property output?: string
./orm-client: everything from @prisma/orm-family-sql/orm-client
```

The TypeScript compiler decides what each import path exports, and Microsoft's API Extractor writes each declaration as text. The lists are committed, so a pull request's diff shows its API changes, and each release's tag records what it exported. CI fails when a list does not match the build.

The description check makes the author say why each change is meant. A package name, with a reason, covers every change in that package. That is for a change that touches many lines without changing the API, such as a tool upgrade.

Reviewers, people and agents, then judge what CI cannot: whether each addition is one we want to keep until the next major version. Their criteria are in `packages/9-public/AGENTS.md`.

## Consequences

- Where the checks are required, a break cannot merge unless someone records why, and a new export cannot merge unless the description names it.
- The release notes must name each record of kind `break`. No check enforces that.
- Some reported breaks are permitted by the policy, and someone has to record them as `allowed`.
- Some changed lines in an `api.txt` are not API changes, and the description must still name their package.
- The type tests install a release on every run, so they need the registry. A full run takes several minutes, and several gigabytes of memory for the largest packages.
- When a new release becomes the last release, the records made against the earlier one stop applying, and the job lists them as removable.

## What the checks do not see

- **Behaviour.** Runtime behaviour, command output and file formats.
- **Which failure raises an error code.** A separate check, `pnpm api:compat:error-codes`, which enforces the rule in [ADR 239](ADR%20239%20-%20Errors%20are%20structural%20envelopes%20with%20dotted%20namespace%20codes.md#adoption-and-freeze-scope) that a dotted code leaves only with a record, sees only that each code that appears in the last release's published JavaScript still appears in the build's. A package recorded in `removed-packages.json` covers its codes, so a code that only such a package had may disappear without a record of its own. It finds a code wherever its text is, including places that only compare a code, such as a `case` in the command-line tool. So a code that is no longer raised, but is still compared somewhere, passes.
- **Undecided comparisons.** A break inside a comparison TypeScript cannot settle is not seen. These are mostly generic builders and clients. The example apps cover their result types, as far as the apps use them.
- **Result types the example apps do not use.**
- **Two gaps in the example-app check.** An app that the pull request deletes is skipped. And each app is compiled with the third-party dependencies the pull request installs, not those of the last release.
- **Generic types.** A generic type, interface or class is compared only with its type parameters' defaults, or `never`. A change that shows only for other type arguments is not seen, and a type that evaluates to `never` is not compared at all.
- **Some other type changes:** a property made `readonly`, and a change to a type inside a namespace that holds only types, which is listed as not compared.
- **A method users override.** If a class's method is not abstract, a subclass users write can still override it. A narrower return type on that method stops their override compiling. The check does not see it, because it treats a class as something users call, not something they extend, except for abstract members.
- **A level on a member.** Only an export's own name is read, so a member named with a level, such as `Client.preview_run`, is checked like its export. Its break fails like any other, and is recorded as `allowed`.
- **Third-party types.** Both sides use the same versions of third-party packages, so a dependency upgrade that changes what our packages expose is not seen.
- **The `exports` field.** Each package's `exports` is written by the build and committed. One that is out of date is not seen.

## Alternatives considered

- **Comparing the text of the lists**, as Go compares its `api/go1.*.txt` files. A text diff shows that a line changed, not whether the change is compatible: an added optional parameter and a removed one both change a line. Every changed line would need a person to judge it and an entry in an exceptions file.
- **Fluid Framework's method unchanged.** Its helper replaces functions with empty objects, so it checks only that each function exists. In a test with planted signature changes on our packages, it missed every one. It also needs every interface tagged by hand.
- **The structural comparison as the main one.** TypeScript gives up on deep and recursive types when they go through a mapped type: on our packages it left more than four in five comparisons undecided. It stays as step 3.
- **API Extractor's own reports as the committed lists**, as Angular commits them. For our packages they are about ten times the size of `api.txt`, and they too are compared as text.
- **Type tests and example apps only, with no list**, as Drizzle, Kysely and Zod do. Nothing would notice an accidental export.
- **Compiling the example apps from the pull request's branch.** The pull request could change an app to fit its own break.
- **A list of which interfaces users implement.** It would remove the reports that are safe for users, at the cost of a list that goes out of date without anyone noticing.
- **Failing when a package declares two classes or symbols with one name**, with a message asking for a rename, in place of undecided results. An unrelated change, or a bundler that merges two files, would then fail a pull request that did not cause it.
