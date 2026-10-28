# Slice 3b — The remaining renames and deletes on Postgres and SQLite

**Linear:** [TML-3537](https://linear.app/prisma-company/issue/TML-3537) · **Builds on:** slices 1, 2 and 3a (merged) · **Project:** [`../../spec.md`](../../spec.md)

## In one example

A Postgres schema moves `Invoice` into a `billing` namespace, renames the enum value `Status.ARCHIVED` to `Status.RETIRED`, and renames `Address.street` to `Address.line1` inside a value object.

```text
$ prisma migration plan --name tidy --rename public.Invoice:billing.Invoice --rename Status.ARCHIVED:Status.RETIRED --rename Address.street:Address.line1
✔ Planned 4 operation(s)
  Move table "public"."Invoice" to schema "billing"                       widening
  Update "Order"."status" from 'ARCHIVED' to 'RETIRED'                    widening
  Rename key "street" to "line1" in "User"."address"                      widening
  ...
```

Without the statements, both commands refuse and print them, as they do today for models and fields.

## What changes for users

| Change in the schema | Today | After this slice |
| --- | --- | --- |
| Model moved to another namespace | Refused, even with `--rename` | `--rename public.Invoice:billing.Invoice` moves the table (`SET SCHEMA`), creating the schema first when the database lacks it |
| Namespace renamed | Old schema and its tables kept silently; new ones created empty | Asked. `--rename billing:finance` renames the schema, before any other statement. `public` and a schema another contract space declares are refused |
| Namespace removed | Its tables kept silently | Asked, one question per model, and the first question says `--delete billing` answers them all. `--delete billing` drops its tables and the schema. A table no contract declares is its own question, by its storage name |
| Enum value renamed (stored value changes) | Postgres: the new CHECK fails at apply on rows with the old value. SQLite: planning fails with "no operations" | Asked. `--rename Status.A:Status.B` updates the rows |
| Enum value removed | Same as above | Asked, with `--rename` offered first. `--delete Status.A` sets it to NULL where the field is optional and removes it from lists. Where a required column holds it in rows, the apply stops, counts the rows and says how to keep them |
| Enum value renamed, stored value unchanged (`@map`) | Nothing planned | Same. A `--rename` is accepted and reported with no operations |
| Field inside a value object renamed | Nothing planned; old keys stay in the JSON | Asked. `--rename Address.street:Address.line1` rewrites the key in every column that holds an `Address` |
| Field inside a value object removed | Nothing planned; old keys stay | Asked. `--delete Address.street` removes the key |
| Variant's discriminator value changed | Nothing planned; its rows stop being that variant | Asked. `--convert Bug` updates the rows to the new value |
| Variant removed | Its own columns or table are dropped; its base rows stay, claimed by no model | Asked as one model. `--delete Bug` deletes its rows, then drops its columns or table |
| `--allow` question | "would widen who can read and write its rows" | "would widen who can read and write its data". `accessWidening` becomes `accessChanges` |

Namespace items are Postgres only: SQLite has no namespaces. Everything else works on both targets.

## Decisions to check

1. **Value objects become storage entities, and a discriminator column names a value set** (agreed with Will, 2026-10-21; [ADR 309](../../../../docs/architecture%20docs/adrs/ADR%20309%20-%20Value%20objects%20are%20storage%20entities,%20and%20a%20discriminator%20column%20names%20a%20value%20set.md)). Today a value object field rename, a discriminator value change and a variant removal with no own columns change only the domain plane. The storage hash covers only the storage plane, so it stays the same, and the migration system cannot see the change: `migration plan` reports "No changes detected", a same-hash migration fails the integrity check, and snapshots are keyed by storage hash with the first write kept. A value object's fields and a discriminator's values are stored data the planner must see, so they belong in storage:
   - **Value objects** move from `domain.namespaces.<ns>.valueObjects` to `storage.namespaces.<ns>.entries.valueObject`, in both families, keeping their definition. A domain field refers to one by entity coordinate, as a field typed by an enum refers to its value set. No copy.
   - **Discriminator values** are a value set keyed `<Base>.<field>`, which the base table's discriminator column names, with a derived check on Postgres as an enum column has.
   - **Both are enforced:** on Postgres a value object column gets a derived check on its shape, one strict `jsonpath` predicate written so an unknown result fails; on MongoDB the validator already lists them. So a change is normally a check or validator change. Will, 2026-10-21: migrations are expected never to be empty, because two storage hashes are two database states, but edge cases will happen, and the system handles them: `migration plan` writes the package with no operations and says what changed, and `db migrate` moves the marker. The "no operations" refusal goes for a plan whose storage hash changed.

   **Cost:** every contract with value objects or variants is re-emitted with a new storage hash, with an upgrade fragment. The move touches every reader of value objects: both emitters, both type renderers, the ORMs and the MongoDB validator derivation.

   **Not in this slice: efficient rewrites.** Once the planner sees a change, it plans the rewrite as one plain operation (an `UPDATE` or `DELETE` over the matching rows). On a large production table that holds row locks for its whole run, and nothing batches it. Making these rewrites cheap is a later optimization, recorded in `deferred.md`. Seeing the change comes first.
2. **Native Postgres enums stay hand-written.** You ruled on 2026-10-13 that Prisma 8 does not rename, remove or reorder native enum values itself. A native enum also has no member names in the contract, so a statement has nothing to name. Enum value statements therefore cover enums that the contract declares, which are stored as a column with a CHECK on Postgres and a plain column on SQLite. The native enum refusal stays as it is, pointing to a hand-written migration. The project spec and design notes say "native Postgres enums rename the value". I'll correct them.
3. **A removed namespace becomes a question.** Today the Postgres planner ignores every schema the destination contract does not declare. That protects schemas Prisma does not manage, such as Supabase's `auth`. After this slice, a schema that the origin contract declared and the destination does not is a removal: its tables are asked about, and `--delete billing` answers all of them. A schema the origin contract never declared is still ignored, and so is `public`, which is never a removal. Without an origin contract (`db update` with no snapshot), nothing changes.
4. **`--convert` on a variant works on `db update` too.** Both values are known, so there is no placeholder and no file to fill. The row updates, like MongoDB's document rewrites, are classed by their effect: renames and conversions are `widening`, and deleting rows or setting values to NULL is `destructive`. So `db update` can run them.
5. **A value object that can contain itself is refused.** A rename inside a value object that is reachable from itself (`NavItem.children`) would have to rewrite to any depth. The refusal points to a hand-written data transform. Slice 4p made the same choice for the MongoDB validator. No SQL authoring surface produces such a value object today, but nothing refuses one either.
6. **Four pull requests, in order.** See [Pull requests](#pull-requests). The first two do not depend on decision 1.

## Statement grammar

Each side of a statement is still one to three names separated by dots. New things a name can refer to:

| Statement | Reads as |
| --- | --- |
| `--rename billing:finance` | A namespace. One name is now read as a namespace or a model |
| `--rename public.Invoice:billing.Invoice` | A model whose namespace changes (a move) |
| `--rename Status.A:Status.B` | An enum value |
| `--rename Address.street:Address.line1` | A field of a value object |
| `--convert Bug` | A variant. `--convert` now accepts a model name, for a variant only |
| `--delete billing`, `--delete Status.A`, `--delete Address.street`, `--delete Bug` | The same subjects |

- The rule from slice 1 stays: when exactly one reading resolves, it is used. When several resolve, the statement is refused and the message lists the readings.
- A model, value object and enum cannot share a name in one namespace, so two-name statements are rarely ambiguous. A namespace that shares its name with a model is the common case. The message then asks for the qualified form.
- A field inside a nested value object is named through its own value object (`GeoPoint.lat`), never through a path (`Address.location.lat`). The statement then applies everywhere that value object is used.
- Both sides must refer to the same kind of thing: an enum value cannot be renamed into another enum, and a value object field cannot move to another value object.

## What each statement does

**Namespaces (Postgres)**
- Model move: `ALTER TABLE … SET SCHEMA`. Constraints and indexes keep their names. A foreign key from another table follows the table.
- Namespace rename: `ALTER SCHEMA … RENAME TO`. Refused for `public`, for a rename to `public`, and for a schema another contract space also declares; the SQL family planner refuses the last, and a target without namespaces, such as SQLite, gets every namespace statement refused. A new name the database already has as a schema is refused with advice to drop or rename that schema by hand if it is empty, or to move each model. Namespace renames are planned before every other statement.
- Namespace delete: drops each table, a table before the tables its foreign keys reference and with its policies, then `DROP SCHEMA`. `--delete billing` answers each of the namespace's questions: the control API matches it to each subject, and the command takes the `--delete` values from the CLI engine when one names a namespace, since the engine matches a flag only to its own subject. `--delete` with a namespace the destination still has answers nothing, and so does `--delete public`: the default namespace is never removed, and no hint offers a rename to or from it. When the destination adds a namespace, the first question also offers `--rename billing:<new namespace>`; a namespace the run already renames gets no namespace hints. `--delete billing` beside `--rename billing:finance` is refused, since a namespace cannot be both renamed and deleted. At the prompt, `delete billing` typed for one of the namespace's questions answers all of them, as the flag does; `rename billing:finance` typed there is planned like the flag, and the questions the rename leaves, such as a model that also changed its name, are asked next. After a namespace rename, questions name the namespace's models and fields by the new namespace, and a field question offers the field rename there. A dry run lists the namespace answers once per removed namespace, and its JSON lists `removedNamespaces` and `addedNamespaces` at the top level. The planner reports which namespaces it removes and adds, and the CLI reads that. `--delete` flags match the same way whatever their order: a subject's own flag first, then its namespace's. A view on one of the namespace's tables stops that table's drop, and the failure names the view; a dry run cannot see it, because the planner reads tables only. A table no contract declares is asked about by its storage name; another undeclared object blocks the schema drop at its precheck, and the failure names each blocking object and says to drop or move it.

**Enum values (Postgres and SQLite)**
- The storage effect is worked out from stored values, not member names.
- A rename updates every column typed by the enum: scalar columns with `UPDATE … SET col = new WHERE col = old`, list columns with `array_replace`. Enum values inside value object JSON are rewritten in the last PR, with the other JSON rewrites.
- On Postgres the update runs between dropping the old CHECK and adding the new one.
- A delete sets the value to NULL in optional columns and removes it from list columns. A required column is asked about like any other, and its removal checks rows, not the column: with no row holding the value it applies; while rows hold it, the apply fails with `MIGRATION.PRECHECK_FAILED`, changes nothing, counts the rows, and its next actions give one way to keep them each: add a member and rename the value to it, or keep the rows by hand (change the stored value in the database under `db update`; replace the removal with `this.replaceStoredValue(...)` in the `migration.ts` under `db migrate`). On SQLite the removals run after the table rebuilds, so a column the same change makes optional takes the NULL. A rename into a stored value another origin member already holds is refused, since it would merge their data. Without an origin contract nothing is asked or rewritten, and `--delete Status.ARCHIVED` answers nothing.
- The operations are `this.replaceStoredValue(...)` and `this.removeStoredValue(...)`, usable in a hand-written `migration.ts`. The planner gives each the column's codec reference (`codecRef`), and the operation writes each value through that codec as the database stores it, as a literal default is written, so a value in another form cannot silently match no row.
- SQLite has no list columns, so its operations are scalar only. Native Postgres enums are unchanged (decision 2).

**Value object fields (Postgres and SQLite)**
- The planner finds every column whose type reaches the value object, through nesting and lists. It rewrites the key in each one: `jsonb` operators on Postgres, `json_` functions on SQLite. Only documents that hold the old key are touched.
- A delete removes the key the same way.

**Variants (Postgres and SQLite)**
- `--convert Bug` updates the base table's discriminator column from the old value to the new one.
- `--delete Bug` deletes the base table's rows that hold its value. For a variant stored in its own table, the foreign key's cascade deletes those rows too, and the planner then drops the table. For a variant stored in its base's table, the planner then drops the columns only it used. The refusal says that rows are deleted.
- A variant field statement on a variant with its own table acts on that table, as you asked on 2026-10-09 for when SQL stored variants in their own tables. It now does.

**The access question.** The question says "would widen (or change) who can read and write its data". The framework doc comments lose their row-level-security examples, and those examples move to the Postgres target. `accessWidening` becomes `accessChanges` in the framework, the CLI, the targets, the `--json` output and the `acceptAccessWidening` option, which becomes `acceptAccessChanges`. That is a breaking change, so it gets an upgrade fragment.

Every operation the planner writes is also something a user could write in `migration.ts`. Re-running the file reproduces `ops.json`, as for every statement so far.

## Pull requests

| PR | Contents | Needs |
| --- | --- | --- |
| 1 | Namespaces: move, rename, delete, and a removed namespace becomes a question. The access question wording and rename | — |
| 2 | Enum values: rename and delete in scalar and list columns, on Postgres and SQLite | 1 merged |
| 3 | Value objects move to the storage plane and discriminator columns name a value set, both with derived checks on Postgres (decision 1), with ADR 309. First step: confirm a Postgres check can enforce every value object shape SQL authoring produces, nesting and lists included; raise any shape it cannot. A plan whose hash changed but has no operations is written and applied, not refused. Contracts re-emitted, with an upgrade fragment. No statements yet | 2 merged |
| 4 | Value object field rename and delete, including enum values inside JSON. A value of a new required value object member for the rows that lack it (`--backfill`), since PR 3's Postgres check refuses those rows. Variant convert and delete | 3 merged |

PR 3 is separate because it changes the contract shape and every contract with value objects or variants, and needs its own review, as slice 4p's first PR did. Slice 4b reuses PR 4's value object statement support for MongoDB.

## Scope

**In:** everything in the table above; error reference, Migration System § Statements and its "Rename limits", the CLI README, `skills/prisma-8/references/migrations.md`; upgrade fragments for the access rename (PR 1) and the storage change (PR 3); the new ADR, with update notes on ADR 172 and ADR 178 (PR 3); correcting ADR 223's statement that emission rejects several namespaces.

**Out:**
- Native Postgres enum values (decision 2).
- A storage name change with no domain change (`@@map` alone). This is the separate syntax question still open with you.
- Moving a variant between its base's table and its own table, and making a model a variant. These stay hand-written.
- Dictionaries and unions of value objects. No SQL authoring surface produces them. The rewrite refuses a column that holds one, naming it.
- MongoDB: slice 4b.

## Edge cases already known

| Case | Handling |
| --- | --- |
| An enum member keeps its name but its stored value changes | No statement can say this. Asked with `--delete` only; the question names, for every column the enum types, the `this.removeStoredValue(...)` call to replace with a `this.replaceStoredValue(...)` call in the `migration.ts` that `migration plan` writes; `db update` cannot keep that data |
| A removed variant with no columns of its own | Now asked as a model, so its rows are not left behind silently |
| Renaming `public` | Refused. `public` is target-owned (ADR 223) and Postgres puts it on every search path. On PGlite a non-superuser database owner can run `ALTER SCHEMA public RENAME`, and a plain role cannot, but the refusal does not depend on that. The message says to move the models with `--rename Model:new.Model` instead |
| `--delete billing` and `--rename billing.Invoice:public.Invoice` in one run | The rename runs first, so that model is kept, and the delete covers the rest |
| A removed namespace that holds a table no contract declares | That table is its own question, `--delete billing.audit_log`; `--delete billing` does not answer it |
| A one-name statement that is both a namespace and a model | Refused, unless another statement of the run renames the model; the message says to name the model with its namespace, or give both statements |

## Done when

- The project's done conditions for namespaces, enum values, value objects and variants pass on Postgres, and on SQLite where the item applies.
- Every journey runs through both `migration plan` and `db update`, and a later plan is empty.

## Implementation notes

- Grounding report (local, gitignored): `wip/3b-grounding.md` in this worktree.
- New subject kinds: `namespace`, `enumValue`, `valueObjectField`. Every exhaustive switch over `MigrationSubject` gets the new kinds (`migration-statements.ts`, `plan-questions.ts`).
- New SQL operations need the full set: call class, op builder with checks, `renderTypeScript`, a facade method with the same arguments, a subjects mapping, and a working-schema step.
- The variant lookup that MongoDB uses (`variantFilter`, `discriminatorValueChange` in `mongo-statement-planning.ts`) is pure domain logic. Move it to the framework so SQL and MongoDB share it. `deferred.md` asks for the selection to be carried as a typed value, not read back from a filter.
- The removed-namespace filter is in `diff-database-schema.ts` (`ownedSchemaNames`). The owned set becomes the destination's namespaces plus the origin contract's, when an origin contract is known.
