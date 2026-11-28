# @prisma/orm-family-mongo

The MongoDB family domain of Prisma 8: the Mongo contract surface, value and codec model, query AST and builders, wire transport, and the Mongo runtime.

> **Maturity level: Early Access.** This package is published so that you can try it. It may have known failures, and any new version may change it. At each new release you edit the Prisma lines in your `package.json` by hand, and [Versions and support](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#a-new-minor-below-ga) shows how. Until release 8.0 it is published as `8.0.0-rc.N`, like every Prisma 8 package, and any of those versions may contain breaking changes.

A MongoDB application lists this package beside the MongoDB database package (`@prisma/orm-mongo`). The database package requires it as a peer dependency and says which versions it accepts, and `prisma orm init` writes the line for you. Application code imports from the database package. Extension authors and decomposed installs building against the Mongo family import it directly.

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/contract` | Mongo contract entities and canonicalization |
| `/value`, `/codec` | BSON value model and codecs |
| `/contract-psl`, `/contract-ts` | PSL and TypeScript contract authoring for Mongo |
| `/emitter` | Mongo contract emission |
| `/schema-ir` | Mongo schema intermediate representation |
| `/query-ast`, `/query-builder`, `/orm` | query AST and builder surfaces |
| `/lowering`, `/wire` | query lowering and wire transport |
| `/runtime` | Mongo runtime |
| `/family` | the family pack: control, migration, IR, schema verification |

## Responsibilities

Everything Mongo-shaped that is independent of the concrete target wiring: contract semantics, query representation, and the family-level control/migration surface. The target descriptor, adapter, and driver live in `@prisma/orm-target-mongo`.
