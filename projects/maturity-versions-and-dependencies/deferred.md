# Deferred

Work this project found and did not do, with the reason and where it is recorded.

## The init contribution's driver list repeats the manifest

A target package names its database driver twice: as a required peer dependency in its `package.json`, and in the `peerPackages` field of the init contribution it exports. Since slice 1, `prisma orm init` adds every required peer from the manifest, so for every target package in this repository the field adds nothing after the target package is installed. `init` still needs a driver's name before the target package is installed, and it gets that from its list of known target packages, not from the contribution.

Removing the field changes an interface that target packages outside this repository implement. That is a decision for the operator, not a clean-up. Raised when slice 1 was handed over.

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
