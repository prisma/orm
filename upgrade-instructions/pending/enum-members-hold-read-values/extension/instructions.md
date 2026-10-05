---
changes:
  - id: enum-accessor-builders-take-codecs
    summary: |
      `buildNamespacedEnums()` and `buildEnumsMapForNamespace()` from `@internal/contract/enum-accessor` now take a codec lookup, `(codecId) => codec | undefined`, as their last argument, and read each member through the codec it returns. `createEnumAccessor()` takes the codec as an optional second argument. `EnumAccessor` members and values are typed `unknown`, and `has()` on `EnumAccessor` and `ContractEnumAccessor` takes `unknown`. Pass the runtime's codec lookup.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\b(?:buildNamespacedEnums|buildEnumsMapForNamespace|createEnumAccessor)\b'
  - id: contract-dts-enum-member-types
    summary: |
      An emitted `contract.d.ts` now gives every namespace that declares enums an `enumMemberTypes` entry, which types each member as `db.enums` holds it. Re-emit bundled contracts that declare enums. `contract.json`, every hash and migration snapshots are unchanged.
    detection:
      glob: "**/contract.d.ts"
      matches:
        - 'readonly enum: \{'
---

## `enum-accessor-builders-take-codecs`

An extension that builds `db.enums` itself passes the codec lookup of the runtime it builds them for. On a SQL runtime, resolve codecs through the execution context's codec registry; on Mongo, through the execution context's codec lookup:

```ts
buildNamespacedEnums<TContract>(context.contract.domain, (codecId) =>
  context.contractCodecs.forCodecRef({ codecId }),
);

buildNamespacedEnums<TContract>(contract.domain, (codecId) => context.codecs.get(codecId));
```

A lookup that returns `undefined` for an enum leaves that enum's members in their stored form. `createEnumAccessor(contractEnum)` without a codec also keeps stored forms, as the native-enum accessor of `@internal/postgres` does.

The accessor's members are now the values the codec reads, so code that read `EnumAccessor.values` or `members` as `JsonValue` must accept `unknown`, and code that passed a stored form to `has()`, `nameOf()` or `ordinalOf()` must pass the value a query returns.

## `contract-dts-enum-member-types`

Regenerate bundled `contract.json` and `contract.d.ts` together from the extension's authoring source with the extension's existing emission command. Only `contract.d.ts` changes, and only for contracts that declare enums.
