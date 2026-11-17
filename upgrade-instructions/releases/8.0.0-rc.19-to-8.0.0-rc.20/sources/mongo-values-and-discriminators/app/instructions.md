---
changes:
  - id: mongo-quoted-enum-members
    summary: |
      A MongoDB PSL `enum` member is now read in the syntax of its codec's data type, as on SQL, and a quoted member is text. A quoted member on a type that does not take text is refused with `PSL_VALUE_TYPE_INCOMPATIBLE` at the member: write a Double's `"NaN"`, `"Infinity"` and `"-Infinity"` and an Int64's or Decimal128's number unquoted (`Unknown = NaN`, `Big = 9007199254740993`, `Half = 0.5`), a Date member as `` date`2024-01-01T00:00:00Z` `` and a Binary member as `` binary`aGVsbG8=` ``. A Decimal128 `"-0"` cannot be written in PSL any more, because `-0` is an int32 zero: write `0`, or declare the enum in TypeScript. The detection matches an enum on one of those codecs with a quoted member.
    detection:
      glob: "**/*.prisma"
      matches:
        - 'enum\s+\w+\s*\{(?=[^}]*@@type\(\s*"mongo/(?:double|int64|int64Number|decimal128|date|binary)@1"\s*\))[^}]*\n\s*\w+\s*=\s*"'
  - id: mongo-integer-enum-members-with-a-fraction
    summary: |
      A MongoDB PSL number with a fraction, such as `1.0`, is now a Decimal128 value, and no integer type casts from Decimal128, so an Int32 or Int64 member written with a fraction is refused with `PSL_VALUE_TYPE_INCOMPATIBLE` (`Expected a number that mongo/int32 can hold; got mongo/decimal128`). Write the whole number, `One = 1`. The detection matches an Int32 or Int64 enum with a member written with a fraction.
    detection:
      glob: "**/*.prisma"
      matches:
        - 'enum\s+\w+\s*\{(?=[^}]*@@type\(\s*"mongo/(?:int32|int64|int64Number)@1"\s*\))[^}]*\n\s*\w+\s*=\s*-?\d+\.\d'
  - id: discriminator-optional-or-list
    summary: |
      A `@@discriminator` field must be required and hold one value, in SQL and MongoDB schemas alike. An optional field is refused with `Discriminator field "<field>" on model "<Model>" must be required, but it is optional. Remove the "?"`, and a list with `... must hold one value, but it is a list. Remove the "[]"`, both `PSL_INVALID_ATTRIBUTE_ARGUMENT`. Make the field required and single: a document or row without the value has no variant. The detection matches a model whose `@@discriminator` names a field declared with `?` or `[]`.
    detection:
      glob: "**/*.prisma"
      matches:
        - 'model\s+\w+\s*\{(?=[^}]*@@discriminator\(\s*(\w+)\s*\))[^}]*\n\s*\1\s+[\w.]+(?:\?|\[\])'
  - id: discriminator-base-value-not-a-member
    summary: |
      When an enum types a `@@discriminator` field, each `@@base` value must be one of the enum's members, as the field stores them. A value that is not is refused at the value with `PSL_INVALID_ATTRIBUTE_ARGUMENT`: `Model "<Variant>" declares @@base value "<value>", which is not a member of enum "<Enum>", the type of discriminator field "<Model>.<field>". Write one of: ...`. Write a member's stored value, or add the value to the enum. The detection matches a schema that declares both a `@@discriminator` and an `enum`; check each `@@base` value of a discriminator typed by an enum.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@@discriminator\()(?=[\s\S]*(?:^|\n)\s*enum\s+\w+\s*\{)[\s\S]*@@base\('
  - id: psl-value-refused-code
    summary: |
      An enum member or `@@base` value that the receiving data type or codec refuses now reports `PSL_VALUE_REFUSED`, in SQL and MongoDB schemas. SQL reported `PSL_INVALID_DEFAULT_LITERAL` for these, and MongoDB reported `PSL_EXTENSION_INVALID_VALUE` (`was rejected by codec`) for a member. A member written in a form its type does not take reports `PSL_VALUE_TYPE_INCOMPATIBLE`, and text an entry or a cast cannot read reports `PSL_INVALID_LITERAL`. Update code or tests that match these codes or messages. A MongoDB discriminator that is not text now says `must be text, such as String`, as SQL does, in place of `must be of type String`, and a type alias of `String` is accepted as a discriminator. The detection matches code that names the old member code or messages.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - 'was rejected by codec \\?"mongo/'
        - 'must be of type String'
        - '(?=[\s\S]*@@base\()[\s\S]*PSL_INVALID_DEFAULT_LITERAL'
  - id: decimal128-spelling
    summary: |
      `mongo/decimal128` stores its values as MongoDB writes them: without leading zeros, keeping negative zero, and only a value a Decimal128 holds exactly. A `contract.json` that stores a Decimal128 value with leading zeros, such as `"007.5"`, is refused when it is loaded with `RUNTIME.DECODE_FAILED`, which names the value to store; emit the contract again. A TypeScript enum member such as `member('Half', '007.5')` is stored as `7.5`, so its contract gets a new hash on the next emit. A value with more than 34 significant digits, counting zeros after the decimal point, such as `1.000000000000000000000000000000000000`, is refused in PSL, TypeScript and `contract.json` instead of being rounded; write a value with at most 34 significant digits. The detection matches a Decimal128 value with leading zeros or more than 34 digits.
    detection:
      glob: "**/*.{json,ts,mts,cts,tsx,prisma}"
      matches:
        - 'mongo/decimal128@1[\s\S]*?(?:[=,(:]\s*["\x27`]?-?0\d|[=,(:]\s*["\x27`]?-?\d[\d.]{35,})'
---

# MongoDB values are written in the syntax of their data type

MongoDB PSL now reads every enum member the way SQL PSL does: by the syntax it is written in, then the casts of the enum codec's data type, then the codec. The MongoDB target has an authoring entry or a cast for every data type except `mongo/bson`:

- a quoted string is `mongo/string`, and `true` and `false` are `mongo/bool`;
- a number is the smallest type that holds it: `mongo/int32`, `mongo/int64`, `mongo/decimal128` when a Decimal128 holds it exactly, `NaN` and the infinities included, and `mongo/double` otherwise;
- the `date`, `binary` and `json` tags write `mongo/date`, `mongo/binary` and `mongo/json`.

A member that was quoted to get a number through the JSON reader is now text, and a member that was written with a fraction on an integer enum is now a Decimal128 value. Rewrite each as the change entries above say:

```prisma
enum Ratio {
  @@type("mongo/double@1")
  Unknown = NaN
  Half    = 0.5
}

enum Level {
  @@type("mongo/int32@1")
  One = 1
}
```

Discriminators follow one rule in both families: the field must be required, hold one value, and have one of the stack's text data types, and when an enum types it, each `@@base` value must be one of its members. A field is text by its data type, so on MongoDB a type alias of `String` is now a discriminator.

An enum on an Int64, Date, Decimal128, Binary or ObjectId codec, or a Double enum with a `NaN` or infinite member, is still refused when a collection the contract manages uses it, because a collection validator cannot list those members.
