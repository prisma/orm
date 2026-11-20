# Readme

This test suite is for ensuring that the `PrismaClient` and related utils can be correctly imported in various scenarios:

- Ensures that `module`/`moduleResolution` combinations produce a deprecated `PrismaClient` with additional instructions.
- Ensures that imports from `@prisma/client/runtime/client` are allowed and work both on the type level and at runtime.
- Ensures that `accelerate` and `read-replicas` extensions can be imported and used correctly on the type level and at runtime.
- Ensure that Driver Adapters are working both on the type level and at runtime.
