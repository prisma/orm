---
changes:
  - id: supabase-contract-regenerated-from-the-reference-fixture
    summary: The Supabase extension contract is regenerated and now declares the reference build's 43 check constraints, six native-enum defaults as member literals, and an element-not-null waiver on two more list columns, so its storage hash changes; re-sign databases that were signed against the previous Supabase contract, and check your own Supabase build declares the same constraints.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/orm-extension-supabase"'
---

## `supabase-contract-regenerated-from-the-reference-fixture`

The `@prisma/orm-extension-supabase` contract is now exactly what `contract:generate` produces from the reference fixture, which it had drifted away from. The Supabase space's storage hash changes from `ede079259d126d9153bcb4fc4aa6781d870a255585524e1e95fae9e5af4eef89` to `43f09411473534105017fa715b8932facbdf79feab1bfc75da681beb87f22cbc`.

Four things changed in the contract.

**43 check constraints are now declared.** Every `CHECK` that the pack's reference Supabase build declares on an `auth` or `storage` table — for example `users_email_change_confirm_status_check` and `one_time_tokens_token_hash_check` — is now part of the contract. The reference build is supabase/postgres 17.6.1.106 with gotrue 2.188.1 and storage-api 1.54.1. On a database at or near that version the constraints are already present, so `prisma db verify` passes without a schema change. This is the one item that can newly fail for you: the checks used to be a tolerated live extra and are now a declared shape, so if your Supabase build's constraint set differs, verify reports the missing ones. You cannot repair that with a migration, because Prisma emits no DDL against an externally controlled table; report the difference so the pack's reference fixture can be refreshed.

**Six native-enum column defaults are declared as member literals.** `auth.oauth_clients.client_type`, `auth.oauth_authorizations.response_type`, `auth.oauth_authorizations.status`, and the `type` column of `storage.buckets`, `storage.buckets_analytics` and `storage.buckets_vectors` previously carried the raw cast expression as their default, for example `{ "kind": "function", "expression": "'STANDARD'::storage.buckettype" }`. They now carry the enum member itself: `{ "kind": "literal", "value": "STANDARD" }`. This is the same live default read a more precise way, so the live databases need no change; if you read a column's declared default out of the contract, expect a literal rather than an expression.

**Two list columns carry an element-not-null waiver.** `auth.custom_oauth_providers.acceptable_client_ids` and `auth.custom_oauth_providers.scopes` now carry `"noCheck": ["elementNotNull"]`, matching the two `storage` list columns that already did. `contract infer` writes this for any list column with no live check at the derived name, and the committed contract is the generator's output, so it carries it too. This item moves the storage hash and changes nothing else you can observe: the pack is under `external` control, so a derived check is stripped before emit whether the waiver is written or not, and `db verify` demanded no such constraint before and demands none now.

**78 timestamp columns are written as `Timestamptz` instead of `DateTime` in the PSL.** Same codec (`pg/timestamptz-temporal@1`) and same emitted column, so this is a text change only.

A contract that composes the Supabase space references it by id, so your own `contract.json` and `contract.d.ts` do not change. What changes is the signature: a database that was signed against the previous Supabase contract no longer matches the new hash, so run `prisma db sign` against it after upgrading. If you re-emit your own contract, do that first so the composed space is the new one.
