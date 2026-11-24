# @prisma/orm-family-mongo

The MongoDB family domain of Prisma 8: the Mongo contract surface, value and codec model, query AST and builders, wire transport, and the Mongo runtime.

> **Maturity level: Preview.** Its tests block a release for what it supports, and it may change in any release. Until `8.0.0` every Prisma 8 package is published as a release candidate, `8.0.0-rc.N`; from `8.0.0` the version shows the level. See [maturity levels](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#maturity-levels).

A MongoDB application lists this package beside the MongoDB target package (`@prisma/orm-mongo`), at the version the target package names it at, because the target package names it as a peer dependency; `prisma orm init` writes that list. Application code imports from the target package. Extension authors and decomposed installs building against the Mongo family import it directly.

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
