---
changes:
  - id: collection-state-carries-tables
    summary: |
      A SQL ORM `CollectionState` has a required `tables` property holding the table scope and the aliased root table and variant tables of the collection, and `emptyState()` takes it as its argument. Build it with `createCollectionTables(contract, namespaceId, modelName)`. This applies to every hand-built state, including `IncludeExpr.nested`, a `combine()` branch state and the state of an include scalar selector.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\bemptyState\('
        - '\bCollectionState\b'
  - id: state-filters-planned-as-written
    summary: |
      The SQL ORM planners no longer turn a literal in `CollectionState.filters` into a parameter. A filter put into a hand-built state must carry a `ParamRef` with the column's codec for each value compared with a column; a `LiteralExpr` left there is not encoded by the column's codec. Filters added through `collection.where(...)` are unaffected.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\bfilters\s*:'
  - id: create-model-accessor-takes-tables
    summary: |
      `createModelAccessor` takes the collection's tables as its fourth argument, before the optional variant's discriminator value: `createModelAccessor(context, namespaceId, modelName, tables, variantValue?)`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\bcreateModelAccessor\('
  - id: include-expr-junction-table
    summary: |
      A hand-built `IncludeExpr` for a many-to-many relation needs a `junction` aliased table next to `through`; compiling a `through` include without one throws. `IncludeExpr.localTableName` is replaced by the optional `localVariantValue`, the discriminator value of the multi-table-inheritance variant whose table holds the relation's local columns.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\bIncludeExpr\b'
---

These changes concern code that imports from `@prisma/orm-family-sql/orm-client` and builds SQL ORM collection state or model accessors by hand.

## `collection-state-carries-tables`

`CollectionState.tables` is a `CollectionTables` value: the table scope plus the aliased root table and each aliased multi-table-inheritance variant table. `emptyState` takes it as a required argument. Build it from the contract with `createCollectionTables`:

```ts
// before
import { emptyState } from '@prisma/orm-family-sql/orm-client';

const state = { ...emptyState(), limit: 10 };

// after
import { createCollectionTables, emptyState } from '@prisma/orm-family-sql/orm-client';

const tables = createCollectionTables(contract, 'public', 'User');
const state = { ...emptyState(tables), limit: 10 };
```

`createCollectionTables(contract, namespaceId, modelName)` takes the model the state is for. For a polymorphic model pass the base model name; its variant tables are aliased in the same scope.

Every object typed `CollectionState` needs the property, not only top-level states:

- `IncludeExpr.nested`;
- the `state` of a `combine()` rows branch;
- the `state` of an include scalar selector.

A state passed to `new Collection(ctx, modelName, { state })` needs it too. A `Collection` constructed without `state` builds its own tables, so that call needs no change.

Do not build a `CollectionTables` or a table scope by hand.

A state built by hand for an include child must not reuse the parent's table aliases. Prefer building includes through `collection.include(...)` and reading `collection.state`, which aliases the child's tables from the parent's scope. Where a child state is built by hand for a relation whose target table already appears in the parent chain (a self-relation, or an include that returns to an ancestor's table), build it through `include()` instead; `createCollectionTables` starts a fresh scope and would give the child the same alias as its parent.

## `state-filters-planned-as-written`

This affects only code that writes expressions into `CollectionState.filters` itself (a hand-built state, an `IncludeExpr.nested` state, a `combine()` branch state). Such a filter used to have each literal compared with a column replaced by a parameter carrying the column's codec when the statement was planned. The planners now use stored filters unchanged.

Build the filter through the collection, which binds it when `where()` is called, and read the state from the result:

```ts
// before
const state = {
  ...emptyState(),
  filters: [BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of(email))],
};

// after
const state = users.where(BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of(email))).state;
```

A filter that must be written by hand needs a `ParamRef` with the column's codec in place of the literal. A literal left in place is not encoded by the column's codec.

## `create-model-accessor-takes-tables`

Pass the tables as the fourth argument. A variant moves to the fifth, named by its discriminator value:

```ts
// before
createModelAccessor(context, 'public', 'User');
createModelAccessor(context, 'public', 'Task', 'Feature');

// after
createModelAccessor(context, 'public', 'User', createCollectionTables(context.contract, 'public', 'User'));
createModelAccessor(
  context,
  'public',
  'Task',
  createCollectionTables(context.contract, 'public', 'Task'),
  'feature',
);
```

The accessor takes the aliases for its relation filters and relation orders from `tables.scope` and records them there. Two relation filters over the same table built from one accessor therefore get different aliases. Pass each accessor its own `createCollectionTables(...)` result unless the expressions it builds are meant for one statement.

## `include-expr-junction-table`

This affects only an `IncludeExpr` object written out by hand with a `through` descriptor. An include built with `collection.include('<relation>')` carries the aliased junction table already.

There is no public function that aliases a junction table on its own. Replace the hand-built object with the include the collection builds:

```ts
// before
const include: IncludeExpr = { relationName: 'tags', through: { table: 'user_tags', /* … */ }, /* … */ };

// after
const [include] = users.include('tags').state.includes;
```

`IncludeExpr` no longer has `localTableName`. Remove the property where the relation's local columns are on the parent model's own table, which is every relation of a non-polymorphic model, a base model or a single-table-inheritance variant. Where they are on a multi-table-inheritance variant's table, set `localVariantValue` to that variant's discriminator value:

```ts
// before
const include: IncludeExpr = { relationName: 'assignee', localTableName: 'features', /* … */ };

// after
const include: IncludeExpr = { relationName: 'assignee', localVariantValue: 'feature', /* … */ };
```
