# Slice 2: helpers for shared query fragments

**Project:** [spec](../../spec.md), [plan](../../plan.md). **Design:** ADR 259, "Query fragments are functions", sections 3 to 5 (on prisma/orm#30543). **Ticket:** TML-3436. **Builds on:** slice 1 (prisma/orm#30560, branch `tml-3403-collection-keeps-its-class`).

## At a glance

```ts
import { CollectionRowOf, FieldExpression, rowFragment, sortField } from '@prisma/orm-postgres/orm-client';

type DeletedAt = FieldExpression<Contract, 'pg/timestamptz@1', true>;
const notDeleted = (row: { deletedAt: DeletedAt }) => row.deletedAt.isNull();

db.Post.where(notDeleted);
db.Tag.where(notDeleted);                                  // error: Tag has no deletedAt

const summary = rowFragment<Contract, 'Post'>()((posts) => posts.select('id', 'title').include('user'));
type PostSummary = CollectionRowOf<ReturnType<typeof summary>>;
db.User.include('posts', (posts) => posts.pipe(summary));

db.Post.orderBy(sortField(db.Post, input.sort, input.direction, ['title', 'createdAt']));
```

## Chosen design

As ADR 259 sections 3 to 5, in `packages/3-extensions/sql-orm-client`, exported from the client and re-exported by the Postgres facade:

- **`FieldExpression<TContract, CodecId, Nullable = false>`** in `src/types.ts`: built from the same parts as the field type of the row accessor (`Expression`, the comparison methods the codec's traits allow, the query operations registered for the codec), keyed by codec id instead of model field. The real field type and `FieldExpression` are assignable to each other in both directions, including package-contributed operations such as `fullTextMatches`.
- **`rowFragment<TContract, ModelName>()(body)`**: the body is typed once against the plain collection of the model; the returned step accepts that model's collection in any state (root, chained, after `select`, include refinement, `this` in a custom class) and is refused for another model. Its result has the default state. The row is named with `CollectionRowOf` from slice 1; there is no separate `RowOf`.
- **`sortField(collection, name, direction?, allowed?)`**: `allowed` is typed against the model's fields whose codec has the `order` trait (`SortableFieldName`). At run time an unknown name, a field without the `order` trait, a relation, or a name outside `allowed` throws `ORM.ARGUMENT_INVALID` before the query runs. The selector fits any collection of a model with the allowed fields.

The spike on `bot/spike-pipe-fragments` (write-up `projects/collection-scopes/spikes/pipe-fragments.md`) is the reference for all three. Do not land `when`, `fragment`, `stateFragment` or the spike's soft-delete fixture contract made by patching a generated `contract.d.ts`.

## Coherence rationale

Three small, independent helpers with one purpose, shared query fragments. One reviewer holds them in one sitting.

## Scope

In: the three helpers, their exports, tests, the package README and `skills/prisma-8/references/queries-postgres.md`, the demo using each helper, ADR 259 set to match the code and to Accepted.

Out: `pipe` and the step vocabulary (slice 1); a default fragment per model; the missing-field error message naming the wrong `where` overload, unless a small change fixes it (report it either way); collection scopes (slice 4).

## Pre-investigated edge cases

- With slice 1 in place, a plain function typed `(posts: Pick<typeof db.Post, 'select'>) => ...` may already serve as a row-changing step. If `rowFragment` adds nothing over that, report it with the cost of each and stop before building `rowFragment`; the decision is the orchestrator's.
- The spike built test contracts with a `deletedAt` field by patching emitted files. Tests must use emitted fixtures or a user-facing authoring surface instead (`.agents/rules/no-contract-data-patching-in-tests.mdc`).
- `sortField` reads codec traits at run time from the context's codec descriptors; the trait must come from the same place the type-level `SortableFieldName` reads it.

## Slice-specific done conditions

- Type tests for each helper at every site listed above, with `@ts-expect-error` negatives verified to fail for their stated reason.
- Runtime tests show the filter, selection and order in the query plan, and `sortField`'s refusals.
- `examples/prisma-8-demo` uses each helper, and its typecheck through `dist` and its tests pass.
- Demo type instantiations do not rise by more than 0.2% with the helpers unused.
