---
changes:
  - id: prisma-packages-are-peer-dependencies
    summary: |
      Every `@prisma/orm-*` package an extension uses, other than another extension, is now a peer dependency, never an ordinary dependency. Move each such entry from `dependencies` (and `optionalDependencies`) to `peerDependencies`, and list it under `devDependencies` too, all at the same exact version.
    detection:
      glob: "**/package.json"
      matches:
        - '"(?:dependencies|optionalDependencies)"\s*:\s*\{[^}]*"@prisma/orm-(?!extension-)'
---

# Every Prisma package an extension uses is a peer dependency

## `prisma-packages-are-peer-dependencies`

An extension used to hold `@prisma/orm-framework`, its family (`@prisma/orm-family-sql` or `@prisma/orm-family-mongo`) and `@prisma/orm-toolchain` as ordinary dependencies, and only the target, such as `@prisma/orm-target-postgres`, as a peer dependency. Now every `@prisma/orm-*` package it uses is a peer dependency. The application lists those packages itself, beside its target package, and a package manager never gives a package its own copy of a peer dependency, so the extension shares the application's one copy of each. A version that does not match the application's is reported at install, instead of becoming a second copy whose values the application's copy does not recognise. A monorepo whose applications are on different Prisma versions can still get two copies under npm workspaces and Bun's hoisted linker; keep such applications on one version, or use pnpm, Yarn or Bun's isolated linker.

In the extension's `package.json`, for every `@prisma/orm-*` entry under `dependencies` or `optionalDependencies`, other than an `@prisma/orm-extension-*` package:

1. Move it to `peerDependencies`, keeping its exact version.
2. Add the same entry, at the same version, to `devDependencies`, so the extension's own build and tests install it. Add any entry already under `peerDependencies` to `devDependencies` too, if it is not there.

Before:

```json
"dependencies": {
  "@prisma/orm-family-sql": "8.0.0-rc.26",
  "@prisma/orm-framework": "8.0.0-rc.26",
  "@prisma/orm-toolchain": "8.0.0-rc.26"
},
"peerDependencies": {
  "@prisma/orm-target-postgres": "8.0.0-rc.26"
}
```

After:

```json
"devDependencies": {
  "@prisma/orm-family-sql": "8.0.0-rc.26",
  "@prisma/orm-framework": "8.0.0-rc.26",
  "@prisma/orm-target-postgres": "8.0.0-rc.26",
  "@prisma/orm-toolchain": "8.0.0-rc.26"
},
"peerDependencies": {
  "@prisma/orm-family-sql": "8.0.0-rc.26",
  "@prisma/orm-framework": "8.0.0-rc.26",
  "@prisma/orm-target-postgres": "8.0.0-rc.26",
  "@prisma/orm-toolchain": "8.0.0-rc.26"
}
```

Leave out a `dependencies` field that ends up empty. Then reinstall. The extension's code does not change.
