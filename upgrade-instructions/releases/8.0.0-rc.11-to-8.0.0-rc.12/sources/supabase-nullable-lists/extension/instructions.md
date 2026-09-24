---
changes:
  - id: supabase-contract-declares-nullable-list-columns
    summary: The Supabase extension contract now declares storage.buckets.allowed_mime_types and storage.objects.path_tokens as nullable lists, so its storage hash changes; re-sign databases that were signed against the previous Supabase contract.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/orm-extension-supabase"'
---

## `supabase-contract-declares-nullable-list-columns`

The `@prisma/orm-extension-supabase` contract gains two fields that were previously omitted because the PSL printer could not write a nullable list: `StorageBucket.allowedMimeTypes` (`storage.buckets.allowed_mime_types`) and `StorageObject.pathTokens` (`storage.objects.path_tokens`), both `String[]?`. The Supabase space's storage hash changes from `409d9a5191d9d7d8e45a795cb55695a79edce9d8f42ff1e456bce6e79f98dff1` to `ede079259d126d9153bcb4fc4aa6781d870a255585524e1e95fae9e5af4eef89`.

A contract that composes the Supabase space references it by id, so your own `contract.json` and `contract.d.ts` do not change. What changes is the signature: a database that was signed against the previous Supabase contract no longer matches the new hash, so run `prisma db sign` against it after upgrading. Both columns already exist on every Supabase database, so `prisma db verify` passes without a schema change. `path_tokens` is `GENERATED ALWAYS`: read it, do not write it.
