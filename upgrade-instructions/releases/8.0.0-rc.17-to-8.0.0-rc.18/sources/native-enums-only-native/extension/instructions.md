---
changes:
  - id: build-native-enums-takes-the-domain
    summary: |
      `buildNamespacedNativeEnums` from `@prisma/orm-postgres/runtime` takes the contract's domain as a second argument, `buildNamespacedNativeEnums(contract.storage, contract.domain)`, and leaves out each value set that a domain enum of the same namespace produced. The accessors it builds hold native enum types only; read a domain enum through the accessor `db.enums` uses.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bbuildNamespacedNativeEnums\s*\('
---

## `build-native-enums-takes-the-domain`

Pass the contract's domain beside its storage:

```ts
// before
buildNamespacedNativeEnums(contract.storage);
// after
buildNamespacedNativeEnums(contract.storage, contract.domain);
```

The result no longer has an accessor for a domain enum (an `enum` block or `enumType()`), only for native enum types. The type `NamespacedNativeEnums<Contract>` leaves out the same names. Code that read a domain enum from the result reads it from the accessor `db.enums` uses instead.
