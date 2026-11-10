---
changes:
  - id: sql-with-a-line-comment-gets-a-new-wire-name
    summary: |
      An index, check or policy whose SQL body contains both `--` and a line break gets a new name in `contract.json` once. The next `migration plan` drops and recreates the object.
    detection:
      glob: "**/contract.json"
      matches:
        - '"(?:[^"\\]|\\.)*?--(?:[^"\\]|\\.)*?\\n|"(?:[^"\\]|\\.)*?\\n(?:[^"\\]|\\.)*?--'
---

# Line comments in raw SQL are safe

## SQL with a line comment gets a new wire name

Prisma names an index, check or policy after a hash of its SQL body. Before hashing, it normalizes the body. A body that contains `--` now keeps its line breaks, because a line break ends the comment and so changes what the body means. Every other body normalizes as before.

This affects an index expression or predicate, a check expression, or a policy `using` or `withCheck` that contains both `--` and a line break. For such an object, re-emitting the contract changes the stored index, check or policy name in `contract.json`. The stored body does not change; only the hash input does.

Re-emit the contract and run `migration plan`. The name's hash suffix changes, so the planned migration drops and recreates each affected object once.
