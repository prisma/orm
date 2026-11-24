---
changes:
  - id: list-the-platform-packages
    summary: |
      The target package (`@prisma/orm-postgres`, `@prisma/orm-sqlite`, `@prisma/orm-mysql`, `@prisma/orm-mariadb` or `@prisma/orm-mongo`) and every extension now name the Prisma packages they are built on, the platform packages, as peer dependencies instead of bringing them along. List each of them in the application's `package.json`, at the same version as the target package. Nothing in application code changes.
    detection:
      glob: "**/package.json"
      matches:
        - '"@prisma/orm-(?:postgres|sqlite|mysql|mariadb|mongo)"\s*:'
---

# The application lists the platform packages

## `list-the-platform-packages`

The target package, such as `@prisma/orm-postgres`, no longer brings `@prisma/orm-framework`, its family, its target and `@prisma/orm-toolchain` along as its own dependencies. It names them as peer dependencies, and so does every extension. A package manager never gives a package its own copy of a peer dependency: it uses the copy the application lists. So the application now lists them, and holds exactly one copy of each. Yarn installs no peer dependencies at all, so an application under Yarn that does not list them cannot load the target package. npm and pnpm install a missing peer by themselves, which hides the gap until the project moves to another package manager.

For each `package.json` that lists a target package, add every `@prisma/orm-*` package that the target package and each installed `@prisma/orm-*` extension name as peer dependencies. Put them in the same field as the target package (usually `dependencies`), each naming the same version as the target package, written the same way as the target package's line (an exact version, or a caret if that line has one), so an update moves them together. Leave entries the file already has.

These are the packages each target package names:

| Target package | Add |
| --- | --- |
| `@prisma/orm-postgres` | `@prisma/orm-framework`, `@prisma/orm-family-sql`, `@prisma/orm-target-postgres`, `@prisma/orm-toolchain` |
| `@prisma/orm-sqlite` | `@prisma/orm-framework`, `@prisma/orm-family-sql`, `@prisma/orm-target-sqlite`, `@prisma/orm-toolchain` |
| `@prisma/orm-mysql` | `@prisma/orm-framework`, `@prisma/orm-family-sql`, `@prisma/orm-target-mysql`, `@prisma/orm-toolchain` |
| `@prisma/orm-mariadb` | `@prisma/orm-framework`, `@prisma/orm-family-sql`, `@prisma/orm-target-mariadb`, `@prisma/orm-target-mysql`, `@prisma/orm-mysql`, `@prisma/orm-toolchain` |
| `@prisma/orm-mongo` | `@prisma/orm-framework`, `@prisma/orm-family-mongo`, `@prisma/orm-target-mongo`, `@prisma/orm-toolchain` |

The extensions name a subset of the PostgreSQL list, except `@prisma/orm-extension-supabase`, which also names `@prisma/orm-postgres`. For a PostgreSQL application on version `8.0.0-rc.26` with pgvector, `package.json` reads:

```json
"dependencies": {
  "@prisma/orm-postgres": "8.0.0-rc.26",
  "@prisma/orm-framework": "8.0.0-rc.26",
  "@prisma/orm-family-sql": "8.0.0-rc.26",
  "@prisma/orm-target-postgres": "8.0.0-rc.26",
  "@prisma/orm-toolchain": "8.0.0-rc.26",
  "@prisma/orm-extension-pgvector": "8.0.0-rc.26"
}
```

Besides the `@prisma/orm-*` packages, check the other required peer dependencies the target package and those packages name, the ones `peerDependenciesMeta` does not mark optional: `temporal-polyfill` for every target package, `pg` and `@types/pg` for `@prisma/orm-postgres`, and `mongodb` for `@prisma/orm-mongo`. A package manager that installs no peer dependencies, such as Yarn, leaves out any the application does not list, and the application then cannot load. Add each one the application does not list yet, at the range its manifest gives. `@prisma/cli-engine`, which `@prisma/orm-toolchain` names, stays where the project already lists it, as a development dependency.

To read the names from the installed packages instead of the table, run this from the project folder after the install, naming the target package and each `@prisma/orm-*` extension the project lists. It prints every package they need as a required peer: the `@prisma/orm-*` ones followed through the peers of those, and the others with the range their manifest gives. It leaves out the names the command was given and `@prisma/cli-engine`, and exits with an error when it cannot find one of them:

```sh
node -e 'const given=process.argv.slice(1);const read=(n)=>{try{return require(require.resolve(n+"/package.json",{paths:[process.cwd()]}))}catch{return undefined}};for(const n of given)if(!read(n)){console.error("cannot find "+n+" from this folder; install it first, or under Yarn Plug\x27n\x27Play run this with yarn node -e");process.exit(1)}const seen=new Set(given);const todo=[...given];const found=[];while(todo.length){const m=read(todo.shift())??{};const meta=m.peerDependenciesMeta??{};for(const [p,r] of Object.entries(m.peerDependencies??{})){if(seen.has(p)||meta[p]?.optional||p==="@prisma/cli-engine")continue;seen.add(p);if(p.startsWith("@prisma/orm-")){found.push(p);todo.push(p)}else found.push(p+"@"+r)}}console.log(found.join(" "))' @prisma/orm-postgres @prisma/orm-extension-pgvector
```

Under Yarn Plug'n'Play, run it as `yarn node -e '…'` with the same arguments, so it finds the installed packages. Under a package manager that installs no peer dependencies, a package the project does not list yet is not on disk, so its own peers are not read: add the names it printed, install, and run it again until it prints no name the project does not list.

Application code does not change: it still imports only from the target package and the extensions, never from a platform package. Generated files are unchanged too.
