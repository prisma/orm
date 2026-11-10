# sql-builder — Status

## What exists

A fluent SQL query builder DSL with both type-level inference and a runtime implementation that produces `relational-core` AST nodes and `SqlQueryPlan` objects for execution through the standard runtime pipeline.

### Type-level

Type-safe builder interfaces validated via `expectTypeOf` tests in `test/playground/`.

### Runtime

- **`sql({ context, runtime })`** — factory returning `Db<Contract>` with table proxies
- **`TableProxy`** — `.select()`, `.as()`, all join methods, lateral joins
- **`SelectQuery`** — `.select()`, `.where()`, `.orderBy()`, `.groupBy()`, `.limit()`, `.offset()`, `.distinct()`, `.distinctOn()`, `.forUpdate()`, `.forNoKeyUpdate()`, `.forShare()`, `.forKeyShare()`, `.as()`, `.first()`, `.firstOrThrow()`, `.all()`
- **`GroupedQuery`** — `.groupBy()`, `.having()`, `.orderBy()`, `.limit()`, `.offset()`, `.distinct()`, `.distinctOn()`, `.as()`, `.first()`, `.firstOrThrow()`, `.all()`
- **Execution** — `.first()`, `.firstOrThrow()`, `.all()` build `SqlQueryPlan` and delegate to `Runtime`
- **Extension functions** — derived from `QueryOperationRegistry` (e.g., pgvector `cosineDistance`)
- **`IdentifierRef`** AST node — for top-level field references without table qualification

### Covered clauses

- **FROM** (table)
- **SELECT** (column names, aliased expressions, callback returning record)
- **WHERE**
- **JOIN** (INNER, LEFT OUTER, RIGHT OUTER, FULL OUTER, LATERAL, LATERAL LEFT — lateral joins are capability-gated)
- **ORDER BY** (with direction, nulls first/last)
- **GROUP BY**
- **HAVING**
- **LIMIT / OFFSET** (numeric literals only)
- **Subqueries as join sources** (via `.as()`)
- **Self-joins** (via `.as()`)
- **Aggregate functions**: `count`, `sum`, `avg`, `min`, `max`
- **Comparison operators**: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`
- **Logical operators**: `and`, `or`
- **Subquery predicates**: `exists`, `notExists`, `in` (subquery or array), `notIn` (subquery or array)
- **DISTINCT** / **DISTINCT ON (expr, ...)** (DISTINCT ON is capability-gated)
- **Row locking**: `.forUpdate()`, `.forNoKeyUpdate()`, `.forShare()`, `.forKeyShare()` with the options `of` (tables or aliases in scope), `nowait` and `skipLocked` (each method and option is capability-gated)
- **Extension functions** (e.g., pgvector `cosineDistance`)

### Tests

- 72 unit tests (expressions, field proxy, functions, builders)
- 33 integration tests against PGlite (SELECT, WHERE, JOIN, ORDER BY, GROUP BY, HAVING, LIMIT/OFFSET, DISTINCT, subqueries, execution methods, extension functions)
- Row-locking integration tests prove that Postgres accepts each rendered locking clause and that the transaction holds the lock, on a single PGlite connection. They do not prove that another transaction waits, fails under `nowait` or skips under `skipLocked`, because PGlite has one connection.

## What's missing

### Clauses

- **WITH** (common table expressions) / **WITH RECURSIVE**
- **UNION** / **INTERSECT** / **EXCEPT** (and their `ALL` variants)
- **FETCH FIRST n ROWS ONLY** (SQL-standard syntax — functionally LIMIT but with `WITH TIES`)
- **TABLESAMPLE**

### FROM sources

- **CROSS JOIN**
- **NATURAL JOIN** (all variants)
- **FROM subquery** as the initial source (currently only tables can be the root `.from()`)
- **Multiple FROM items** (implicit cross join: `FROM a, b`)
- **VALUES** as a row source
- **USING** join condition (shorthand for equi-join on same-named columns)
- **generate_series()** and other set-returning functions as FROM sources

### Pagination

- **Expression-based LIMIT / OFFSET** (currently only numeric literals; expressions and parameter placeholders are not supported)

### Expressions & operators

- **NOT** (boolean negation)
- **IS NULL / IS NOT NULL**
- **BETWEEN ... AND ...**
- **LIKE / ILIKE / SIMILAR TO**
- **ANY / ALL / SOME**
- **Arithmetic**: `+`, `-`, `*`, `/`, `%`
- **String concatenation**: `||`
- **CASE WHEN ... THEN ... ELSE ... END**
- **CAST(expr AS type)** / `expr::type`
- **COALESCE / NULLIF / GREATEST / LEAST**
- **Scalar subqueries** (subquery in SELECT list or WHERE)
- **Row constructors** / row-level comparisons
- **Array operators**: `@>`, `<@`, `&&`, indexing, slicing
- **JSON/JSONB operators**: `->`, `->>`, `#>`, `@>`, `?`, etc.

### Window functions

- **OVER (PARTITION BY ... ORDER BY ... frame)**
- **Named windows** (`WINDOW w AS (...)`)
- **Ranking**: `row_number()`, `rank()`, `dense_rank()`, `ntile()`
- **Offset**: `lag()`, `lead()`, `first_value()`, `last_value()`, `nth_value()`
- **Frame clauses**: `ROWS/RANGE/GROUPS BETWEEN ...`

### Advanced GROUP BY

- **GROUPING SETS**
- **CUBE**
- **ROLLUP**
- **FILTER (WHERE ...)** clause on aggregate calls

### Functions (beyond the 5 aggregates)

- **String**: `length`, `substring`, `trim`, `upper`, `lower`, `regexp_match`, ...
- **Math**: `abs`, `ceil`, `floor`, `round`, `power`, ...
- **Date/time**: `now()`, `date_trunc`, `extract`, interval arithmetic, ...
- **Array**: `array_agg`, `unnest`, `array_length`, `array_position`, ...
- **JSON**: `json_agg`, `jsonb_build_object`, `json_each`, ...
- **Conditional**: `coalesce`, `nullif`, `greatest`, `least`

## Priority gaps

The most impactful gaps for a practical query builder: **CTEs**, **set operations** (UNION/INTERSECT/EXCEPT), **window functions**, **IS NULL**, **NOT**, **CASE**, **arithmetic**, and **COALESCE** — those cover the vast majority of real-world queries that the current types can't express.
