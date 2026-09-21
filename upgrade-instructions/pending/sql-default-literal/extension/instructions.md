---
changes:
  - id: default-sql-replaces-default-sql-method
    summary: |
      `.defaultSql('...')` on the TypeScript contract builder is deprecated and is removed in 8.0.0.
      Rewrite each call to `.default(...)` with a named helper or the `sql` template tag.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.defaultSql\('
  - id: control-mutation-defaults-require-literal-tag-registry
    summary: |
      `ControlMutationDefaults.defaultLiteralTagRegistry` is required on every pack's
      `controlMutationDefaults`; add `defaultLiteralTagRegistry: new Map()` or register tags. An
      attribute spec context's `controlMutationDefaults` now carries both registries.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "defaultFunctionRegistry"
---

## `default-sql-replaces-default-sql-method`

Rewrite every `.defaultSql('<expression>')` call by its expression:

| Call | Replacement | Import |
| --- | --- | --- |
| `.defaultSql('now()')` | `.default(now())` | `now` from `@internal/sql-contract-ts/contract-builder` |
| `.defaultSql('autoincrement()')` | `.default(autoincrement())` | `autoincrement` from `@internal/sql-contract-ts/contract-builder` |
| `.defaultSql('<anything else>')` | `` .default(sql`<anything else>`) `` | `sql` from `@internal/sql-contract-ts/contract-builder` |

There is no named helper for other database functions: `.defaultSql('gen_random_uuid()')` becomes `` .default(sql`gen_random_uuid()`) ``.

Copy the expression's value, not its source string: first undo the TypeScript string's own escaping, so `.defaultSql('it\'s')` contributes `it's`. Then write each backtick as `` \` ``. Write a backslash that precedes a dollar sign as `\\$`, because the tag reads `\$` as the escape for `$`. Every other backslash can be written as it is, or doubled; both give one backslash. An expression that contains `${` is written `\${` inside the `sql` tag, which resolves it back to the two characters; in PSL it is written as it is.

Every form lowers to the same `{ kind: 'function', expression }` default, so emitted contracts do not change. In PSL, rewrite `@default(dbgenerated("<expression>"))` by its expression: `dbgenerated("now()")` becomes `@default(now())`, `dbgenerated("autoincrement()")` becomes `@default(autoincrement())`, and anything else, including `dbgenerated("gen_random_uuid()")`, becomes `` @default(sql`<expression>`) `` (the quoted form `@default(sql"<expression>")` with the argument copied unchanged is the exact mechanical rewrite; for the backtick form, undo the quoted string's escaping and write each backtick as `` \` ``; every other backslash inside backticks is kept as written, `\$` included, because PSL has no escape for `$`). `` sql`now()` `` and `` sql`autoincrement()` `` are refused, in PSL and in the TypeScript `sql` tag, so those two must use the named form. `dbgenerated` still works in this release.

## `control-mutation-defaults-require-literal-tag-registry`

`defaultLiteralTagRegistry` is a required member of `ControlMutationDefaults`. A pack whose descriptor contributes `controlMutationDefaults` fails to type-check, and fails at control-stack assembly, until it adds the member. The one-line fix keeps the pack's behaviour:

```ts
controlMutationDefaults: {
  defaultFunctionRegistry: createMyDefaultFunctionRegistry(),
  defaultLiteralTagRegistry: new Map(),
  generatorDescriptors: createMyGeneratorDescriptors(),
},
```

To register tags instead, map a prefixed tag (`mypack.sql`; the unprefixed `sql` belongs to the SQL targets) to a `ControlDefaultLiteralTagEntry`: `usage` (how the tag is written, for messages), `documentation`, and `lower({ literal, context })`, which receives the tag, the canonical body, and the span of a `@default` tagged literal and returns a `LoweredDefaultResult` like a default-function entry does. Two packs registering the same tag is an assembly error.

Code that builds an `AttributeSpecContext` or `FieldAttributeSpecContext` by hand used to pass the default-function registry as `controlMutationDefaults`; pass an object with both registries instead (`{ defaultFunctionRegistry, defaultLiteralTagRegistry }`, or the stack's whole `controlMutationDefaults`).
