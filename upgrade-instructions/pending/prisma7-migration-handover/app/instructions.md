---
changes:
  - id: strict-verify-unclaimed-code
    summary: |
      `prisma db verify --strict` now reports a database holding tables no contract declares under `CONTRACT.SCHEMA_VERIFICATION_FAILED`, in both the diagnostic and the JSON result's `code`. It used to report `CONTRACT.MARKER_REQUIRED`. The exit code is still 4. `CONTRACT.MARKER_REQUIRED` now only means the database has not been signed.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs,sh,yml,yaml,json}"
      matches:
        - 'CONTRACT\.MARKER_REQUIRED'
---

# `db verify --strict` reports unclaimed tables as a schema verification failure

## `strict-verify-unclaimed-code`

For each place that reads `CONTRACT.MARKER_REQUIRED` from a `prisma db verify --strict` run to detect tables no contract declares, read `CONTRACT.SCHEMA_VERIFICATION_FAILED` instead, or read the names from the result's `unclaimed` list. Leave code that reads `CONTRACT.MARKER_REQUIRED` to detect an unsigned database unchanged.
