---
changes:
  - id: better-auth-1-7-22
    summary: |
      `@prisma/orm-better-auth` needs Better Auth 1.7.22 or a later 1.7 release: its peer range for `@better-auth/core` is now `>=1.7.22 <1.8.0`. Better Auth 1.7.6 to 1.7.21 run the adapter's contract check when the auth instance is created, and log a contract that is missing something as "Could not validate the database schema. Check your database connection.", which is wrong. Raise `better-auth`, `@better-auth/core` where it is a direct dependency, and the `auth` command to 1.7.22 or later.
    detection:
      glob: "**/package.json"
      matches:
        - '"@prisma/orm-better-auth"\s*:'
---

# Better Auth 1.7.22 or later for `@prisma/orm-better-auth`

If the application depends on `@prisma/orm-better-auth`, raise `better-auth` to 1.7.22 or a later 1.7 release, together with `@better-auth/core` and the `auth` command if the application lists them, then install:

```sh
pnpm add better-auth@~1.7.22
```

Releases from 1.7.6 to 1.7.21 still work, but print a false "Check your database connection" error at startup whenever the contract is missing something Better Auth needs, and the package manager warns that the peer range is not met.
