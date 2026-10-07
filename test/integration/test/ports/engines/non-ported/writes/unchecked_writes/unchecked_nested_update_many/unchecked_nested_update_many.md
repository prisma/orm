# Non-ported — writes/unchecked_writes/unchecked_nested_update_many.rs

- `query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/unchecked_writes/unchecked_nested_update_many.rs` › `writes::unchecked_nested_um::allow_write_autoinc_id_cockroachdb` — nested updateMany writes a BigInt autoincrement id on CockroachDB — the test runs only on CockroachDB (`only(CockroachDb)`), which Prisma 8 has no target for; its Postgres counterpart `allow_write_autoinc_id` is ported
