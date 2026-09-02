# Journey 02d — Capability-gated `returning()`

**Skills under test:** `prisma-orm-core-concepts` (queries, contract).

**Acceptance criterion:** AC5d.

## Prompt

> Update every user with role='USER' to role='GUEST' and return the affected rows.

## Expected agent behavior

- [ ] Attempts the update with `.update(...).returning('id', 'email')`.
- [ ] Recognises a type-check error indicating the `returning` capability isn't enabled.
- [ ] Edits `prisma.config.ts` to add `capabilities: { returning: true }`.
- [ ] Runs `contract emit`.
- [ ] Re-runs the query; it now typechecks.

## Success criteria

- [ ] The capability flag landed in `prisma.config.ts`.
- [ ] The query returned `Array<{ id, email }>`.
- [ ] Agent did NOT confabulate a different API to avoid enabling the capability.
