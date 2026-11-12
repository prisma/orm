---
changes:
  - id: sql-builder-enum-comparison-values-are-checked
    summary: |
      In the SQL builder, a raw value compared with an enum column in `fns.eq`, `fns.ne`, `fns.gt`, `fns.gte`, `fns.lt`, `fns.lte`, `fns.in` or `fns.notIn` must now be one of the enum's members, as it already must in `insert`, `update` and the ORM client's `where`. A value that is not a member, such as a misspelling, is now a type error instead of a query that matches no rows. Fix the value. To match a value the enum no longer lists, such as in a migration that renames a member, compare with `fns.raw` instead.
---

# SQL builder comparisons check enum values

## `sql-builder-enum-comparison-values-are-checked`

A builder `where` such as `fns.eq(f.kind, 'humna')` on an enum column whose members are `human` and `agent` now fails to type-check, with the same error as `update({ kind: 'humna' })`. Correct the value to one of the enum's members.

To find rows that hold a value the enum no longer lists, compare with a raw SQL operand, which keeps the codec's input type: ``fns.eq(fns.raw`kind`.returns('pg/text@1'), 'old_value')``.
