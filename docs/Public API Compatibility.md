# Public API compatibility checks

Once Prisma 8 is generally available (GA), an application must be able to upgrade to any later `8.x` release without changing its code. CI checks every pull request against that promise. This guide says what each check does, and what to do when one fails. The reasons behind the design are in [ADR 336](architecture%20docs/adrs/ADR%20336%20-%20CI%20finds%20breaking%20and%20accidental%20API%20changes%20against%20the%20last%20release.md).

## The checks

| What you see fail | Job | What it checks | Fails |
| --- | --- | --- | --- |
| [`api.txt` is out of date](#apitxt-is-out-of-date) | `Lint` (`pnpm api:check`) | Each published package's committed `api.txt` matches the build | Always |
| [The description does not name a change](#the-description-does-not-name-a-change) | `API changes named` | A pull request that changes an `api.txt` names each changed export in its description, with a reason | Always |
| [A break against the last release](#a-break-against-the-last-release) | `API compatibility` (`pnpm api:compat`) | Code written against the last release still compiles against the build | Once the last release is GA |
| [The last release's example apps fail](#the-last-releases-example-apps-fail) | `API compatibility` (`pnpm api:compat:examples`) | The example apps, as they were at the last release, compile against the build | Once the last release is GA |

The last release is GA when its version has no pre-release part, such as `8.1.0`. Against a pre-release, such as `8.0.0-rc.25`, the last two checks list what they find in the job summary and pass, because breaking a pre-release is allowed. A check that could not compare at all, for example because the registry was unreachable, fails at any version.

## `api.txt` is out of date

Each package under `packages/9-public/@prisma/` has a generated `api.txt` beside its `package.json`. It lists everything a user can import: one line for each export of each import path, and one for each member.

```text
./config: function defineConfig(options: PostgresConfigOptions): PrismaConfig<'sql', 'postgres'>
./config: interface PostgresConfigOptions, readonly optional property output?: string
./orm-client: everything from @prisma/orm-family-sql/orm-client
(not exported) interface EnumMember_2<Name extends string, Value>
```

To fix the failure, run `pnpm build`, then `pnpm api:update`, and commit the changed lists. Never edit an `api.txt` by hand. After a merge conflict in one, rebuild and run `pnpm api:update` again; do not merge the file by hand.

If `pnpm api:update` changes nothing on your machine and CI still fails, the scripts have a bug. Download the `api-lists` artifact from the failed run and compare it with your files.

Some lines change although the API did not:

- A type that is not exported, but appears in a signature, is listed as `(not exported)`. When two such types share a name, the later ones get a number (`EnumMember_2`), so adding one can renumber others.
- A declaration exported under several names is referred to by the name that sorts first.
- A third-party type whose name the package also exports is written with its package, such as `mongodb.MongoClient`. Adding an export can therefore add that prefix on other lines.

## The description does not name a change

When your pull request changes an `api.txt`, a comment appears on it with the added and removed lines:

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
@prisma/orm-extension-middleware-cache: 16 exports on 1 paths; 16 comparisons, …; breaks 1, undecided 0, not compared 0, recorded 0 — FAILS
  break  @prisma/orm-extension-middleware-cache: createCacheMiddleware (value): Type 'undefined' is not assignable to type 'CacheMiddlewareOptions<TMeta>'.
    to record it: {"path":".","export":"createCacheMiddleware","test":"value","kind":"break","lastRelease":"8.1.0","fingerprint":"b0e322358c4a297e","reason":"…"}
```

The line names the package and import path, the export, which comparison failed (here `value`, the function itself), and TypeScript's message. While the last release is a pre-release, the line reads `break (reported only)` and the job passes.

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

Add `--ga` to treat the last release as GA and see what would fail. Leave the run over all packages to CI: it compares three packages at a time, and the largest need about 6 GB of memory each.

### The other entries in the report

Besides breaks, the report lists entries that need no action but tell you what was not checked.

**`undecided`** means TypeScript could not settle the comparison, so it neither passed nor failed. The word in brackets says where it stopped:

| | Why it is undecided |
| --- | --- |
| `undecided (native)` | The type is too deep for TypeScript to compare, or it came after such a type and there was no time to compile it again |
| `undecided (structural)` or `undecided (member)` | TypeScript cannot relate two copies of this generic type, and comparing it member by member did not settle it either: a member was too deep, the type also has call, construct or index signatures or symbol keys, which that comparison leaves out, or the package's ten minutes ran out |
| `undecided (shared marker)` | The export uses one of two classes or unique symbols that have the same name in one package, which the check cannot tell apart. Renaming one of the two restores the comparison |

If your change touches an undecided export, check it yourself: the job has not.

**`not compared`** means there was nothing to compare. Most often the last release's type is `never` or `any`, which every type satisfies.

**`decided member by member`** is a pass that took the longer route.

**`problem`** always fails the job. It means the check could not do its work, or a record no longer matches a break and must be removed.

In the package's first line, "forwarded names" are names the package re-exports from another of our packages, such as `Collection` in `@prisma/orm-postgres`. They are only checked to still exist; their types are compared in the package that declares them.

## An API below GA

An API that is not ready to be kept until the next major version starts its name with its maturity level: `ea_` (Early Access), `preview_` or `rc_` (Release Candidate). On a type or class the word is capitalised, as in `Ea_Search`. A break in such an export is reported and never fails the job.

When you promote an API, keep the old name as a deprecated second name for the same thing, until the next major version. Code written against the old name must keep working. From the release that has both names, the check treats the old name as GA, so removing it fails. Write the old name in one of the three forms the check recognises:

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

A level on a member, such as a method named `preview_run` on a GA class, is not read: the member is checked as GA. Record its break as `allowed`.

## Recording a break you mean

A break in a GA export is an exception to the promise. It needs a reason a user would accept, and the release notes must name it.

1. Run `pnpm build` and `pnpm api:update`, so that the fingerprint in the printed record is taken from the lists you will commit.
2. Copy the record the job prints under the break (`to record it: …`) into the package's `api-breaks.json`, which is a JSON array beside its `api.txt`.
3. Replace the `…` in `reason` with one line that says why. If the change is safe for users, change `kind` to `allowed`.
4. Name the package in your description's `## API changes` section. The `API changes named` job treats a changed record as an API change.

```json
[{"path":".","export":"createCacheMiddleware","test":"value","kind":"break","lastRelease":"8.1.0","fingerprint":"b0e322358c4a297e","reason":"A cache always needs a store; see the release notes."}]
```

`kind` is `break` for a real break. It is `allowed` when the change is safe for users and the check reports it anyway. That happens because the check cannot know whether users implement a type or only receive it, so it tests both. For example, a wider return type on a method of an interface that users only implement is safe for them, and is still reported.

A record covers the export only as it is now. `fingerprint` is taken from the export's lines in `api.txt` and from the types of the same package those lines use. When any of them changes, the record stops applying, and the break is reported again for you to judge afresh. Some changes that are not API changes also change a fingerprint: a renumbered `(not exported)` type, or an upgrade of TypeScript or API Extractor. After one of those, paste the printed record again.

Two other things are recorded the same way, each with the record the job prints: a published package that is deleted, in `packages/9-public/removed-packages.json`, and an example app's error, described next.

## The last release's example apps fail

`pnpm api:compat:examples` takes each app under `examples/` as it was at the last release's git tag, puts it in a folder of its own (`.api-examples/`), and compiles it against your build. Your own app folders are not touched. An error there is one a user would see after upgrading:

```text
prisma-8-demo: 1 error in 1 file (recorded: 0 allowed, 0 breaks) — FAILS
  test/codec-id-ergonomics.types.test-d.ts(14,55): TS2344 Type '"pg/timestamptz-temporal@1"' does not satisfy the constraint …
    to record it: {"app":"prisma-8-demo","file":"test/codec-id-ergonomics.types.test-d.ts","line":14,"code":"TS2344","message":"…","kind":"break","lastRelease":"8.1.0","reason":"…"}
```

To check one app yourself, run `pnpm api:compat:examples --only prisma-8-demo`.

The apps' type tests assert exact types, so they also fail on a change that is safe for users, such as a new optional property on a result row. To accept an error, copy the printed record into `examples/last-release-errors.json`, write the reason, and set `kind` to `allowed` for a safe change or `break` for a real one. Name it in the description as `examples/<app>`.

A record matches one error by app, file, line, code and message. Unlike a break record it has no fingerprint, so it keeps matching while the error's place and text stay the same. If the message changes, the record matches nothing, which fails the job, and the job prints a new record to replace it.

## What the checks do not see

The checks compare declarations, so a reviewer is the only check for behaviour: runtime results, error codes, command output and file formats. They also miss a break inside an undecided comparison, a result type no example app uses, and a few kinds of type change. The full list is in the decision record, under "What the checks do not see".
