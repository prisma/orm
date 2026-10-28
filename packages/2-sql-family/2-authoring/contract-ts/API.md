# @internal/sql-contract-ts API Notes

This page collects user-facing helper semantics that are too detailed for the package README.

## Helper Quick Reference

- Structural helpers: `field.column(...)`, `field.namedType(...)` (an enum handle only), plus `model(...)` and `rel.*`
- Callback helpers: `type.*` and `gen.*`. A generated id is its identifier's type alias with the generator, `field.column(type.sql.UuidString()).id().onCreate(gen.uuid())` on every SQL target (`type.UuidString()` on Postgres), or on Postgres `field.column(type.Uuid()).id().onCreate(gen.uuid(7))`, which emits `pg/uuid@1`. There are no field presets and no `field.generated(...)`.
- Integer representation types: PostgreSQL and SQLite expose `type.BigIntNumber()`; PostgreSQL also exposes `type.UnboundedInt()`. Pass the result to `field.column(...)`, or use a direct per-codec column helper with `field.column(...)`. `type.BigInt()` keeps the lossless `pg/int8@1`. See [Integer representation types](../../../../docs/reference/integer-representation-types.md) for selection, runtime guards, canonical JSON forms, and aggregate behavior.
- `field.column(type.temporal.CreatedAt())` generates a client-side timestamp on create. `field.column(type.temporal.UpdatedAt())` uses the same execution generator on create and non-empty update mutations. Neither creates a database default; matching representations share one generated value per operation.
- Field-local and FK-local storage overrides stay next to the authoring site with `field.sql(...)` and `rel.belongsTo(...).sql({ fk })`
- Prefer typed local refs such as `field.namedType(Role)`, `User.refs.id`, and `User.ref('id')` when those tokens are available

## Integer Representation Forms

The composed-type form passes the constructor result to `field.column(...)`. A constant shares it between fields:

```typescript
const BigIntNumber = field.column(type.BigIntNumber());

return {
  models: {
    Meter: model('Meter', {
      fields: {
        peak: BigIntNumber,
        lifetime: field.column(type.UnboundedInt()),
      },
    }),
  },
};
```

The direct form wraps the exported helper result: `field.column(pgInt8NumberColumn())` or `field.column(pgUnboundedIntColumn())` from `@internal/target-postgres/codecs`, and `field.column(sqliteBigintNumberColumn())` from `@internal/target-sqlite/codecs`. Both forms preserve the same codec and application type.

## Validation and Warnings

- Duplicate named storage objects are rejected during build. This includes named primary keys, uniques, indexes, and foreign keys in the authored contract.
- String fallbacks such as `constraints.ref('User', 'id')` still work, but they emit typed-fallback warnings when a local typed token is available in the same contract. `field.namedType(...)` takes only an enum handle; a string or a codec instance is a type error.
- Prefer local typed references such as `field.namedType(Role)`, `User.refs.id`, and `User.ref('id')` when those tokens are available.

Contributor-facing lowering notes and implementation details live in [DEVELOPING.md](./DEVELOPING.md).
