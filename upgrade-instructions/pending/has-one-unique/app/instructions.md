---
changes:
  - id: has-one-key-must-be-unique
    summary: |
      Building a SQL contract fails with `CONTRACT.RELATION_INVALID` when a one-to-one relation, `rel.hasOne(Target, { by: ... })` in TypeScript, names `by` fields of the target model that no primary key, unique constraint or unique index without a `where` covers exactly. Make those fields unique, or make the relation `rel.hasMany`. PSL schemas are not affected: PSL already refused a singular back-relation over a non-unique foreign key. The detection matches TypeScript sources that declare a `hasOne` relation.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])rel\s*\.\s*hasOne\s*\('
---

# A `hasOne` relation needs a unique key on the target

A `hasOne` relation says that at most one row of the target model points at each row of this model. The SQL contract build now checks that the target's `by` fields are unique. They are unique when one of these covers exactly those fields, in any order:

- the target's primary key;
- a unique constraint (`.unique()` on the field, or `constraints.unique([...])` in `.attributes()`);
- a unique index (`constraints.index([...], { unique: true })` in `.sql()`) without a `where`.

A unique constraint over more fields than `by`, or over only some of them, does not count. When none matches, `prisma contract emit` and `defineContract` fail:

```text
CONTRACT.RELATION_INVALID: Relation "User.profile" is one-to-one, but the fields "userId" of model "Profile" are not unique. Add a unique constraint over exactly those fields, or make "profile" a hasMany relation.
```

In every file the detection matches, find each `rel.hasOne(Target, { by: ... })` whose `by` fields of `Target` are not unique, and apply one of the two fixes below. Then re-emit the contract with `prisma contract emit`.

## Each parent has at most one related row: make the key unique

Add a unique constraint over exactly the `by` fields of the target model. For one field, use `.unique()`:

```ts
// Before
const Profile = model('Profile', {
  fields: {
    id: field.column(int4Column).id(),
    userId: field.column(int4Column),
  },
});

// After
const Profile = model('Profile', {
  fields: {
    id: field.column(int4Column).id(),
    userId: field.column(int4Column).unique(),
  },
});
```

For several fields, add `constraints.unique([fields.a, fields.b])` to the target's `.attributes()`. The contract's storage gains a unique constraint, so plan and apply a migration for it. The migration fails if the table already holds two rows with the same key; remove the duplicates first.

## A parent can have several related rows: use `hasMany`

Replace `rel.hasOne(Target, { by })` with `rel.hasMany(Target, { by })`. The relation then reads as an array of rows instead of one row or `null`, so update the code that reads or writes it.
