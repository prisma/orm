---
changes:
  - id: one-orm-version
    summary: |
      Every `@prisma/orm-*` package and the `prisma` CLI must run one version of Prisma ORM. With more than one copy installed, commands and clients stop with `RUNTIME.MULTIPLE_ORM_COPIES`.
    detection:
      glob: "package.json"
      matches:
        - '"@prisma/orm-'
---

# One version of Prisma ORM

Commands and clients now refuse to start when Prisma ORM is loaded from more than one folder. Before, a project with mismatched versions could fail later with an internal error, for example on the first literal `@default` in `prisma contract emit`.

After upgrading, check that one copy is installed:

1. Every `@prisma/orm-*` entry in `package.json` other than `@prisma/orm-extension-*` names the same version. Extensions carry their own version; each one must depend on that same version of Prisma ORM.
2. The `prisma` CLI runs that version. `npm ls @prisma/orm-framework`, `pnpm why @prisma/orm-framework` or `bun why @prisma/orm-framework` lists every copy and the package that brought it.

If more than one version is listed, align the versions and reinstall. If every copy is the same version, delete `node_modules` and the lockfile and reinstall. With pnpm, copies of one version can also differ by their peer dependencies: `pnpm why @prisma/orm-framework` shows the difference, and giving every dependent the same peer leaves one copy.
