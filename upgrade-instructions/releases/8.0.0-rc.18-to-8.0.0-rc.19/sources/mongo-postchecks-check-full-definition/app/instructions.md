---
changes:
  - id: mongo-postchecks-check-full-definition
    summary: |
      On MongoDB, the checks that let the runner skip an operation whose effect is already in place now check the whole definition. `createIndex` checks every index option the planner tells indexes apart by, not only the keys and `unique: true`. `collMod` with a validator that is not only a `$jsonSchema` compares the whole validator. An `ops.json` written by an earlier release still carries the old checks; write it again before you apply it.
    detection:
      glob: "**/ops.json"
      matches:
        - '(?<![\s\S])(?![\s\S]*"field":\s*"sparse")[\s\S]*"description":\s*"index exists on '
        - '(?<![\s\S])(?![\s\S]*"field":\s*"options\.validator)[\s\S]*"description":\s*"validator applied on '
---

# MongoDB postchecks check the whole definition

## `mongo-postchecks-check-full-definition`

The runner checks an operation's postchecks before it runs the operation, and skips the operation when they already hold. MongoDB has no transaction, so a run that fails part way relies on this skip when it runs again. Two MongoDB postchecks held for a different state:

- `createIndex` checked only the index keys, and `unique: true` when the index is unique. An index on the same keys with other options, such as `sparse`, a TTL, a partial filter, a collation, a wildcard projection, or other text weights or languages, passed the check, so the operation was skipped. It now checks `unique` and `sparse` both ways, `expireAfterSeconds`, `partialFilterExpression`, `wildcardProjection`, the collation fields the call gives (MongoDB fills in the others) or no collation when it gives none, and a text index's fields, `weights`, `default_language` and `language_override`.
- `collMod` with a validator that is not only a `$jsonSchema`, such as `{ status: { $in: [...] } }`, checked only the collection's validation level and action. It now compares the whole validator.

The checks are written into `ops.json` when the migration package is written. A matched `ops.json` needs action only when its migration is not applied yet. Write its `ops.json` again before you apply it: run its `migration.ts` (`node migration.ts`), or delete the package and run `prisma migration plan` again. An applied migration needs nothing.
