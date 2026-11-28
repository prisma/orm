# Prior art: how classic ORMs handle writes that return rows

Read on 2026-11-24 from each project's default branch and official docs. Line numbers are those of the default branch on that date and will drift; the function name is the stable pointer. Markers: **(verified in source/docs)** means I read it in the linked file or page; **(from memory, not verified)** means I did not find it in a source this session.

The six questions:

1. A bulk update or delete that returns the written rows: does it exist, and how is it done on PostgreSQL/SQLite and on MySQL?
2. When a library emulates it with SELECT then write: locks, transaction, re-check, count comparison, or a documented race?
3. "Update or delete the first row matching a filter and order" (claiming a job): the idiom, and whether the library hides it.
4. Stale writes on a single loaded record: how detected; does the library compare affected rows with the expected count?
5. Capability handling: feature flags checked when building SQL, or build-general-then-rewrite?
6. MySQL error 1093 (a write whose WHERE subquery reads the target table): worked around, refused, or surfaced?

---

## Active Record (Rails)

### 1. Bulk write that returns rows

- `update_all` and `delete_all` send one SQL statement and return the affected-row count only. `destroy_all` loads the records and calls `destroy` on each (`records.each(&:destroy)`); `destroy_by`/`delete_by` are `where(...).destroy_all` / `where(...).delete_all`. [relation.rb `update_all`, `delete_all`, `destroy_all`, `destroy_by`, `delete_by`](https://github.com/rails/rails/blob/main/activerecord/lib/active_record/relation.rb) **(verified in source/docs)**
- There is no `returning:` on `update_all`/`delete_all` in released Rails. A proposal, [rails/rails#57073 "Add update_all_returning"](https://github.com/rails/rails/pull/57073) (opened 2026-03-26, still open, no maintainer review), adds a separate method and a `supports_update_returning` flag. On MySQL it **raises** instead of emulating; the author's reason is that atomicity is the point of the method, so a multi-query fallback would defeat it. The same position is in the [forum proposal](https://discuss.rubyonrails.org/t/feature-proposal-atomic-update-and-select/90992). **(verified in source/docs)**
- `insert_all`/`upsert_all` accept `returning:`, documented as "(PostgreSQL, SQLite3, and MariaDB only)". If the caller passes `returning:` on an adapter without support, `InsertAll#ensure_valid_options_for_connection!` raises `ArgumentError, "#{connection.class} does not support :returning"`. If the caller leaves it unset, it silently becomes `false`. [insert_all.rb](https://github.com/rails/rails/blob/main/activerecord/lib/active_record/insert_all.rb) **(verified in source/docs)**
- MariaDB: `supports_insert_returning?` is `mariadb? && database_version >= "10.5.0"` ([abstract_mysql_adapter.rb line 213](https://github.com/rails/rails/blob/main/activerecord/lib/active_record/connection_adapters/abstract_mysql_adapter.rb#L213)). **(verified in source/docs)**
- For a single record, `_update_row` uses `UPDATE … RETURNING` when `supports_update_returning?` is true, to read back database-computed columns ([persistence.rb `_update_row`](https://github.com/rails/rails/blob/main/activerecord/lib/active_record/persistence.rb)). Only the PostgreSQL adapter turns that flag on (`alias supports_update_returning? supports_insert_returning?`, [postgresql_adapter.rb line 322](https://github.com/rails/rails/blob/main/activerecord/lib/active_record/connection_adapters/postgresql_adapter.rb#L322)). **(verified in source/docs)**

### 2. SELECT-then-write emulation

- Rails does not emulate a returning bulk write. The only SELECT-then-write path is `destroy_all`, which loads rows (no lock, no transaction around the whole set, each `destroy` in its own transaction) and deletes them one by one. A row deleted by someone else in between is simply not deleted again; plain `destroy` does not raise on 0 rows (see 4). **(verified in source/docs** for the code path; "each destroy in its own transaction" is **from memory, not verified)**

### 3. Claiming one row

- No high-level method. The user asks for the lock: `Model.lock("FOR UPDATE SKIP LOCKED").where(...).order(...).first` inside `transaction`, or `with_lock`/`lock!` on a loaded record. The docs say "Call `lock('some locking clause')` to use a database-specific locking clause", with the example `Account.lock("FOR UPDATE NOWAIT")`. [locking/pessimistic.rb](https://github.com/rails/rails/blob/main/activerecord/lib/active_record/locking/pessimistic.rb) **(verified in source/docs)**
- There is no `supports_skip_locked?` flag in the abstract adapter; the lock clause is a raw string the user writes ([abstract_adapter.rb](https://github.com/rails/rails/blob/main/activerecord/lib/active_record/connection_adapters/abstract_adapter.rb)). **(verified in source/docs)**
- `update_all` on a relation with `limit`/`order` builds one statement `UPDATE … WHERE id IN (SELECT id … ORDER BY … LIMIT n)` (Arel `prepare_update_statement` + `build_subselect`, [to_sql.rb line 951](https://github.com/rails/rails/blob/main/activerecord/lib/arel/visitors/to_sql.rb#L951)). That is a single statement but takes no row lock in the subquery and does not return the row. **(verified in source/docs)**
- The #57073 proposal's motivating example is exactly the claim: `Ticket.unassigned.limit(1).update_all_returning(...)`. **(verified in source/docs)**

### 4. Stale writes on one record

- Without optimistic locking: `_update_record` and `destroy` ignore a 0 count except to skip the after-callbacks (`@_trigger_update_callback = affected_rows == 1`, `destroy_row > 0`). No error. [persistence.rb](https://github.com/rails/rails/blob/main/activerecord/lib/active_record/persistence.rb) **(verified in source/docs)**
- With a `lock_version` column: the UPDATE/DELETE adds `AND lock_version = ?`, and `_update_row` raises `ActiveRecord::StaleObjectError` when `affected_rows != 1`; `destroy_row` does the same when `locking_enabled? && affected_rows != 1`. [locking/optimistic.rb](https://github.com/rails/rails/blob/main/activerecord/lib/active_record/locking/optimistic.rb) **(verified in source/docs)** This is an affected-row-count comparison, but only when the user opts in to versioning.
- MySQL rowcount: both MySQL adapters set the found-rows flag so a count means "rows matched", not "rows changed": `@config[:flags] |= ::Mysql2::Client::FOUND_ROWS` ([mysql2_adapter.rb line 63-65](https://github.com/rails/rails/blob/main/activerecord/lib/active_record/connection_adapters/mysql2_adapter.rb#L63)) and `config[:found_rows] = true` with the comment "Set FOUND_ROWS capability on the connection so UPDATE queries returns number of rows" ([trilogy_adapter.rb line 96](https://github.com/rails/rails/blob/main/activerecord/lib/active_record/connection_adapters/trilogy_adapter.rb#L96)). **(verified in source/docs)**

### 5. Capability handling

- Adapter predicate methods checked while building or validating the statement: `supports_insert_returning?`, `supports_update_returning?`, `supports_insert_on_duplicate_skip?`, etc., all `false` in `AbstractAdapter` and overridden per adapter. **(verified in source/docs)**
- SQL shape differences live in per-database Arel visitors (e.g. `Arel::Visitors::MySQL#prepare_update_statement` overrides the generic one). This is "pick the form per database when compiling", not "build a general multi-statement plan and optimise it". I found no build-general-then-fuse step. **(verified in source/docs)**

### 6. MySQL error 1093

- Partial workaround. When Rails itself generates the `id IN (subquery)` form on MySQL (offset, GROUP BY with HAVING, or joins combined with LIMIT/OFFSET/ORDER), `Arel::Visitors::MySQL#build_subselect` wraps it as `SELECT id FROM (…) __active_record_temp`, adding `DISTINCT` when there is no LIMIT/ORDER so MySQL 5.7.6+ materialises it instead of merging it. Comment: "MySQL doesn't automatically create a temporary table for use subquery, so we have to give it some prompting in the form of a subsubquery." [mysql.rb lines 82-112](https://github.com/rails/rails/blob/main/activerecord/lib/arel/visitors/mysql.rb#L82) **(verified in source/docs)**
- When the MySQL statement allows it, Rails uses MySQL's native `UPDATE … ORDER BY … LIMIT` or multi-table `UPDATE … JOIN` and needs no subquery. **(verified in source/docs)**
- A subquery the user writes themselves (`where(id: Model.where(...).select(:id))`) is not wrapped by this code, so error 1093 surfaces. **(my inference from the code path; not tested)**

---

## Django ORM

### 1. Bulk write that returns rows

- `QuerySet.update()` "returns the number of rows matched". `QuerySet.delete()` returns `(total, {model_label: count})`; it collects objects first unless it can take the fast path (no cascades handled in Python and no delete signal receivers). [QuerySet API reference](https://docs.djangoproject.com/en/dev/ref/models/querysets/) **(verified in source/docs)**
- No public `RETURNING` on `update()` or `delete()`. Ticket [#32406 "Allow QuerySet.update() to return fields on supported backends"](https://code.djangoproject.com/ticket/32406) is accepted but "patch needs improvement"; the patch supports SQLite, PostgreSQL and Oracle, and the ticket does not say what MySQL would do. **(verified in source/docs)**
- Django 6.0 added internal `UPDATE … RETURNING` for `Model.save()`: generated fields and fields assigned expressions are refreshed via `RETURNING` on SQLite, PostgreSQL and Oracle; on MySQL and MariaDB they are marked deferred and re-read on next access. New backend flag `DatabaseFeatures.can_return_rows_from_update`. [6.0 release notes](https://docs.djangoproject.com/en/dev/releases/6.0/) **(verified in source/docs)**
- `bulk_create` sets primary keys only on PostgreSQL, MariaDB and SQLite (`can_return_rows_from_bulk_insert`); "On other databases, it will not be set." [QuerySet API reference](https://docs.djangoproject.com/en/dev/ref/models/querysets/), [mysql/features.py](https://github.com/django/django/blob/main/django/db/backends/mysql/features.py) (`can_return_rows_from_bulk_insert` is false on MySQL, true on MariaDB) **(verified in source/docs)**

### 2. SELECT-then-write emulation

- Django does emulate, for `update()` on MySQL when the update depends on other tables. `SQLUpdateCompiler.pre_sql_setup` computes `must_pre_select = count > 1 and not self.connection.features.update_can_self_select`; when true it runs the SELECT of primary keys, then filters the UPDATE by `pk__in` that literal list. Comment: "the db backend doesn't support selecting from the updating table (e.g. MySQL)". [compiler.py `SQLUpdateCompiler.pre_sql_setup`](https://github.com/django/django/blob/main/django/db/models/sql/compiler.py) **(verified in source/docs)**
- It takes no lock, and does not open a transaction: `QuerySet.update` runs inside `transaction.mark_for_rollback_on_error`, whose docstring says it exists "to avoid starting a transaction when in autocommit mode". It does not re-check the filter in the UPDATE (only `pk IN (…)`) and does not compare counts. [query.py `QuerySet.update`](https://github.com/django/django/blob/main/django/db/models/query.py), [transaction.py `mark_for_rollback_on_error`](https://github.com/django/django/blob/main/django/db/transaction.py) **(verified in source/docs)**
- The docs accept and document the race: "On MySQL, `QuerySet.update()` may execute a `SELECT` followed by an `UPDATE` instead of a single `UPDATE` when filtering on related tables, which can introduce a race condition if concurrent changes occur between the queries." [QuerySet API reference, `update()`](https://docs.djangoproject.com/en/dev/ref/models/querysets/#update) **(verified in source/docs)**
- `delete()` with collection does SELECT then DELETE, inside `transaction.atomic(savepoint=False)` in `Collector.delete`, with no row locks and no comparison of deleted counts with collected objects. [deletion.py `Collector.delete`](https://github.com/django/django/blob/main/django/db/models/deletion.py) **(verified in source/docs)**

### 3. Claiming one row

- The user asks for the lock: `Model.objects.select_for_update(skip_locked=True).filter(...).order_by(...).first()` inside `transaction.atomic()`, then `save()`/`update()`/`delete()`. Evaluating it in autocommit mode raises `TransactionManagementError` "because the rows are not locked in that case". `nowait` and `skip_locked` are mutually exclusive; unsupported options raise `NotSupportedError`; on SQLite it "will have no effect". [QuerySet API reference, `select_for_update()`](https://docs.djangoproject.com/en/dev/ref/models/querysets/#select-for-update) **(verified in source/docs)**
- `update()` on a sliced queryset raises `TypeError("Cannot update a query once a slice has been taken.")`, and `delete()` raises on `limit`/`offset`, so there is no single-statement "update the first N". [query.py `QuerySet.update`, `QuerySet.delete`](https://github.com/django/django/blob/main/django/db/models/query.py) **(verified in source/docs)**
- No high-level claim method. **(verified in source/docs** that none is documented in the QuerySet reference)

### 4. Stale writes on one record

- `save()` on an instance with a primary key runs an UPDATE; if it matched no rows, Django falls back to an INSERT. With `force_update=True` it raises `NotUpdated("Forced update did not affect any rows.")`; with `update_fields` it raises `NotUpdated("Save with update_fields did not affect any rows.")`. `NotUpdated` subclasses `DatabaseError`. [base.py `Model._save_table`](https://github.com/django/django/blob/main/django/db/models/base.py) **(verified in source/docs)**
- `Meta.select_on_save` runs `exists()` first and, when the UPDATE reports 0, re-checks `exists()` to tell a deleted row from a trigger that hid the count. [base.py `Model._do_update`](https://github.com/django/django/blob/main/django/db/models/base.py), [model instance reference](https://docs.djangoproject.com/en/dev/ref/models/instances/) **(verified in source/docs)**
- No built-in optimistic locking (version column); third-party packages provide it. **(from memory, not verified)**
- MySQL: the backend sets `kwargs["client_flag"] = CLIENT.FOUND_ROWS` with the comment "We need the number of potentially affected rows after an 'UPDATE', not the number of changed rows." [mysql/base.py `get_connection_params`](https://github.com/django/django/blob/main/django/db/backends/mysql/base.py) **(verified in source/docs)**
- `Model.delete()` on a row that is gone returns a count of 0. **(inferred from the documented return value, not verified)**

### 5. Capability handling

- Backend feature flags on `connection.features`, read by the SQL compiler while building the statement: `can_return_columns_from_insert`, `can_return_rows_from_bulk_insert`, `can_return_rows_from_update`, `update_can_self_select`, `delete_can_self_reference_subquery`, `has_select_for_update_skip_locked`, `supports_select_for_update_with_limit`. Defaults in [base/features.py](https://github.com/django/django/blob/main/django/db/backends/base/features.py); MySQL values in [mysql/features.py](https://github.com/django/django/blob/main/django/db/backends/mysql/features.py) (e.g. `update_can_self_select` false on MySQL, true on MariaDB; `delete_can_self_reference_subquery` false on both). **(verified in source/docs)**
- Backends also replace whole compiler classes (`django/db/backends/mysql/compiler.py`), e.g. MySQL's `SQLDeleteCompiler.as_sql` prefers multi-table `DELETE alias FROM …` "since MySQL/MariaDB will generate a more efficient query plan than when using a subquery". [mysql/compiler.py](https://github.com/django/django/blob/main/django/db/backends/mysql/compiler.py) **(verified in source/docs)**
- The `update()` pre-select (question 2) is the closest thing to "general form adjusted per database", but it is a decision made inside the compiler from a flag, not a rewrite of an already-built plan. **(verified in source/docs)**

### 6. MySQL error 1093

- DELETE: when the delete needs a subquery and `delete_can_self_reference_subquery` is false, `SQLDeleteCompiler.as_sql` wraps it: `RawSQL("SELECT * FROM (%s) subquery" …)` then `pk__in` that, with the comment "Force the materialization of the inner query to allow reference to the target table on MySQL." The MySQL compiler first tries multi-table `DELETE … FROM` instead. [compiler.py `SQLDeleteCompiler.as_sql`](https://github.com/django/django/blob/main/django/db/models/sql/compiler.py) **(verified in source/docs)**
- UPDATE: avoided by the pre-select of primary keys (question 2), not by a derived table. Documented race. **(verified in source/docs)**

---

## SQLAlchemy (Core and ORM)

### 1. Bulk write that returns rows

- Core: `update().returning(...)` and `delete().returning(...)` render `RETURNING`. The `UpdateBase.returning` docstring: "Note that not all databases/DBAPIs support RETURNING. For those backends with no support, an exception is raised upon compilation and/or execution." [sql/dml.py `UpdateBase.returning`](https://github.com/sqlalchemy/sqlalchemy/blob/main/lib/sqlalchemy/sql/dml.py) **(verified in source/docs)**. The compiler's `returning_clause` renders the clause without checking a flag, so on MySQL the error I could find comes from the server at execution. **(verified in source** that `returning_clause` has no check; that the server error is what the user sees is **my inference, not tested)**
- MariaDB: "The MariaDB dialect supports 10.5+'s `INSERT..RETURNING` and `DELETE..RETURNING` (10.0+) syntaxes." [dialects/mysql/base.py docs](https://github.com/sqlalchemy/sqlalchemy/blob/main/lib/sqlalchemy/dialects/mysql/base.py) **(verified in source/docs)**
- `Insert.return_defaults()` is the "if supported" variant: "If the backend does not support RETURNING … then no RETURNING clause is added and no additional data is fetched, however the INSERT, UPDATE or DELETE statement proceeds normally." [sql/dml.py `return_defaults`](https://github.com/sqlalchemy/sqlalchemy/blob/main/lib/sqlalchemy/sql/dml.py) **(verified in source/docs)**
- ORM: "`UpdateBase.returning()` method is fully compatible with ORM-enabled UPDATE and DELETE with WHERE criteria", returning entities or columns. [ORM DML guide](https://docs.sqlalchemy.org/en/20/orm/queryguide/dml.html) **(verified in source/docs)**

### 2. SELECT-then-write emulation (`synchronize_session='fetch'`)

- Purpose: keep in-memory session objects in step with an ORM bulk UPDATE/DELETE, not to return rows to the caller. `'fetch'` "retrieves affected primary keys by either performing a SELECT before the UPDATE or DELETE, or by using RETURNING if the database supports it". The default `'auto'` uses `'fetch'` with RETURNING where supported and otherwise falls back to `'evaluate'` (evaluate the WHERE in Python against objects already in the session). [ORM DML guide](https://docs.sqlalchemy.org/en/20/orm/queryguide/dml.html) **(verified in source/docs)**
- Exact mechanism, in `_do_pre_synchronize_fetch`: it builds `select(*mapper.primary_key, identity_token).select_from(mapper)` and copies the statement's `_where_criteria`; it runs this through `session.execute`, and a `do_orm_execute` hook cancels the SELECT when RETURNING is usable (`can_use_returning`: `dialect.update_returning and mapper.local_table.implicit_returning`, or `delete_returning`; `*_returning_multifrom` for UPDATE..FROM / DELETE..USING). The matched primary keys are stored as `_matched_rows`; after the write, `_do_post_synchronize_fetch` uses the RETURNING rows if present, otherwise `_matched_rows`. [orm/bulk_persistence.py `_do_pre_synchronize_fetch`, `can_use_returning`](https://github.com/sqlalchemy/sqlalchemy/blob/main/lib/sqlalchemy/orm/bulk_persistence.py) **(verified in source/docs)**
- No `with_for_update`, no extra transaction (it uses whatever transaction the Session already has, which by default is open), the WHERE is re-applied by the write itself (the write is the original statement, not `pk IN (…)`), and no count comparison. The docs say nothing about the race. **(verified in source/docs)** Consequence: on MySQL the pre-selected key list and the rows actually written can differ if another connection commits in between; only the session sync is affected, since the write uses its own WHERE. **(my inference from the code)**
- If the dialect cannot do the multi-table form with RETURNING it raises, e.g. `'Dialect "{name}" does not support RETURNING with UPDATE..FROM; for synchronize_session='fetch', …'`. **(verified in source/docs)**

### 3. Claiming one row

- The user asks: `select(Job).where(...).order_by(...).limit(1).with_for_update(skip_locked=True)` inside a transaction, then modify and flush. The compiler renders `FOR UPDATE … SKIP LOCKED` ([sql/selectable.py `with_for_update`](https://github.com/sqlalchemy/sqlalchemy/blob/main/lib/sqlalchemy/sql/selectable.py); MySQL rendering in [dialects/mysql/base.py line 1772](https://github.com/sqlalchemy/sqlalchemy/blob/main/lib/sqlalchemy/dialects/mysql/base.py#L1772)). **(verified in source/docs)**
- Core lets the user write the single-statement form `update(t).where(t.c.id == select(t.c.id)….limit(1).with_for_update(skip_locked=True).scalar_subquery()).returning(...)`; nothing builds it automatically. MySQL supports `UPDATE/DELETE … LIMIT` via the `limit()` extension (`update(...).ext(limit(10))`, superseding `mysql_limit` in 2.1). [dialects/mysql/base.py docs](https://github.com/sqlalchemy/sqlalchemy/blob/main/lib/sqlalchemy/dialects/mysql/base.py) **(verified in source/docs** for `limit()`; the composed claim statement is **my example, not from their docs)**
- No high-level claim method. **(from memory, not verified)**

### 4. Stale writes on one record

- The unit of work always compares matched rows with the expected count for per-object UPDATEs, versioned or not: `if rows != len(records): raise orm_exc.StaleDataError("UPDATE statement on table '%s' expected to update %d row(s); %d were matched.")`. This runs when `supports_sane_rowcount` (single row) or `supports_sane_multi_rowcount` (executemany) is true; if versioning is on and the dialect cannot report counts, it only warns "Dialect %s does not support updated rowcount - versioning cannot be verified." [orm/persistence.py `_emit_update_statements`, lines ~940-977](https://github.com/sqlalchemy/sqlalchemy/blob/main/lib/sqlalchemy/orm/persistence.py#L963) **(verified in source/docs)**
- DELETE: with `confirm_deleted_rows` (default on) and a count mismatch, it warns when there is no version column and raises `StaleDataError` when there is one. A source comment asks "why does this 'only warn' if versioning is turned off, whereas the UPDATE raises?" If versioning is on and the dialect lacks sane multi-row counts, it executes the deletes one at a time to verify each. [orm/persistence.py `_emit_delete_statements`, lines ~1460-1523](https://github.com/sqlalchemy/sqlalchemy/blob/main/lib/sqlalchemy/orm/persistence.py#L1496) **(verified in source/docs)**
- `version_id_col`: "If zero rows match, that indicates our version of the data is stale, and a StaleDataError is raised." Server-side version counters are read back with RETURNING where available. [Configuring a Version Counter](https://docs.sqlalchemy.org/en/20/orm/versioning.html) **(verified in source/docs)**
- ORM bulk UPDATE by primary key list enables the row-count check only when there is no WHERE criteria (`enable_check_rowcount = not statement._where_criteria`). [orm/bulk_persistence.py](https://github.com/sqlalchemy/sqlalchemy/blob/main/lib/sqlalchemy/orm/bulk_persistence.py) **(verified in source/docs)**
- MySQL: "SQLAlchemy standardizes the DBAPI `cursor.rowcount` attribute to be the usual definition of 'number of rows matched by an UPDATE or DELETE' … the SQLAlchemy MySQL dialects always add the `constants.CLIENT.FOUND_ROWS` flag … This setting is currently hardcoded." [dialects/mysql/base.py "rowcount Support"](https://github.com/sqlalchemy/sqlalchemy/blob/main/lib/sqlalchemy/dialects/mysql/base.py#L716) **(verified in source/docs)**

### 5. Capability handling

- Dialect class attributes read at statement build/execution: `insert_returning`, `update_returning`, `delete_returning`, `update_returning_multifrom`, `delete_returning_multifrom`, `use_insertmanyvalues`, `insert_executemany_returning`, `supports_sane_rowcount`, `supports_sane_multi_rowcount`, `supports_sane_rowcount_returning`. All default false/true in [engine/default.py `DefaultDialect`](https://github.com/sqlalchemy/sqlalchemy/blob/main/lib/sqlalchemy/engine/default.py). **(verified in source/docs)**
- The ORM uses them to choose a strategy before executing (RETURNING vs pre-SELECT vs Python evaluation; executemany vs one statement per row). The one place that looks like "plan then optimise" is the pre-SELECT that is built and then cancelled by an execute hook when RETURNING is available; it is a strategy choice, not a general rewrite. **(verified in source/docs)**
- A source comment in `_emit_update_statements` shows the trade-off being made per dialect: "if RETURNING is not going to be used anyway, (applies to MySQL, MariaDB which lack UPDATE RETURNING) ensure we can do an executemany UPDATE which is more efficient". **(verified in source/docs)**

### 6. MySQL error 1093

- No workaround found. Grepping the MySQL dialect and the core compiler for "1093", "target table" and derived-table wrapping in DML found nothing. The error surfaces. **(verified in source/docs** by search; absence of evidence, not a documented decision)

---

## Ecto (Elixir)

### 1. Bulk write that returns rows

- `Repo.update_all`/`Repo.delete_all` return `{count, nil | [term]}`; the list is filled when the query has a `select`. Docs: "not all databases support returning data from UPDATEs/DELETEs", example "With returning results, if supported by the database". [lib/ecto/repo.ex `update_all`, `delete_all` callbacks](https://github.com/elixir-ecto/ecto/blob/master/lib/ecto/repo.ex#L1563) **(verified in source/docs)**
- PostgreSQL adapter appends `RETURNING` built from the query's `select` ([postgres/connection.ex `update_all`, `delete_all`, `returning/2`](https://github.com/elixir-ecto/ecto_sql/blob/master/lib/ecto/adapters/postgres/connection.ex#L224)). **(verified in source/docs)**
- MySQL adapter **refuses**: `error!(nil, ":select is not supported in update_all by MySQL")` and the same for `delete_all`; `insert_all` with `returning` raises ":returning is not supported in insert/insert_all by MySQL". [myxql/connection.ex `update_all`, `delete_all`, `insert`](https://github.com/elixir-ecto/ecto_sql/blob/master/lib/ecto/adapters/myxql/connection.ex#L145) **(verified in source/docs)**

### 2. SELECT-then-write emulation

- None. It raises instead (above). **(verified in source/docs)**

### 3. Claiming one row

- `update_all`/`delete_all` reject `limit`/`order_by`: "`update_all` allows only `with_cte`, `where` and `join` expressions" ([query/planner.ex line 2853](https://github.com/elixir-ecto/ecto/blob/master/lib/ecto/query/planner.ex#L2853)). **(verified in source/docs)** So the claim is written by the user, either as `Repo.transaction` + `lock: "FOR UPDATE SKIP LOCKED"` on a `select … limit 1` and then `Repo.update`, or as `update_all` whose `where` is `id in subquery(from j in Job, … limit: 1, lock: "FOR UPDATE SKIP LOCKED")` with `select` (PostgreSQL). The lock is a raw string or fragment (`lock/2` in [myxql/connection.ex line 645](https://github.com/elixir-ecto/ecto_sql/blob/master/lib/ecto/adapters/myxql/connection.ex#L645)). **(verified in source/docs** for the lock rendering; the two idioms are **from memory, not verified** against Ecto docs**)**
- No high-level claim method (Oban, a separate library, does this). **(from memory, not verified)**

### 4. Stale writes on one record

- Every `Repo.update`/`Repo.delete` of a struct checks the affected count: `{:ok, %{num_rows: 0}}` becomes `{:error, :stale}`; more than one row raises `Ecto.MultiplePrimaryKeyError`. [ecto_sql/lib/ecto/adapters/sql.ex `struct/…`, lines 1199-1205](https://github.com/elixir-ecto/ecto_sql/blob/master/lib/ecto/adapters/sql.ex#L1199) **(verified in source/docs)**
- `{:error, :stale}` raises `Ecto.StaleEntryError` unless the caller passes `:allow_stale` or `:stale_error_field` (which turns it into a changeset error). [ecto/repo/schema.ex lines 1113-1129](https://github.com/elixir-ecto/ecto/blob/master/lib/ecto/repo/schema.ex#L1113), option docs in [repo.ex](https://github.com/elixir-ecto/ecto/blob/master/lib/ecto/repo.ex#L1909) **(verified in source/docs)** This is the clearest "compare affected rows with expected count and raise, by default, even without a version column" design among the five.
- `Ecto.Changeset.optimistic_lock/3` adds a version field to the WHERE; a mismatch then shows up as the same 0-row stale error. [ecto/changeset.ex `optimistic_lock`](https://github.com/elixir-ecto/ecto/blob/master/lib/ecto/changeset.ex) **(verified in source/docs)**
- MySQL: the MyXQL driver always sends `:client_found_rows` in its capability flags ([myxql/protocol.ex `build_capability_flags`](https://github.com/elixir-ecto/myxql/blob/master/lib/myxql/protocol.ex#L175)), so counts mean matched rows. **(verified in source/docs)**

### 5. Capability handling

- No feature-flag struct; each adapter's `Connection` module builds its own SQL and calls `error!` for anything the database cannot do (dozens of such errors in the MyXQL connection). Per-database SQL generation with refusal, no rewrite step. **(verified in source/docs)**

### 6. MySQL error 1093

- No workaround found in the MyXQL connection module (no derived-table wrapping for DML subqueries). The error surfaces. **(verified in source/docs** by search)

---

## Hibernate / JPA

### 1. Bulk write that returns rows

- HQL/JPQL `update` and `delete` run through `executeUpdate()`, which returns an int: "The integer value returned by `executeUpdate()` indicates the number of entity instances affected". The effect "is not reflected in the persistence context". [HQL guide 6.4](https://docs.hibernate.org/orm/6.4/querylanguage/html_single/Hibernate_Query_Language.html) **(verified in source/docs)**
- I found no `RETURNING` form for HQL update/delete. **(searched, not found; not a confirmed absence)**
- For a single entity, Hibernate retrieves database-generated values with RETURNING where the dialect supports it and otherwise with "an ordinary select after mutation", described as "a Hibernate fallback rather than a capability" ([Dialect.java `getGeneratedValuesSupport`, line ~2856](https://github.com/hibernate/hibernate-orm/blob/main/hibernate-core/src/main/java/org/hibernate/dialect/Dialect.java)). **(verified in source/docs)**

### 2. SELECT-then-write emulation

- Not for bulk returning (there is none). Polymorphic bulk statements over joined inheritance can expand into several SQL statements (the guide says one HQL statement may affect several tables; Hibernate uses temporary-table or CTE strategies for this). **(verified in source/docs** for "several tables"; the temp-table/CTE strategy names are **from memory, not verified)**

### 3. Claiming one row

- The user asks: `LockModeType.PESSIMISTIC_WRITE` with the skip-locked timeout hint (`-2`, `LockOptions.SKIP_LOCKED`), rendered as `FOR UPDATE SKIP LOCKED` per dialect. No high-level claim method. **(from memory, not verified)**

### 4. Stale writes on one record

- Every entity UPDATE/DELETE checks the JDBC row count against the expected count: fewer rows raises `StaleStateException("Unexpected row count (expected row count 1 but was 0)")`, more raises `TooManyRowsAffectedException`; batched statements raise the batched equivalents. [jdbc/Expectations.java `checkNonBatched`, `checkBatched`](https://github.com/hibernate/hibernate-orm/blob/main/hibernate-core/src/main/java/org/hibernate/jdbc/Expectations.java#L61) **(verified in source/docs)**
- With `@Version`, the version is in the WHERE, so a concurrent change gives 0 rows, which surfaces as `StaleObjectStateException` / JPA `OptimisticLockException`. **(from memory, not verified)**
- Bulk HQL `update` leaves `@Version` alone unless written `update versioned …`. [HQL guide 6.4](https://docs.hibernate.org/orm/6.4/querylanguage/html_single/Hibernate_Query_Language.html) **(verified in source/docs)**

### 5. Capability handling

- `Dialect` methods and capability profiles (`getLockingSupport()`, `getGeneratedValuesSupport()`, etc.) consulted when building the SQL AST, plus a per-database `SqlAstTranslator` subclass that renders it. [Dialect.java](https://github.com/hibernate/hibernate-orm/blob/main/hibernate-core/src/main/java/org/hibernate/dialect/Dialect.java) **(verified in source/docs)**
- This is the one library here that builds a database-neutral tree (SQM to SQL AST) and then lets the per-database translator rewrite parts of it while rendering (see 6). It still does not merge several statements into one. **(verified in source/docs** for the translator overrides; "does not merge" is **my reading)**

### 6. MySQL error 1093

- Worked around for every subquery inside an UPDATE or DELETE. `MySQLSqlAstTranslator.renderSelectStatement` checks `needsDmlSubqueryWrapper()` (true when the statement is a `DeleteStatement` or `UpdateStatement`) and renders any non-root subquery as `(select * from (<subquery>) _sub_)`; the relational and quantified subquery emulations do the same. [MySQLSqlAstTranslator.java lines 347-400](https://github.com/hibernate/hibernate-orm/blob/main/hibernate-core/src/main/java/org/hibernate/dialect/sql/ast/internal/MySQLSqlAstTranslator.java#L347) **(verified in source/docs)**

---

## Summary table

| Question | Active Record | Django | SQLAlchemy | Ecto | Hibernate/JPA |
| --- | --- | --- | --- | --- | --- |
| 1. Bulk write returning rows | No for update/delete (counts only); `insert_all returning:` on PG/SQLite/MariaDB, raises if asked on MySQL; open PR adds `update_all_returning` that raises on MySQL | No public API (ticket open); internal `UPDATE … RETURNING` for `save()` since 6.0; MySQL marks fields deferred instead | Yes in Core and ORM via `.returning()`; on MySQL an error "upon compilation and/or execution"; MariaDB has DELETE/INSERT RETURNING | Yes via `select` in `update_all`/`delete_all` on PG; MySQL adapter raises | No for HQL bulk (int count); single-entity generated values use RETURNING or a follow-up SELECT |
| 2. SELECT-then-write emulation | None for bulk; `destroy_all` loads then destroys each, no lock | Yes: MySQL `update()` pre-selects pks, no lock, no transaction in autocommit, no count check; race documented in the docs | `synchronize_session='fetch'` pre-selects pks on MySQL for session sync only; no lock; write keeps its own WHERE; race not documented | None (refuses) | None for bulk |
| 3. Claim one row | User writes `lock("FOR UPDATE SKIP LOCKED")` in a transaction; no helper | User writes `select_for_update(skip_locked=True)` in `atomic()`; no helper; no sliced update | User writes `with_for_update(skip_locked=True)`; can compose `UPDATE … WHERE id = (subquery FOR UPDATE SKIP LOCKED) RETURNING` by hand | User writes `lock:` string; `update_all` forbids limit/order; no helper | User sets PESSIMISTIC_WRITE + skip-locked hint; no helper |
| 4. Stale single-record write | Only with `lock_version`: `affected_rows != 1` raises `StaleObjectError`; otherwise 0 rows ignored | `save()` falls back to INSERT; raises `NotUpdated` with `force_update`/`update_fields`; no built-in versioning | Always compares matched rows with expected for UPDATE, raises `StaleDataError`; DELETE warns (raises with version column) | Always: 0 rows is `:stale`, raises `StaleEntryError` by default | Always: row count mismatch raises `StaleStateException`; `@Version` adds the version check |
| 5. Capability handling | Adapter `supports_*?` predicates + per-database Arel visitor | `connection.features` flags + per-backend compiler classes | Dialect class flags + per-dialect compiler; strategy chosen before execution | Per-adapter SQL builder that raises on unsupported features | Dialect capability profiles + per-database SQL AST translator that rewrites while rendering |
| 6. MySQL error 1093 | Wraps the subqueries Rails itself generates in a derived table (`__active_record_temp`); user subqueries surface the error | DELETE: wraps in `SELECT * FROM (…) subquery`; UPDATE: pre-selects pks (racy) | No workaround found; error surfaces | No workaround found; error surfaces | Wraps every subquery inside UPDATE/DELETE as `(select * from (…) _sub_)` |

Rails (both MySQL adapters), Django, SQLAlchemy and Ecto's MyXQL driver all set `CLIENT_FOUND_ROWS`, so MySQL reports matched rows rather than changed rows (verified). I did not check Hibernate's MySQL driver setup.
