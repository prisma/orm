# Readme

This test suite is for ensuring that the `PrismaClient` and related utils can be correctly imported in various scenarios:

- Ensures that `module`/`moduleResolution` combinations produce a deprecated `PrismaClient` with additional instructions.
- Ensures that imports from `@prisma/client/runtime/client` are allowed and work both on the type level and at runtime.
- Ensures that `accelerate` and `read-replicas` extensions can be imported and used correctly on the type level and at runtime.
- Ensure that Driver Adapters are working both on the type level and at runtime.

## Note on the `pg-protocol` override

`pg-protocol` is pinned via `pnpm.overrides` because its `1.15.0` release uses
generic `Buffer<T>` types in its declaration files, which fail to typecheck
against the `@types/node@20` / TypeScript 5.4 combination this suite
intentionally tests (`Type 'Buffer' is not generic`, TS2315). Since `pg` pulls
it in via a floating `^` range, an unpinned install breaks whenever a new
`pg-protocol` release requires newer `@types/node` than the suite targets.
