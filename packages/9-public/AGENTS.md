# Published packages: reviewing API changes

Every package in this folder is published, and each has a generated `api.txt` beside its `package.json` that lists everything a user can import from it, one line per import path, export and member. A pull request that changes what users can import changes these files. The contributor guide is `docs/Public API Compatibility.md`.

## Why a reviewer looks closely

From `8.0.0`, Prisma 8 promises that an application upgrades to any later `8.x` release with no code changes. Two kinds of change undo that promise without anyone meaning to:

- **An accidental addition.** Once a GA release has exported something, we must keep it, unchanged in any way that breaks its users, until Prisma 9. So every new line in an `api.txt` is a commitment, not a detail.
- **A break.** A removed export, a narrower parameter, a wider return type, or a new required member on an interface that users implement stops existing code compiling. CI finds most of these against the last release, but only for what is GA, and only for declarations it can see.

CI already makes sure the lists match the code and that the pull request description names each changed export. What it cannot judge is whether the change is one we want. That is the review.

## What to check in an `api.txt` change

For each added export or member:

- Is it meant for users, to be supported until the next major release? If it exists only so that another of our packages can reach it, it should not be exported from a package users depend on; say so.
- Is its maturity right? Something not ready to be covered belongs in a package below GA, or under a name starting with `preview_` or `ea_`.
- Does a GA package now depend on something below GA? It cannot be more reliable than its dependencies, so that is a defect.
- Is a new member on an interface that users implement optional, with the old behaviour when it is missing? A required one breaks every implementation.

For each removed or changed line:

- Is the package or the export below GA? Then the change is allowed. Say which.
- If it is GA, is the break recorded, with its reason, in the package's record of deliberate breaks, and will the release notes name it? Breaking GA code within a major is an exception that needs a reason a user would accept.
- Is it a line that changed only because a non-exported type was renumbered (`Options_2`) or an outside type gained its package prefix? Those are not API changes; say so, so nobody spends time on them.

The pull request description's `## API changes` section must name each changed export and say why. If the reason given does not match the change, say so.

## What to check in a record of a break

A package's `api-breaks.json`, `packages/9-public/removed-packages.json` and `examples/last-release-errors.json` record changes that CI would otherwise report as breaks against the last release. A new record is a decision to let one through, so review it as such:

- A record of kind `break` breaks users' code. Is the reason one a user would accept, and is the break also in the release notes?
- A record of kind `allowed` claims the change is one the compatibility policy allows: for example a new optional property that fails an example app's exact type assertion, or a change to an interface that users only implement. Check that the claim is true. A record that calls a real break allowed hides it from users.
- A record replaced with a new `fingerprint` means the export, or a type it uses, changed again. The new record covers whatever that test reports now, which may be a different break with the same message. Look at the break the job reports for the current code, not only at the reason, which is often copied unchanged.
- A removed record means the break it covered is gone, or the last release has moved on. Either is fine.

Ask, rather than guess, when you cannot tell whether a type is one users implement or only receive.
