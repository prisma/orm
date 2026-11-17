---
changes:
  - id: access-changes-rename
    summary: |
      `accessWidening` is renamed `accessChanges` on `MigrationPlanSubjects` (from `@prisma/orm-framework/components/control`) and on every type that extends it: `MigrationPlannerSuccessResult`, `PerSpacePlan` and `DbUpdateSuccess`. The subjects argument of `plannerSuccess` from `@prisma/orm-family-sql/family/control` takes `accessChanges`, and the control API option `acceptAccessWidening` becomes `acceptAccessChanges`. There is no alias for the old names.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\w$])(?:acceptAccessWidening|accessWidening)(?![\w$])'
---

# `accessWidening` is renamed `accessChanges`

A migration planner lists each operation that changes who can read or write data. Such an operation does not always widen access, so the list is now `accessChanges`. Each entry is still a `MigrationAccessChange`, with `widens` saying whether it widens access. Rename the property wherever a planner, a test double or a hand-built plan sets or reads it:

```ts
// Before
return { kind: 'success', plan, appliedStatements, dataLoss: [], accessWidening: [], temporaryValues: [] };
plannerSuccess(plan, appliedStatements, { dataLoss: [], accessWidening: [], temporaryValues: [] });

// After
return { kind: 'success', plan, appliedStatements, dataLoss: [], accessChanges: [], temporaryValues: [] };
plannerSuccess(plan, appliedStatements, { dataLoss: [], accessChanges: [], temporaryValues: [] });
```

A caller of the control API's `executeDbUpdate` or `dbUpdate` renames the option `acceptAccessWidening` to `acceptAccessChanges`, and reads `accessChanges` from a `DbUpdateSuccess`.
