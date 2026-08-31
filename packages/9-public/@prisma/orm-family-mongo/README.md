# @prisma/orm-family-mongo

The MongoDB family domain of Prisma Next: the Mongo contract surface, value and codec model, query AST and builders, wire transport, and the Mongo runtime.

Applications receive it as an exact-pinned dependency of the Mongo facade (`@prisma/orm-mongo`); app developers install the facade. Extension authors and decomposed installs building against the Mongo family import it directly.

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
