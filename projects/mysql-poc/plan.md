# Project plan — MySQL proof of concept

**Spec:** [`spec.md`](./spec.md) · **Design notes:** [`design-notes.md`](./design-notes.md) · **Coupling register:** [`coupling.md`](./coupling.md) · **Linear:** [MySQL proof of concept](https://linear.app/prisma-company/project/mysql-proof-of-concept-da2bc4144a89)

## At a glance

| Slice | What it delivers | Builds on | Linear | State |
| --- | --- | --- | --- | --- |
| 1 | Every target in one folder per database; `2-sql` becomes `2-sql-family` | — | [TML-3693](https://linear.app/prisma-company/issue/TML-3693) | Merged, prisma/orm#30829 |
| 2a | MySQL target: codecs, driver, contract emit, schema introspection | 1 | [TML-3694](https://linear.app/prisma-company/issue/TML-3694) | Merged, prisma/orm#30836 |
| 2b | MySQL migrations, `db verify`, `db sign`; migration atomicity stated by the target | 2a | [TML-3704](https://linear.app/prisma-company/issue/TML-3704) | Merged, prisma/orm#30841 |
| 2c | `examples/prisma-8-demo-mysql` and the public `@prisma/orm-mysql` packages; the example migrates, verifies and signs | 2b | [TML-3723](https://linear.app/prisma-company/issue/TML-3723) | Merged, prisma/orm#30856 |
| 3 | MySQL ORM reads with includes; the example reads | 2c | [TML-3695](https://linear.app/prisma-company/issue/TML-3695) | Merged, prisma/orm#30863; drivers on `mariadb`, prisma/orm#30893 and prisma/orm#30918 |
| 4 | ORM writes without `RETURNING`; MySQL create, update, delete, upsert; the example writes | 3 | [TML-3696](https://linear.app/prisma-company/issue/TML-3696) | In progress, spec: [`slices/mysql-writes/`](./slices/mysql-writes/spec.md) |
| 6 | `mariadb` target extending MySQL; the example also runs against MariaDB | 4 | [TML-3697](https://linear.app/prisma-company/issue/TML-3697) | Not started |

```text
1 → 2a → 2b → 2c → 3 → 4 → 6 → close-out
```

- Each slice is one pull request against `main`.
- Six slices is more than the usual limit of four. Slice 1 is a pure move with no MySQL code, kept apart so its diff is reviewable as renames and the MySQL slices only add files. Slice 2 was split into 2a and 2b on 2026-10-22, after research sized it at 10–13k lines, too large to review in one sitting. The example app was added on 2026-10-23 and moved to the front the same day (Will): it is built in slice 2c, and every later slice is done only when the example runs what it delivered, in CI, as the Postgres, SQLite and Mongo examples grew. There is no slice 5.
- The slices are a stack because each tests against the previous one: reads need tables that slice 2 creates, writes read rows back through slice 3's reads, the example grows with each slice, and MariaDB subclasses the finished MySQL target and runs the example.

## Slices

### 1 — Every target in one folder per database

- Postgres, SQLite and Mongo move into `packages/3-targets/<db>/{1-target,2-adapter,3-driver,4-codec-testkit,9-facade}`. `2-sql` becomes `2-sql-family`.
- Every target registers in `architecture.config.json` the same way, and gets the layering test.
- Docs rewritten; a new ADR records the layout.

**Hands to 2:** the folder a new target goes in, and the registration recipe it follows.

### 2a — MySQL target: codecs, driver, emit, introspection

- Target, adapter, driver and facade in `packages/3-targets/mysql/`.
- The spec's contract emits; a MySQL database introspects into the family schema IR.
- Namespace refusal reads the target's `supportsNamespaces` (coupling row 9).
- MySQL 8.4 and MariaDB 10.11 service containers in CI and `docker-compose.yaml` (approved by Will, 2026-10-22).

**Hands to 2b:** a MySQL target that emits and introspects, a driver, and the test database helper.

### 2b — MySQL migrations, verify, sign

- Planner and operations for the spec's schema; the runner applies and verifies one space at a time.
- `db verify` and `db sign` against MySQL 8.4.
- Migration atomicity becomes a target fact; MySQL resumes per space.

**Hands to 2c:** a MySQL target that migrates, verifies and signs.

### 2c — The MySQL example app and the public packages

- `examples/prisma-8-demo-mysql`, depending only on the public `@prisma/orm-mysql`, emits, migrates, verifies and signs against MySQL 8.4 in the "Test Examples" CI job.
- The public `@prisma/orm-mysql` and `@prisma/orm-target-mysql` packages.

**Hands to 3:** an example to add reads to, and a MySQL database the tests can create and migrate.

### 3 — MySQL ORM reads with includes

- Select, filter, order, limit and includes lower to MySQL SQL, with golden tests and tests against MySQL 8.4.
- How related rows keep their order is decided against a live server.

**Hands to 4:** the read path the ORM's read-back uses after a write.

### 4 — ORM writes without `RETURNING`

- Writes find the written rows' identity without `RETURNING` and read them back.
- The SQL driver's write result reports `insertId` for a one-row write; the ORM reads rows back by identity when `returning` is off (ADR 164).
- A new capability, `sql.insertOnConflictTarget`, says whether a conflict clause applies only to the columns it names. Splitting `returning` by statement kind moves to slice 6, where MariaDB needs it.

**Hands to 6:** a complete MySQL target to subclass, and an example that reads and writes.

### 6 — MariaDB

- `packages/3-targets/mariadb/` subclasses MySQL and overrides JSON, defaults, relation loading and upsert rendering.
- Every MySQL test, and the example app, passes against MariaDB 10.11.

**Hands to close-out:** both targets proven, and the coupling register complete.

## Close-out (required)

- [ ] Verify every condition in the spec's Project DoD.
- [ ] Every entry in `coupling.md` is fixed or filed as a Linear issue; every breaking one is fixed.
- [ ] File the follow-up issues for full MySQL and MariaDB support.
- [ ] Migrate long-lived decisions into ADRs (layout; migration atomicity; MariaDB as an extending target; writes without `RETURNING`).
- [ ] Mark stream 1 row 3 done on the GA planning branch.
- [ ] Strip repo-wide references to `projects/mysql-poc/**`.
- [ ] Delete `projects/mysql-poc/`.
