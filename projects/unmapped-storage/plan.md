# Storage a model does not map — Plan

**Spec:** [`spec.md`](./spec.md) · **Linear:** P-TML-1151

Three slices, in sequence. Each is one PR.

| # | Slice | Delivers | Builds on | Hands to | Ticket |
|---|---|---|---|---|---|
| 1 | `storage-in-the-definition` | `ContractDefinition` holds column nodes and table nodes, and the build lowers them through the same code as a model's columns and tables. The build is split so a model lowers on its own before assembly. Foreign keys may target a table by name. | main | A definition any source can fill with storage that has no model, and a matrix test that proves exposure does not move storage. | TML-3468 |
| 2 | `orm-stays-in-the-domain` | The ORM reads and writes only the columns a model's fields map: per-model projection, one resolver that throws `ORM.FIELD_UNKNOWN`, row mapping without pass-through, relation lowering that refuses a join column with no field, the validators, and model types (emitted and no-emit) without extra columns. | Slice 1 | An ORM that is safe against any contract slice 1 can produce. | TML-3532 |
| 3 | `prisma7-ignore-keeps-storage` | The Prisma 7 reader turns `@ignore` fields into column nodes and `@@ignore` models into table nodes, keeps the foreign keys and indexes Prisma 7 created, refuses a primary key over an ignored field, and handles `_prisma_migrations`. The handover test adds and removes `@ignore` with no plan, and strict verify reports nothing unclaimed. Upgrade instruction for projects that already signed. | Slices 1 and 2; the two open questions in `design-notes.md` | Project close-out. | TML-3467, TML-3453, TML-3462 |

Deferred, not in this project: Prisma 8 syntax for storage with no model, and `contract print` and `contract infer` for it (TML-3469), until the syntax is agreed.

## Sequencing

Strictly sequential. Slice 2 needs slice 1 to build a test contract with an extra column through an authoring surface rather than by patching contract data. Slice 3 must not produce extra columns before slice 2 stops the ORM from returning them.

## Per-slice notes

### 1. `storage-in-the-definition`

The risk is the split. Every existing definition must build to the same contract, warnings and error codes as before. The salvage branch `tml-3468-unexposed-storage` has nothing for this slice; it used a flag on nodes.

### 2. `orm-stays-in-the-domain`

Salvage from `tml-3468-unexposed-storage` (head `64601ebc15`): `resolveModelColumns` in `sql-orm-client/src/query-plan-meta.ts`, the storage-entry-per-field and execution-default validators, `{}` typing for empty field and relation maps, and the canonicalization hooks that keep empty maps. Take the pieces, not the branch.

### 3. `prisma7-ignore-keeps-storage`

Starts only when the two open questions are decided. Regenerates the Prisma 7 fixtures and the planner golden manifest.

## Close-out

- [ ] Verify the project DoD in `spec.md`.
- [ ] ADR 267 merged; replace the Prisma 7 project's slice 1 text on omitted objects.
- [ ] Delete `projects/unmapped-storage/`.
