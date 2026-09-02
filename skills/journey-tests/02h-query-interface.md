# Journey 02h — Pick the right query interface

**Skills under test:** `prisma-orm-core-concepts` (queries).

**Acceptance criterion:** AC5h.

## Prompt

> I need to compute a running total of order amounts per user using a Postgres window function. How do I write this in Prisma Next?

## Expected agent behavior

- [ ] Recognises that ORM doesn't express window functions ergonomically.
- [ ] Reaches for the SQL DSL (`db.sql.from(...)`) first, or raw SQL if the DSL doesn't expose `SUM(...) OVER (...)`.
- [ ] Writes the query with parameter binding (no string interpolation of user input).

## Success criteria

- [ ] Agent did NOT use raw `string` concatenation of user input into a SQL query.
- [ ] Agent justified the choice (window function → DSL or raw SQL, not ORM).
- [ ] The query typechecks and returns the expected row shape.
