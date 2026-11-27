# Public API compatibility checks

CI checks every pull request for changes that would break code written against the last release, and for new exports nobody meant to publish. This guide says what each check does, and what to do when one fails. The promise these checks protect, and the reasons behind their design, are in [ADR 336](architecture%20docs/adrs/ADR%20336%20-%20CI%20finds%20breaking%20and%20accidental%20API%20changes%20against%20the%20last%20release.md).

## The checks

| What you see fail | Job | What it checks |
| --- | --- | --- |
| [`api.txt` is out of date](#apitxt-is-out-of-date) | `Lint` (`pnpm api:check`) | Each published package's committed `api.txt` matches the build |
| [The description does not name a change](#the-description-does-not-name-a-change) | `API changes named` | A pull request that changes an `api.txt` names each changed export in its description, with a reason |
| [A break against the last release](#a-break-against-the-last-release) | `API compatibility` (`pnpm api:compat`) | Code written against the last release still compiles against the build |
| [The last release's example apps fail](#the-last-releases-example-apps-fail) | `API compatibility` (`pnpm api:compat:examples`) | The example apps, as they were at the last release, compile against the build |

Each of them fails the job. The last release is the newest release tag at or below the version in the root `package.json` of the branch your pull request merges into, not whatever the registry tags as `latest`. A break is allowed only when you [record it](#recording-a-break-you-mean) as deliberate. A check that could not compare at all, for example because the registry was unreachable, also fails.

## `api.txt` is out of date

Each package under `packages/9-public/@prisma/` has a generated `api.txt` beside its `package.json`. It lists everything a user can import: one line for each export of each import path, and one for each member.

```text
./config: function defineConfig(options: PostgresConfigOptions): PrismaConfig<'sql', 'postgres'>
./config: interface PostgresConfigOptions, readonly optional property output?: string
./orm-client: everything from @prisma/orm-family-sql/orm-client
(not exported) interface EnumMember_2<Name extends string, Value>
```

To fix the failure, run `pnpm build`, then `pnpm api:update`, and commit the changed lists. Never edit an `api.txt` by hand. After a merge conflict in one, rebuild and run `pnpm api:update` again; do not merge the file by hand.

If `pnpm api:update` changes nothing on your machine and CI still fails, the usual cause is a stale local build. If a clean build gives the same lists, the scripts have a bug: download the `api-lists` artifact from the failed run and compare it with your files.

Some lines change although the API did not:

- A type that is not exported, but appears in a signature, is listed as `(not exported)`. When two such types share a name, the later ones get a number (`EnumMember_2`), so adding one can renumber others.
- A declaration exported under several names is referred to by the name that sorts first.
- A third-party type whose name the package also exports is written with its package, such as `mongodb.MongoClient`. Adding an export can therefore add that prefix on other lines.

## The description does not name a change

When your pull request changes an `api.txt`, a comment appears on it with the added and removed lines. On a pull request from a fork there is no comment, and the same text is in the job's summary.

````markdown
## Public API changes

This pull request changes the `api.txt` list of 1 package. Its description needs a section headed `## API changes` that names each export below, in backticks, on a line that says why it changes. …

```markdown
## API changes

- `@prisma/orm-extension-middleware-cache: createCacheMiddleware`:
```
````

The `API changes named` job fails until the description has that section, with a reason after each name:

```markdown
## API changes

- `@prisma/orm-extension-middleware-cache: createCacheMiddleware`: options are required, because a cache always needs a store.
- `@prisma/orm-family-sql`: regenerated after the TypeScript upgrade; no API change.
```

The second line shows the short form: a package name covers every change in that package. Use it for a change that touches many lines without changing the API, such as a tool upgrade. The failure message lists the names that are still missing. Editing the description runs the job again.

Reviewers read this section to decide whether each addition is one we want to keep until the next major version. Their criteria are in [`packages/9-public/AGENTS.md`](../packages/9-public/AGENTS.md).

## A break against the last release

The `API compatibility` job installs the last release of each package beside your build. For each export of the last release, it asks TypeScript whether your version can be used wherever the old one could. When it cannot, the job reports a break:

```text
@prisma/orm-extension-middleware-cache: 16 exports on 1 paths; 16 comparisons, and 0 forwarded names checked only for existence (they are compared in the package that declares them); breaks 1, undecided 0, not compared 0, recorded 0; 0.9 s, 588 MB — FAILS
  break  @prisma/orm-extension-middleware-cache: createCacheMiddleware (value): Type 'undefined' is not assignable to type 'CacheMiddlewareOptions<TMeta>'.
    to record it: {"path":".","export":"createCacheMiddleware","test":"value","kind":"break","lastRelease":"8.1.0","fingerprint":"b0e322358c4a297e","reason":"…"}
    the fingerprint is taken from the package’s api.txt as it is on disk: run pnpm build and pnpm api:update first, or it will not match
```

The break line names the package and import path, the export, the test that failed in brackets, and TypeScript's message.

Each export gets one or more of these tests:

| Test | What it compares |
| --- | --- |
| `type` | The type itself |
| `value` | The function, constant or class as a value. It also fails when a value becomes a type-only export |
| `constructor` | The parameters of a class's constructor |
| `abstract` | What a subclass of an abstract class must implement |
| `augments` | A member the package adds to another package's interface with `declare module` |
| `exists` | A name re-exported from another of our packages is still exported |
| `path` | An import path is still there |

TypeScript's message can contain names the check itself writes. `MembersNew<…>` and `MembersOld<…>` wrap your type and the last release's. A key such as `"private @prisma/orm-family-sql:Pool"`, `"protected name"` or `"unique symbol @prisma/orm-family-sql:brand"` stands for a private member, a protected member or a unique symbol.

What is a break:

- Removing an export, narrowing a parameter, making an optional parameter required, or widening a return type is a break.
- Adding an optional parameter or an optional property is not.
- A new member on an interface that users implement is a break unless it is optional. A new member on a type users only receive is not.

If you did not mean the break, change the code. If you did, [record it](#recording-a-break-you-mean).

### Running it yourself

Run `pnpm build`, then check the one package you changed:

```bash
pnpm api:compat --only @prisma/orm-extension-middleware-cache
```

Do not run it over all packages on your machine: by default it compares three packages at a time, and the largest need about 6 GB of memory each. CI does that run.

### The other entries in the report

Besides breaks, the report lists these entries. Only `problem` fails the job.

**`problem`** means the check could not do its work, or a record no longer matches a break and must be removed. It always fails the job.

**`undecided`** means TypeScript could not settle the comparison, so it neither passed nor failed. The word in brackets says where it stopped:

| | Why it is undecided |
| --- | --- |
| `undecided (native)` | The type is too deep for TypeScript to compare, or it came after such a type and there was no time to compile it again |
| `undecided (structural)` | TypeScript cannot relate two copies of this type, and the check's fallback, called the structural comparison, could not settle it either. The type cannot be compared member by member (it is a function, a union or a generic type alias), or one of its members cannot be related |
| `undecided (member)` | Its members passed one by one, but it also has call, construct or index signatures or symbol keys, which that comparison leaves out. Or a member was too deep, or the package's ten minutes ran out |
| `undecided (shared marker)` | The export uses one of two classes or unique symbols that have the same name in one package, which the check cannot tell apart. Renaming one of the two restores the comparison |

The job has not checked an undecided export. If your change touches one, check it yourself: add a type test that asserts the type you expect to the example app that uses it, or compile a small file that uses the export as a user would.

**`not compared`** means the test would pass whatever the export is. Most often it is a generic type that evaluates to `never` when its type parameters are filled with `never`, which is how the check fills a parameter with no default.

**`decided member by member`** is a pass. TypeScript could not compare the whole type across the two copies, so each member was compared, and all passed.

**`recorded break`** and **`recorded allowed change`** are breaks that a record covers.

**`removable record`** is a record made against an earlier release. It no longer applies and does not fail; delete it.

A closing line, `Not checked, no release <version>: …`, names packages that have never been released, so there is nothing to compare them with.

In a package's first line, "forwarded names" are names the package re-exports from another of our packages, such as `Collection` in `@prisma/orm-postgres`. They only get the `exists` test; their types are compared in the package that declares them.

## An API that may still change

An API that may still change starts its name with its maturity level: `ea_` (Early Access), `preview_` or `rc_` (Release Candidate). On a type or class the word is capitalised, as in `Ea_Search`. A break in such an export is listed as `break (maturity level, does not fail)` and never fails the job.

When you promote an API, keep the old name as a deprecated second name for the same thing, until the next major version. Code written against the old name must keep working. From the release that has both names, the check treats the old name like any other export, so removing it fails. Write the old name in one of the three forms the check recognises:

```ts
export function search(query: string): Result[] { … }

/** @deprecated Use `search`. */
export { search as ea_search };                        // the same declaration under two names

/** @deprecated Use `search`. */
export const preview_search: typeof search = search;   // a constant typed as the original

/** @deprecated Use `Options`. */
export type Ea_Options<T> = Options<T>;                // an alias that passes its type parameters through
```

Keep the `typeof` annotation on a constant. Without it, TypeScript writes out the value's type for an object or a primitive, and the check can no longer see that the two names are one thing. An `interface Ea_Options extends Options {}` is not recognised either.

A level on a member, such as a method named `preview_run` on a class, is not read: the member is checked like its class. Its break is permitted, so record it as `allowed`.

## Recording a break you mean

A deliberate break needs a reason a user would accept, and the release notes must name it.

1. Run `pnpm build` and `pnpm api:update`, so that the fingerprint in the printed record is taken from the lists you will commit.
2. Copy the record the job prints under the break (`to record it: …`) into the package's `api-breaks.json`, which is a JSON array beside its `api.txt`.
3. Replace the `…` in `reason` with one line that says why. If the policy permits the change, change `kind` to `allowed`.
4. Name the package in your description's `## API changes` section. The `API changes named` job treats a changed record as an API change.

```json
[{"path":".","export":"createCacheMiddleware","test":"value","kind":"break","lastRelease":"8.1.0","fingerprint":"b0e322358c4a297e","reason":"A cache always needs a store; see the release notes."}]
```

`kind` is `break` for a deliberate break. It is `allowed` for a change the policy permits and the check reports anyway. There are two such cases:

- The change is safe for users. The check cannot know whether users implement a type or only receive it, so it tests both. A wider return type on a method of an interface that users only implement is safe for them, and is still reported.
- The change breaks only an API with a level that the check cannot recognise as one, such as a member named `preview_run`.

A record covers the export only as it is now. `fingerprint` is taken from the export's lines in `api.txt` and from the types of the same package those lines use. When any of them changes, the record stops applying, and the break is reported again for you to judge afresh. Some changes that are not API changes also change a fingerprint: a renumbered `(not exported)` type, or an upgrade of TypeScript or API Extractor. After one of those, paste the printed record again.

Two other things are recorded the same way, each with the record the job prints: a published package that is deleted, in `packages/9-public/removed-packages.json`, and an example app's error, described next.

## The last release's example apps fail

`pnpm api:compat:examples` takes each app under `examples/` as it was at the last release's git tag, puts it in a folder of its own (`.api-examples/`), and compiles it against your build. Your own app folders are not touched. An error there is one a user would see after upgrading:

```text
prisma-8-demo: 1 error in 1 file (recorded: 0 allowed, 0 breaks); 3.3 s — FAILS
  test/codec-id-ergonomics.types.test-d.ts: 1
    test/codec-id-ergonomics.types.test-d.ts(14,55): TS2344 Type '"pg/timestamptz-temporal@1"' does not satisfy the constraint '"Expected: literal string: pg/timestamptz-temporal@1, Actual: string"'.
      to record it: {"app":"prisma-8-demo","file":"test/codec-id-ergonomics.types.test-d.ts","line":14,"code":"TS2344","message":"…","kind":"break","lastRelease":"8.1.0","reason":"…"}
```

(The `message` field holds the whole error message; it is shortened here.)

To check one app yourself, run `pnpm api:compat:examples --only prisma-8-demo`.

The apps' type tests assert exact types, so they also fail on a change that is safe for users, such as a new optional property on a result row. To accept an error, copy the printed record into `examples/last-release-errors.json`, write the reason, and set `kind` to `allowed` for a change that is safe for users or `break` for a real break. Name it in the description as `examples/<app>`.

A record matches one error by app, file, line, code and message. Unlike a break record it has no fingerprint, so it keeps matching while the error's place and text stay the same. If the message changes, the record matches nothing, which fails the job, and the job prints a new record to replace it.

## What the checks do not see

The checks compare declarations, so a reviewer is the only check for behaviour: runtime results, error codes, command output and file formats. They also miss a break inside an undecided comparison, a result type no example app uses, and a few kinds of type change. The full list is in the decision record, under "What the checks do not see".
