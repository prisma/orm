---
changes:
  - id: psl-default-namespace-duplicate-declaration
    summary: |
      A declaration at the top level of a PSL schema and one inside `namespace public { … }` (Postgres) now share one set of names. The same name declared both ways is `PSL_DUPLICATE_DECLARATION`, and so is a member of `namespace public { … }` named like a `types { }` binding or a namespace. Remove or rename one.
    detection:
      glob: "**/*.{prisma,psl}"
      matches:
        - '(^|\n)\s*namespace\s+public\s*\{'
  - id: psl-default-namespace-name-is-reserved
    summary: |
      A top-level model, composite type, block or `types { }` binding cannot be named like the target's default namespace: `public` on Postgres; `unbound` or `__unbound__` on SQLite and MongoDB. This also holds for a schema read with `prisma7Schema(...)` or `prisma6Schema(...)`. Rename the declaration.
    detection:
      glob: "**/*.{prisma,psl}"
      matches:
        - '(^|\n)[ \t]*(?!namespace[ \t])[A-Za-z_]\w*[ \t]+(public|unbound|__unbound__)[ \t]*\{'
        - '(^|\n)\s*(public|unbound|__unbound__)\s*=\s*\S'
---

# Top-level declarations belong to the default namespace

A declaration written at the top level of a schema is a member of the target's default namespace: `public` on Postgres, the late-bound namespace (`unbound`, contract id `__unbound__`) on SQLite and MongoDB. Emitted contracts do not change.

## `psl-default-namespace-duplicate-declaration`

```prisma
model Account {
  id Int @id
}

namespace public {
  model Account {
    id Int @id
  }
}
```

This is `PSL_DUPLICATE_DECLARATION: Duplicate declaration of "Account"` on the second declaration. Remove one or rename it. The same holds for a member of `namespace public { … }` named like a `types { }` binding, like another namespace, or `public`.

## `psl-default-namespace-name-is-reserved`

A top-level declaration named `public` (Postgres), or `unbound` or `__unbound__` (SQLite, MongoDB), is rejected, even when the schema has the name once, because the default namespace already has it:

```text
PSL_DUPLICATE_DECLARATION: Duplicate declaration of "public"
```

On Postgres, `unbound` and `__unbound__` are rejected only when the schema also has a `namespace unbound { … }` or `namespace __unbound__ { … }` block. Rename the declaration; on a model, `@@map("public")` keeps the table or collection name. A schema read with `prisma7Schema(...)` or `prisma6Schema(...)` is the file the Prisma 7 or Prisma 6 client reads, so the rename applies there too.
