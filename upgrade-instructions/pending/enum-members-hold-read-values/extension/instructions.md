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
      `mongoOrm()` from `@internal/mongo-orm` takes an optional `codecs` lookup and checks a written enum value through the enum's codec. Code that builds `mongoOrm()` itself passes the execution context's `codecs` next to `mutationDefaults`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\bmongoOrm\s*(?:<[^>]*>)?\s*\('
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

Without `codecs`, the ORM compares a written enum value with the enum's stored forms, which refuses every value of an enum whose codec's stored form is not the value, such as a bigint or a date member.

## `contract-dts-enum-member-types`

Regenerate bundled `contract.json` and `contract.d.ts` together from the extension's authoring source with the extension's existing emission command. Only `contract.d.ts` changes, and only for contracts that declare enums.
