# Journey 02c — Fill a placeholder data transform

**Skills under test:** `prisma-next-migrations`.

**Acceptance criterion:** AC5c.

## Prompt

> Add a `displayName String` field to User, NOT NULL, defaulting to the user's email if displayName isn't set yet.

## Expected agent behavior

- [ ] Adds `displayName String` (initially nullable) to the contract.
- [ ] Emits, plans, observes a `placeholder(...)` in `migration.ts`.
- [ ] Replaces the placeholder with `UPDATE user SET displayName = email WHERE displayName IS NULL`.
- [ ] Adds a follow-up step to ALTER COLUMN to NOT NULL.
- [ ] Self-emits the migration (`node migrations/<dir>/migration.ts`).
- [ ] Applies.

## Success criteria

- [ ] Placeholder replaced, not left as-is.
- [ ] Self-emit ran (timestamps on `ops.json` advanced after the TS edit).
- [ ] `db migrate` completed without `MIGRATION.PLACEHOLDER_NOT_FILLED`.
- [ ] Existing rows have a non-null `displayName`.
