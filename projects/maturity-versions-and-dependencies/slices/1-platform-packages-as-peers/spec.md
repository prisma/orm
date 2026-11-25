# Slice 1: the application lists the platform packages, and our packages name each other as peers

Linear: [TML-3935](https://linear.app/prisma-company/issue/TML-3935). Project: [spec](../../spec.md), [plan](../../plan.md). Trial: [the second install trial](../../spikes/2026-11-24-below-ga-and-monorepo-installs.md).

"Our packages" means the 22 packages this repository publishes under `@prisma/orm-*`. A "sibling" of one of them is another of them.

## At a glance

Before, `@prisma/orm-postgres` published:

```json
"dependencies": {
  "@prisma/orm-family-sql": "8.0.0-rc.25",
  "@prisma/orm-framework": "8.0.0-rc.25",
  "@prisma/orm-target-postgres": "8.0.0-rc.25",
  "@prisma/orm-toolchain": "8.0.0-rc.25"
}
```

After, those four lines are under `"peerDependencies"`, and a new application's `package.json` reads:

```json
"dependencies": {
  "@prisma/orm-postgres": "8.0.0-rc.26",
  "@prisma/orm-family-sql": "8.0.0-rc.26",
  "@prisma/orm-framework": "8.0.0-rc.26",
  "@prisma/orm-target-postgres": "8.0.0-rc.26",
  "@prisma/orm-toolchain": "8.0.0-rc.26"
}
```

## Behaviour

1. **Every sibling is a peer.** In each of our packages, every sibling it uses is in `peerDependencies` and in none of `dependencies` or `optionalDependencies`. The specifier stays `workspace:<version>`, which publishes as the exact version. The sibling is also in `devDependencies`, as the extensions already do for their target, so the workspace installs it.
2. **The build computes the list and refuses a manifest that disagrees.** `validateShellManifest` (`packages/0-config/tsdown/shell-build.ts`) computes the siblings a package reaches from the map in `packages/0-shared/publish-surface/src/shells.ts`. It requires each to be a peer, and requires that no sibling is a dependency. The `peerShells` field of the map is no longer needed, because every sibling is a peer; it is removed, not kept as a second way to say the same thing. `@prisma/orm-better-auth` is not in the map and already names its siblings as peers; it keeps doing so.
3. **`prisma orm init` writes the platform packages.** After it has installed the application's facade, it reads that package's installed `package.json`, takes every `@prisma/orm-*` name in its `peerDependencies`, and does the same for each of those, until no new name appears. It installs each name as a dependency of the application, at the range the installed manifests declare. When it finishes, every `@prisma/orm-*` line in the application's `dependencies`, the facade included, names the same version, written the way the project's package manager writes a version it is given: in manual QA npm added a caret, and pnpm, Yarn and Bun wrote the version exactly. All the lines are written the same way, so an update moves them together. `init` cannot ask for an exact line: the install interface it uses belongs to `@prisma/cli-engine` and has no such option, and it does not need one. With `--skip-install` it prints the same list.
4. **Packages in this repository that stand for an application follow.** Every example, app and test application that depends on one of our packages lists the siblings that package names as peers. `test/prisma-bin`, which carries its own toolchain, lists the framework.
5. **Docs say what the manifests say.** Each package's README, `docs/reference/Package Naming Conventions.md`, `skills/DEVELOPING.md`, the `prisma-8` skill's `quickstart.md`, `build.md`, `contract.md`, `upgrade-app.md`, `upgrade-extension.md` and `build-a-target-package.md`, the comment on `reexports` in `shells.ts`, and the sentence in `.agents/rules/use-timeouts-helper-in-tests.mdc` about an example depending on one facade.
6. **Upgrade instructions** exist for both audiences, recorded the way the `record-upgrade-instructions` skill says: an application adds the platform packages to its `package.json`; an extension moves the framework, the family and the toolchain from `dependencies` to `peerDependencies`.
7. **`init` also adds the other required peers.** The facade and the packages above name third-party packages as required peers (`temporal-polyfill`, the driver and its types). `init` adds each one the project does not list, at the range the manifest declares, so that the application loads under a package manager that installs no peers. Found in manual QA under Yarn.
8. **`init` works out the list before it loads the facade's `init` entry.** That entry imports the platform packages. With `--skip-install`, when they are not installed, `init` stops with the list of packages to add.

## Checks

- A packaging test installs the packed packages into an application that lists the PostgreSQL package, its platform packages and the pgvector extension, runs code in it, and requires that the application, the PostgreSQL package and the extension all hold the same module for each of the four platform packages.
- A packaging test packs one platform package one version ahead of the others and requires the install to report the mismatch. The existing tests of this kind for an extension and for Better Auth keep passing.
- The build check has unit tests for: a sibling under `dependencies` is refused; a missing peer is refused; a correct manifest passes.
- `prisma orm init` has tests for the list it installs for PostgreSQL and MongoDB, for a package whose peers name a further sibling (the MariaDB shape), and for `--skip-install`.

## Out of scope

- Ranges. Every specifier stays exact. Slice 2 writes ranges.
- The decision record. The orchestrator writes it; implementers do not.
- The command-line tool's own behaviour, other than `init`.
- `packages/1-framework` domain concepts. `init` lives in `packages/1-framework/3-tooling/cli`, which is tooling and is in scope. Nothing in the contract, the control vocabulary or the interfaces families implement changes.

## Edge cases

| Case | Required behaviour |
| --- | --- |
| The application already lists a platform package and another version of it is installed | `init` reports the mismatch and changes nothing it did not write, as it does today for a facade already declared |
| `init` run a second time | Adds nothing that is already listed at the right version |
| A database package from outside this repository that names no `@prisma/orm-*` peers | `init` installs only what it installs today |
| `orm-mariadb`, whose siblings include the MySQL facade | The MySQL facade and target are peers of it, and `init` lists them |
| `orm-extension-supabase`, which imports the PostgreSQL facade | The facade is a peer of it |
| `orm-extension-paradedb`, which imports nothing from the PostgreSQL target | It does not name the target |
| Yarn with the `node_modules` linker, which installs no peers | Covered by `init` listing every name. Not run in CI; checked by hand before the pull request |
| Yarn Plug'n'Play | `init` does not support it: it looks for installed packages in `node_modules` folders only. Out of scope here; documented, and recorded as a ticket |

## Done when

- `pnpm build`, `pnpm lint:deps`, `pnpm check:publish-deps` and `pnpm check:conformance` pass.
- The test files named under "Checks" pass, and the packaging tests that already exist pass.
- A search of the repository's docs, READMEs and skills for "exact-pinned dependenc", "one package a", "installs exactly one" and "nothing else" finds no sentence that describes the old arrangement, outside release notes, archived upgrade instructions and decision records.
