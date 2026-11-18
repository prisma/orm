---
changes:
  - id: engine-pin-moves-to-0-6-1
    summary: |
      The toolchain now requires `@prisma/cli-engine@0.6.1` (up from 0.4.0). A project that pins `@prisma/cli-engine` itself must move the pin to `0.6.1`. The engine no longer exports the deprecated `defineConfig` alias, so `prisma.config.ts` must import `definePrismaConfig`.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/cli-engine": "0.4.0"'
  - id: config-paths-resolve-from-declaring-file
    summary: |
      A relative path in `prisma.config.ts` now resolves from the directory of the config file that wrote it, not from the working directory. Commands run from the config file's directory behave as before. The engine also discovers `prisma.config.ts` files up to the repository root and merges them, with the nearest file's values winning.
---

# The engine moves to `@prisma/cli-engine@0.6.1`

## `engine-pin-moves-to-0-6-1`

For every `package.json` matched by `detection`, change the `@prisma/cli-engine` version from `0.4.0` to `0.6.1` and reinstall. Projects assembled by the `prisma` CLI resolve the engine automatically.

The engine removed the deprecated `defineConfig` alias. If `prisma.config.ts` still imports `defineConfig` from `@prisma/cli-engine`, apply `define-config-becomes-define-prisma-config` in the same upgrade.

## `config-paths-resolve-from-declaring-file`

No change is needed for a project that runs commands from the directory holding its `prisma.config.ts`. A script that runs `prisma ... --config <path>` from another directory and relied on relative paths resolving from the working directory must drop that workaround: `contract`, `contract.output`, and `migrations.dir` now resolve from the config file's own directory.

A project inside a repository whose root, or any directory between the root and the project, holds another `prisma.config.ts` now inherits that file's values for any key the project's own config does not set. Remove or rename a stray parent config if the project must not inherit from it.
