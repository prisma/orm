# Plan: Better Auth works with Prisma 8

**Spec:** [spec.md](spec.md)
**Linear project:** [P-TML-1174](https://linear.app/prisma-company/project/better-auth-works-with-prisma-8-6d06f95f118b)

One pull request. Its first merge publishes the package, so a partial first step would ship to users, and the adapter's tests are built on the same code that prints PSL for `auth generate`.

## Pull request

[TML-3912](https://linear.app/prisma-company/issue/TML-3912). Branch `tml-3912-better-auth-adapter`.

- **Outcome:** `@prisma/better-auth-adapter` exists, passes Better Auth's conformance suites on Postgres and SQLite, reports an incomplete contract through the contract check and `auth generate`, and has an example application and a README.
- **Builds on:** `main`.
- **Hands on:** the project's definition of done, less the ADR, which is written at close-out.

## Steps inside the pull request

Each step is one piece of work for the implementer, reviewed before the next starts. Decision numbers are the spec's.

1. **The package and what the contract must hold.** The package skeleton and the repository tooling changes of decisions 1 to 6; the comparison, the codec table, the message and the printed PSL of decisions 30 to 34, 41 and 42 as functions inside the package; test helpers that turn printed PSL into a database on SQLite and Postgres; the decision 30, 31, 32 and 42 rows of the test table.
   - *Hands on:* a package that builds, lints and is registered everywhere the repository requires; `render(tables, options)` proven to emit and apply for every first-party plugin schema.
2. **The adapter.** Decisions 7 to 29: lookup, calls, filters, joins, transactions. The conformance harness on both databases and the rows of the test table for decisions 9 to 28.
   - *Builds on:* step 1's PSL and test helpers.
   - *Hands on:* seven suites green on both databases with no test disabled.
3. **The contract check and `auth generate`.** Decisions 35 to 43 and their test rows; the complete README.
   - *Builds on:* steps 1 and 2.
4. **The example, the packaging test and the docs.** `examples/better-auth/` with its two tests, the packaging test, the naming conventions page, the application declaration under `upgrade-instructions/pending/`, and every lint in the definition of done.
   - *Builds on:* step 3.

After step 4: a full review of the branch tip by two reviewers (system design and code), fixes, manual QA of the example and of `auth generate` by hand, then the pull request opens as a draft until the npm package name is confirmed.

## Dependencies

- **npm.** `@prisma/better-auth-adapter` must exist on npm with a trusted publisher for this repository's publish workflow before the pull request merges. Owner: the operator, or whoever they name with rights on the `@prisma` scope. Users can install the package from the first release after the merge.
- **Better Auth.** Tested against 1.7.27. The peer range excludes 1.8 until the suites pass against it.

## Follow-ups filed outside this project

- [TML-3913](https://linear.app/prisma-company/issue/TML-3913): the SQLite driver blocks the process while waiting for a locked database.
- [TML-3914](https://linear.app/prisma-company/issue/TML-3914): a comparison or ordering a field's type does not support throws a bare `TypeError`; booleans cannot be ordered.

Other deferred work is in [deferred.md](deferred.md).

## Close-out (required)

- [ ] Verify the definition of done in [spec.md](spec.md) with evidence.
- [ ] Write the ADR: a library outside Prisma is integrated through published entrypoints, with its models in the application's contract.
- [ ] Final retro.
- [ ] Strip repository references to `projects/better-auth-adapter/**`.
- [ ] Delete `projects/better-auth-adapter/`.
