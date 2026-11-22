# @prisma/better-auth-adapter

A [Better Auth](https://www.better-auth.com) database adapter for Prisma 8 applications on Postgres and SQLite.

This package is in development and does not work yet. Its setup instructions arrive with the adapter.

## Responsibilities

- Compare the application's Prisma contract with the models and fields Better Auth needs, and say what is missing or wrong.
- Print the PSL to add to the contract for the models and fields that are missing.

## Dependencies

- `@prisma/orm-framework` and `@prisma/orm-family-sql`, as peers at the same version as the application's database package.
- `@better-auth/core` 1.7, as a peer.

The package imports only published entrypoints, so it works outside this repository.
