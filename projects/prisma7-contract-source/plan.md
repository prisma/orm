# Plan: Prisma 7 contract source, remaining work

> Refreshed 2026-10-15. Linear project: [Prisma 7 contract source: gaps and defects](https://linear.app/prisma-company/project/prisma-7-contract-source-gaps-and-defects-b1952f4c6133).

## Summary

The core of the project is finished. A Prisma 7 user can point Prisma 8 at their `schema.prisma`, sign the database, let Prisma 8 take over migrations while Prisma 7 still serves queries, and convert the schema to Prisma 8 when they drop Prisma 7.

The GA plan sets the bar for what remains: every urgent and high upgrade issue is closed before GA, and medium and low issues may stay open (`planning/decisions.md` on the `planning/prisma-8-ga` branch). The high issues are TML-3267, TML-3268 and TML-3457 here, and TML-3322, TML-3323 and TML-3326 in the Linear project "Contract print and Prisma 7 source follow-ups", which this plan also covers (Will, 2026-10-15).

The work is grouped into three PRs, because each PR costs review time and CI. Smaller tickets ride along in the PR that touches the same code.

## The three PRs, in order

| PR | What the user gets | Tickets | Size |
|---|---|---|---|
| A. Generated values | Prisma 8 accepts `updatedAt DateTime @default(now()) @updatedAt`, and `uuid()` or `@updatedAt` on an optional field; today it refuses the whole schema. `@updatedAt` works on `@db.Date`, `@db.Time` and `@db.Timetz`. The string timestamp presets stop writing a JavaScript `Date` to a text column. `contract print` asks the stack which PSL call makes a generator, so it prints a default function an extension registers, and its two hand-written tables go. | TML-3267, TML-3268, TML-3322 (high); TML-3275, TML-3255 | Large |
| B. Migrations after the handover | Changing a relation's `onDelete` or `onUpdate`, or a table's primary key columns, plans a migration; today Prisma 8 refuses both. Typing `prisma migrate dev` out of habit prints the Prisma 8 commands to use. | TML-3457 (high); TML-3458, TML-3461, TML-3262 | Medium |
| C. `contract print` writes everything the reader reads | A relation to a model in another contract space, such as Supabase's `auth.AuthUser`, prints; today every Supabase contract is refused. An entity kind a pack adds prints through the pack's own block descriptor. `contract format` keeps a comment between a block's name and `{`. The `CONFIG.VERSION_MARKER_MISSING` advice shows the config that works. | TML-3326, TML-3323 (high); TML-3258, TML-3259 | Medium, plus a short ADR for TML-3323 |

How I will build them:

- **A.** A value the client leaves out is generated, and an explicit `null` is stored as `null`, as in Prisma 7. Prisma 8's schema language accepts `@default(now())` together with `@updatedAt` (agreed 2026-10-13). The string timestamp presets get a generator that writes text; removing their `now` option would break existing schemas.
- **B.** The migration drops the foreign key and adds it again with the new actions, as Prisma 7 did. Changing a primary key also drops and adds back the foreign keys that point at it.
- **C.** A pack's PSL block descriptor gains a `print` function next to its keyword and parameters, as TML-3323 recommends, so the way in and the way back cannot drift. The ADR goes to Will before C is built.

## After GA

Each stays in this Linear project. Each needs a product decision before code. In priority order:

1. **TML-3270, the `citext` column type and five rare Postgres types.** `citext` is common for case-insensitive emails, and should come first, as a text codec.
2. **TML-3274, index options.** `sort: Desc` on a timestamp index is common, so it should come first.
3. **TML-3460, Postgres extensions listed in the Prisma 7 datasource.** A database Prisma 8 builds from scratch does not get them. Until then, the user creates them by hand before `db migrate`.
4. **TML-3455, storing `Bytes` and `DateTime` defaults as values instead of SQL text.** Every affected project would have to sign its database again. Not worth that cost on its own.
5. **TML-3277, a JSON `null` default,** and **TML-3276, `dbgenerated()` with no expression.** Both are rare.
6. **TML-3269, database views.** Not built before GA (Will, 2026-10-15).

## Moved out

- **[Type references across namespaces](https://linear.app/prisma-company/project/type-references-across-namespaces-4a1c2964cde6) (P-TML-1158), created 2026-10-15:** TML-3272, TML-3273, TML-3341 and TML-3280. A field cannot use an enum or a composite type from another namespace. ADR 221 says every reference to another namespace names the namespace; enum references do, and composite type references carry only a name, which is the bug in TML-3341. One ADR, then one implementation. All four are medium or low, so none is required before GA.
- **TML-3456, closed as already decided.** Prisma 8 does not remove or reorder a Postgres enum's values: Postgres can only do it by building a new type and rewriting every table that uses it. `docs/reference/postgres-native-enums.md` tells the user to write that migration, and the native enums project made it a permanent non-goal (`projects/native-postgres-enums/spec.md`, requirement R9). The planner's refusal already links that page. A rename is different, because Postgres renames a value in place; the migration statements project plans `--rename` for enum values.
- **TML-3261, to the `prisma-cli` repository.** The CLI renders finding locations there.

## When the project closes

When PRs A, B and C have merged. The tickets left for after GA move to a backlog project or stay with a closed note, long-lived docs move to `docs/`, and `projects/prisma7-contract-source/` is deleted, as `projects/README.md` describes.
