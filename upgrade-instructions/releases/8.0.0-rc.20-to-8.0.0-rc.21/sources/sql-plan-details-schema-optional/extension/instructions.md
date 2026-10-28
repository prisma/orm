---
changes:
  - id: plan-target-details-schema-optional
    summary: |
      `SqlPlanTargetDetails.schema` (from `@prisma/orm-family-sql/family/control`) is optional, and SQLite operations no longer carry `schema: 'main'`. Code that reads `target.details.schema` handles `undefined`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\.details\??\.schema(?![\w$])'
---

# A SQL operation's schema is optional

Code that reads `target.details.schema` from a SQL migration operation treats it as `string | undefined`: SQLite and MySQL operations name no schema.
