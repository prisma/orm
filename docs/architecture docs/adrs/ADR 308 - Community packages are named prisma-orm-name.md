# ADR 308 — Community packages are named `prisma-orm-<name>`

**Status:** Accepted
**Date:** 2026-10-23
**Related:** [ADR 242 — Public npm surface](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md)

---

## Decision

A package that someone other than Prisma publishes for Prisma 8 is named `prisma-orm-<name>`, whatever it adds. Every such package lists the keyword `prisma-orm-extension`.

A Sentry middleware, published unscoped:

```json
{
  "name": "prisma-orm-sentry",
  "keywords": ["prisma-orm-extension"]
}
```

Support for CockroachDB:

```json
{
  "name": "prisma-orm-cockroachdb",
  "keywords": ["prisma-orm-extension"]
}
```

A publisher with its own npm scope uses `@scope/prisma-orm-<name>`, or just `@scope/prisma-orm` when the scope already says what the package is. So Sentry may publish `@sentry/prisma-orm`, and CipherStash `@cipherstash/prisma-orm`.

The convention covers community packages only. The packages Prisma publishes keep the names ADR 242 gives them.

## Why

The name lets a person recognise a Prisma 8 package in a dependency list or a search result. The keyword lets a tool find all of them. A future website that lists Prisma 8 packages finds them by the keyword and does not read their names. Astro and Gatsby build their package listings the same way, from the `astro-integration` and `gatsby-plugin` keywords.

Prisma cannot make third parties follow a naming rule, and nothing in Prisma 8 loads a package by its name: `prisma.config.ts` and the runtime options import each package directly. ESLint and Babel need fixed name patterns because they resolve plugins from names. Prisma 8 does not, so the name stays short and the keyword does the indexing.

## Why the name carries no type

A package can plug into several places: the `extensions` list in the config, the runtime's `middleware` option, the contract `source`, the cache middleware's `store`, the runtime's `log` option. Real packages span these. CipherStash contributes data types, its own schema and migrations, per-column migration steps and middleware. A type word in the name would either be wrong for such a package or force it to pick one.

A package that adds a database needs no type word either: the database's name already says what it is, as `prisma-orm-cockroachdb` does. Prisma's own database packages work the same way: `@prisma/orm-postgres`, not `@prisma/orm-db-postgres`.

A package that provides only a driver for a database Prisma 8 already supports is not covered. Its author names it as they like.

## Consequences

- A listing site or search tool finds community packages by the `prisma-orm-extension` keyword. It cannot tell a database package from middleware or data types without reading the package itself.
- The convention is guidance in the docs, not a check anywhere in Prisma 8. A package that ignores it still works.
- No revisit-if condition is recorded.

## Alternatives considered

### A type word for every kind of package

`prisma-orm-middleware-<name>`, `prisma-orm-extension-<name>`, and so on, from a fixed list. Rejected because packages that span several kinds would have to pick one, and because "extension" describes every package and so tells the reader nothing.

### A type word for database packages only

`prisma-orm-db-<name>`, because an application installs exactly one database package and imports its client from it. Rejected because the database's name already says this, so `prisma-orm-db-cockroachdb` repeats itself, and because Prisma's own database packages carry no such word.

### A short type marker, such as `prisma-orm-x-<name>`

Rejected for the reason ADR 153 rejected `ext-`: an abbreviation only makes sense to someone who already knows the convention, and a single letter reads as a placeholder.

### A keyword for each kind

`prisma-orm-middleware`, `prisma-orm-db`, and so on alongside `prisma-orm-extension`. Rejected to keep one keyword that every package carries and every tool searches for.

### Free names with only the keyword

Rejected because a person scanning a dependency list or a search result would not recognise a Prisma 8 package from its name.
