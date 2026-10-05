---
changes:
  - id: enum-accessor-builders-take-codecs
    summary: |
      `buildNamespacedEnums()` and `buildEnumsMapForNamespace()` from `@internal/contract/enum-accessor` now take a codec lookup, `(codecId) => EnumMemberCodec`, as their last argument and read each member through the codec it returns. The lookup must return a codec for every enum; throw `RUNTIME.CODEC_DESCRIPTOR_MISSING` when the runtime has none. `createEnumAccessor()` takes the codec as an optional second argument. `EnumAccessor` members and values are typed `unknown`, and `has()` on `EnumAccessor` and `ContractEnumAccessor` takes `unknown`. Pass the runtime's codecs.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\b(?:buildNamespacedEnums|buildEnumsMapForNamespace|createEnumAccessor)\b'
  - id: mongo-orm-takes-codecs
    summary: |
      `mongoOrm()` and `createMongoCollection()` from `@internal/mongo-orm` now require the runtime's codecs, which they check a written enum value through. Code that builds them itself passes the execution context's `codecs`; `createMongoCollection()` takes them before the optional `mutationDefaults`.
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

On Mongo, resolve through the execution context's codec lookup and throw when it has none:

```ts
function enumCodec(codecs: MongoCodecLookup, codecId: string): EnumMemberCodec {
  const codec = codecs.get(codecId);
  if (codec === undefined) {
    throw runtimeError(
      'RUNTIME.CODEC_DESCRIPTOR_MISSING',
      `No codec is registered for codecId '${codecId}', which a domain enum in the contract uses.`,
      { codecId },
    );
  }
  return codec;
}

const enums = buildNamespacedEnums<TContract>(contract.domain, (codecId) =>
  enumCodec(context.codecs, codecId),
)[UNBOUND_NAMESPACE_ID];
```

`runtimeError` comes from `@internal/framework-components/runtime`, and `EnumMemberCodec` from `@internal/contract/enum-accessor`. A static context that builds enums before it has an execution context must build the context first so it can pass the codecs.

`createEnumAccessor(contractEnum)` without a codec keeps the members in their stored forms, as the native-enum accessor of `@internal/postgres` does.

The accessor's members are the values the codec reads, so code that read `EnumAccessor.values` or `members` as `JsonValue` must accept `unknown`. A member that is an object is a fresh copy on every read. `has()`, `nameOf()` and `ordinalOf()` find a value equal to a member: a primitive by SameValueZero, an object by its `Object.prototype.toString` kind and the form the codec stores it in. Code that passed a stored form to them must pass the value a query returns.

## `mongo-orm-takes-codecs`

Pass the execution context's codecs when building the Mongo ORM:

```ts
const orm = mongoOrm<TContract>({
  contract,
  executor,
  mutationDefaults: context,
  codecs: context.codecs,
});
```

`createMongoCollection()` takes the codecs as its fourth argument, before the optional `mutationDefaults`: `createMongoCollection(contract, 'User', executor, context.codecs, mutationDefaults)`. The ORM reads each enum through its codec once and refuses a write of an enum field whose codec the lookup lacks with `RUNTIME.CODEC_DESCRIPTOR_MISSING`.

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
