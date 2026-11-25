# Deferred

Work this project found and did not do, with the reason and where it is recorded.

## The init contribution's driver list repeats the manifest

A facade names its database driver twice: as a required peer dependency in its `package.json`, and in the `peerPackages` field of the init contribution it exports. Since slice 1, `prisma orm init` adds every required peer from the manifest, so for every facade in this repository the field adds nothing after the facade is installed. `init` still needs a driver's name before the facade is installed, and it gets that from its list of known facades, not from the contribution.

Removing the field changes an interface that facades outside this repository implement. That is a decision for the operator, not a clean-up. Raised when slice 1 was handed over.

## "Target package" where the facade is meant, outside this project's changes

The facade is the package an application installs, such as `@prisma/orm-postgres`; a target package is `@prisma/orm-target-*`. Earlier work called the facade a "target package", and about 300 uses remain on `main` outside the files this project changes: the command-line tool's internal names (`target-packages.ts`, `TargetPackage`, `KNOWN_TARGET_PACKAGES`) and comments, the error reference, the versioning and CLI docs, the released upgrade guides in the `prisma-8` skill, and two published names, the subpath `@prisma/orm-framework/target-package-config` and the error codes `CLI.INIT_TARGET_PACKAGE_NOT_INSTALLED` and `_NOT_VERIFIED`. Text users read says "the package for your database", never "facade". The `--target` flag keeps its name. To be fixed in a pull request of its own, after slice 1.

## Whether a GA package can go below GA again

Version numbers allow it at a new minor (`8.5.0-preview.0` sorts above `8.4.x`). It bears on what GA promises, and nobody has decided it. The release scripts refuse it and the decision record says it is not decided. For the operator, when a case arises.

## The Supabase extension's version stamp in contracts

The Supabase extension writes a version into each emitted contract. It follows the root version, which from `8.0.0` is the release number and not the package's own version. Making it the package's version would change every emitted `contract.json`, which belongs to the work on stored files, not here. Documented in `docs/oss/versioning.md`.

## Polymorphism is marked "Experimental" in the scorecard files

About twenty `scorecard*.md` files mark polymorphism as "Experimental". Under the maturity levels there is no such word: an API with a plain name inside a GA package is GA. So either polymorphism is GA with PostgreSQL at `8.0.0`, or its API gets a name that carries a lower level before then. That is a decision about one feature, for the operator, and belongs with the work that reduces the packages' exports. Raised when slice 2 was handed over.

## What a package manager writes when `init` gives it a range

From `8.0.0`, `init` passes a range for each package (`name@^8.1.0`, `name@~8.1.0-ea.0`). The install trial checked only a plain add. Whether each package manager keeps the range it is given in `package.json` is checked by hand before slice 2's pull request, and again at the first release with levels.

## `prisma orm init` under Yarn Plug'n'Play

`init` looks for installed packages in `node_modules` folders, so it cannot find anything under Yarn's default install mode. Older than this project. Linear: TML-3940.

## Prisma Composer follows the new arrangement

Its examples and getting-started guide list only `@prisma/orm-postgres`. Linear: TML-3939.

## The command-line tool's rules

Proposed as a project of its own. See [plan.md](plan.md), "Proposed split".

## A preview build of one package installs the released versions of its peers

`pkg.pr.new` publishes a preview of each package for a pull request. It rewrites ordinary dependencies to the preview's own addresses and leaves peer dependencies alone. A preview of `@prisma/orm-postgres` therefore installs the released platform packages unless the user installs their previews too. Documented in `docs/oss/versioning.md`. It stops mattering for most cases when the packages name each other with ranges (slice 2).

## For slice 3, when `8.0.0` is cut

- Set `lastReleaseCandidate` in `packages/0-shared/publish-surface/src/levels.ts` to the counter of the last release candidate. The plan needs it to move a package up to Release Candidate within `8.0` without colliding with a published version, and refuses that move while it is unset.
- The ParadeDB extension keeps its published version until it gets a fix, but its manifest's ranges on our packages follow each release. So between fixes its source manifest is ahead of what is published. Harmless; say so in the release procedure.

## A project that already lists its target package with a caret

When a project already lists a GA target package, `init` leaves that line and writes each platform package at the tilde range the target package declares. If the user's line is a caret, the lines are then not written the same way, and an update moves the target package and not the others; the package manager reports the mismatch. `init` does not rewrite a line the user wrote. The docs say to write all the lines the same way.
