---
changes:
  - id: engine-pin-moves-to-0-6-2
    summary: |
      The toolchain now peers `@prisma/cli-engine@0.6.2` (up from 0.6.1). An extension package that pins `@prisma/cli-engine` for its tests or tooling must move the pin to `0.6.2`. With this engine the CLI prints its own name in hints and messages where it used to print a literal `{bin}`.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/cli-engine": "0.6.1"'
---

## `engine-pin-moves-to-0-6-2`

For every `package.json` matched by `detection`, change the `@prisma/cli-engine` version from `0.6.1` to `0.6.2` and reinstall.

Engine 0.6.2 replaces the placeholder `{bin}` with the name of the CLI that was run. A hint that used to print as `{bin} db migrate` now prints as `prisma db migrate`. The replacement applies to next actions, warnings, errors, and summary and list text, in human, `--json`, and `--format markdown` output. Keep writing `{bin}` in the commands and messages your extension produces; the engine replaces it. If a test of yours runs the CLI and matches the literal text `{bin}` in its output, change it to match the CLI name.
