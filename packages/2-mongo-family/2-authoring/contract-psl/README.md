# @internal/mongo-contract-psl

PSL-to-Mongo contract interpreter for Prisma 8. Transforms Prisma Schema Language (`.prisma`) files into Mongo `Contract`, enabling contract-first development with MongoDB.

## Responsibilities

- **PSL interpretation**: `interpretPslDocumentToMongoContract()` reads a parsed PSL document into a `ContractDefinition` and builds it with `buildMongoContractFromDefinition` from `@internal/mongo-contract-ts`, the builder every MongoDB source calls. The interpreter keeps the rules about how a schema is written: attribute arguments, `@id` placement, back-relation pairing, type alias attributes and unresolved references. The builder checks every other rule, and `src/refusal-diagnostics.ts` reports each of its refusals at the field, index, `@@discriminator`, `@@base` value or enum line its key names, with PSL's codes and wording. A field's own `@unique` comes first in a model's indexes, then `@@index`, `@@unique` and `@@textIndex` in the order they are written, and variants come after their base, so each collection lists its indexes as before
- **Attribute registry**: `mongoAttributeSpecs` registers every Mongo built-in (`@@map`, `@@discriminator`, `@@base`, `@@index`, `@@unique`, `@@textIndex`, `@id`, `@unique`, `@map`, `@relation`) as spec factories over the uniform `AttributeSpecContext`; the family descriptor contributes it under `authoring.attributeSpecs`, and the interpreter sources every spec from it
- **Scalar type mapping**: `createMongoScalarTypeDescriptors()` provides the default PSL-type → Mongo codec ID mapping (e.g. `String` → `mongo/string@1`, `ObjectId` → `mongo/objectId@1`)
- **Contract provider**: `mongoContract(path, { target, extensionPacks? })` (exported from `./provider`) takes the stack's target pack and extension packs, which the contract records, and integrates with the CLI's `prisma contract emit` command, reading a `.prisma` schema file and producing a `ContractConfig`
- **Diagnostics**: Emits structured diagnostics for unsupported field types (`PSL_UNSUPPORTED_FIELD_TYPE`), fields a collection validator cannot describe (`PSL_UNSUPPORTED_FIELD_TYPE`, `PSL_MONGO_ID_INVALID` for a field stored as `_id` that can hold BSON type array, regex, undefined or null, such as a list, an optional field, a `Json` field or a `Bson` field, and `PSL_MONGO_ID_ATTRIBUTE_INVALID` for `@id` on a field not stored as `_id` or on more than one field; the validator requires `_id` with the declared field's BSON type, and a model may leave `@id` and `_id` out, when its validator requires an objectId `_id`), orphaned backrelations (`PSL_ORPHANED_BACKRELATION`), ambiguous backrelations (`PSL_AMBIGUOUS_BACKRELATION`), and attribute names outside the registered namespace (`PSL_UNSUPPORTED_MODEL_ATTRIBUTE`, `PSL_UNSUPPORTED_FIELD_ATTRIBUTE`)

## Type aliases

```prisma
types {
  Stamp = Date @onCreate(now()) @onUpdate(now())
}

model Post {
  id        ObjectId           @id @map("_id")
  editedAt  Stamp
  createdAt temporal.CreatedAt
  updatedAt temporal.UpdatedAt
}
```

- A `types {}` alias is expanded into each field typed by it: the field stores the alias's codec and type params, and the collection validator follows from that codec. The contract does not store the alias.
- An alias's base is a type constructor or an enum. It may not name another alias or a contributed alias (`PSL_UNSUPPORTED_NAMED_TYPE_BASE`).
- An alias may carry `@onCreate` and `@onUpdate`. `@default` is refused at the alias, because MongoDB has no database defaults, and so are `@id` and `@unique` (`PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE`). A refused attribute is dropped and the alias is kept.
- A field that writes an attribute its alias already sets is `PSL_DUPLICATE_ATTRIBUTE`. A list field typed by an alias that generates a value is refused, as `@onCreate` on a list is; an optional one is accepted, as an optional field with `@onCreate` is. Generated values are keyed by the field's stored name, so a `@map`-ped field works.
- The Mongo target contributes `temporal.CreatedAt` (`now()` on create) and `temporal.UpdatedAt` (`now()` on create and on update), on `Date` (`mongo/date@1`). They take no arguments. A call to a removed field preset, `temporal.createdAt()`, `temporal.updatedAt()` or `temporal.timestamp(...)`, is refused with `PSL_UNRESOLVED_REFERENCE` and the message names its replacement, such as `Write temporal.CreatedAt.`
- The `@updatedAt` attribute is refused with the hint `Use @onCreate(now()) @onUpdate(now()), or type the field temporal.UpdatedAt.`

## Index sort directions

Use `sort(field, Asc)` or `sort(field, Desc)` in `@@index`, `@@unique`, and `@@textIndex` field lists, for example `@@index([status, sort(createdAt, Desc)])`. Field references use model names; `@map` is applied to the resulting index keys. Plain fields retain the index's default key type, and explicit sort calls produce ascending or descending keys. Wildcard syntax remains `wildcard()` or `wildcard(field)` where supported. The earlier `field(sort: Desc)` syntax and additional sort options such as null ordering are not supported.

## Unresolved type names

The family descriptor contributes `describeUnresolvedMongoType` as its `pslDiagnostics.describeUnresolvedType`, so the binder reports a field type it cannot resolve in Mongo terms. A bare, unqualified name that an earlier Prisma schema used for a Mongo scalar gets the current name and its BSON storage:

| Earlier name | Current name |
| --- | --- |
| `BigInt` | `Int64` |
| `Bytes` | `Binary` |
| `Decimal` | `Decimal128` |

These earlier names are not registered in the `type` namespace, so the binder never resolves them. Any other bare name gets a message that it is not a scalar type, an enum, a composite type or a model, followed by the registered Mongo scalar types. A qualified name (`ns.Name`) or a constructor call (`Name()`) keeps the binder's default `Cannot find type "…"` message.

## Test helpers

`@internal/mongo-contract-psl/test` exports `mongoContextInput(context)`, which maps a `ContractSourceContext` to the context fields of `interpretPslDocumentToMongoContract`'s input. Tests combine it with `bindPslSchema` from `@internal/psl-parser/test`.

## Known limitations

- **Per-index `collation`**: PSL authoring does not support the `collation` index option. Users requiring per-index collation must use the TypeScript contract builder (`@internal/mongo-contract-ts`).
- **`partialFilterExpression` / `wildcardProjection`**: These object-valued index options are not supported in PSL and require the TypeScript contract builder.
