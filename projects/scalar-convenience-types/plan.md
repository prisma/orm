# Plan: scalar convenience types

Spec: [spec.md](spec.md). Approved by Will on 2026-11-02.

## Slices

| # | Slice | Linear | Builds on | Hands to |
| --- | --- | --- | --- | --- |
| 1 | PostgreSQL `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes` convenience types; explicit renames with deprecated aliases; SQL PSL interpreter reports `PSL_DEPRECATED_SCALAR_NAME`; ADR 316; docs | TML-3715 | `main` | The renamed explicit types and the SQL deprecation warning |
| 2 | PostgreSQL `Json` convenience type, `jsonb` by default; new explicit name for `pg/json@1`; upgrade instruction for the contract change | TML-3789 | Slice 1 | — |

Slice 2 waits for Will to name the explicit `pg/json@1` type, and for slice 1 to merge.

SQLite, MySQL and MongoDB are TML-3790, outside this project.

## Slice 1 dispatches

1. Implementation, one dispatch: type declarations, the SQL deprecation warning, tests, fixtures, examples, docs, ADR 316, upgrade instructions. The type changes and the fixtures that use them must change together, so they are not split.
2. `/drive-code-review` on the branch, then fixes.
