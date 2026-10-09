# Slice 3: the Prisma 7 reader keeps ignored columns and tables

_Parent project: `projects/unmapped-storage/`. Linear: TML-3467, TML-3462. Stacked on slice 2 (TML-3532, prisma/orm#30667). Outcome: a Prisma 7 schema that uses `@ignore` and `@@ignore` reads into a contract that describes the database Prisma 7 built, so adding or removing `@ignore` after the handover plans nothing._

## At a glance

```prisma
model User {
  id         Int     @id
  email      String  @unique
  legacy_key String? @ignore
  audits     AuditRow[] @ignore
}

model AuditRow {
  id     Int  @id
  userId Int
  user   User @relation(fields: [userId], references: [id])

  @@map("audit_rows")
  @@ignore
}
```

Today the contract has table `User` with `id`, `email` and model `User`; `legacy_key`, `audit_rows` and its foreign key are missing. After this slice the contract's storage has `User` (`id`, `email`, `legacy_key`) and `audit_rows` with its primary key and its foreign key to `User`; the domain has model `User` with `id` and `email` only. In the handover example, an edit that adds these `@ignore` attributes plans no migration, and so does the edit that removes them.

## Chosen design

### `@ignore` field

- A scalar field marked `@ignore` becomes a column node on its model's table: column name (`@map`), type (with `@db.*`), nullability, list shape, and its column default. It gets no execution default: `uuid()`, `cuid()`, `nanoid()`, `ulid()` and `@updatedAt` are ORM-generated values, and the ORM never writes this column. A field whose only default is such a generator becomes a column with no default. The checks that only concern execution defaults (`@updatedAt` type, `@updatedAt` with `@default`, an optional generated field) do not fire on an ignored field.
- A uniqueness constraint or index over an ignored field (`@unique`, `@@unique`, `@@index`) is kept on the model's table, naming the column. A primary key over an ignored field (`@id`, `@@id`) is still refused with `PSL.PRISMA7_IGNORED_FIELD_REFERENCED`: the model would have no identity among its fields.
- A relation field marked `@ignore` keeps its foreign key on the model's table (the constraint Prisma 7 created), and the relation itself stays out of the domain.
- A relation that is not `@ignore` but whose `fields:` or `references:` name an ignored scalar is refused with `PSL.PRISMA7_IGNORED_FIELD_REFERENCED`: Prisma 8 relations join on fields, and the reader never drops the relation silently. The message offers removing `@ignore` from the field or marking the relation field `@ignore` too.

### `@@ignore` model

An `@@ignore` model becomes a table node: namespace (`@@schema`), table name (`@@map`), its scalar fields as column nodes (same rules as an ignored field), primary key, uniques, indexes, and the foreign keys of its relation fields. A foreign key from or to an ignored model targets the other table by name when that table has no model, and by model when it has one. Relation fields on other models that point at an ignored model (Prisma 7 requires them to be `@ignore`) keep their foreign keys the same way.

### Implicit many-to-many with an ignored side

The junction table Prisma 7 created (`_AToB` or `_RelationName`) is kept as a table node, with its two columns, primary key, index and foreign keys, when either side's list field is `@ignore` or either model is `@@ignore`. It is not a model, because no relation reaches it through the domain.

### Columns with no Prisma 8 codec

Decided by Will on 2026-10-09: a column whose type has no Prisma 8 codec is refused whether or not it is ignored, including a column of an `@@ignore` model. The type checks run before the ignore handling. The diagnostic messages stop advising `@ignore` or `@@ignore`; they say the column type is not supported by Prisma 8 yet and that the schema cannot be read until it is.

### Ignored objects meet every rule of the reader

An ignored field or model now becomes storage, so it goes through every check the reader applies to storage, not only the codec check. A schema that loaded before only because its ignored objects were dropped can now be refused: for example an `@@ignore` model with an index argument Prisma 8 cannot express (`sort: Desc`), an `@ignore` relation with `onDelete: SetNull` over a required field, or an ignored `Json` field with the default `"null"`. This follows Will's rule of 2026-10-09: refuse a schema whose contents the contract cannot express. The upgrade instruction says so and names the diagnostics.

### Already-signed projects

A project whose Prisma 7 schema uses `@ignore` or `@@ignore` and that signed with an earlier Prisma 8 has a storage hash computed without the ignored objects; after upgrading, its contract's hash changes.

- While Prisma 7 still owns migrations: `prisma contract emit`, then `prisma db sign`.
- After the handover: `prisma contract emit`, then `prisma migration plan`, which records the creates of the ignored objects so that a database rebuilt from `migrations/` gets them. Then bring each existing database to the new hash with `prisma db sign`, or with `prisma db migrate --advance-ref db` (the runner skips each create because the object already exists). Plain `db migrate` also brings the database to the new hash but leaves the `db` ref behind, so the next plan repeats the migration; run `db sign` afterwards to move it. Signing before planning leaves the `db` ref on a hash that is not in the migration graph, and the next plan fails with `MIGRATION.HASH_NOT_IN_GRAPH`; the instruction says how to recover (`migration plan --from <previous hash>`).

`examples/prisma7-adoption/test/upgrade-ignore.test.ts` proves the post-handover order with `db sign` and with `db migrate`, and the upgrade instruction `prisma7-ignore-keeps-storage` gives both.

## Coherence rationale

One reviewer can hold it: one package (`contract-prisma7`) changes how it lowers two attributes, plus its fixtures, its diagnostics and the handover test that proves the outcome.

## Scope

In: `packages/2-sql/2-authoring/contract-prisma7/**` and its fixtures; `test/integration/test/prisma7-source/**`; the planner golden manifest; `examples/prisma7-adoption` (handover test, README); the error reference for changed messages; the upgrade instruction; the Prisma 7 project's slice 1 spec text and the reader README lines that say ignored objects are omitted.

Deliberately out:

- `_prisma_migrations`. Slice 4: the Postgres target names Prisma 7's ledger as a tool table that `db verify` and `contract infer` leave alone. The handover test's strict-verify assertion tightens to nothing unclaimed in slice 4.
- `contract print` of a contract with ignored storage. It keeps refusing until Prisma 8 syntax exists (TML-3469); the round-trip test lists the affected Prisma 7 fixtures as expected refusals.

## Pre-investigated edge cases

| Case | Disposition |
|---|---|
| The `@ignore` early return in `readField` comes before every type check | Move the codec checks before the ignore handling. |
| `stateServedBackingIndexes` takes a `ModelNode` | It reads only table properties; retype it to work for a table node too. |
| `reportTableCollisions` sees only kept models | Include ignored tables, so two declarations of one table are still refused. |
| An index or unique on a modelled table over an ignored column | Stays on the `ModelNode`, naming the column; slice 1's merge lowers it with the column node's column. Prove it with a fixture. |
| Fixtures that change | `ignore`, `ignored-relation-back-relations`, `relations-ignored` gain storage; `native-type-model-ignored` and `unsupported-type-model-ignored` become diagnostics fixtures; `ignored-field-in-key` keeps only its primary-key diagnostics; every expected-diagnostics file with the old advice text. Regenerate with `UPDATE_PRISMA7_FIXTURES=1`. |
| `interpreter-fixtures.integration.test.ts` `strictExtras` | Entries for ignored objects go away: strict verify on those fixtures reports nothing unclaimed except what slice 4 covers. |
| Planner golden manifest | Regenerate with `PLANNER_GOLDEN_WRITE=1 pnpm --filter integration-tests test test/planner-golden`, or the merge queue ejects the PR. |

## Slice-specific done conditions

- The handover test adds `@ignore` to a field and `@@ignore` to a model (with its inbound relation fields `@ignore`), and `migration plan` reports no changes with the storage hash unchanged; then removes them, with the same result; Prisma 7's `migrate diff` is empty for both edits.
- Strict verify on every success fixture in `interpreter-fixtures.integration.test.ts` reports no ignored object as unclaimed.

## Dispatch plan

| # | Outcome | Builds on | Hands to |
|---|---|---|---|
| 1 | `@ignore` fields become column nodes, with keys, indexes and foreign keys as above; codec checks run first and their messages change; fixtures regenerated. | Slice 2 | A reader that keeps ignored columns. |
| 2 | `@@ignore` models and junctions with an ignored side become table nodes; foreign keys to and from them; fixtures and the integration `strictExtras`. | Dispatch 1 | A reader that keeps every ignored object. |
| 3 | Handover test edits, upgrade instruction, planner golden manifest, docs (reader README, Prisma 7 project slice 1 spec, example README). | Dispatch 2 | The slice outcome. |

## References

- ADR 267 (prisma/orm#30641), ADR 252.
- `projects/prisma7-contract-source/slices/01-postgres-source/spec.md` (rules for `@ignore` today).
