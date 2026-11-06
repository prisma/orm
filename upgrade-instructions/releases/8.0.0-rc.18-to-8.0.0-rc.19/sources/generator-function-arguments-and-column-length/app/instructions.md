---
changes:
  - id: prisma7-default-function-arguments-checked
    summary: |
      The reader for a Prisma 7 schema checks the arguments of `uuid`, `cuid` and `nanoid` as Prisma 8 does. An argument the function does not take, such as `uuid(5)`, `cuid(1)`, `nanoid(1)` or `nanoid(1000)`, is refused with `PSL.PRISMA7_UNKNOWN_DEFAULT` and the function's message, where it used to be read as something else (`uuid(5)` as a version 4 UUID, `cuid(1)` as `cuid(2)`). A named argument, such as `nanoid(size: 8)`, is refused too, and so is a number written with a fraction, such as `uuid(4.0)` or `nanoid(8.0)`, which is not an integer value. Write the argument positionally, as a whole number, inside the function's range: `uuid(4)`, `nanoid(8)`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\buuid\(\s*(?![47]\s*\))[^\s)]'
        - '\bcuid\(\s*(?!2\s*\))[^\s)]'
        - '\bnanoid\(\s*(?:[01]\s*\)|\d{4,}|[3-9]\d\d|2[6-9]\d|25[6-9]|[^)]*[.:])'
  - id: generator-function-argument-diagnostics
    summary: |
      In Prisma 8 PSL, an argument of `uuid`, `cuid` or `nanoid` the function does not take is reported with the code `PSL_INVALID_GENERATOR_ARGUMENT` instead of `PSL_INVALID_ATTRIBUTE_SYNTAX`, and with the function's message, such as `uuid: version must be 4 or 7, got 5`. A missing or extra argument names the callee `Generator function "<name>"` instead of `Attribute "<name>"`, and `Default function "<name>"` for `now` and `autoincrement` in `@default`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,json}"
      matches:
        - 'Expected one of: 4 \| 7'
        - 'Expected an integer between 2 and 255'
        - 'Attribute \\?"(?:uuid|cuid|nanoid|ulid|ksuid|now|autoincrement)\\?"'
  - id: generator-function-argument-with-fraction
    summary: |
      A generator function argument written with a fraction, such as `nanoid(8.0)`, `uuid(4.0)`, `uuid(7.0)` or `cuid(2.0)`, is refused with `PSL_VALUE_TYPE_INCOMPATIBLE`, because a number with a fraction is not an integer value. It used to be read as the whole number. Write `nanoid(8)`, `uuid(4)`, `uuid(7)` or `cuid(2)`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(?:uuid|cuid|nanoid)\(\s*\d+\.\d'
  - id: generator-fits-column
    summary: |
      A generator is refused on a Postgres column too short for what it writes, such as `Char(5) @onCreate(nanoid())` (a Nano ID is 21 characters), `VarChar(5) @onCreate(uuid())`, or a bare `Char`, which holds one character. The message names both lengths: `Field "Row.value": nanoid() writes 21 characters, which does not fit a column of 5 characters.` The code is `PSL_GENERATOR_NOT_APPLICABLE` in Prisma 8 PSL, `PSL.PRISMA7_GENERATOR_REFUSED` for a Prisma 7 `@default(...)`, and `CONTRACT.DEFAULT_INVALID` in a TypeScript contract. Such a column used to fail at the first insert. SQLite does not limit the length, so it takes any of them. Widen the column, or for `nanoid` pass a size that fits.
  - id: discriminator-must-be-text
    summary: |
      A SQL `@@discriminator` field that is not text is refused with the message `must be text, such as String, but is "<type>"` instead of `must be of type String, but is "<type>"`. A discriminator may now also be a `Char(n)` or `VarChar(n)` column on Postgres, or a `sql.String(n)` column on SQLite. A `@@base` value is checked against the column's type, so on Postgres a value longer than a `VarChar(n)` column holds is refused; SQLite does not limit the length, so it takes any value. Mongo's message is unchanged.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,json}"
      matches:
        - '(?<![\s\S])(?![\s\S]*[Mm]ongo)[\s\S]*must be of type String'
---

## `prisma7-default-function-arguments-checked`

A Prisma 7 schema the reader used to accept with a changed meaning is now refused:

```prisma
// Before: read as a version 4 UUID, a CUID2 identifier, and a 1-character Nano ID
id    String @id @default(uuid(5))
code  String @default(cuid(1))
short String @default(nanoid(1))
named String @default(nanoid(size: 8))
whole String @default(uuid(4.0))

// After: write what the generator makes
id    String @id @default(uuid(4))
code  String @default(cuid(2))
short String @default(nanoid(2))
named String @default(nanoid(8))
whole String @default(uuid(4))
```

Each refusal is `PSL.PRISMA7_UNKNOWN_DEFAULT`, reported at the argument, with the function's message: `Field "User.id": uuid: version must be 4 or 7, got 5`. `cuid()` with no argument still reads as `cuid(2)`. Pick the value that keeps what your application stores today: `uuid(5)` made version 4 UUIDs, `cuid(1)` made CUID2 identifiers.

## `generator-function-argument-diagnostics`

Code or tests that match the diagnostics of a Prisma 8 schema read the new code and messages:

```ts
// Before
expect(diagnostic).toMatchObject({ code: 'PSL_INVALID_ATTRIBUTE_SYNTAX', message: 'Expected one of: 4 | 7' });

// After
expect(diagnostic).toMatchObject({
  code: 'PSL_INVALID_GENERATOR_ARGUMENT',
  message: 'uuid: version must be 4 or 7, got 5',
});
```

The messages are `uuid: version must be 4 or 7, got <n>`, `cuid: version must be 2, got <n>` and `nanoid: size must be between 2 and 255, got <n>`. An argument that is not written as a whole number, such as `nanoid(8.5)` or `nanoid("8")`, is `PSL_VALUE_TYPE_INCOMPATIBLE`, as for any value of the integer type.

## `generator-function-argument-with-fraction`

```prisma
// Before: read as nanoid(8) and uuid(7)
slug String @onCreate(nanoid(8.0))
id   String @id @onCreate(uuid(7.0))

// After
slug String @onCreate(nanoid(8))
id   String @id @onCreate(uuid(7))
```

## `generator-fits-column`

```prisma
// Before: emitted, then on Postgres every insert failed with "value too long"
code Char(5) @onCreate(nanoid())

// After
code Char(21) @onCreate(nanoid())
code Char(5)  @onCreate(nanoid(5))
```

The lengths are: `uuid` 36, `ksuid` 27, `ulid` 26, `cuid(2)` 24, `nanoid()` 21 and `nanoid(n)` n. A column's length is read in its type's normal form, so a bare `Char` is `Char(1)` and a bare `VarChar` has no limit.

## `discriminator-must-be-text`

This applies to SQL schemas only; a Mongo schema's discriminator message is unchanged.

```ts
// Before
'Discriminator field "type" on model "Task" must be of type String, but is "Int"'

// After
'Discriminator field "type" on model "Task" must be text, such as String, but is "Int"'
```
