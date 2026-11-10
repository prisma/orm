---
changes:
  - id: schema-verification-failed-schema-issues
    summary: |
      The `CONTRACT.SCHEMA_VERIFICATION_FAILED` diagnostic of `db verify --json` and `db sign --json` carries the schema differences in `meta.schemaIssues`, as issue objects, instead of `meta.issues`, as label strings. Code that reads `meta.issues` from that diagnostic reads `meta.schemaIssues` instead.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*(?:\bdb (?:verify|sign)\b|SCHEMA_VERIFICATION_FAILED))[\s\S]*\bmeta(?:\?\.|\.|\?\.\[|\[)(?:issues\b|[''"]issues[''"]\])'
---

# The schema check's differences are in `meta.schemaIssues`

When `db verify` or `db sign` finds that the database schema does not match the contract, its `--json` output has a diagnostic with the code `CONTRACT.SCHEMA_VERIFICATION_FAILED`. Its `meta.issues` was a list of label strings, such as `"missing: public/users/email"`. It is now `meta.schemaIssues`, a list of issue objects, the same key and shape the `MIGRATION.SCHEMA_VERIFY_FAILED` failure of `db init`, `db update` and `db migrate` already uses. `meta.space` and `meta.code` are unchanged, and so is `schema.issues` in the result of a check that passed.

Each issue has a `path`, the location of the difference as a list of names, and `expected` and `actual`, the contract's and the database's side, one of which is absent for a missing or an extra object. It has an `explanation` with a `text` when the CLI can say more.

In code that reads the diagnostic, read `meta.schemaIssues` where it read `meta.issues`. Where it used the label strings, build them from the issue. A label was the outcome, then the path: `missing` when only `expected` is set, `extra` when only `actual` is set, and `mismatch` when both are:

```typescript
// before
const labels: string[] = diagnostic.meta.issues;
// after
const labels = diagnostic.meta.schemaIssues.map((issue) => {
  const outcome = issue.actual === undefined ? 'missing' : issue.expected === undefined ? 'extra' : 'mismatch';
  return `${outcome}: ${issue.path.join('/')}`;
});
```

The `why` of the diagnostic still lists every difference as text.
