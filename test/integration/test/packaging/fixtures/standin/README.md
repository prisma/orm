# `prisma-orm-standin`

A target package written the way someone outside Prisma would write one, under
an unscoped name of the form community packages use, for
`test/packaging/standin-target.test.ts`. It appears in no list in this
repository. The test builds it with `tsc` against the packed published
packages, packs it, and installs it into a scratch application.

It reuses the published PostgreSQL target's descriptors behind its own name,
so its codec and operation types are real, and restates their type
declarations to name its own `contract-types` module.

Its `init` entrypoint is an init contribution, so the test sets the application up with `prisma orm init --target prisma-orm-standin` before it emits and plans. Its `runtime` and `static` entrypoints re-export the published PostgreSQL client, which the `db.ts` that init writes imports.
