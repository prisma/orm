# Deferred

Work this project found and did not do, with the reason and where it is recorded.

## The init contribution's driver list repeats the manifest

A facade names its database driver twice: as a required peer dependency in its `package.json`, and in the `peerPackages` field of the init contribution it exports. Since slice 1, `prisma orm init` adds every required peer from the manifest, so for every facade in this repository the field adds nothing after the facade is installed. `init` still needs a driver's name before the facade is installed, and it gets that from its list of known facades, not from the contribution.

Removing the field changes an interface that facades outside this repository implement. That is a decision for the operator, not a clean-up. Raised when slice 1 was handed over.

## "Target package" where the facade is meant, outside this project's changes

The facade is the package an application installs, such as `@prisma/orm-postgres`; a target package is `@prisma/orm-target-*`. Earlier work called the facade a "target package", and about 300 uses remain on `main` outside the files this project changes: the command-line tool's internal names (`target-packages.ts`, `TargetPackage`, `KNOWN_TARGET_PACKAGES`) and comments, the error reference, the versioning and CLI docs, the released upgrade guides in the `prisma-8` skill, and two published names, the subpath `@prisma/orm-framework/target-package-config` and the error codes `CLI.INIT_TARGET_PACKAGE_NOT_INSTALLED` and `_NOT_VERIFIED`. Text users read says "the package for your database", never "facade". The `--target` flag keeps its name. To be fixed in a pull request of its own, after slice 1.

## `prisma orm init` under Yarn Plug'n'Play

`init` looks for installed packages in `node_modules` folders, so it cannot find anything under Yarn's default install mode. Older than this project. Linear: TML-3940.

## Prisma Composer follows the new arrangement

Its examples and getting-started guide list only `@prisma/orm-postgres`. Linear: TML-3939.

## The command-line tool's rules

Proposed as a project of its own. See [plan.md](plan.md), "Proposed split".

## A preview build of one package installs the released versions of its peers

`pkg.pr.new` publishes a preview of each package for a pull request. It rewrites ordinary dependencies to the preview's own addresses and leaves peer dependencies alone. A preview of `@prisma/orm-postgres` therefore installs the released platform packages unless the user installs their previews too. Documented in `docs/oss/versioning.md`. It stops mattering for most cases when the packages name each other with ranges (slice 2).
