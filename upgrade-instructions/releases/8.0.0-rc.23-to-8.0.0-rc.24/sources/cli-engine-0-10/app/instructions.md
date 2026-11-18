---
changes:
  - id: engine-pin-moves-to-0-10-0
    summary: |
      The toolchain now requires `@prisma/cli-engine@0.10.0` (up from 0.9.0). A project that depends on `@prisma/cli-engine` itself must move to `0.10.0`.
    detection:
      glob: "**/{package.json,pnpm-workspace.yaml}"
      matches:
        - '"@prisma/cli-engine":\s*"[^"]*(?<![\d.])0\.\d(?!\d)'
        - '[''"]?@prisma/cli-engine[''"]?:\s*[''"]?[\^~]?0\.\d(?![\d])'
  - id: prisma-7-commands-answer-v7-command
    summary: |
      A Prisma 7 command the ORM answers, such as `prisma migrate dev`, now fails with `CLI.V7_COMMAND` instead of `CLI.COMMAND_MOVED`, still with exit code 2.
---

## `engine-pin-moves-to-0-10-0`

For every file matched by `detection`, change the `@prisma/cli-engine` version (`0.9.0`, `^0.9.0` or any other 0.x below 0.10) to `0.10.0` and reinstall. Projects assembled by the `prisma` CLI resolve the engine automatically.

## `prisma-7-commands-answer-v7-command`

`prisma generate`, `validate`, `format`, `studio`, `db pull`, `db push`, `db seed`, `db execute` and the six `prisma migrate` commands fail with `CLI.V7_COMMAND`. The error names the Prisma 8 commands to run instead and their `--help`, or links the CLI docs when Prisma 8 has no equivalent. A script that checks for `CLI.COMMAND_MOVED` after running one of these commands checks for `CLI.V7_COMMAND` instead.
