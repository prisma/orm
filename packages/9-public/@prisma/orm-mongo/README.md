# @prisma/orm-mongo

The package a MongoDB application installs for its database. It wires the framework, the Mongo family, and the Mongo target into a single lazy client. It names the platform packages it is built on as peer dependencies: until `8.0.0` at this package's own exact version, and from `8.0.0` at a range within this package's release, such as `~8.1.0`. The application lists them beside it, and `prisma orm init` writes that list. To install them by hand, give every `@prisma/orm-*` package the same `8.0.0-rc.N` until `8.0.0`, and from `8.0.0` the lines [the versioning page](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#what-an-application-writes) gives for the release you want:

> **Maturity level: Preview.** Its tests block a release for what it supports, and it may change in any release. Until `8.0.0` every Prisma 8 package is published as a release candidate, `8.0.0-rc.N`; from `8.0.0` the version shows the level. At each new minor, edit every `@prisma/orm-*` line to the new minor by hand and run the install; a package manager's command that updates to the latest version is not a substitute ([why](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#a-new-minor-below-ga)). See [maturity levels](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#maturity-levels).

```sh
pnpm add @prisma/orm-mongo@<version> @prisma/orm-framework@<version> @prisma/orm-family-mongo@<version> @prisma/orm-target-mongo@<version> @prisma/orm-toolchain@<version>
pnpm add mongodb
```

```
@prisma/orm-mongo
├── @prisma/orm-framework      contracts, components, runtime core
├── @prisma/orm-family-mongo   Mongo contract, query builders, runtime
├── @prisma/orm-target-mongo   target descriptor + adapter + driver
└── @prisma/orm-toolchain      ORM command family for the `prisma` CLI, emitter, config loader
```

The application lists the platform packages because it must hold exactly one copy of each: the runtime keeps its registries of codecs and operations in them, and a second copy would not see what the first one registered. A package manager never gives a package its own copy of a peer dependency; it uses the one the application lists, and it reports a version that does not match. When the packages that disagree are ones the application lists itself, npm refuses the install, and pnpm, Yarn and Bun install and print a peer dependency warning. A successful install does not prove the versions match, so read the peer warnings it prints. Application code still imports only from `@prisma/orm-mongo` and from the extensions, never from a platform package. The decision record explains this in full: [ADR 329](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/adrs/ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md).

In a repository with several applications on different Prisma versions, npm workspaces and Bun with its hoisted linker can give one application two copies of a platform package without a warning. Keep the applications on one Prisma version, or use pnpm, Yarn, or Bun with its isolated linker.

`mongodb` is a peer dependency: the driver is the application's, so a single connection pool and a single BSON implementation serve both Prisma 8 and any direct `mongodb` use in the same process.

`temporal-polyfill` is a required peer dependency. The control plane, such as the `prisma` commands, loads it as a fallback `Temporal` when the runtime has none, and a project that already installs it for its own code has one copy. npm, pnpm and bun install it automatically; with Yarn, add `temporal-polyfill` to your dependencies.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/runtime` | `mongo(url)` — the lazy query client |
| `/static` | statically composed runtime for pre-wired deployments |
| `/config` | `defineConfig` for `prisma.config.ts`, and `prisma6Schema` to read a Prisma 6 MongoDB schema as the contract source |
| `/contract-types` | the types a generated `contract.d.ts` imports |
| `/contract-builder` | `defineContract` and Mongo contract authoring |
| `/bson` | BSON value helpers (`ObjectId`, `Decimal128`, …) |
| `/target`, `/family` | the Mongo target pack and the Mongo family pack |
| `/migration`, `/control` | migration planning and the control client |
| `/init` | the init contribution `prisma orm init` writes a project from |

A generated `contract.d.ts` imports every framework, family and target type it names from `/contract-types`, and a generated `migration.ts` imports from `/migration`: the modules this package's `defineConfig` sets as `contract.typesModule` and `migrations.module`. This package also forwards the namespaces of the packages it is built from, so application code imports from this package alone, even though the application lists those packages too:

| Namespace | Forwards |
| --- | --- |
| `/contract`, `/contract/*` | `@prisma/orm-framework/contract` |
| `/components`, `/components/*` | `@prisma/orm-framework/components` |
| `/family-contract`, `/family-contract/*` | `@prisma/orm-family-mongo/contract` |
| `/target/*` | `@prisma/orm-target-mongo/target` |
| `/adapter`, `/adapter/*` | `@prisma/orm-target-mongo/adapter` |

These forward; they do not copy. `@prisma/orm-mongo/contract/types` and `@prisma/orm-framework/contract/types` are the same module, so shared registries and `instanceof` checks hold across the boundary.

## Prepared statements

`db.prepare(declaration, callback)` builds a query once and runs it many times with different values. Run the handle against `await db.runtime()`:

```ts
const byEmail = await db.prepare({ email: 'mongo/string@1' }, (p) =>
  db.query
    .from('users')
    .match((f) => f.email.eq(p.email))
    .build(),
);
const users = await byEmail.query(await db.runtime(), { email: 'alice@example.com' }).toArray();
```

ORM reads are prepared through `.prepared.all()`, `.prepared.first()` and `.prepared.firstOrThrow()`, and the handle's `query` returns what the ad-hoc read returns:

```ts
const userByEmail = await db.prepare({ email: 'mongo/string@1' }, (p) =>
  db.orm.users.where({ email: p.email }).prepared.first(),
);
const user = await userByEmail.query(await db.runtime(), { email: 'alice@example.com' });
```

The handle and declaration types (`MongoPreparedStatement`, `MongoPreparedExecution`, `MongoDeclaration`, `MongoParamsFromDeclaration`) are exported from `@prisma/orm-mongo/family-runtime`. The ORM read handle types (`MongoPreparedRowQuery`, `MongoPreparedFrom`) and `MongoPrepareMember`, the type that has the client's `prepare` method, are exported from `@prisma/orm-mongo/runtime`.

## The CLI

This package ships no bin. The ORM commands run inside the unified `prisma` CLI, which mounts the command family published at `@prisma/orm-toolchain/cli`.

## Responsibilities

Composition only. Every behavior it exposes lives in the platform packages; this package chooses the default combination of them and gives it one name.
