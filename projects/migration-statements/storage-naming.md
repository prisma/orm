# A changed stored name is a rename

Will asked on 2026-10-07 for a critical discussion, with prior art, before any syntax is chosen for statements that name storage objects. This page records that discussion and the decision Will made on 2026-11-18. The full design is in [`slices/stored-name-renames/spec.md`](./slices/stored-name-renames/spec.md).

## Decision

**A model, field or enum member with the same contract name in the origin and the destination is always the same thing. When its stored name changes, the planner plans a rename and asks nothing.**

No statement that names storage is added now.

One exception: the rule applies on targets that can plan a rename (PostgreSQL, SQLite, MongoDB). The MySQL target has no rename operation yet, so a stored-name change there keeps today's drop, create and by-hand advice.

## The problem

A user keeps `model User` and changes `@@map("users")` to `@@map("app_users")`:

```text
$ prisma migration plan --name tidy
✖ [CLI.CONSENT_REQUIRED] "User" needs a statement, and the session is not interactive.
→ Pass --delete User
To keep its rows, rename table "users" to "app_users" instead; a statement cannot rename the table of a model that keeps its name. With db update, rename the table in the database yourself …
```

The plan drops `users` and creates `app_users`. `--rename User:User` is refused, because the old name must not exist in the destination. No statement keeps the rows, so the only way is by hand.

The same gap exists in two more places. In each, the contract name stays the same and only the stored name changes. (Value object fields take no `@map`, so they are not affected. Enum members take no `@map` either; a member's stored value is written after `=`.)

| Contract change | Planned today | Planned under the decision | Families |
| --- | --- | --- | --- |
| `@@map` of a model | drop and create the table or collection | rename the table or collection | SQL, MongoDB |
| `@map` of a field | drop and add the column, or remove the key | rename the column or key | SQL, MongoDB |
| The stored value of an enum member (`ACTIVE = "active"`) | the value is removed, and rows holding it are asked about | replace the stored value | SQL, MongoDB |

## Why

- **The contract is where the user says what they want.** The user wrote the same name on both sides. Reading that as one object is not a guess. Every other part of planning already pairs models and fields by name; only a stored-name change is treated as a new object today.
- **The contracts hold the whole answer.** The old and new stored names are both there. A statement would make the user type a fact the planner can read.
- **It is the safe direction.** A rename keeps the data, and a user who wanted an empty table can empty it. A drop cannot be undone.
- **It completes the pairing prisma/orm#31061 began.** That change pairs MongoDB variants whose names differ and whose storage matches. This rule pairs objects whose names match and whose storage differs.
- **It removes the by-hand advice.** `keepTableAdvice` (SQL), `keepCollectionByHandAdvice` (MongoDB) and the `STORED_NAME_ONLY` text in `resolve-statements.ts` exist only for this gap.

A changed column type on a renamed column needs nothing new: the plan renames, then alters, and the alteration asks its usual question.

## Cases refused in the first slice

The meaning of both is settled by the decision. Only the order of operations is work, so they are refused at first, with a message that says why, and planned later. Today neither is a drop and a create: both plan with no question and leave each table holding the other model's rows, so the refusal also fixes silent damage. The slice spec lists the same cases for fields and enum members.

- **A swap.** `User` moves to `accounts` and `Account` moves to `users`. This is two renames that need a temporary name. MongoDB is the harder family, because nothing there runs in a transaction.
- **Taking the storage of a removed model.** `Account` is removed and `User` now maps to `accounts`. This is a drop of `accounts`, which still asks for `--delete Account`, and then a rename.

A name and its stored name both changing is already a statement today: `--rename User:Account` plans the table rename from the two contracts.

## A statement that names storage

Not built now. The decision leaves it needed only where there is no contract name to use:

- **A plan with no origin contract** (no snapshot of the contract the database is at). The planner names a lost object by its database name, as a storage subject (`users.email`). The only answers today are `--delete users.email`, or storing the snapshot and running again (`ORIGIN_SNAPSHOT_RECOVERY` in `plan-questions.ts`). That route works.
- **Storage the contract does not model.**

If it is built later, use a `storage/` prefix, as in `--rename storage/users.name:users.full_name`. A bare `users.email` can collide with a model named `users`. The question prints the subject with the prefix, so the user copies it whole and never builds one.

It would not make the CLI depend on a target. The CLI already passes subjects to the family as opaque strings. It does widen one principle in the design notes, "The user states intent in the vocabulary of their contract", to cover storage that has no contract name.

## What other tools do

The full survey is in `wip/storage-naming/prior-art.md` (not committed). The patterns that matter here:

1. **Identity is the schema name, so a stored-name change is a rename by default.** Django tracks a model by its model name. When only `Meta.db_table` changes, it plans `AlterModelTable`, which renames the table, and asks nothing. A changed `db_column` renames the column the same way. Entity Framework Core does the same for `ToTable` and `HasColumnName`. This is the decision above.
2. **The rename is declared in the source, on the new object.** Atlas has `renamed_from`, sqldef has `-- @renamed from=`, Terraform has `moved` blocks and Pulumi has `aliases`. Terraform and Pulumi recommend these over their command-line forms, because the change is reviewed with the code and applies in every environment.
3. **A command-line address with the kind in it.** kubectl writes `pod/web`, which works only because a Kubernetes name cannot contain `/`. dbt writes `source:raw.orders`. Terraform and Pulumi write full addresses. The most common complaint about every one of these is quoting. A storage statement would need quoting rules for `/`, `.`, `:` and spaces in database names.
4. **Refuse until a flag says what to do.** gh-ost refuses a detected column rename until `--approve-renamed-columns` or `--skip-renamed-columns`.
5. **Interactive question only, or no rename support.** Drizzle Kit, Skeema, Alembic autogenerate and Flyway. Drizzle's question fails in CI even with `--force`.

## Cost

- SQL family and MongoDB target planner changes only: when a model, field or enum member keeps its contract name and its stored name changes, plan a rename. No framework interface change.
- Each family's `ops.json` for these cases changes from drop and create to a rename, so journeys and fixtures that expect the drop change.
- Upgrade instructions: a plan for a stored-name-only change no longer asks a question.
