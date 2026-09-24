---
changes:
  - id: contract-format-formats-prisma7-schema
    summary: prisma contract format now formats a Prisma 7 schema configured through prisma7Schema().
---

# `prisma contract format` formats a Prisma 7 schema

A project whose `contract` is `prisma7Schema('./prisma/schema.prisma')` used to be skipped by `prisma contract format`. The Prisma 7 source is now a PSL source, so the command formats that file with the Prisma 8 formatter when it parses, and refuses without writing when it does not (for example, a schema with a `view` block).

If the Prisma 7 schema must keep Prisma 7's own formatting, do not run `prisma contract format` on it; format it with Prisma 7's `prisma format` instead.
