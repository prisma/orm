# @internal/sql-contract-ts API Notes

This page collects user-facing helper semantics that are too detailed for the package README.

## Generated Field Specs

`field.generated(...)` accepts a generated-field spec with:

- `type`
- optional `typeParams`
- `generated`

Built-in ID helpers from `@internal/ids` already return that shape, so calls such as `field.generated(uuidv4()).id()` and `field.generated(nanoid({ size: 12 })).id()` are valid.

If you are composing the spec yourself instead of using an ID helper, pass the same `{ type, typeParams?, generated }` structure.

## Helper Quick Reference

- Structural helpers: `field.column(...)`, `field.generated(...)`, `field.namedType(...)`, plus `model(...)` and `rel.*`
- Callback helper presets: `field.id.uuidv4String()`, `field.id.uuidv7String()`, `field.id.nanoid({ size })`, `field.uuidString()`, `field.text()`, `field.temporal.createdAt()`, `field.temporal.updatedAt()`, and `type.*` (Postgres also adds `field.uuidNative()`, `field.id.uuidv4Native()`, `field.id.uuidv7Native()` — these emit `pg/uuid@1`)
- Integer representation types: PostgreSQL and SQLite expose `type.BigIntNumber()`; PostgreSQL also exposes `type.UnboundedInt()`. Register each result in the contract's returned `types` map and pass that same instance to `field.namedType(...)`, or use a direct per-codec column helper with `field.column(...)`. Bare `field.bigint()` keeps the lossless `pg/int8@1`. See [Integer representation types](../../../../docs/reference/integer-representation-types.md) for selection, runtime guards, canonical JSON forms, and aggregate behavior.
- `field.temporal.createdAt()` is the create-time timestamp helper and lowers to the target storage `now()` default. `field.temporal.updatedAt()` is the update-time timestamp helper and lowers to the target-owned `timestampNow` execution default for create and non-empty update mutations.
- Field-local and FK-local storage overrides stay next to the authoring site with `field.sql(...)` and `rel.belongsTo(...).sql({ fk })`
- Prefer typed local refs such as `field.namedType(types.Role)`, `User.refs.id`, and `User.ref('id')` when those tokens are available

## Integer Representation Forms

The composed-type form registers the constructor result and reuses that exact instance at each field:

```typescript
const types = {
  BigIntNumber: type.BigIntNumber(),
  UnboundedInt: type.UnboundedInt(),
} as const;

return {
  types,
  models: {
    Meter: model('Meter', {
      fields: {
        peak: field.namedType(types.BigIntNumber),
        lifetime: field.namedType(types.UnboundedInt),
      },
    }),
  },
};
```

The direct form skips named-type registration and wraps the exported helper result: `field.column(pgInt8NumberColumn())` or `field.column(pgUnboundedIntColumn())` from `@internal/target-postgres/codecs`, and `field.column(sqliteBigintNumberColumn())` from `@internal/target-sqlite/codecs`. Both forms preserve the same codec and application type.

## Validation and Warnings

- Duplicate named storage objects are rejected during build. This includes named primary keys, uniques, indexes, and foreign keys in the authored contract.
- String fallbacks such as `field.namedType('Role')` or `constraints.ref('User', 'id')` still work, but they emit typed-fallback warnings when a local typed token is available in the same contract.
- Prefer local typed references such as `field.namedType(types.Role)`, `User.refs.id`, and `User.ref('id')` when those tokens are available.

Contributor-facing lowering notes and implementation details live in [DEVELOPING.md](./DEVELOPING.md).
