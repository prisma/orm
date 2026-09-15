# Prisma 7 implicit many-to-many names fixture

`schema.prisma` holds an unnamed implicit many-to-many relation over a mapped table (`Post` is `blog_posts`), a named one (`Favorites`), a self relation (`Follows`), one across two schemas (`Category` in `public`, `Product` in `shop`), and relations over models `A` and `B`, whose inferred relation names clash with the fields infer prints for columns `A` and `B`, one of them a self relation (`Loop`). `implicit-many-to-many-names.integration.test.ts` applies `migration.sql`, runs `contract infer`'s inference on the introspected database, and checks that the interpreter names each junction model's relation fields as infer names them for the same tables.

## How `migration.sql` was produced

- Prisma version: `prisma@7.10.0`.
- Date: 2026-09-15.
- Run from a scratch directory holding a copy of `schema.prisma` and the `prisma.config.ts` described in `../reference/README.md`:

```bash
pnpm dlx prisma@7.10.0 migrate diff --from-empty --to-schema schema.prisma --script -o migration.sql
```
