---
changes:
  - id: entity-context-data-types
    summary: |
      `AuthoringEntityContext` has a required `dataTypes: DataTypeSupport`, the stack's data types with their authoring entries, in place of `dataTypeLookup`; its `readWrittenValueForCodec` hook and the `WrittenValueReading` type are removed. Where an extension builds an `AuthoringEntityContext`, replace `dataTypeLookup` with `dataTypes` from the contract source context or the assembled stack (`assembleDataTypeSupport`), and read the data type lookup as `ctx.dataTypes.lookup`. To read a written value into a codec, call `readWrittenValueIntoCodec({ support, codecLookup, ref, written, subject })` from `@internal/framework-components/authoring`, which returns the stored value or a refusal with its code and message. The detection matches code that uses the removed hook or type, builds the context by hand, or reads `dataTypeLookup` from a context.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])readWrittenValueForCodec(?![\w$])'
        - '(?<![\w$])WrittenValueReading(?![\w$])'
        - ':\s*AuthoringEntityContext\s*=\s*\{'
        - '(?<![\w$])ctx\.dataTypeLookup(?![\w$])'
  - id: enum-block-members-written-values
    summary: |
      `readEnumBlockMembers` reads every member through `readWrittenValueIntoCodec` and no longer reads a member's value as JSON. A block member with a value must have an entry in the block's `writtenValues`, which the PSL block interpreter records for every literal and for a list of literals; a member without one throws an `InternalError`, and a bare member is read from its name. `writtenValues` now holds a `WrittenValue`, which may be a list. An extension that builds an enum block itself sets `writtenValues` for each member with a value, as `{ kind: 'string', text }` for text. The detection matches code that calls `readEnumBlockMembers` or reads `writtenValues`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])readEnumBlockMembers\('
        - '\.writtenValues(?![\w$])'
---

# Written values are read into a codec by one framework function

Enum members and `@@base` values are read by `readWrittenValueIntoCodec` in `@internal/framework-components/authoring`, in every family. It replaces the `readWrittenValueForCodec` hook on `AuthoringEntityContext`, which now carries the stack's `dataTypes` in place of the hook and of `dataTypeLookup`:

```typescript
const context: AuthoringEntityContext = {
  family,
  target,
  codecLookup,
  dataTypes,
};
```

A discriminator and its variants' values are decided by `applyDiscriminatorRule`, and its refusals worded for PSL by `describeDiscriminatorRefusal`, both in the same entry point; a target names its text data types in `authoring.textDataTypes`.
