# @prisma/orm-mongo

The package a MongoDB application imports Prisma from. It wires the framework, the Mongo family, and the Mongo target into a single lazy client.

> **Maturity level: Early Access.** This package is published so that you can try it. It may have known failures, and any new version may change it. At each new release you edit the Prisma lines in your `package.json` by hand, and [Versions and support](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#a-new-minor-below-ga) shows how. Until release 8.0 it is published as `8.0.0-rc.N`, like every Prisma 8 package, and any of those versions may contain breaking changes.

This package is built from other Prisma packages, the platform packages, and your application lists them beside it in `package.json`. `prisma orm init` writes those lines for you. To add them by hand:

- Until release 8.0, give every `@prisma/orm-*` package the same exact version, such as `8.0.0-rc.25`.
- From release 8.0, use the command below. It is written for release 8.0. For a later release, such as 8.3, write `8.3.0` in place of `8.0.1`.

```sh
pnpm add "@prisma/orm-mongo@~8.0.1-ea.0" "@prisma/orm-framework@~8.0.1" "@prisma/orm-family-mongo@~8.0.1-ea.0" "@prisma/orm-target-mongo@~8.0.1-ea.0" "@prisma/orm-toolchain@~8.0.1"
pnpm add mongodb
```

```
@prisma/orm-mongo
├── @prisma/orm-framework      contracts, components, runtime core
├── @prisma/orm-family-mongo   Mongo contract, query builders, runtime
├── @prisma/orm-target-mongo   target descriptor + adapter + driver
└── @prisma/orm-toolchain      ORM command family for the `prisma` CLI, emitter, config loader
```

**Why your application lists the platform packages.** It must have exactly one copy of each. With two copies, Prisma fails with an error that does not say why, because one copy does not accept a value that the other created.

- **Listing them is what gives you one copy.** This package requires them as peer dependencies, and a package manager installs a peer dependency only where your application lists it.
- **A version that does not fit is reported when you install.** npm refuses the install. pnpm, Yarn and Bun install and print a peer dependency warning, so read the warnings: a successful install does not prove that the versions fit.
- **You never import them.** Your code imports only from `@prisma/orm-mongo` and from extensions.

[ADR 329](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/adrs/ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md) explains this in full.

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

These forward; they do not copy. `@prisma/orm-mongo/contract/types` and `@prisma/orm-framework/contract/types` are the same module, so a value made through either is recognised by both, and `instanceof` checks hold across the boundary.

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
