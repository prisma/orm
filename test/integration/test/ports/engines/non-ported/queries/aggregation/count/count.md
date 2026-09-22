# Non-ported — queries/aggregation/count.rs

- `query-engine/connector-test-kit-rs/query-engine-tests/tests/queries/aggregation/count.rs` › `queries::aggregation::count::count_with_all_sorts_of_query_args` — applies take, negative take, where, orderBy, skip, and cursor before count-all — Prisma 8's aggregate terminal compiles filters but not order/take/skip/cursor state, and its cursor requires an explicit order axis, so the complete argument matrix cannot be expressed faithfully
