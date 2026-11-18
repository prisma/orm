# Non-ported — queries/chunking_qc.rs

- `query-engine/connector-test-kit-rs/query-engine-tests/tests/queries/chunking_qc.rs` › `queries::chunking_qc::create_lots_of_m2m_relations` — query-compiler nested M:N creation exceeds the connector bind limit and chunks generated junction rows — Prisma 8 has no public query-compiler bind-limit chunking mechanism, and splitting the relation write manually would substitute the subject
