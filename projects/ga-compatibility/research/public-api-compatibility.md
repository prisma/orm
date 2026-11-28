# Research: how other projects detect a break in their public API before release

Every claim was checked against the source linked beside it. "Not confirmed" at the end lists what was not checked. Nothing here is a decision or a proposal for Prisma.

## 1. A generated API file committed to the repository

A tool writes the public API to a text file, and the file is committed. CI fails if the file no longer matches the code, so an API change shows in the pull request diff.

- **Go.** `api/go1.*.txt` lists "API features, one per line", "frozen once a version has been shipped"; `api/next/` holds "the only files intended to be mutated" ([README](https://raw.githubusercontent.com/golang/go/master/api/README)). The check fails with "API differences found" ([test](https://raw.githubusercontent.com/golang/go/master/src/cmd/api/main_test.go)). An intentional change adds `api/next/<issue>.txt`, each line ending in the proposal issue number. `except.txt` lists features that may disappear.
- **Microsoft API Extractor** `.api.md` reports. A local build updates the report; a CI build "does not automatically update the report file", so it fails until the new report is committed ([docs](https://api-extractor.com/pages/overview/demo_api_report/)).
  - **Fluent UI**: "In PR builds, the task will fail if it detects missing API file updates." ([docs](https://github.com/microsoft/fluentui/blob/master/docs/react-v9/contributing/api-extractor.md))
  - **Azure SDK for JS**: reports committed under each package's `review/` folder ([config](https://raw.githubusercontent.com/Azure/azure-sdk-for-js/main/api-extractor-base.json)).
  - **tldraw**: commits `api-report.api.md` and has an `api-check` script ([package.json](https://raw.githubusercontent.com/tldraw/tldraw/main/package.json)).
  - **Angular**: commits `goldens/public-api/core/index.api.md` plus one folder per subpath ([directory](https://github.com/angular/angular/tree/main/goldens/public-api/core)); a script tests targets tagged `api_guard` and has an `accept` step ([manage.js](https://raw.githubusercontent.com/angular/angular/main/goldens/public-api/manage.js)); its checker uses API Extractor ([source](https://raw.githubusercontent.com/angular/dev-infra/main/bazel/api-golden/test_api_report.ts)).
- **Kotlin binary-compatibility-validator.** `apiDump` writes `.api` files to commit; `apiCheck` compares the build with them ([repo](https://github.com/Kotlin/binary-compatibility-validator)). Used by kotlinx.coroutines. Covers binary changes only.
- **Rust `cargo public-api`.** Can snapshot the API into a committed file or diff against a published version; needs a nightly toolchain ([repo](https://github.com/cargo-public-api/cargo-public-api)).

What it misses: behaviour. It records names and signatures.

## 2. Comparing the build with the last published release

No file is committed. CI diffs the candidate against a released artifact.

- **Rust `cargo-semver-checks`** uses crates.io for the previous version ([repo](https://github.com/obi1kenobi/cargo-semver-checks)). Run by cargo's own CI ([workflow](https://raw.githubusercontent.com/rust-lang/cargo/master/.github/workflows/main.yml)) and by Tokio ([workflow](https://raw.githubusercontent.com/tokio-rs/tokio/master/.github/workflows/ci.yml)). It misses some type changes, generics and lifetimes.
- **Elm.** `elm publish` diffs old and new docs and rejects a wrong version number; `elm bump` picks the version ([source](https://raw.githubusercontent.com/elm/compiler/master/terminal/src/Publish.hs)).
- **Java japicmp**, used by the Apache Commons parent POM ([pom](https://raw.githubusercontent.com/apache/commons-parent/master/pom.xml)); **Revapi**, used by Netty ([pom](https://raw.githubusercontent.com/netty/netty/4.2/pom.xml)).
- **.NET package validation** against a baseline version; intentional breaks go in a committed `CompatibilitySuppressions.xml` ([docs](https://learn.microsoft.com/en-us/dotnet/fundamentals/apicompat/package-validation/baseline-version-validator)). Used by dotnet/runtime.

No established TypeScript tool of this kind was found.

## 3. Type-level tests for TypeScript libraries

- Tools: **tsd** ([repo](https://github.com/tsdjs/tsd)), **Vitest** `expectTypeOf` ([docs](https://vitest.dev/guide/testing-types)), **dtslint** `$ExpectType` ([repo](https://github.com/microsoft/DefinitelyTyped-tools/tree/main/packages/dtslint)), **TSTyche** ([site](https://tstyche.org/)).
- **DefinitelyTyped** "only tests packages on versions of TypeScript that are less than 2 years old" ([README](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/README.md)).
- Libraries that test several TypeScript versions:
  - **TanStack Query**: scripts `test:types:ts57` to `ts71` ([package.json](https://raw.githubusercontent.com/TanStack/query/main/packages/query-core/package.json)).
  - **Zod**: CI matrix `typescript: ["5.5", "6", "latest"]` ([workflow](https://raw.githubusercontent.com/colinhacks/zod/main/.github/workflows/test.yml)).
  - **Kysely**: type tests with tsd, also run on `~5.4.0`, `~5.8.0`, `~5.9.0` ([workflow](https://raw.githubusercontent.com/kysely-org/kysely/master/.github/workflows/test.yml)).
  - **Effect**: `tstyche --target '>=5.9'` ([package.json](https://raw.githubusercontent.com/Effect-TS/effect/main/package.json)).
- No multi-version matrix found in the workflows read for tRPC and Drizzle.

What it misses: anything the tests do not assert.

## 4. Marking individual APIs as stable or unstable

- **API Extractor release tags** `@public`, `@beta`, `@alpha`, `@internal`; trimmed type rollups per level ([docs](https://api-extractor.com/pages/setup/configure_rollup/)); the message `ae-incompatible-release-tags` fires when a signature references a less visible tag ([docs](https://api-extractor.com/pages/messages/ae-incompatible-release-tags/)).
- **Kotlin `@RequiresOptIn`**: using the API without `@OptIn(...)` is a compile error by default ([docs](https://kotlinlang.org/docs/opt-in-requirements.html)).
- **Rust standard library**: `#[unstable]` and `#[stable]`; users need `#![feature]` on a nightly compiler ([guide](https://rustc-dev-guide.rust-lang.org/stability.html)).
- **Node.js stability index**, levels 0 to 3; experimental "is not subject to semantic versioning rules" ([docs](https://nodejs.org/api/documentation.html)).
- **React**: APIs starting with `unstable_` are excluded from major-version rules ([policy](https://react.dev/community/versioning-policy)).
- **AWS CDK**: new constructs ship in separate packages with an "Alpha" suffix ([docs](https://docs.aws.amazon.com/cdk/v2/guide/versioning.html)).
- **Java preview features** need `--enable-preview` at compile time and run time ([docs](https://docs.oracle.com/en/java/javase/21/language/preview-language-and-vm-features.html)).

## 5. Changes that break code without removing anything

- **Rust RFC 1105**: adding an enum variant is a major change; adding a trait item without a default is major, with a default is minor ([RFC](https://rust-lang.github.io/rfcs/1105-api-evolution.html)). `#[non_exhaustive]` makes a new variant non-breaking by forcing a wildcard arm ([reference](https://doc.rust-lang.org/cargo/reference/semver.html)).
- **Go 1 compatibility**: new struct fields break unkeyed literals; a new method can conflict through embedding, "We cannot protect against this rare case" ([doc](https://go.dev/doc/go1compat)).
- **AWS CDK**: interfaces are "stable for consumers, but not for implementors" ([docs](https://docs.aws.amazon.com/cdk/v2/guide/versioning.html)).
- **SemVer for TypeScript Types** (semver-ts.org, 1.0.0-beta.4; Ember commits to it in [RFC 730](https://rfcs.emberjs.com/id/0730-semver-for-ts/)): breaking changes include a new required property on a type consumers construct, a new required argument, and a return type that gets wider ([spec](https://www.semver-ts.org/formal-spec/2-breaking-changes.html)). Dropping a TypeScript version is breaking unless it is outside a declared rolling support window.

## Fit for a TypeScript repository with about 20 packages and about 1,000 subpath entrypoints

- API Extractor "does not currently support analysis of multiple entry points" ([docs](https://api.rushstack.io/pages/api-extractor-model.apientrypoint/); [issue 1596](https://github.com/microsoft/rushstack/issues/1596) is open). Each subpath needs its own run.
- Angular's wrapper reads `package.json` `exports` and commits one report per subpath ([source](https://raw.githubusercontent.com/angular/dev-infra/main/bazel/api-golden/find_entry_points.ts)).
- Type-test tools can import any subpath the compiler resolves. tsd fixes `moduleResolution`, which affects subpath resolution.

## Not confirmed

- That Azure SDK for JS CI fails on a stale report.
- Java incubator modules; the Next.js `unstable_` policy.
- Which large crates run `cargo public-api` in CI.
- API Extractor's `additionalEntryPoints` option.
- semver-ts.org rules on union members and on interfaces users implement.
