---
changes:
  - id: engine-pin-moves-to-0-6-1
    summary: |
      The toolchain now peers `@prisma/cli-engine@0.6.1` (up from 0.4.0). An extension package that pins `@prisma/cli-engine` for its tests or tooling must move the pin to `0.6.1`. A config section's `validate` now receives a second `provenance` argument naming the files that declared the section.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/cli-engine": "0.4.0"'
---

# The engine moves to `@prisma/cli-engine@0.6.1`

For every `package.json` matched by `detection`, change the `@prisma/cli-engine` version from `0.4.0` to `0.6.1` and reinstall.

Code that calls a config section's `validate` directly, for example in a test, must pass the provenance the engine supplies as the second argument:

```ts
// before
section.validate(raw);

// after
section.validate(raw, { files: [configPath], keys: { contract: configPath } });
```

`files` lists the config files that declared the section, nearest first. `keys` maps each top-level key of the section to the file that wrote it.
