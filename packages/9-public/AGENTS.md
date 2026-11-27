# Published packages: reviewing API changes

Every package in this folder is published. Each has a generated `api.txt` beside its `package.json`, which lists everything a user can import from it: one line for each export of each import path, and one for each of its members. A pull request that changes what users can import changes these files. How the checks work, and how a contributor fixes a failure, is in `docs/Public API Compatibility.md`.

## Why you look closely

A pull request can harm users in two ways without anyone meaning to. The promise this protects, and the checks, are in the decision record `docs/architecture docs/adrs/ADR 336 - CI finds breaking and accidental API changes against the last release.md`.

- **An accidental addition.** Once a release exports something, users can depend on it, and removing it later is a break. Every new line in an `api.txt` adds to what we must keep.
- **A break.** A removed export, a narrower parameter, a wider return type, or a new required member on an interface that users implement stops existing code compiling.

CI already checks that the lists match the code, that the description names each changed export, and that code written against the last release still compiles. It fails on every break that is not recorded as deliberate. What CI cannot judge is whether a change is one we want. That is your review.

An API that may still change has its maturity level at the start of its name: `ea_`, `preview_` or `rc_`, capitalised on a type or class, as in `Ea_Search`. CI lets such an API break.

## An `api.txt` change

For each added export or member:

- Is it meant for users, to be kept until the next major version? If it exists only so another of our packages can reach it, it should not be exported from a package users depend on. Say so.
- Is its level right? An API that may still change belongs under a name that starts with a level.
- Is a new member on an interface that users implement optional, with the old behaviour when it is missing? A required one breaks every implementation.

For each removed or changed line:

- Does the export's name carry a level? Then the change is allowed. Say so.
- Is it an old name left by a promotion, such as a deprecated `ea_search` beside `search`? That name must be kept until the next major version, and removing it is a break.
- Otherwise, is the break recorded with a reason in the package's `api-breaks.json`, and will the release notes name it?
- Did the line change only because a `(not exported)` type was renumbered (`Options_2`), or a third-party type gained its package prefix? That is not an API change. Say so, so nobody spends time on it.

The description's `## API changes` section must name each changed export and say why. If a reason does not match the change, say so.

## A change to a record

Three files hold records: a package's `api-breaks.json`, `packages/9-public/removed-packages.json`, and `examples/last-release-errors.json`. Each record accepts one thing CI would otherwise fail on. A new record is a decision to let it through, so review it as one.

- **`kind: break`** breaks users' code. Is the reason one a user would accept, and is the break in the release notes?
- **`kind: allowed`** claims the promise permits the change. Either it is safe for users: a new optional property that fails an example app's exact type assertion, or a wider return type on a method of an interface that users only implement. Or it breaks only an API with a level that CI cannot recognise as one, such as a member named `preview_run`. Check which, and that it is true. A record that calls a real break allowed hides it from users.
- **A record replaced with a new `fingerprint`** means the export, or a type it uses, changed again. The new record covers whatever the job reports now, which may be a different break behind the same message. Look at the break the job reports for the current code, not only at the reason, which is often copied unchanged.
- **A record in `examples/last-release-errors.json` replaced with a new `message`** means the app's error changed. Compare the new message with the old one, and check that the reason still fits.
- **A removed record** means the break it covered is gone, or a newer release has become the last release. Both are fine.

When you cannot tell whether users implement a type or only receive it, ask. Do not guess.
