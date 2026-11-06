# ADR 237 — Supabase-internal access is a `service_role`-only secondary root

**Status:** Accepted

A Supabase app sometimes needs to read Supabase-owned tables — `auth.users`, `auth.sessions`, `storage.objects` — for admin work: seeding test users, auditing sessions, joining storage metadata into a report. Those tables belong to the Supabase extension's contract, not the app's. This is how the app reaches them:

```ts
const admin = db.asServiceRole();

// The secondary root: the extension contract's own query surface.
const users = await admin.supabase.orm.auth.AuthUser.select('id', 'email').all();
const sessions = await admin.supabase
  .execute(admin.supabase.sql.auth.sessions.select('id', 'aal').build())
  .toArray();

// The primary surfaces stay app-only, on every role:
admin.orm.public.Profile;         // ✅ the app's own contract
admin.orm.auth?.AuthUser;         // ✗ does not exist — auth.* is not in the app contract
db.asAnon().supabase;             // ✗ does not exist — .supabase is service_role-only
(await db.asUser(jwt)).supabase;  // ✗ does not exist
```

`admin.supabase` is a **secondary root**: a complete, separate query surface (`.sql`, `.orm`, `.nativeEnums`, `.execute`) bound to the *extension's* contract, present only on the `service_role`-bound db.

## Decision

Admin access to Supabase-internal tables is exposed as a secondary root on `asServiceRole()` and nowhere else. Structurally:

- The `.supabase` facet is the extension contract's **own intact execution context** — its own `ExecutionContext` and a second runtime bound to it — sharing the app runtime's driver/pool and the `service_role` session.
- The app contract and the extension contract are **never merged**. Each runtime stays bound to exactly one contract.
- Marker verification is off for the extension-bound runtime: the extension contract is `external` and owns no marker in the app's database.
- `asUser` / `asAnon` have no `.supabase` at the type level, and `asServiceRole()`'s primary `.sql` / `.orm` stay scoped to the app contract.

Cross-space *querying* — reaching another contract's tables from the app contract's own query surface — is deliberately not built. Cross-space **FK references** (`supabase:auth.AuthUser` in a relation) are the supported boundary crossing: they let the app's schema point at extension-owned rows, while each contract keeps its own query surface.

## Why the capability is bound to `service_role`

Prisma Next connects over a **direct Postgres connection**, and over that connection Supabase's grants are asymmetric: `service_role` has privileges on the `auth` schema plus `BYPASSRLS`; `anon` and `authenticated` have no `auth.*` grants at all. Putting `.supabase` only on the `service_role`-bound db makes the type surface match the grant surface — a role that cannot read `auth.*` cannot express the attempt.

(The widespread "you can't query `auth.users` on Supabase" advice describes the PostgREST/`supabase-js` HTTP path, which excludes the `auth` schema from its API. It does not apply to a direct connection.)

## Why two runtimes instead of one

The runtime layer is contract-bound by construction: every plan carries the storage hash of the contract it was built from, and the family adapter rejects a plan whose hash doesn't match the executing runtime's contract (`PLAN.HASH_MISMATCH`). A query built against the extension contract therefore *must* execute on a runtime bound to the extension contract — the app runtime would refuse it.

So the facade holds two runtimes — app-bound and extension-bound — sharing one pool and one `service_role` session-binding mechanism (the session-coupled connections of [ADR 230](ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md)). Each contract keeps its own codec registry, its own hashes, its own verification posture. The seam between them is the pool, which is exactly the resource that is safe to share.

Because they share the driver, they close together. Neither runtime owns the driver. `close()` closes both, which makes both refuse new work at once and waits for the work in flight on both, then closes the driver once, and only when the client created the pool.

## Consequences

- **No transaction spans the two roots.** The app root and the `.supabase` root are separate runtimes that do not share a pinned connection; `RoleBoundDb.transaction(...)` exists on the app root only. Work that must be atomic across app and `auth.*` tables doesn't fit this surface.
- **Admin reads, not user management.** Supabase-internal schemas can drift across platform upgrades. Direct `service_role` SQL is appropriate for ad-hoc and admin reads; for creating users, password resets, and similar lifecycle operations, the GoTrue Admin API is the stable interface. This is documentation-level guidance, not enforced.
- **The extension's schema fidelity is verifiable.** Because the extension contract is a real contract with its own context, `db verify` can check the live database against it (shape of `auth.*` / `storage.*`, presence of the platform roles) under the `external` control policy — no DDL is ever planned for those objects.
- **A future aggregate-contract runtime has a clean upgrade path.** A single runtime bound to a composed app + extension contract aggregate would serve both roots natively and provide the substrate for real cross-space querying. The secondary-root surface is forward-compatible with that: `admin.supabase.*` call sites would keep working with the facade re-implemented over the aggregate.

## Alternatives considered

- **Merge the two contracts into one and bind a single runtime to the merged result.** Rejected. The runtime is contract-bound by storage hash, so a merged contract mints a third hash matching neither source — every existing plan and the database marker check break. Merging also collides the codec registries (one registry per contract, keyed by codec id) and has no answer for marker verification (the app space owns a marker; the external extension space must not be checked against it). The contract is the unit of identity throughout the stack; merging dissolves that identity.
- **Expose extension tables inside the app contract's queryable surface** (i.e. make `db.asUser(jwt).sql.auth.users` work). Rejected. It reads as cross-space querying but is really a silent merge with the same identity problems, and it puts `auth.*` behind roles that hold no grants on it — every such query fails at the database with a permission error the type system implied could not happen.
- **Have users hand-construct a second db bound to the extension contract.** Workable without framework support — and rejected as the *shipped* answer: it duplicates the pool (or forces manual pool-sharing plumbing), re-derives the `service_role` session binding by hand, and leaves the "which roles may even try this" question to convention instead of types. The facade does exactly this composition once, correctly, and types the capability onto the one role that holds the grant.
