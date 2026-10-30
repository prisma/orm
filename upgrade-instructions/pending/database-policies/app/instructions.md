---
changes:
  - id: migrate-options-ref
    summary: |
      The control client's `migrate` options (`MigrateOptions`, from `@prisma/orm-toolchain/cli/control-api`) no longer take `refHash`, `refInvariants` and `refName`. When the target is a ref, pass it whole as `ref`, with its name: `ref: { name, ...entry }` (`NamedRef`, from `@prisma/orm-toolchain/migration-tools/refs`); the application space walks to its hash by a path that provides its invariants, and its declared policies are checked. When the target is a contract hash, pass `targetHash` instead. `dbUpdate` takes the same `ref` for the ref `--to` named: its hash must be the storage hash of the `contract` you pass, or the call fails as an internal error. `dbSign` takes a required `invocation`, like `migrate`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\w$])refHash\s*[:,}]'
        - '(?<![\w$])refInvariants\s*[:,}]'
  - id: db-sign-invocation
    summary: |
      `DbSignOptions` has a required `invocation`, `{ cwd, configPath, dbGiven }`, so the advice of a refusal repeats the `--config` and `--db` the command was given. Pass the same `invocation` you pass to `migrate`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '\.dbSign\s*\('
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
  // or, for a contract hash rather than a ref: targetHash: hash,
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

Code that writes ref files keeps the `policies` and `invariants` it read. A successful `migrate` that recorded policies returns them in `databasePoliciesUpdated`, one `{ setting, declared, inForce }` per setting it changed; `setting` is the key path in the ref's `policies` (`change`, `dataProtection.dataLoss`, `dataProtection.accessWidening`). `dbUpdate`'s result carries the same field.
