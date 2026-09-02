# Journey 08 — Supabase: RLS-scoped profile listing

**Skills under test:** `prisma-orm-core-concepts` (supabase), `prisma-orm-core-concepts` (contract), `prisma-orm-core-concepts` (queries).

**Example app:** `examples/supabase` (the canonical Supabase walking skeleton), or a fresh project wired per the `prisma-orm-core-concepts` (supabase) config workflow against a disposable Supabase project.

## Prompt

> users should only be able to update their own profile, but anyone can browse the list — set that up and show me the handler code

## Expected agent behavior

- [ ] Confirms the Supabase pack is composed (`extensions: [supabasePack]` in `prisma.config.ts`); wires it if absent.
- [ ] Declares (or confirms) the `Profile` model with a cross-space FK typed `supabase:auth.AuthUser` and `@@rls`.
- [ ] Authors the policies in the contract — a `policy_select` for `anon`/`authenticated` browse and a `policy_update` with `using` **and** `withCheck` scoped to `auth.uid()` — not hand-written `CREATE POLICY` SQL.
- [ ] Quotes camelCase columns and casts appropriately inside predicate strings (`"userId"::uuid = auth.uid()`).
- [ ] Emits + migrates; does not expect DDL for `auth.*`.
- [ ] Mentions the one-time `GRANT`s for `anon` / `authenticated` on the table.
- [ ] Handler code binds a role first: `await db.asUser(jwt)` for the update path, `db.asAnon()` for the browse path — no top-level `db.orm` / `db.sql`.
- [ ] `asUser` failure handling matches the structured code `SUPABASE.JWT_INVALID` (via `isStructuredError`), not a class.

## Success criteria

- [ ] The policies live in the contract source; `contract.json` carries them after emit.
- [ ] Browse-as-anon returns all rows; update-as-user affects only the caller's row (0 rows for someone else's).
- [ ] The agent did NOT use the stock `postgres()` factory for the Supabase app, did NOT invent a `/control` subpath, and did NOT put `.supabase` on a non-service role.
- [ ] The agent did NOT recommend the transaction pooler (port 6543) connection string.
