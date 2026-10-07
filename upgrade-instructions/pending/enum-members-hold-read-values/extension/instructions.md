---
changes:
  - id: enum-accessor-builders-take-codecs
    summary: |
      `buildNamespacedEnums()` and `buildEnumsMapForNamespace()` from `@internal/contract/enum-accessor` now take a codec lookup, `(codecId) => EnumMemberCodec`, as their last argument and read each member through the codec it returns. The lookup must return a codec for every enum; throw `RUNTIME.CODEC_DESCRIPTOR_MISSING` when the runtime has none. `createEnumAccessor()` takes the codec as an optional second argument. `EnumAccessor` members and values are typed `unknown`, and `has()` on `EnumAccessor` and `ContractEnumAccessor` takes `unknown`. Pass the runtime's codecs.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\b(?:buildNamespacedEnums|buildEnumsMapForNamespace|createEnumAccessor)\b'
  - id: mongo-orm-takes-enum-accessors
    summary: |
      `mongoOrm()` and `createMongoCollection()` from `@internal/mongo-orm` now require the contract's enum accessors, which they check a written enum value against. Code that builds them itself passes `buildMongoEnums(contract, context.codecs)` from `@internal/mongo-runtime` as `enums`; `createMongoCollection()` takes them before the optional `mutationDefaults`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\b(?:mongoOrm|createMongoCollection)\s*(?:<[^>]*>)?\s*\('
  - id: define-contract-carries-enums
    summary: |
      A target facade whose `defineContract` wraps `buildBoundContract` must carry the contract's enums as an `Enums` generic and export an `enumType` bound to its pack's codec types, as `@internal/postgres` and now `@internal/sqlite` do. Without them `db.enums` types each member as `JsonValue`, while it holds the value its codec reads, such as a bigint or a `Date`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\bbuildBoundContract\s*\('
  - id: contract-dts-enum-member-types
    summary: |
      An emitted `contract.d.ts` now gives every namespace that declares enums an `enumMemberTypes` entry, which types each member as `db.enums` holds it. Re-emit bundled contracts that declare enums. `contract.json`, every hash and migration snapshots are unchanged.
    detection:
      glob: "**/contract.d.ts"
      matches:
        - 'readonly enum: \{'
---

## `enum-accessor-builders-take-codecs`

An extension that builds `db.enums` passes the codecs of the runtime it builds them for. On a SQL runtime, resolve each codec through the execution context's codec registry, which throws `RUNTIME.CODEC_DESCRIPTOR_MISSING` for a codec no component registers:

```ts
const enums = Object.freeze(
  buildNamespacedEnums<TContract>(context.contract.domain, (codecId) =>
    context.contractCodecs.forCodecRef({ codecId }),
  ),
);
```

On Mongo, build them with `buildMongoEnums` from `@internal/mongo-runtime`, which resolves each codec through the execution context's codec lookup and throws `RUNTIME.CODEC_DESCRIPTOR_MISSING` when it has none:

```ts
const enumsByNamespace = buildMongoEnums(contract, context.codecs);
const enums = enumsByNamespace[UNBOUND_NAMESPACE_ID];
```

A static context that builds enums before it has an execution context must build the context first so it can pass the codecs. Each enum's codec is resolved when the accessors are built; its members are decoded when the enum is first read.

`createEnumAccessor(contractEnum)` without a codec keeps the members in their stored forms, as the native-enum accessor of `@internal/postgres` does.

The accessor's members are the values the codec reads, so code that read `EnumAccessor.values` or `members` as `JsonValue` must accept `unknown`. Members are decoded once, when the enum is first read; a mutable member, such as a `Date` or a `Uint8Array`, is a fresh copy on every read, and an immutable one, such as a Temporal value, is the same value on every read. `has()`, `nameOf()` and `ordinalOf()` find a value equal to a member: a primitive by SameValueZero, an object by its `Object.prototype.toString` kind and the form the codec stores it in. Code that passed a stored form to them must pass the value a query returns.

## `mongo-orm-takes-enum-accessors`

Pass the contract's enum accessors when building the Mongo ORM, the same ones the static context builds for `db.enums`:

```ts
const orm = mongoOrm<TContract>({
  contract,
  executor,
  mutationDefaults: context,
  enums: buildMongoEnums(contract, context.codecs),
});
```

`createMongoCollection()` takes the accessors as its fourth argument, before the optional `mutationDefaults`: `createMongoCollection(contract, 'User', executor, enums, mutationDefaults)`. A write of an enum field whose accessor `enums` lacks is refused with `ORM.ARGUMENT_INVALID`.

## `define-contract-carries-enums`

Give the facade's `defineContract` an `Enums` type parameter on both overloads, pass it to `buildBoundContract` through the definition type, and merge the scaffold's and the factory's enums in the factory overload:

```ts
import type {
  EnumTypeHandle,
  MergeEnums,
} from '@internal/sql-contract-ts/contract-builder';

type EnumsConstraint = Record<string, EnumTypeHandle>;

type Result<Types, Models, Extensions, Enums extends EnumsConstraint> = ReturnType<
  typeof buildBoundContract<
    SqlFamily,
    TargetPack,
    {
      readonly types?: Types;
      readonly models?: Models;
      readonly extensions?: Extensions;
      readonly enums?: Enums;
      readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
    }
  >
>;

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const Enums extends EnumsConstraint = Record<never, never>,
>(definition: Definition<Types, Models, Extensions, Enums>): Result<Types, Models, Extensions, Enums>;

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const ScaffoldEnums extends EnumsConstraint = Record<never, never>,
  const FactoryEnums extends EnumsConstraint = Record<never, never>,
>(
  scaffold: Scaffold<Extensions, ScaffoldEnums>,
  factory: (helpers: ComposedAuthoringHelpers<SqlFamily, TargetPack, Extensions>) => {
    readonly types?: Types;
    readonly models?: Models;
    readonly enums?: FactoryEnums;
  },
): Result<Types, Models, Extensions, MergeEnums<ScaffoldEnums, FactoryEnums>>;
```

Add `'enums'` to the keys the base scaffold omits from `ContractInput`, add `readonly enums?: Enums` to the definition and scaffold types, and type the implementation's `enums` as `EnumsConstraint`. Then export an `enumType` bound to the pack's codec types, and `member`, from the facade's contract builder:

```ts
import {
  bindEnumType,
  type ExtractCodecTypesFromPack,
} from '@internal/sql-contract-ts/contract-builder';

/** `enumType` bound to the pack's codec types, so each `member()` value is checked against the enum codec's input type. */
export const enumType = bindEnumType<ExtractCodecTypesFromPack<typeof targetPack>>();
```

## `contract-dts-enum-member-types`

Regenerate bundled `contract.json` and `contract.d.ts` together from the extension's authoring source with the extension's existing emission command. Only `contract.d.ts` changes, and only for contracts that declare enums.
