# Project plan: Raw columns

**Spec:** [`spec.md`](./spec.md) · **Linear:** [Raw columns](https://linear.app/prisma-company/project/raw-columns-f8b71d02e514)

| Slice | Delivers | Builds on | Linear |
| --- | --- | --- | --- |
| 1 | `sql/raw` data type and codec on Postgres and SQLite; `Raw("...")` in Prisma 8 schemas and the TypeScript builder; `sql` defaults only; verify by the reported type; `contract print`; planning a change between raw types | main | TML-3585 |
| 2 | The Prisma 7 reader reads `Unsupported("...")` as a raw column with no field | 1 | TML-3596 |

Each slice is one pull request against `main`. Slice 2 starts after slice 1 merges.

## Close-out (required)

- [ ] Verify every project DoD item in [`spec.md`](./spec.md)
- [ ] Final retro
- [ ] ADR 273 matches the shipped code
- [ ] Delete `projects/raw-columns/`
