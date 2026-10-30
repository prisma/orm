---
changes:
  - id: migrate-options-ref
    summary: |
      The control client's `migrate` options (`MigrateOptions`, from `@prisma/orm-toolchain/cli/control-api`) no longer take `refHash`, `refInvariants` and `refName`. They take one field, `ref`: the target the application space walks to, `{ hash, invariants }`, plus `name` and `policies` when the target is a ref. Pass the whole ref entry you read, with its name: `ref: { name, ...entry }`. A bare contract hash is `ref: { hash, invariants: [] }`. `dbUpdate` takes the same `ref`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\w$])refHash\s*[:,}]'
        - '(?<![\w$])refInvariants\s*[:,}]'
  - id: permit-policy-change
    summary: |
      A ref can declare the policies its database should have, in a `policies` field of its ref file, and the database's marker records the policies in force. `migrate` and `dbUpdate` refuse a ref whose declared policies differ from the database's with `MIGRATION.POLICY_MISMATCH`, unless the new option `permitPolicyChange: true` consents to writing them. Pass `permitPolicyChange` only when the person running the deploy has said the ref's policies should be applied. A database whose change policy does not permit the operation refuses with `MIGRATION.CHANGE_POLICY_FORBIDS`; `db sign` refuses the same way.
---

# `migrate` takes the target ref whole, and consents to a policy change

```ts
// Before
await client.migrate({
  contract,
  migrationsDir,
  invocation,
  refHash: entry.hash,
  refInvariants: entry.invariants,
  refName: 'production',
});

// After
await client.migrate({
  contract,
  migrationsDir,
  invocation,
  ref: { name: 'production', ...entry },
  // Only when the deploy should write the ref's declared policies into the database:
  permitPolicyChange: true,
});
```

A ref file may now carry `policies`:

```json
{
  "hash": "4b1c…e09a",
  "invariants": [],
  "policies": {
    "change": ["migrate"],
    "dataProtection": { "dataLoss": "data-loss-with-consent", "accessWidening": "access-widening-forbidden" }
  }
}
```

Code that writes ref files keeps the `policies` and `invariants` it read. A successful `migrate` that recorded policies returns them in `policiesUpdated`, one `{ setting, declared, inForce }` per setting it changed.
