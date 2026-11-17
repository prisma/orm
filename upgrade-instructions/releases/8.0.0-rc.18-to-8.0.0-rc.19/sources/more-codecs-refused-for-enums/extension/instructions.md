---
changes:
  - id: family-codec-templates-render-no-literals
    summary: |
      `postgresCodec` and `sqliteCodec` now throw an `InternalError` when the family codec template they adapt declares `renderValueLiteral`. Earlier versions copied the template's renderer. A family template renders no literal, because only the target knows the form its data type stores a value in. Remove `renderValueLiteral` from the template and pass it in the adapter's options instead; the framework exports `renderTsLiteral`, `floatNumberLiteral`, `decimalTextNumberLiteral` and `decimalTextBigintLiteral` from `@internal/framework-components/codec` for the common stored forms.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\bextends\s+CodecDescriptorTemplateImpl\b)(?=[\s\S]*\brenderValueLiteral\s*\()'
  - id: enum-block-written-values
    summary: |
      A parsed PSL extension block now records each literal entry as it is written in `writtenValues`, a `WrittenScalar` by key, in place of `numberTexts`, which held only the source text of number entries. `AuthoringEntityContext.readWrittenNumber` is replaced by `readWrittenValueForCodec`, which takes a `WrittenScalar` as `written` in place of the number's `text`, and reads any written value, not only a number, by the cast rule. A refused `WrittenValueReading` now carries the diagnostic `code` with its `message`. `enumMemberValue()` yields a tagged member as its `WrittenScalar` in place of `null`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:numberTexts|readWrittenNumber|WrittenValueReading)\b'
---

## `family-codec-templates-render-no-literals`

```ts
// before: the template renders, and postgresCodec copied it
export class MyTextTemplate extends CodecDescriptorTemplateImpl<void> {
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  // ...
}
export const myTextDescriptor = postgresCodec(myTextTemplate, {
  dataType: pgText,
  jsonProjection: (expression) => expression,
  factory: (descriptor, dataType) => () => new MyTextCodec(descriptor, dataType),
});

// after: the template renders nothing, and the target passes the renderer
export class MyTextTemplate extends CodecDescriptorTemplateImpl<void> {
  // ...
}
export const myTextDescriptor = postgresCodec(myTextTemplate, {
  dataType: pgText,
  renderValueLiteral: renderTsLiteral,
  jsonProjection: (expression) => expression,
  factory: (descriptor, dataType) => () => new MyTextCodec(descriptor, dataType),
});
```

Without the option, the adapted codec renders no literal, so an enum or value set on it is typed as the codec's whole output type.

## `enum-block-written-values`

1. Read `block.writtenValues?.[key]` in place of `block.numberTexts?.[key]`. A number entry is `{ kind: 'number', text }`, with the text as written.
2. Rename a `readWrittenNumber` hook to `readWrittenValueForCodec`, and read `written` in place of `text`.
3. Give every refused `WrittenValueReading` a `code`, such as `PSL_VALUE_TYPE_INCOMPATIBLE`.

```ts
// before
readWrittenNumber: ({ text, codecId, subject }) => ({ ok: false, message: `${subject}: refused` }),

// after
readWrittenValueForCodec: ({ written, codecId, subject }) => ({
  ok: false,
  code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
  message: `${subject}: refused`,
}),
```

The detection matches every file that names `WrittenValueReading`, including one that already sets `code`. Check each refused reading.
