---
changes:
  - id: typescript-defaults-take-the-canonical-form
    summary: |
      A literal default written with the TypeScript contract builder now passes through the canonical form of the column's data type after the codec's `encodeJson`, as a PSL default already did, and is stored in that form. A codec whose `encodeJson` writes JSON its data type's canonical form refuses now fails in `defineContract` with `CONTRACT.DEFAULT_INVALID`, "has a default that its data type <id> refuses", where the default was stored before. Make the codec's `encodeJson` write the canonical form of its data type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bencodeJson\s*\('
---

A pack codec's `encodeJson` must write a value its data type's canonical form takes. Every built-in codec already does, so only a pack codec whose JSON is not in canonical form is affected. Run the pack's TypeScript contract tests: a default that now fails names the data type that refuses it. Change the codec's `encodeJson` to write the canonical form, as the data type's `toCanonicalForm` gives it.
