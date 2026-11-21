---
changes:
  - id: db-migrate-advances-db-ref
    summary: |
      `prisma db migrate` now advances the `db` ref after a successful apply when the connection comes from `prisma.config.ts` and the `CI` environment variable is unset. It still advances nothing with `--db` or in CI. A development `db migrate --advance-ref db` can drop the flag. A script that runs `db migrate` from the config outside CI and must not write a ref passes the new `--no-advance-ref`.
    detection:
      glob: "**/*.{json,sh,bash,zsh,yml,yaml,toml,md,mdx,ts,mts,js,mjs,cjs}"
      matches:
        - 'db\s+migrate\b[^\n]*--advance-ref[\s=]+db(?![\w-])'
---

# `db migrate` advances the `db` ref

`prisma db migrate` now moves the `db` ref to the contract the database is at after it applies, the way `db init` and `db update` do. It does so only when the connection comes from `db.connection` in `prisma.config.ts` and the `CI` environment variable is unset:

| Situation | Ref advancement |
| --- | --- |
| Connection from `prisma.config.ts`, `CI` unset | `db` |
| Connection from `prisma.config.ts`, `CI` set to anything but `false` | None |
| `--db <url>` | None |
| `--advance-ref <name>` | `<name>` instead, in every case above |
| `--no-advance-ref` | None |

Change the commands the project runs:

- In a development command that reads the connection from the config, such as a `package.json` script or a README step, remove `--advance-ref db` from `db migrate`. Keep it where the command passes `--db` or runs in CI, because there `db migrate` advances nothing by default.

  ```bash
  # Before
  prisma db migrate --advance-ref db
  # After
  prisma db migrate
  ```

- In a script that runs `db migrate` from the config outside CI and must not change files in the repository, such as a job that commits its results, add `--no-advance-ref`.

A ref that `db migrate` cannot write, for example on a read-only filesystem, is now a warning, `MIGRATION.MIGRATE_REF_NOT_WRITTEN`, and the command exits 0. Before, a failed `--advance-ref` write failed the command after the migrations had applied. A script that checked the exit code to detect that failure reads the warning from the `--json` result's diagnostics instead.
