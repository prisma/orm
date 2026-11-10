---
changes:
  - id: verify-contract-spaces-marker-location
    summary: |
      `verifyContractSpaces` (from the `spaces` subpath of the migration tools) takes a required `markerLocation`, the name of the target's marker table or collection, which the remediation of an orphan marker names.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\w$])verifyContractSpaces\s*\('
---

# `verifyContractSpaces` names the marker location

A project that checks its contract spaces itself passes the marker location of its target to `verifyContractSpaces`, so the advice for an orphan marker names the right table:

```ts
// Before
verifyContractSpaces({ loadedSpaces, spaceDirsOnDisk, headRefsBySpace, markerRowsBySpace });

// After
verifyContractSpaces({
  loadedSpaces,
  spaceDirsOnDisk,
  headRefsBySpace,
  markerRowsBySpace,
  markerLocation: 'prisma_contract.marker',
});
```

The marker location is `prisma_contract.marker` on Postgres, `_prisma_marker` on SQLite and MySQL, and `_prisma_migrations` on MongoDB.
