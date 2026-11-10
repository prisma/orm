# MySQL proof of concept

A narrow MySQL target, then MariaDB, built to find the places where shared SQL code assumes Postgres or SQLite while release candidates can still break APIs. All targets move to one folder per database first.

| File | Holds |
| --- | --- |
| [`spec.md`](./spec.md) | Purpose, decisions, non-goals, project DoD |
| [`design-notes.md`](./design-notes.md) | Why each decision was made, and the alternatives rejected |
| [`plan.md`](./plan.md) | The five slices and their order |
| [`coupling.md`](./coupling.md) | Every coupling found, and its outcome |
| `slices/` | One folder per slice, with its spec and plan, written when the slice starts |

Linear: [MySQL proof of concept](https://linear.app/prisma-company/project/mysql-proof-of-concept-da2bc4144a89).
