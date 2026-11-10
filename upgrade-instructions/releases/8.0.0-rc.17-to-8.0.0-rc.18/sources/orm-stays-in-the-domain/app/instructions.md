---
changes:
  - id: orm-refuses-names-that-are-not-fields
    summary: |
      The SQL ORM client refuses any name a caller passes that is not a field of the model, or of the variant the collection is narrowed to, with `ORM.FIELD_UNKNOWN`. That covers `where` shorthand and callbacks, `orderBy`, `select`, `distinct`, `distinctOn`, `groupBy`, `cursor`, aggregates, `having`, create, update and upsert data, `conflictOn`, include nested selects and relation filters. A column name that differs from its field name is no longer accepted, and rows no longer carry a column no field maps. `conflictOn` with a name that is not a field raised `ORM.ARGUMENT_INVALID` and now raises `ORM.FIELD_UNKNOWN`. The detection matches a file that names both `conflictOn` and `ORM.ARGUMENT_INVALID`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\bconflictOn\b)[\s\S]*\bORM\.ARGUMENT_INVALID\b'
---

# The SQL ORM client accepts only field names

Every name passed to the SQL ORM client must be the name of a field of the model, or of the variant the collection is narrowed to. A name that is not a field throws `ORM.FIELD_UNKNOWN` with the message `Model "<model>" has no field "<name>"`. A column name is not a field name: pass the field instead.

```diff
- await db.orm.Post.where({ user_id: 1 }).all();
+ await db.orm.Post.where({ userId: 1 }).all();
```

Code that catches the error a `conflictOn` name that is not a field raises (in a create with `onConflict: 'skip'`) matched `ORM.ARGUMENT_INVALID`. Match `ORM.FIELD_UNKNOWN` instead.

```diff
- if (error.code === 'ORM.ARGUMENT_INVALID') {
+ if (error.code === 'ORM.FIELD_UNKNOWN') {
```

Leave other checks of `ORM.ARGUMENT_INVALID` alone; only the `conflictOn` refusal changed code.
