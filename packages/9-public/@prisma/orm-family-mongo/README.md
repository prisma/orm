# @prisma/orm-family-mongo

The MongoDB family domain of Prisma 8: the Mongo contract surface, value and codec model, query AST and builders, wire transport, and the Mongo runtime.

> **Maturity level: Early Access.** It is released so that people can try it, and it may change in any release. Until release 8.0 every Prisma 8 package is published as a release candidate, `8.0.0-rc.N`; from release 8.0 the version shows the level. At each new minor, edit every `@prisma/orm-*` line to the new minor by hand and run the install; a package manager's command that updates to the latest version is not a substitute ([why](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#a-new-minor-below-ga)). See [maturity levels](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#maturity-levels).

A MongoDB application lists this package beside the MongoDB database package (`@prisma/orm-mongo`), at the version the database package names it at, because the database package names it as a peer dependency; `prisma orm init` writes that list. Application code imports from the database package. Extension authors and decomposed installs building against the Mongo family import it directly.

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
