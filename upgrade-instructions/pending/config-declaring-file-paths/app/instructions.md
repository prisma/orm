---
changes:
  - id: engine-pin-moves-to-0-5-0
    summary: |
      The toolchain now peers `@prisma/cli-engine@0.5.0`. A project that pins
      `@prisma/cli-engine` itself must move the pin to `0.5.0`.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/cli-engine": "0.4.0"'
  - id: orm-config-paths-resolve-against-declaring-file
    summary: |
      Relative paths in the `orm` section of `prisma.config.ts` (contract inputs and
      output, `migrations.dir`) now resolve against the config file that declares them,
      not against the directory the command runs in. Engine 0.5.0 discovers config
      files from the current directory up to the repository root and merges them, so a
      root config's `orm` section reaches commands run in any subdirectory; a path
      written next to the root config keeps meaning the root's directory from anywhere.
      A project that ran commands only from the config's own directory sees no change.
      A project that relied on cwd-relative resolution from another directory must
      rewrite those paths relative to the config file.
    detection:
      glob: "**/prisma.config.ts"
      contains:
        - "orm"
---

# `orm` config paths anchor at the declaring file

## `engine-pin-moves-to-0-5-0`

For every `package.json` matched by `detection`, change the `@prisma/cli-engine` version to `0.5.0` and reinstall. Projects assembled by the unified `prisma` CLI resolve the engine automatically and need no change.

## `orm-config-paths-resolve-against-declaring-file`

Relative paths in the `orm` section now mean "relative to this config file", from whatever directory a command runs in. Check each relative path in the section (contract `input`/`output`, `migrations.dir`): if it was written relative to the config file's own directory — the overwhelmingly common case — nothing changes. If it relied on being resolved against a different working directory, rewrite it relative to the config file.
