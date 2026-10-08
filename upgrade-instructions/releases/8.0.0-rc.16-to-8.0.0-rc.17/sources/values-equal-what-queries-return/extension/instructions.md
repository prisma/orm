---
changes:
  - id: decode-json-integer-text-refuses-other-spellings
    summary: |
      `decodeJsonIntegerText` from `@internal/framework-components/codec` now refuses digit text with a leading zero or a minus sign on zero, such as "007" or "-0", naming the text to write. An extension codec that reads an integer through it refuses those spellings in `contract.json` and in a PSL enum member. Write its values without leading zeros or a minus sign on zero, as its `encodeJson` should already.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\bdecodeJsonIntegerText\b'
  - id: enum-codecs-need-equality
    summary: |
      Every enum authoring surface, `enumType` in `defineContract` and the PSL enum block in both families, now refuses a codec whose descriptor does not declare the `equality` trait. A codec descriptor can also set the new `enumRefusal` field, a reason an enum cannot use it that ends with what to use instead. Declare `equality` on an extension codec whose values an enum may hold, and set `enumRefusal` on one that declares it but whose values a query reads back never equal a member as the contract stores it.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\btraits\s*[:=]'
---

## `decode-json-integer-text-refuses-other-spellings`

`decodeJsonIntegerText(codecId, json, range?)` reads an integer a codec stores as decimal text. It now refuses any spelling other than the integer's decimal text:

```text
demo/big@1 JSON value must be "7", the integer's decimal text without leading zeros or a minus sign on zero
```

1. Find the codecs that call `decodeJsonIntegerText`. The detection for this change looks for the name.
2. Check that each codec's `encodeJson` writes `value.toString()` of the integer, so it never writes a spelling `decodeJson` now refuses.
3. Re-emit the extension's bundled contracts, if it ships any, and check that they load. A contract that holds such a spelling fails to load with `RUNTIME.DECODE_FAILED`.

## `enum-codecs-need-equality`

An enum compares a value with its members, so an enum cannot use a codec whose values cannot be compared for equality. `enumRefusalOf(descriptor)` from `@internal/framework-components/codec` gives the reason an enum cannot use a codec, or `undefined`. Every enum surface refuses through it, with `CONTRACT.ENUM_INVALID` in TypeScript and `PSL_EXTENSION_INVALID_VALUE` at the `@@type` in PSL.

1. For each codec descriptor the extension contributes, declare `equality` in `traits` when its type compares values for equality, so an enum can use it.
2. Set `enumRefusal` when the codec declares `equality` but its values read back never equal a member as the contract stores it: for example, the database normalises the value's text and the codec stores it as written, or the stored form is not text the database reads as the value. Write one or two sentences that say why and end with what to use instead:

```ts
class GeoHashDescriptor extends CodecDescriptorImpl<void> {
  override readonly traits = ['equality'] as const;
  override readonly enumRefusal =
    'The database normalises a geohash to its shortest form, so a member as written is not the value a query reads back. Use a text enum.';
}
```

A codec without `equality` may set `enumRefusal` too, to replace the generic reason with its own.
