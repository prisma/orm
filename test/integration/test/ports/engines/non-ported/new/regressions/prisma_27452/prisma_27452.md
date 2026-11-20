# Non-ported — new/regressions/prisma_27452.rs

- `query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_27452.rs` › `comment_like_upsert_with_nested_comments` — an upsert of a comment like whose create branch connects a comment and whose update branch sets the comments, on a model with a compound unique (issue 27452) — Prisma 8's top-level `upsert` takes scalar `create` and `update` data only, so its create branch cannot hold the nested `connect`, and Prisma 8 has no nested `set` for the update branch
