# Mongo slice plan

1. **PSL and BSON matrix** — Add failing domain-lowering and exact-validator tests, then map `FieldSymbol.elementOptional` and derive nullable array `items` for scalar and supported value-object lists.
2. **TypeScript authoring and typing** — Add failing value/type tests, then carry an element-nullability axis through `FieldBuilder`, contract emission, and inferred input/output channels using `.many({ elementsNullable: true | false })`.
3. **Runtime audit** — Prove decode bypasses `null` elements, fix scalar-list write wrapping to encode non-null elements independently, and test null bypass.
4. **Gates and artifacts** — Run affected package tests/typechecks/lints, dependency lint if imports changed, inspect the scoped diff, and record status. Semantic PSL printer remains excluded.
