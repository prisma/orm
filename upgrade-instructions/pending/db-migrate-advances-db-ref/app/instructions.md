---
changes:
  - id: db-migrate-advances-db-ref
    summary: |
      `prisma db migrate` now advances the `db` ref after a successful apply when the connection comes from `prisma.config.ts` and the CLI does not detect CI. It still advances nothing with `--db` or in CI. A development `db migrate --advance-ref db` can drop the flag. A deploy or script that runs `db migrate` from the config outside a CI runner, and must not change `migrations/app/refs/db.json`, passes the new `--no-advance-ref` or `--db`.
    detection:
      glob: "**/*.{json,sh,bash,zsh,yml,yaml,toml,md,mdx,ts,mts,js,mjs,cjs}"
      matches:
        - 'db\s+migrate\b[^\n]*--advance-ref[\s=]+db(?![\w-])'
---

# `db migrate` advances the `db` ref

`prisma db migrate` now moves the `db` ref to the contract the database is at after it applies, the way `db init` and `db update` do. It does so only when the connection comes from `db.connection` in `prisma.config.ts` and the CLI does not detect CI. The CLI detects CI when the `CI` environment variable is set to anything but `false`, or when a variable that CI services set is present, such as `BUILD_NUMBER`, `BUILD_ID` or `GITHUB_ACTIONS`. When CI detection is what stops the advance, the command says so with `MIGRATION.REF_NOT_ADVANCED_IN_CI`. A pipeline that runs `db migrate` from the config silences that notice with `--no-advance-ref`.

| Situation | Ref advancement |
| --- | --- |
| Connection from `prisma.config.ts`, CI not detected | `db` |
| Connection from `prisma.config.ts`, CI detected | None |
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

- Add `--no-advance-ref`, or pass the URL with `--db`, wherever `db migrate` runs from the config outside a CI runner and must not change files in the repository. That covers deploys: a container entrypoint, a Kubernetes job, a release command such as Fly's `release_command`, or a deploy script on a server checkout. On a persistent checkout the run would otherwise rewrite the tracked `migrations/app/refs/db.json` to the deployed contract, and the next `git pull` that touches that file refuses. It also covers a job that commits its results.

A ref that `db migrate` cannot write, for example on a read-only filesystem, is now a warning, `MIGRATION.REF_NOT_WRITTEN`, and the command exits 0. Before, a failed `--advance-ref` write failed the command after the migrations had applied. A script that checked the exit code to detect that failure reads the warning from the `--json` result's diagnostics instead.
