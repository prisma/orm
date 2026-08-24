# Journey 02e — Recover from `MIGRATION.HASH_MISMATCH`

**Skills under test:** `prisma-next-debug`, `prisma-next-migrations`.

**Acceptance criterion:** AC5e.

## Setup

Plan a migration. Edit its `migration.ts` (add a no-op comment). Do NOT self-emit. Attempt to apply.

## Prompt

> I get this error when I run `db migrate`:
>
> ```text
> code: PN-MIG-2042
> kind: MIGRATION.HASH_MISMATCH
> message: ops.json hash does not match migration.json
> ```
>
> Help me fix it.

## Expected agent behavior

- [ ] Reads the envelope, recognises `MIGRATION.HASH_MISMATCH`.
- [ ] Names the cause: `migration.ts` edited after the initial emit.
- [ ] Runs `node migrations/<dir>/migration.ts` (self-emit).
- [ ] Re-runs `db migrate`.

## Success criteria

- [ ] Self-emit step happened.
- [ ] Apply completed.
- [ ] Agent did NOT delete and re-plan the migration (overkill; loses the user's edits).
