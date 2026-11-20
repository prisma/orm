---
changes:
  - id: init-target-takes-a-package-name
    summary: |
      `prisma orm init --target` takes the name of a target package, such as `--target @prisma/orm-sqlite`, beside the short names `postgres` and `mongodb`. The `--json` result gains `package`, the name of the target package, and its `target` is the package name when the package has no short name. A script that reads the result needs a change only if it accepts no `target` but `postgres` and `mongodb`.
    detection:
      glob: "**/*.{sh,bash,zsh,ts,mts,cts,js,mjs,cjs,json,yml,yaml}"
      matches:
        - 'orm init\b[^\n]*--json'
---

# `init` takes any target package by name

```bash
prisma orm init --target @prisma/orm-sqlite --authoring psl
```

`--target` is looked up among the short names (`postgres`, `mongodb` and their aliases). A value that is not one of them is taken as a package name when it is scoped (`@scope/name`) or begins `prisma-orm-`: `init` installs that package and writes the project from the init contribution it exports. `--target postgres` and `--target mongodb` do what they did before. Any other value is refused with `CLI.INIT_INVALID_FLAG_VALUE` before anything changes, and the error's `meta.problems` says why. That includes an unscoped word such as `--target sqlite`: use `--target @prisma/orm-sqlite`. Its `meta.allowed` still lists the short names only, and `meta.acceptsPackageName` is `true`.

Without `--target`, the picker has one more entry, "Another target package", which asks for the package name.

## `init-target-takes-a-package-name`

Nothing changes for a script that runs `init --target postgres` or `--target mongodb` and ignores fields it does not know.

In each matched file that reads the `--json` result of `prisma orm init`:

- The result has a new string field, `package`: the name of the target package, such as `@prisma/orm-postgres`. A reader that refuses unknown fields must allow it.
- `target` is still `postgres` or `mongodb` for those packages, also when the package was given by name (`--target @prisma/orm-postgres` reports `target: "postgres"`). For any other package it is the package name, so a reader that checks `target` against the two short names must accept any string. Use `package` when you need the package name.
