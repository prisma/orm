---
changes:
  - id: init-reaches-a-target-package-by-name
    summary: |
      `prisma orm init --target <package name>` sets up a project on any target package that exports an init contribution from its `init` entrypoint. The package needs no entry in any list of Prisma's. `@prisma/orm-sqlite` and `@prisma/orm-mysql` now export one. A package without an `init` entrypoint is not affected.
---

# `init` reaches a target package by its name

```bash
prisma orm init --target prisma-orm-acmedb --authoring psl
```

## `init-reaches-a-target-package-by-name`

This applies to a package that adds a target and exports an init contribution, or wants to. Nothing changes for a package that does not. The guide for the whole package is `references/build-a-target-package.md` in the `prisma-8` skill.

Check these against your package:

- **The package name.** For a package that is not in Prisma's list of short names, `--target` accepts its name as published, with no version or tag, when the name is scoped (`@acme/prisma-orm`) or begins `prisma-orm-` (`prisma-orm-acmedb`). `init` refuses any other value before it changes anything, so an unscoped package with another name cannot be set up with `init`.
- **The first install.** `init` does not know your drivers before your package is installed, and it does not read the registry. It installs your package and `dotenv`, and the package manager handles your required peer dependencies its own way. A package manager set up to refuse a package whose peers are missing fails that install, and `init` reports the failure. After loading your contribution, `init` declares its `peerPackages` in a later install. Your `init` entrypoint is loaded between the two installs, so it must load without the drivers present.
- **Other required peers.** `init` installs only `peerPackages`. Tell your users in your README about any other peer your package requires.
- **`--json`.** The result reports your package name as both `target` and `package`.
- **Prisma 7 schemas.** `init` maps the provider of a Prisma 7 schema to a target package through Prisma's list only. In a project with a Prisma 7 schema, `--target <your package>` sets up a fresh contract and leaves the schema alone, and `--from-prisma7-schema` with `--target <your package>` is refused.
