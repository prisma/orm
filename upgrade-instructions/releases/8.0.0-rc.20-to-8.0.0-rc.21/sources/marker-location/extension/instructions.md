---
changes:
  - id: control-adapter-marker-location
    summary: |
      `SqlControlAdapter` (from `@prisma/orm-family-sql/family/control-adapter`) and `MongoControlAdapter` (from `@prisma/orm-family-mongo/family/control-adapter`) have a new required field, `markerLocation`: the name of the table or collection that holds the contract markers, which messages show the user. `ControlFamilyInstance` (from `@prisma/orm-framework/components/control`) has it too; the SQL and Mongo families read it from the control adapter.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\s\S])(?![\s\S]*markerLocation)(?=[\s\S]*\b(?:SqlControlAdapter|MongoControlAdapter)\b)[\s\S]*\breadMarker\s*[(:]'
        - '(?<![\s\S])(?![\s\S]*markerLocation)(?=[\s\S]*\bControlFamilyInstance\b)[\s\S]*\bstorageNameOf\s*[(:]'
  - id: control-adapter-hold-marker-lock
    summary: |
      `SqlControlAdapter` has a new optional method, `holdMarkerLock(driver, work)`. A target whose DDL ends an open transaction provides it: `db sign` then creates the marker table under that lock, outside the transaction that writes the markers. Without it, `db sign` takes the lock with `lockMarker` and creates the marker table inside that transaction, as before.
  - id: verify-contract-spaces-marker-location
    summary: |
      `verifyContractSpaces` (from the `spaces` subpath of the migration tools) takes a required `markerLocation`, the name of the target's marker table or collection, which the remediation of an orphan marker names.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\w$])verifyContractSpaces\s*\('
---

# A control adapter names where it keeps its markers

Add `markerLocation` to your control adapter, so messages about the contract markers name the right table:

```ts
// Before
export class MyControlAdapter implements SqlControlAdapter<'my-target'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'my-target' as const;
  …
}

// After
export class MyControlAdapter implements SqlControlAdapter<'my-target'> {
  readonly familyId = 'sql' as const;
  readonly targetId = 'my-target' as const;
  readonly markerLocation = 'my_schema.marker';
  …
}
```

The same applies to an adapter written as an object literal or returned by a factory: add `markerLocation: 'my_schema.marker'` to the object.

A family that implements `ControlFamilyInstance` itself adds `markerLocation` too, usually read from its control adapter:

```ts
return {
  familyId: 'my-family',
  get markerLocation() {
    return getControlAdapter().markerLocation;
  },
  …
};
```

A test double that builds a control adapter or a `ControlFamilyInstance` sets it too.

# A target whose DDL ends a transaction can hold the marker lock itself

If your database commits a transaction when it runs DDL, as MySQL does, give your SQL control adapter `holdMarkerLock(driver, work)`: take the marker lock, run `work`, and release the lock when `work` ends. `db sign` then creates the marker table inside `work`, under the lock, and writes the markers in a transaction after it. A target whose DDL is transactional needs nothing: without `holdMarkerLock`, `db sign` keeps the lock, the marker table and the writes in one transaction.

A call to `verifyContractSpaces` passes the marker location of the target it verifies, such as `markerLocation: 'prisma_contract.marker'` for Postgres or `'_prisma_marker'` for SQLite.
