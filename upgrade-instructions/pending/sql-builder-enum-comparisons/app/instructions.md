---
changes:
  - id: sql-builder-enum-comparison-values-are-checked
    summary: |
      In the SQL builder, a raw value compared with a column in `fns.eq`, `fns.ne`, `fns.gt`, `fns.gte`, `fns.lt`, `fns.lte`, `fns.in` or `fns.notIn` must now have the type the contract gives that column, as it already must in `insert`, `update` and the ORM client's `where`. This affects every column whose contract type is narrower than its codec's type: enums stored as text or integers, native enums, and columns with a typed override. A value that is not a member, such as a misspelling, is now a type error. Before, the query ran and matched no rows, or, for a native enum, the database rejected the value. So is a value typed as a plain `string` or `number`, or a `string[]` passed to `fns.in`. Fix the value, or narrow it to the column's type before comparing. To match a value the column's type no longer lists, such as in a migration that renames an enum member, compare with `fns.raw` instead.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - 'fns\.(?:eq|ne|gt|gte|lt|lte|in|notIn)\('
---

# SQL builder comparisons check values against the column's type

## `sql-builder-enum-comparison-values-are-checked`

A builder `where` such as `fns.eq(f.kind, 'humna')` on an enum column whose members are `human` and `agent` now fails to type-check, with the same error as `update({ kind: 'humna' })`. Correct the value to one of the enum's members.

The same check applies to any column whose contract type is narrower than its codec's type: an enum stored as an integer (`0 | 1 | 2`), a native enum, or a column with a typed override.

A value whose type is wider than the column's is also refused. For example, `fns.eq(f.status, req.query.status)` fails when `req.query.status` is a `string`, and `fns.in(f.status, values)` fails when `values` is a `string[]`. Narrow the value first, for example by checking it against the enum's members, so that TypeScript knows it is one of them.

To find rows that hold a value the column's type no longer lists, compare with a raw SQL operand, which keeps the codec's input type: ``fns.eq(fns.raw`kind`.returns('pg/text@1'), 'old_value')``.
