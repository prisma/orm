# ADR 241 — Scalar types use the authoring type-constructor channel

Status: **Accepted**.

**Amended 2026-10-30 (TML-3714):** the rule that a target contributes the constructors that are TypeScript `type.*` helpers holds for MongoDB too. The MongoDB target, not its adapter, contributes its scalar type constructors, and the MongoDB TypeScript builder builds `type.*` from the family, target and extension packs, as the SQL builder does. A constructor marked `deprecated` stays PSL-only and is not a `type.*` helper.

Amends: [ADR 170 — Pack-provided type constructors and field presets](ADR%20170%20-%20Pack-provided%20type%20constructors%20and%20field%20presets.md).

Related: [ADR 171 — Parameterized native types in contracts](ADR%20171%20-%20Parameterized%20native%20types%20in%20contracts.md), [ADR 254 — Data types and casts](ADR%20254%20-%20Data%20types%20and%20casts.md), [ADR 231 — Declarative attribute specifications](ADR%20231%20-%20Declarative%20attribute%20specifications.md).

## At a glance

Every PSL storage type comes from one contributed authoring namespace. A scalar is a type constructor that can be called with no arguments, so bare `String` means `String()`. Parameterized storage types such as `VarChar(191)` use the same constructor descriptor and the same resolution path. Both forms are contributed through `AuthoringContributions.type`. A target contributes every constructor of its stack, the base scalars and native types included, and each is also a TypeScript `type.*` helper. (Amended by ADR 275, 2026-10-21: until then the target's adapter contributed the base scalars and native types, so that they stayed PSL-only.) An extension pack contributes its own. There is no separate scalar-descriptor map or database-attribute channel.

## Grounding example

A target defines its ordinary scalars and parameterized storage types with the same descriptor shape, and contributes them. PostgreSQL's:

```ts
const postgresScalarAndNativeTypeConstructors = {
  String: {
    kind: 'typeConstructor',
    output: { codecId: 'pg/text@1' },
  },
  VarChar: {
    kind: 'typeConstructor',
    args: [{ kind: 'value', dataType: 'pg/int4', name: 'length', optional: true }],
    output: {
      codecId: 'sql/varchar@1',
      typeParams: { length: { kind: 'arg', index: 0 } },
    },
  },
} as const satisfies AuthoringTypeNamespace;
```

PSL resolves both through the type position:

```prisma
types {
  Slug = VarChar(191)
}

model User {
  id   Uuid @id
  slug Slug
}
```

`String`, `Uuid`, and bare `VarChar` are zero-argument instantiations. `VarChar(191)` uses the same contribution with one argument, producing structured `typeParams`. A constructor names only the codec; the database type, its name and the bounds of its parameters come from the data type the codec represents ([ADR 254](ADR%20254%20-%20Data%20types%20and%20casts.md)), so the `length` argument carries no `minimum` of its own.

> **Amended by [ADR 275](ADR%20275%20-%20Client%20generators%20are%20field%20attributes%2C%20and%20a%20type%20alias%20is%20expanded%20into%20each%20column.md) (2026-10-21).** The contract no longer stores the alias. The two JSON blocks below show the earlier form. Today the column stores the parameters inline, `{ "codecId": "sql/varchar@1", "dataType": "pg/varchar", "nullable": false, "typeParams": { "length": 191 } }`, and `storage.types` has no `Slug` entry.

The contract stores the alias as a `storage.types` entry with the codec, the data type the codec represents and the parameters, and the column names the entry:

```json
"Slug": {
  "codecId": "sql/varchar@1",
  "dataType": "pg/varchar",
  "kind": "codec-instance",
  "typeParams": { "length": 191 }
}
```

```json
"slug": {
  "codecId": "sql/varchar@1",
  "dataType": "pg/varchar",
  "nullable": false,
  "typeRef": "Slug"
}
```

## Context

The authoring stack previously carried two ways to contribute storage types. Base scalar names came from a dedicated `scalarTypeDescriptors` map, while parameterized and extension-owned types came from `AuthoringContributions.type`. PostgreSQL native types also had a family-owned `@db.*` interpretation path that translated named-type attributes into storage descriptors. These channels described the same decision—selecting a codec, native type, and optional parameters—but assembled, validated, completed, and resolved it differently.

That split made a scalar artificially different from any other storage type. It also placed target-specific native-type knowledge in the SQL family interpreter instead of in the target that owns the codecs and storage vocabulary. A single contribution channel lets the framework treat type names uniformly while targets and extension packs retain ownership of their concrete types.

## Decision

Every authorable storage type is an `AuthoringTypeConstructorDescriptor` contributed through the `type` property of `AuthoringContributions`. Family, target, adapter, and extension descriptors compose their type namespaces through `assembleAuthoringContributions`; duplicate paths fail at composition rather than overriding one another.

A bare type name `T` is semantically the zero-argument instantiation `T()`. The framework derives the scalar view with `collectScalarTypeConstructors`: a top-level constructor with no entity-reference argument and no required arguments is a scalar. `ControlStack.scalarTypes`, language-server scalar names, symbol-table classification, and scalar codec validation are derived from that view. They are consumers of the unified namespace, not contribution channels of their own.

Parameterized storage types use the same descriptor and resolver. Their argument declarations validate the authoring call, and their output templates place resolved values in structured `typeParams`. The data type the codec represents writes the type's name from those parameters and bounds them, as decided by [ADR 254](ADR%20254%20-%20Data%20types%20and%20casts.md), which supersedes ADR 171's expansion hooks.

Storage-type ownership follows the component boundary. For a target the rule has two parts. The target defines its base scalars and native types next to the codecs they name, as one set (`postgresScalarAndNativeTypeConstructors`, `sqliteScalarTypeConstructors`), and contributes that set together with its other constructors, such as PostgreSQL's `BigIntNumber`, `UnboundedInt` and `pg.enum`. The TypeScript contract builder builds its `type.*` helpers from the family, the target and the extension packs, so PSL and `type.*` see the same constructors, such as `type.String()` and `type.VarChar(64)`. (Amended by ADR 275, 2026-10-21: the adapter contributed the base set before, to keep it out of `type.*`.) Extension packs contribute namespaced constructors unless the short-name policy permits otherwise. The SQL family interpreter resolves the assembled namespace generically and contains no PostgreSQL-native mapping table.

PSL storage is selected only in type position. The former `@db.X(args)` channel is removed. Remaining source using that spelling fails with actionable migration guidance: rewrite `@db.X` as `X` and `@db.X(args)` as `X(args)` in type position.

## Rationale

One concept should have one registration and resolution path. A scalar differs from a parameterized type only in whether the constructor is invoked with arguments; treating them as different contribution kinds duplicates assembly and validation without expressing a domain distinction.

The unified namespace also enforces thin-family, target-owned storage vocabulary. The framework defines the constructor descriptor and generic composition rules. The target or extension that owns a codec declares the names and output storage descriptors associated with it. Adding a storage type does not require teaching the SQL family interpreter a new database-specific name.

Deriving scalar names from constructors keeps tooling aligned with interpretation. Completion, symbol classification, and codec validation cannot drift onto a scalar map that resolves differently from the constructors used to emit the contract.

## Consequences

- Components contribute scalar and parameterized storage types through `AuthoringContributions.type` only. The `scalarTypeDescriptors` contribution and assembly surfaces are retired.
- Bare type syntax and constructor-call syntax share precedence, collision handling, argument validation, and lowering.
- A target contributes the constructors that are also TypeScript `type.*` helpers, on SQL and MongoDB alike. It defines its PSL-only constructors, which bind PSL type names to codecs, and its adapter contributes them. Family interpreters remain generic across targets.
- `ControlStack.scalarTypes` remains a derived convenience view for consumers that need names, while `collectScalarTypeConstructors` provides the derived name-to-storage-output map.
- TypeScript and PSL authoring helpers can be generated from the same descriptor namespace.
- This decision does not change the contract representation: storage entries contain codec ids, data type ids and structured type parameters ([ADR 254](ADR%20254%20-%20Data%20types%20and%20casts.md)).
- Existing `@db.X(args)` source must be rewritten mechanically to `X(args)` in type position; no compatibility channel remains.

## Alternatives considered

### Keep a separate scalar descriptor map

Base scalars could remain in `scalarTypeDescriptors`, with constructor contributions reserved for types that expose an explicit call surface. Rejected: bare `T` already has the semantics of `T()`, and two contribution paths would continue to duplicate composition, codec validation, completion derivation, and resolution precedence.

### Fold the scalar map into constructors during assembly

The framework could preserve the old component SPI and translate map entries into constructor descriptors when composing a control stack. Rejected: this would make the assembled result uniform while leaving two authoring contracts for component authors. Retiring the map makes the component boundary and the runtime shape agree.

### Keep PostgreSQL native types in the SQL family interpreter

The SQL interpreter could continue translating a dedicated database attribute into storage descriptors from a family-owned table. Rejected: the table embeds PostgreSQL codec and native-type knowledge in a family package, bypasses the shared constructor namespace, and gives one storage decision two authoring positions. Native types belong to the target and resolve in type position like every other type.

### Treat bare scalars as declarations rather than calls

The namespace could contain a scalar leaf kind alongside a constructor leaf kind. Rejected: it would encode an invocation-style distinction as a domain distinction and force every namespace consumer to dispatch between two descriptor shapes that produce the same storage output.

## References

- [ADR 170 — Pack-provided type constructors and field presets](ADR%20170%20-%20Pack-provided%20type%20constructors%20and%20field%20presets.md) — establishes contributed authoring helpers and target/pack ownership.
- [ADR 171 — Parameterized native types in contracts](ADR%20171%20-%20Parameterized%20native%20types%20in%20contracts.md) — keeps base native type names separate from structured parameters in the contract.
- [ADR 231 — Declarative attribute specifications](ADR%20231%20-%20Declarative%20attribute%20specifications.md) — covers attributes after removal of the separate `@db.*` storage channel.
- [Ecosystem Extensions & Packs subsystem](../subsystems/6.%20Ecosystem%20Extensions%20&%20Packs.md) — component contribution and extension authoring boundaries.
- Constructor and contribution types: [`framework-authoring.ts`](../../../packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts).
- Namespace assembly and derived scalar view: [`control-stack.ts`](../../../packages/1-framework/1-core/framework-components/src/control/control-stack.ts).
- PostgreSQL scalar and native-type constructors: defined as `postgresScalarAndNativeTypeConstructors` in [`type-constructors.ts`](../../../packages/3-targets/postgres/1-target/src/core/type-constructors.ts) in the target, next to the codecs they name, and contributed by the target in [`descriptor-meta.ts`](../../../packages/3-targets/postgres/1-target/src/core/descriptor-meta.ts), so they are also TypeScript `type.*` helpers.
