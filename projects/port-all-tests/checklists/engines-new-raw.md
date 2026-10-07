# Checklist — prisma-engines query-engine tests (new/ + raw/)

Source: prisma/prisma-engines@e922089b7d7502aff4249d5da3420f6fa55fc6ad — query-engine/connector-test-kit-rs/query-engine-tests/tests/{new,raw}/

Protocol: each line is one source test. `[ ]` = not yet dispositioned. The Opus reviewer sub-agent checks `[x]` ONLY when satisfied that the test is (a) faithfully ported and passing, (b) faithfully ported as `test.fails` with a `failing.md` entry, or (c) covered by a justified individual `non-ported.md` entry. Implementer sub-agents never check boxes.

## tests/new

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/assertion_violation_error.rs

- [ ] `new::assertion_violation_error::value_too_many_bind_variables` — passing 65536+ params in an `in` filter raises the "too many bind variables" driver error (P2010) [connectors: only(Postgres); exclude(Postgres("neon.js.wasm"),Postgres("pg.js.wasm"))]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/create_many.rs

- [ ] `new::create_many::autoinc_id::disallow_sql_server` — SQL Server rejects writing explicit autoincrement IDs via createMany [connectors: only(SqlServer)]
- [ ] `new::create_many::autoinc_id_cockroachdb::foo` — createMany with autoincrement id works on CockroachDB [connectors: only(CockroachDb)]
- [ ] `new::create_many::autoinc_id_cockroachdb::foo_sequence` — createMany with sequence-backed id works on CockroachDB [connectors: only(CockroachDb)]
- [ ] `new::create_many::autoinc_id::foo` — createMany with autoincrement id (non-cockroach) [connectors: capabilities(CreateMany,AutoIncrement); exclude(CockroachDb)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/cursor.rs

- [ ] `new::cursor::bigint_id_must_work` — regression prisma/prisma#6337: cursor pagination works with a BigInt id [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/disconnect.rs

- [ ] `new::disconnect::must_honor_connect_scope_one2m` — to-many disconnect with a selector list only disconnects records previously connected to the parent (1:m) [connectors: all]
- [ ] `new::disconnect::must_honor_connect_scope_m2m` — same scoped-disconnect guarantee for m2m relations [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/interactive_tx.rs

- [ ] `new::interactive_tx::basic_commit_workflow` — start tx, write, commit; changes are visible [connectors: exclude(Sqlite("cfd1"))]
- [ ] `new::interactive_tx::basic_rollback_workflow` — start tx, write, rollback; changes are discarded [connectors: exclude(Sqlite("cfd1"))]
- [ ] `new::interactive_tx::tx_expiration_cycle` — interactive tx times out and is invalidated after expiration [connectors: exclude(Sqlite("cfd1"))]
- [ ] `new::interactive_tx::no_auto_rollback` — a failed query inside a tx does not auto-rollback the whole tx [connectors: exclude(Sqlite("cfd1"))]
- [ ] `new::interactive_tx::raw_queries` — raw queries participate in the interactive tx [connectors: only(Postgres)]
- [ ] `new::interactive_tx::batch_queries_success` — batched queries succeed within a tx [connectors: exclude(Sqlite("cfd1"))]
- [ ] `new::interactive_tx::batch_queries_rollback` — batched queries roll back with the tx [connectors: exclude(Sqlite("cfd1"))]
- [ ] `new::interactive_tx::batch_queries_failure` — a failing batch inside a tx surfaces the error [connectors: exclude(Sqlite("cfd1"))]
- [ ] `new::interactive_tx::tx_expiration_failure_cycle` — operations on an expired tx fail as expected [connectors: exclude(Sqlite("cfd1"))]
- [ ] `new::interactive_tx::multiple_tx` — multiple concurrent interactive txs are isolated [connectors: exclude(Sqlite)]
- [ ] `new::interactive_tx::write_conflict` — concurrent writes across txs produce a write conflict [connectors: only(Postgres)]
- [ ] `new::interactive_tx::double_commit` — committing an already-committed tx errors [connectors: exclude(Sqlite("cfd1"))]
- [ ] `new::interactive_tx::double_rollback` — rolling back an already-rolled-back tx errors [connectors: exclude(Sqlite("cfd1"))]
- [ ] `new::interactive_tx::commit_after_rollback` — committing after rollback errors [connectors: exclude(Sqlite("cfd1"))]
- [ ] `new::interactive_tx::rollback_after_commit` — rolling back after commit errors [connectors: exclude(Sqlite("cfd1"))]
- [ ] `new::interactive_tx::basic_serializable` — Serializable isolation level is honored [connectors: exclude(MongoDb,Sqlite("cfd1"))]
- [ ] `new::interactive_tx::casing_doesnt_matter` — isolation-level string is case-insensitive [connectors: exclude(MongoDb,Sqlite("cfd1"))]
- [ ] `new::interactive_tx::spacing_doesnt_matter` — isolation-level string tolerates spacing variants [connectors: only(Postgres)]
- [ ] `new::interactive_tx::invalid_isolation` — invalid isolation level raises an error [connectors: exclude(MongoDb)]
- [ ] `new::interactive_tx::mongo_failure` — isolation level is rejected on MongoDB [connectors: only(MongoDb)]
- [ ] `new::interactive_tx::high_concurrency` — many concurrent non-conflicting txs succeed without deadlock [connectors: exclude(Sqlite)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/multi_schema.rs

- [ ] `new::multi_schema::crud_simple` — basic CRUD across two DB schemas [connectors: capabilities(MultiSchema); db_schemas("schema1","schema2")]
- [ ] `new::multi_schema::crud_many_simple` — createMany/updateMany/deleteMany across two DB schemas [connectors: capabilities(MultiSchema); db_schemas("schema1","schema2")]
- [ ] `new::multi_schema::crud_relations` — CRUD over relations spanning two DB schemas [connectors: capabilities(MultiSchema); db_schemas("schema1","schema2")]
- [ ] `new::multi_schema::create_and_get_many_relations` — create + read many related records across schemas [connectors: capabilities(MultiSchema); db_schemas("schema1","schema2")]
- [ ] `new::multi_schema::create_and_get_many_to_many_relations` — create + read m2m records across three schemas [connectors: capabilities(MultiSchema); db_schemas("schema1","schema2","schema3")]
- [ ] `new::multi_schema::test_filter_in` — `in` filter over records across two schemas [connectors: capabilities(MultiSchema); db_schemas("schema1","schema2")]
- [ ] `new::multi_schema::implicit_m2m_simple` — implicit m2m join table spanning two schemas [connectors: capabilities(MultiSchema); db_schemas("shapes","objects")]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/native_types/mongodb.rs

- [ ] `new::native_types::mongodb::native_type_list_coercion` — regression: native-type coercions apply correctly to list fields on MongoDB [connectors: only(MongoDb)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/native_upsert.rs

- [ ] `new::native_upsert::should_upsert_on_single_unique` — native DB upsert used when where targets a single unique [connectors: capabilities(NativeUpsert)]
- [ ] `new::native_upsert::should_upsert_on_id` — native upsert used when where targets the id [connectors: capabilities(NativeUpsert)]
- [ ] `new::native_upsert::should_upsert_on_unique_list` — native upsert used with a compound unique list [connectors: capabilities(NativeUpsert)]
- [ ] `new::native_upsert::should_not_use_native_upsert_on_two_uniques` — falls back to non-native when where mixes two uniques [connectors: capabilities(NativeUpsert)]
- [ ] `new::native_upsert::should_not_use_if_where_and_create_different` — no native upsert when where and create diverge [connectors: capabilities(NativeUpsert)]
- [ ] `new::native_upsert::should_not_if_missing_update` — no native upsert when update data is missing [connectors: capabilities(NativeUpsert)]
- [ ] `new::native_upsert::should_not_if_has_nested_select` — no native upsert when a nested select is requested [connectors: capabilities(NativeUpsert)]
- [ ] `new::native_upsert::should_upsert_on_compound_id` — native upsert used on a compound id [connectors: capabilities(NativeUpsert)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/occ.rs

- [ ] `new::occ::occ_update_many_test` — optimistic concurrency: concurrent updateMany does not double-book a seat [connectors: exclude(MongoDb,CockroachDb,Vitess("planetscale.js.wasm"),Sqlite("cfd1"))]
- [ ] `new::occ::occ_update_test` — optimistic concurrency via update guard [connectors: exclude(CockroachDb,Vitess("planetscale.js.wasm"))]
- [ ] `new::occ::occ_delete_test` — optimistic concurrency via delete guard [connectors: exclude(Vitess("planetscale.js.wasm"))]
- [ ] `new::occ::occ_delete_many_test` — optimistic concurrency via deleteMany guard [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/ref_actions/on_delete/cascade.rs

- [ ] `new::ref_actions::on_delete::cascade::cascade_onD_1to1_req::delete_parent` — onDelete Cascade: deleting parent deletes required 1:1 child (relationMode=prisma) [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::cascade::cascade_onD_1to1_opt::delete_parent` — onDelete Cascade on optional 1:1 [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::cascade::cascade_onD_1to1_opt::delete_parent_diff_id_name` — onDelete Cascade 1:1 with differently-named id/fk [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::cascade::cascade_onD_1toM_req::delete_parent` — onDelete Cascade on required 1:m [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::cascade::cascade_onD_1toM_opt::delete_parent` — onDelete Cascade on optional 1:m [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::cascade::should_work` — onDelete Cascade end-to-end on a self/complex relation graph [connectors: exclude(SqlServer); relation_mode="prisma"]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/ref_actions/on_delete/no_action.rs

- [ ] `new::ref_actions::on_delete::no_action::noaction_onD_1to1_req::delete_parent_failure` — onDelete NoAction: deleting parent with a required 1:1 child fails [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::no_action::noaction_onD_1to1_opt::delete_parent_failure` — onDelete NoAction: deleting parent while optional 1:1 child connected fails [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::no_action::noaction_onD_1to1_opt::delete_parent` — deleting parent succeeds when 1:1 child disconnected [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::no_action::noaction_onD_1to1_opt::delete_parent_violation` — NoAction violation surfaces on MongoDB (1:1) [connectors: only(MongoDb)]
- [ ] `new::ref_actions::on_delete::no_action::noaction_onD_1toM_req::delete_parent_failure` — onDelete NoAction: deleting parent with required 1:m children fails [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::no_action::noaction_onD_1toM_req::delete_parent` — deleting parent succeeds when children disconnected (1:m) [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::no_action::noaction_onD_1toM_req::delete_parent_violation` — NoAction violation on connected 1:m children [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::no_action::noaction_onD_1toM_opt::delete_parent_failure` — deleting parent with optional connected 1:m children fails [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::no_action::noaction_onD_1toM_opt::delete_parent` — deleting parent succeeds when optional children disconnected [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::no_action::noaction_onD_1toM_opt::delete_parent_violation` — NoAction violation surfaces on MongoDB (1:m) [connectors: only(MongoDb)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/ref_actions/on_delete/restrict.rs

- [ ] `new::ref_actions::on_delete::restrict::restrict_onD_1to1_req::delete_parent_failure` — onDelete Restrict: deleting parent with required 1:1 child fails [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::restrict::restrict_onD_1to1_opt::delete_parent_failure` — onDelete Restrict: deleting parent with connected optional 1:1 child fails [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::restrict::restrict_onD_1to1_opt::delete_parent` — deleting parent succeeds when child disconnected [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::restrict::restrict_onD_1to1_opt::delete_parent_diff_id_name` — Restrict 1:1 with differently-named id/fk [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::restrict::restrict_onD_1toM_req::delete_parent_failure` — Restrict blocks deleting parent with required 1:m children [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::restrict::restrict_onD_1toM_req::delete_parent` — deleting parent succeeds when children disconnected [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::restrict::restrict_onD_1toM_opt::delete_parent_failure` — Restrict blocks deleting parent with connected optional 1:m children [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::restrict::restrict_onD_1toM_opt::delete_parent` — deleting parent succeeds when optional children disconnected [connectors: exclude(SqlServer); relation_mode="prisma"]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/ref_actions/on_delete/set_default.rs

- [ ] `new::ref_actions::on_delete::set_default::setdefault_onD_1to1_req::delete_parent` — onDelete SetDefault sets required 1:1 fk to its default on parent delete [connectors: exclude(MongoDb,MySQL,Vitess("planetscale.js.wasm"))]
- [ ] `new::ref_actions::on_delete::set_default::setdefault_onD_1to1_req::delete_parent_no_exist_fail` — SetDefault fails when default target row does not exist [connectors: exclude(MongoDb,MySQL,Vitess("planetscale.js.wasm"))]
- [ ] `new::ref_actions::on_delete::set_default::setdefault_onD_1to1_req::delete_parent_fail` — SetDefault on required-without-default fk fails [connectors: only(Postgres); exclude(CockroachDb)]
- [ ] `new::ref_actions::on_delete::set_default::setdefault_onD_1to1_opt::delete_parent` — SetDefault on optional 1:1 [connectors: exclude(MongoDb,MySQL,Vitess("planetscale.js.wasm"))]
- [ ] `new::ref_actions::on_delete::set_default::setdefault_onD_1to1_opt::delete_parent_no_exist_fail` — SetDefault opt 1:1 fails when default target missing [connectors: exclude(MongoDb,MySQL,Vitess("planetscale.js.wasm"))]
- [ ] `new::ref_actions::on_delete::set_default::setdefault_onD_1to1_opt::delete_parent_fail` — SetDefault opt-without-default fails [connectors: only(Postgres)]
- [ ] `new::ref_actions::on_delete::set_default::setdefault_onD_1toM_req::delete_parent` — SetDefault on required 1:m [connectors: exclude(MongoDb,MySQL,Vitess("planetscale.js.wasm"))]
- [ ] `new::ref_actions::on_delete::set_default::setdefault_onD_1toM_req::delete_parent_no_exist_fail` — SetDefault req 1:m fails when default target missing [connectors: exclude(MongoDb,MySQL,Vitess("planetscale.js.wasm"))]
- [ ] `new::ref_actions::on_delete::set_default::setdefault_onD_1toM_req::delete_parent_fail` — SetDefault req-without-default 1:m fails [connectors: only(Postgres); exclude(CockroachDb)]
- [ ] `new::ref_actions::on_delete::set_default::setdefault_onD_1toM_opt::delete_parent` — SetDefault on optional 1:m [connectors: exclude(MongoDb,MySQL,Vitess("planetscale.js.wasm"))]
- [ ] `new::ref_actions::on_delete::set_default::setdefault_onD_1toM_opt::delete_parent_no_exist_fail` — SetDefault opt 1:m fails when default target missing [connectors: exclude(MongoDb,MySQL,Vitess("planetscale.js.wasm"))]
- [ ] `new::ref_actions::on_delete::set_default::setdefault_onD_1toM_opt::delete_parent_fail` — SetDefault opt-without-default 1:m fails [connectors: only(Postgres)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/ref_actions/on_delete/set_null.rs

- [ ] `new::ref_actions::on_delete::set_null::setnull_onD_1to1_opt::delete_parent` — onDelete SetNull nulls optional 1:1 fk on parent delete [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::set_null::setnull_onD_1to1_opt::delete_parent_diff_id_name` — SetNull 1:1 with differently-named id/fk [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::set_null::setnull_onD_1to1_opt::delete_parent_recurse_set_null` — SetNull recurses through a chained 1:1:1 SetNull relation [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::set_null::setnull_onD_1to1_opt::delete_parent_set_null_restrict` — SetNull chained into a Restrict relation is blocked [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::set_null::setnull_onD_1to1_opt::delete_parent_set_null_cascade` — SetNull chained into a Cascade relation [connectors: exclude_features("relationJoins"); relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::set_null::setnull_onD_1toM_opt::delete_parent` — SetNull nulls optional 1:m fks on parent delete [connectors: exclude(MongoDb); relation_mode="prisma"]
- [ ] `new::ref_actions::on_delete::set_null::setnull_onD_1toM_opt::prisma_17255` — regression prisma/prisma#17255 for SetNull on delete [connectors: exclude(MongoDb); relation_mode="prisma"]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/ref_actions/on_update/cascade.rs

- [ ] `new::ref_actions::on_update::cascade::cascade_onU_1to1_req::update_parent_cascade` — onUpdate Cascade propagates parent id change to required 1:1 child [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::cascade::cascade_onU_1to1_req::update_parent_compound_cascade` — onUpdate Cascade on a compound-key 1:1 [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::cascade::cascade_onU_1to1_opt::update_parent_cascade` — onUpdate Cascade on optional 1:1 [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::cascade::cascade_onU_1to1_opt::update_parent_compound_cascade` — onUpdate Cascade on compound optional 1:1 [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::cascade::cascade_onU_1to1_opt::update_parent_diff_id_name` — onUpdate Cascade 1:1 with differently-named id/fk [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::cascade::cascade_onU_1toM_req::update_parent` — onUpdate Cascade on required 1:m [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::cascade::cascade_onU_1toM_opt::update_parent` — onUpdate Cascade on optional 1:m [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::cascade::cascade_onU_1toM_opt::update_compound_parent` — onUpdate Cascade on compound-unique 1:m [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::cascade::it_should_work` — onUpdate Cascade end-to-end on a complex relation graph [connectors: exclude(SqlServer); relation_mode="prisma"]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/ref_actions/on_update/no_action.rs

- [ ] `new::ref_actions::on_update::no_action::noaction_onU_1to1_req::update_parent_violation` — onUpdate NoAction: changing parent id with connected required 1:1 child violates [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::no_action::noaction_onU_1to1_req::update_many_parent_violation` — updateMany parent id violation (req 1:1) [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::no_action::noaction_onU_1to1_req::upsert_parent_violation` — upsert parent id violation (req 1:1) [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::no_action::noaction_onU_1to1_opt::update_parent_failure` — NoAction opt 1:1 update failure path [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::no_action::noaction_onU_1to1_opt::update_parent` — updating parent succeeds when child disconnected (opt 1:1) [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::no_action::noaction_onU_1to1_opt::update_parent_with_many` — updating parent with a nested many op (opt 1:1) [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::no_action::noaction_onU_1to1_opt::update_parent_violation` — NoAction violation on connected opt 1:1 [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::no_action::noaction_onU_1to1_opt::update_many_parent_violation` — updateMany violation (opt 1:1) [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::no_action::noaction_onU_1to1_opt::upsert_parent_violation` — upsert violation (opt 1:1) [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::no_action::noaction_onU_1toM_req::update_parent` — updating parent succeeds when children disconnected (req 1:m) [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::no_action::noaction_onU_1toM_req::update_parent_violation` — NoAction violation with connected req 1:m children [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::no_action::noaction_onU_1toM_req::update_many_parent_violation` — updateMany violation (req 1:m) [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::no_action::noaction_onU_1toM_req::upsert_parent_violation` — upsert violation (req 1:m) [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::no_action::noaction_onU_1toM_opt::update_parent_failure` — NoAction opt 1:m update failure path [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::no_action::noaction_onU_1toM_opt::update_parent` — updating parent succeeds when opt 1:m children disconnected [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::no_action::noaction_onU_1toM_opt::update_parent_violation` — NoAction violation with connected opt 1:m children [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::no_action::noaction_onU_1toM_opt::update_many_parent_violation` — updateMany violation (opt 1:m) [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::no_action::noaction_onU_1toM_opt::upsert_parent_violation` — upsert violation (opt 1:m) [connectors: exclude(Postgres,Sqlite); relation_mode="prisma"]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/ref_actions/on_update/restrict.rs

- [ ] `new::ref_actions::on_update::restrict::restrict_onU_1to1_req::update_parent_failure` — onUpdate Restrict blocks parent id change with connected req 1:1 child [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::restrict::restrict_onU_1to1_req::update_many_parent_failure` — updateMany blocked by Restrict (req 1:1) [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::restrict::restrict_onU_1to1_req::upsert_parent_failure` — upsert blocked by Restrict (req 1:1) [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::restrict::restrict_onU_1to1_opt::update_parent_failure` — Restrict blocks update on connected opt 1:1 [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::restrict::restrict_onU_1to1_opt::update_many_parent_failure` — updateMany blocked by Restrict (opt 1:1) [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::restrict::restrict_onU_1to1_opt::upsert_parent_failure` — upsert blocked by Restrict (opt 1:1) [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::restrict::restrict_onU_1toM_req::update_parent_failure` — Restrict blocks update with connected req 1:m children [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::restrict::restrict_onU_1toM_req::update_many_parent_failure` — updateMany blocked by Restrict (req 1:m) [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::restrict::restrict_onU_1toM_req::upsert_parent_failure` — upsert blocked by Restrict (req 1:m) [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::restrict::restrict_onU_1toM_req::update_parent` — update succeeds when children disconnected (req 1:m) [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::restrict::restrict_onU_1toM_opt::update_parent_failure` — Restrict blocks update with connected opt 1:m children [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::restrict::restrict_onU_1toM_opt::update_many_parent_failure` — updateMany blocked by Restrict (opt 1:m) [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::restrict::restrict_onU_1toM_opt::upsert_parent_failure` — upsert blocked by Restrict (opt 1:m) [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::restrict::restrict_onU_1toM_opt::update_parent` — update succeeds when opt 1:m children disconnected [connectors: exclude(SqlServer); relation_mode="prisma"]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/ref_actions/on_update/set_default.rs

- [ ] `new::ref_actions::on_update::set_default::setdefault_onU_1to1_req::update_parent` — onUpdate SetDefault sets required 1:1 fk to default on parent id change [connectors: exclude(MongoDb,MySQL,Vitess)]
- [ ] `new::ref_actions::on_update::set_default::setdefault_onU_1to1_req::update_parent_no_exist_fail` — SetDefault fails when default target row missing (req 1:1) [connectors: exclude(MongoDb,MySQL,Vitess)]
- [ ] `new::ref_actions::on_update::set_default::setdefault_onU_1to1_req::update_parent_fail` — SetDefault on required-without-default fk fails [connectors: only(Postgres); exclude(CockroachDb)]
- [ ] `new::ref_actions::on_update::set_default::setdefault_onU_1to1_opt::update_parent` — SetDefault on optional 1:1 [connectors: exclude(MongoDb,MySQL,Vitess)]
- [ ] `new::ref_actions::on_update::set_default::setdefault_onU_1to1_opt::update_parent_no_exist_fail` — SetDefault opt 1:1 fails when default target missing [connectors: exclude(MongoDb,MySQL,Vitess)]
- [ ] `new::ref_actions::on_update::set_default::setdefault_onU_1to1_opt::update_parent_fail` — SetDefault opt-without-default fails [connectors: only(Postgres)]
- [ ] `new::ref_actions::on_update::set_default::setdefault_onU_1toM_req::update_parent` — SetDefault on required 1:m [connectors: exclude(MongoDb,MySQL,Vitess)]
- [ ] `new::ref_actions::on_update::set_default::setdefault_onU_1toM_req::update_parent_no_exist_fail` — SetDefault req 1:m fails when default target missing [connectors: exclude(MongoDb,MySQL,Vitess)]
- [ ] `new::ref_actions::on_update::set_default::setdefault_onU_1toM_req::update_parent_fail` — SetDefault req-without-default 1:m fails [connectors: only(Postgres); exclude(CockroachDb)]
- [ ] `new::ref_actions::on_update::set_default::setdefault_onU_1toM_opt::update_parent` — SetDefault on optional 1:m [connectors: exclude(MongoDb,MySQL,Vitess)]
- [ ] `new::ref_actions::on_update::set_default::setdefault_onU_1toM_opt::update_parent_no_exist_fail` — SetDefault opt 1:m fails when default target missing [connectors: exclude(MongoDb,MySQL,Vitess)]
- [ ] `new::ref_actions::on_update::set_default::setdefault_onU_1toM_opt::update_parent_fail` — SetDefault opt-without-default 1:m fails [connectors: only(Postgres)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/ref_actions/on_update/set_null.rs

- [ ] `new::ref_actions::on_update::set_null::setnull_onU_1to1_opt::update_parent` — onUpdate SetNull nulls optional 1:1 fk on parent id change [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::set_null::setnull_onU_1to1_opt::upsert_parent` — SetNull via upsert (opt 1:1) [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::set_null::setnull_onU_1to1_opt::update_many_parent` — SetNull via updateMany (opt 1:1) [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::set_null::setnull_onU_1to1_opt::update_parent_recurse_set_null` — SetNull recurses through chained 1:1:1 SetNull [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::set_null::setnull_onU_1to1_opt::update_parent_recurse_restrict_failure` — SetNull chained into Restrict is blocked (1:1) [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::set_null::setnull_onU_1to1_opt::update_parent_no_recursion` — SetNull without shared fk does not recurse (1:1) [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::set_null::setnull_onU_1to1_opt::update_parent_diff_id_name` — SetNull 1:1 with differently-named id/fk [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::set_null::setnull_onU_1toM_opt::update_parent` — SetNull nulls optional 1:m fks on parent id change [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::set_null::setnull_onU_1toM_opt::update_parent_nested` — SetNull via nested parent update (1:m) [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::set_null::setnull_onU_1toM_opt::upsert_parent` — SetNull via upsert (1:m) [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::set_null::setnull_onU_1toM_opt::upsert_parent_nested` — SetNull via nested upsert (1:m) [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::set_null::setnull_onU_1toM_opt::update_many_parent` — SetNull via updateMany (1:m) [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::set_null::setnull_onU_1toM_opt::update_compound_parent` — SetNull on compound-unique 1:m [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::set_null::setnull_onU_1toM_opt::update_parent_recurse_set_null` — SetNull recurses through chained 1:m:m SetNull [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::set_null::setnull_onU_1toM_opt::update_parent_recurse_restrict_failure` — SetNull chained into Restrict is blocked (1:m:m) [connectors: exclude(SqlServer); relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::set_null::setnull_onU_1toM_opt::update_parent_no_recursion` — SetNull without shared fk does not recurse (1:m:m) [connectors: relation_mode="prisma"]
- [ ] `new::ref_actions::on_update::set_null::setnull_onU_1toM_opt::update_parent_compound_recurse` — SetNull recurses on compound-key 1:m:m [connectors: relation_mode="prisma"]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/max_integer.rs

- [ ] `new::regressions::max_integer::transform_gql_parser_too_large` — GraphQL parser rejects an int literal above i64 range [connectors: all]
- [ ] `new::regressions::max_integer::transform_gql_parser_too_small` — GraphQL parser rejects an int literal below i64 range [connectors: all]
- [ ] `new::regressions::max_integer::document_parser_no_crash_too_large` — document parser does not crash on too-large int [connectors: all]
- [ ] `new::regressions::max_integer::document_parser_no_crash_too_small` — document parser does not crash on too-small int [connectors: all]
- [ ] `new::regressions::max_integer::document_parser_no_crash_ridiculously_big` — document parser does not crash on a huge int literal [connectors: all]
- [ ] `new::regressions::max_integer::unfitted_int_should_fail` — int exceeding column range fails cleanly [connectors: exclude(MongoDb,MySql(5.6),Sqlite("cfd1","better-sqlite3.js.wasm","libsql.js.wasm"),CockroachDb("pg.js.wasm"))]
- [ ] `new::regressions::max_integer::unfitted_int_should_fail_pg_quaint` — Postgres (quaint) int overflow fails [connectors: only(Postgres); exclude(Postgres("neon.js.wasm"),Postgres("pg.js.wasm"))]
- [ ] `new::regressions::max_integer::unfitted_int_should_fail_pg_js` — Postgres (js driver) int overflow fails [connectors: only(Postgres("neon.js.wasm"),Postgres("pg.js.wasm"))]
- [ ] `new::regressions::max_integer::fitted_int_should_work_pg` — Postgres accepts an int within column range [connectors: only(Postgres)]
- [ ] `new::regressions::max_integer::unfitted_int_should_fail_mysql` — MySQL int overflow fails [connectors: only(MySql); exclude(MySql(5.6))]
- [ ] `new::regressions::max_integer::fitted_int_should_work_mysql` — MySQL accepts an in-range int [connectors: only(MySql)]
- [ ] `new::regressions::max_integer::unfitted_int_should_fail_mssql` — SQL Server int overflow fails [connectors: only(SqlServer)]
- [ ] `new::regressions::max_integer::fitted_int_should_work_mssql` — SQL Server accepts an in-range int [connectors: only(SqlServer)]
- [ ] `new::regressions::max_integer::unfitted_int_should_fail_cockroach` — CockroachDB int overflow fails [connectors: only(CockroachDb("23.1","22.2","22.1"))]
- [ ] `new::regressions::max_integer::fitted_int_should_work_cockroach` — CockroachDB accepts an in-range int [connectors: only(CockroachDb)]
- [ ] `new::regressions::max_integer::int_range_overlap_works` — int filters at the range boundary behave [connectors: exclude(SqlServer)]
- [ ] `new::regressions::max_integer::int_range_overlap_fails` — out-of-range int in a filter fails [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_10098.rs

- [ ] `new::regressions::prisma_10098::gte_works_with_floating_numbers` — issue #10098: gte filter works with floating-point numbers on MongoDB [connectors: only(MongoDb)]
- [ ] `new::regressions::prisma_10098::lte_works_with_floating_numbers` — issue #10098: lte filter works with floating-point numbers on MongoDB [connectors: only(MongoDb)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_10935.rs

- [ ] `new::regressions::prisma_10935::upserts_must_not_return_count` — issue #10935: upsert must not return an affected-rows count on MySQL [connectors: only(MySql); referential_integrity="prisma"]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_11750.rs

- [ ] `new::regressions::prisma_11750::test_itx_concurrent_updates_single_thread` — issue #11750: concurrent interactive-tx updates (single-thread) must not deadlock [connectors: exclude(Sqlite,MySql(8),SqlServer)]
- [ ] `new::regressions::prisma_11750::test_itx_concurrent_updates_multi_thread` — issue #11750: concurrent interactive-tx updates (multi-thread) must not deadlock [connectors: exclude(Sqlite,MySql(8),SqlServer)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_11789.rs

- [ ] `new::regressions::prisma_11789::concurrent_creates_should_succeed` — issue #11789: concurrent creates succeed on SQLite [connectors: only(Sqlite)]
- [ ] `new::regressions::prisma_11789::concurrent_upserts_should_succeed` — issue #11789: concurrent upserts succeed on SQLite [connectors: only(Sqlite)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_12572.rs

- [ ] `new::regressions::prisma_12572::all_generated_timestamps_are_the_same` — issue #12572: now() default resolves to the same timestamp within one request [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_12929.rs

- [ ] `new::regressions::prisma_12929::no_field_confusion` — issue #12929: no field confusion in MongoDB queries [connectors: only(MongoDb)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_13089.rs

- [ ] `new::regressions::prisma_13089::filtering_with_dollar_values` — issue #13089: filtering by values containing `$` works [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_13097.rs

- [ ] `new::regressions::prisma_13097::group_by_enum_array` — issue #13097: groupBy over an enum-array column [connectors: only(Postgres)]
- [ ] `new::regressions::prisma_13097::group_by_boolean_array` — issue #13097: groupBy over a boolean-array column [connectors: only(Postgres)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_13158.rs

- [ ] `new::regressions::prisma_13158::insert_mixed_int_float_array_in_execute_raw` — issue #13158: executeRaw with a mixed int/float array parameter (Postgres arrays) [connectors: only(Postgres)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_13405.rs

- [ ] `new::regressions::prisma_13405::find_raw_works_with_itx` — issue #13405: findRaw works inside an interactive tx (Mongo) [connectors: only(MongoDb)]
- [ ] `new::regressions::prisma_13405::run_command_raw_works_with_itx` — issue #13405: runCommandRaw works inside an interactive tx (Mongo) [connectors: only(MongoDb)]
- [ ] `new::regressions::prisma_13405::aggregate_raw_works_with_itx` — issue #13405: aggregateRaw works inside an interactive tx (Mongo) [connectors: only(MongoDb)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_14001.rs

- [ ] `new::regressions::prisma_14001::pascal_cased_field_names_work_in_aggregations` — issue #14001: PascalCase field names work in aggregations [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_14696.rs

- [ ] `new::regressions::prisma_14696::create_does_not_panic` — issue #14696: create does not panic on the repro schema [connectors: exclude(MongoDB,SqlServer)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_14703.rs

- [ ] `new::regressions::prisma_14703::upsert_does_not_panic_if_underflowing_the_scale` — issue #14703: upsert does not panic when a decimal underflows the scale [connectors: exclude(MongoDB,Sqlite)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_15177.rs

- [ ] `new::regressions::prisma_15177::repro` — issue #15177: CRUD works on a column whose name contains a space [connectors: exclude(MongoDb)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_15204.rs

- [ ] `new::regressions::prisma_15204::convert_to_int_sqlite_quaint` — issue #15204: numeric-to-int conversion on SQLite (quaint) [connectors: only(Sqlite); exclude(Sqlite("libsql.js.wasm","better-sqlite3.js.wasm")); exclude_executors("QueryCompiler")]
- [ ] `new::regressions::prisma_15204::convert_to_int_sqlite_js` — issue #15204: numeric-to-int conversion on SQLite (js driver) [connectors: only(Sqlite("libsql.js.wasm")); exclude_executors("QueryCompiler")]
- [ ] `new::regressions::prisma_15204::convert_to_bigint_sqlite_quaint` — issue #15204: numeric-to-bigint conversion on SQLite (quaint) [connectors: only(Sqlite); exclude(Sqlite("libsql.js.wasm","better-sqlite3.js.wasm")); exclude_executors("QueryCompiler")]
- [ ] `new::regressions::prisma_15204::convert_to_bigint_sqlite_js` — issue #15204: numeric-to-bigint conversion on SQLite (js driver) [connectors: only(Sqlite("libsql.js.wasm")); exclude_executors("QueryCompiler")]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_15264.rs

- [ ] `new::regressions::prisma_15264::upsert_works_with_unsigned_int` — issue #15264: upsert works with an unsigned int on MySQL [connectors: only(MySql)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_15467.rs

- [ ] `new::regressions::prisma_15467::update_many_log_output` — issue #15467: updateMany produces correct query log output on MongoDB [connectors: only(MongoDb)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_15581.rs

- [ ] `new::regressions::prisma_15581::create_one_model_with_datetime_default_now_in_id` — issue #15581: create with now() default in a composite id [connectors: exclude(Mongodb)]
- [ ] `new::regressions::prisma_15581::create_one_model_with_updated_at_in_id` — issue #15581: create with @updatedAt field in a composite id [connectors: exclude(Mongodb)]
- [ ] `new::regressions::prisma_15581::create_one_model_with_low_precision_datetime_in_id` — issue #15581: create with low-precision datetime in id (Postgres) [connectors: only(Postgres)]
- [ ] `new::regressions::prisma_15581::single_create_one_model_with_default_now_in_id` — issue #15581: single create with now() default in single-field id [connectors: exclude(Mongodb)]
- [ ] `new::regressions::prisma_15581::single_create_one_model_with_updated_at_in_id` — issue #15581: single create with @updatedAt in single-field id [connectors: exclude(Mongodb)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_15607.rs

- [ ] `new::regressions::prisma_15607::sqlserver_can_recover_from_deadlocks` — issue #15607: SQL Server recovers from a transaction deadlock (error 2034) and the connection stays usable (NB: `#[tokio::test]`, not `#[connector_test]`; SQL-Server-only, guarded in body) [connectors: only(SqlServer) (in-body guard)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_16760.rs

- [ ] `new::regressions::prisma_16760::regression` — issue #16760: enum-array push on a scalar-list field [connectors: capabilities(ScalarLists,EnumArrayPush)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_17103.rs

- [ ] `new::regressions::prisma_17103::regression` — issue #17103: connect on a one-to-many relation [connectors: exclude(Vitess("planetscale.js.wasm"))]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_18517.rs

- [ ] `new::regressions::prisma_18517::regression` — issue #18517: Postgres-specific repro [connectors: only(Postgres)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_20799.rs

- [ ] `new::regressions::prisma_20799::repro` — issue #20799: query that previously ran for minutes and OOM'd now completes [connectors: only(Sqlite)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_21182.rs

- [ ] `new::regressions::prisma_21182::query_with_normalized_dependencies` — issue #21182: query with normalized dependencies [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_21369.rs

- [ ] `new::regressions::prisma_21369::select_null_works` — issue #21369: selecting a literal null value works [connectors: exclude(MongoDb,CockroachDb("pg.js.wasm"))]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_21901.rs

- [ ] `new::regressions::prisma_21901::test` — issue #21901: enum + scalar-list repro [connectors: capabilities(Enums,ScalarLists); exclude(MongoDb)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_22007.rs

- [ ] `new::regressions::prisma_22007::filters_render_correctly` — issue #22007: filters render correctly on MongoDB [connectors: only(MongoDb)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_22298.rs

- [ ] `new::regressions::prisma_22298::query_53_fields_through_relation` — issue #22298: querying 53 fields through a relation [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_22971.rs

- [ ] `new::regressions::prisma_22971::top_level` — issue #22971: top-level repro [connectors: all]
- [ ] `new::regressions::prisma_22971::nested` — issue #22971: nested repro [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_24072.rs

- [ ] `new::regressions::prisma_24072::test_24072` — issue #24072: onDelete SetDefault repro [connectors: exclude(MongoDb,MySql(5.6),MySql(5.7),Vitess("planetscale.js.wasm"))]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_25290.rs

- [ ] `new::regressions::prisma_25290::cm_selecting_ignored_field_errors` — issue #25290: createManyAndReturn selecting an @@ignore'd field raises a validation error (no panic) [connectors: only(Postgres,CockroachDb,Sqlite)]
- [ ] `new::regressions::prisma_25290::cm_does_not_return_ignored_fields` — issue #25290: createManyAndReturn does not return ignored fields [connectors: only(Postgres,CockroachDb,Sqlite)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_27452.rs

- [ ] `new::regressions::prisma_27452::comment_like_upsert_with_nested_comments` — issue #27452: comment-like upsert with nested comments [connectors: exclude(MongoDb,SqlServer)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_5952.rs

- [ ] `new::regressions::prisma_5952::decimal_find_different_uniques` — issue #5952: find by different Decimal unique values [connectors: exclude(MongoDb)]
- [ ] `new::regressions::prisma_5952::decimal_find_different_uniques_unquoted` — issue #5952: find by unquoted Decimal unique values [connectors: exclude(MongoDb)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_6173.rs

- [ ] `new::regressions::prisma_6173::mysql_call` — issue #6173: raw anonymous-block call on MariaDB [connectors: only(MySQL("mariadb"))]
- [ ] `new::regressions::prisma_6173::mysql_call_2` — issue #6173: second raw anonymous-block call variant on MariaDB [connectors: only(MySQL("mariadb"))]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_7010.rs

- [ ] `new::regressions::prisma_7010::binary_uuid` — issue #7010: binary-stored UUID round-trips on MySQL 8 [connectors: only(MySql(8))]
- [ ] `new::regressions::prisma_7010::str_uuid` — issue #7010: string UUID round-trips [connectors: only(MySql(8))]
- [ ] `new::regressions::prisma_7010::binary_str_composite` — issue #7010: composite of binary + string UUID [connectors: only(MySql(8))]
- [ ] `new::regressions::prisma_7010::extra_spaces_are_removed` — issue #7010: extra spaces are stripped from UUID input [connectors: only(MySql(8))]
- [ ] `new::regressions::prisma_7010::uuid_without_native_type` — issue #7010: UUID without a native type [connectors: only(MySql(8))]
- [ ] `new::regressions::prisma_7010::uuid_is_provided` — issue #7010: explicitly provided UUID [connectors: only(MySql(8))]
- [ ] `new::regressions::prisma_7010::uuid_is_swapped` — issue #7010: byte-swapped UUID handling [connectors: only(MySql(8))]
- [ ] `new::regressions::prisma_7010::uuid_is_normal` — issue #7010: normal (non-swapped) UUID handling [connectors: only(MySql(8))]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_7072.rs

- [ ] `new::regressions::prisma_7072::test_filter_in` — issue #7072: `in` filter repro [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_7434.rs

- [ ] `new::regressions::prisma_7434::autoinc::not_in_batch_filter` — issue #7434: notIn filter in a batched query (autoincrement schema) [connectors: capabilities(AutoIncrement); exclude(CockroachDb)]
- [ ] `new::regressions::prisma_7434::cockroachdb::not_in_batch_filter` — issue #7434: notIn filter in a batched query (CockroachDB schema) [connectors: only(CockroachDb)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_8265.rs

- [ ] `new::regressions::prisma_8265::nested_update_many_timestamps` — issue #8265: nested updateMany sets @updatedAt timestamps [connectors: all] → PASS `test/integration/test/ports/engines/new/regressions/prisma_8265/prisma_8265.test.ts` › `nested updateMany changes the updated-at timestamp of the rows it updates (nested_update_many_timestamps)`

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/prisma_engines_4286.rs

- [ ] `new::regressions::prisma_engines_4286::close_tx_on_error` — prisma-engines#4286: an unsupported-isolation error closes the tx cleanly instead of hanging (libSQL) [connectors: only(Sqlite("libsql.js.wasm"))]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/regressions/team_orm_927.rs

- [ ] `new::regressions::team_orm_927::find_unique` — team-orm#927: findUnique repro [connectors: all]
- [ ] `new::regressions::team_orm_927::find_many` — team-orm#927: findMany repro [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/relation_load_strategy/batch.rs

- [ ] `new::relation_load_strategy::batch::compacted_query_lateral` — batched compaction with relationLoadStrategy=query and lateral-join capability [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::batch::compacted_query_subquery` — batched compaction with query strategy and correlated-subquery capability [connectors: capabilities(CorrelatedSubqueries); exclude(Mysql("5.6","5.7","mariadb","mariadb.js.wasm"))]
- [ ] `new::relation_load_strategy::batch::compacted_join_lateral` — batched compaction with relationLoadStrategy=join (lateral) [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::batch::compacted_join_subquery` — batched compaction with join strategy (subquery) [connectors: capabilities(CorrelatedSubqueries); exclude(Mysql("5.6","5.7","mariadb","mariadb.js.wasm"))]
- [ ] `new::relation_load_strategy::batch::mixed_rls_does_not_compact_lateral` — mixed relationLoadStrategy across batch is not compacted (lateral) [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::batch::mixed_rls_does_not_compact_subquery` — mixed relationLoadStrategy across batch is not compacted (subquery) [connectors: capabilities(CorrelatedSubqueries); exclude(Mysql("5.6","5.7","mariadb","mariadb.js.wasm"))]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/relation_load_strategy/queries.rs

- [ ] `new::relation_load_strategy::queries::test_find_many_lateral_join` — findMany relationLoadStrategy=join uses lateral join [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::queries::test_find_many_subquery_join` — findMany join strategy via correlated subquery [connectors: capabilities(CorrelatedSubqueries); exclude(Mysql("5.6","5.7","mariadb","mariadb.js.wasm"))]
- [ ] `new::relation_load_strategy::queries::test_find_many_lateral_query` — findMany relationLoadStrategy=query with lateral-join capability [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::queries::test_find_many_subquery_query` — findMany query strategy with correlated-subquery capability [connectors: capabilities(CorrelatedSubqueries)]
- [ ] `new::relation_load_strategy::queries::test_find_first_lateral_join` — findFirst join strategy uses lateral join [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::queries::test_find_first_subquery_join` — findFirst join strategy via correlated subquery [connectors: capabilities(CorrelatedSubqueries); exclude(Mysql("5.6","5.7","mariadb","mariadb.js.wasm"))]
- [ ] `new::relation_load_strategy::queries::test_find_first_lateral_query` — findFirst query strategy (lateral capability) [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::queries::test_find_first_subquery_query` — findFirst query strategy (subquery capability) [connectors: capabilities(CorrelatedSubqueries)]
- [ ] `new::relation_load_strategy::queries::test_find_first_or_throw_lateral_join` — findFirstOrThrow join strategy (lateral) [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::queries::test_find_first_or_throw_subquery_join` — findFirstOrThrow join strategy (subquery) [connectors: capabilities(CorrelatedSubqueries); exclude(Mysql("5.6","5.7","mariadb","mariadb.js.wasm"))]
- [ ] `new::relation_load_strategy::queries::test_find_first_or_throw_lateral_query` — findFirstOrThrow query strategy (lateral capability) [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::queries::test_find_first_or_throw_subquery_query` — findFirstOrThrow query strategy (subquery capability) [connectors: capabilities(CorrelatedSubqueries)]
- [ ] `new::relation_load_strategy::queries::test_find_unique_lateral_join` — findUnique join strategy (lateral) [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::queries::test_find_unique_subquery_join` — findUnique join strategy (subquery) [connectors: capabilities(CorrelatedSubqueries); exclude(Mysql("5.6","5.7","mariadb","mariadb.js.wasm"))]
- [ ] `new::relation_load_strategy::queries::test_find_unique_lateral_query` — findUnique query strategy (lateral capability) [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::queries::test_find_unique_subquery_query` — findUnique query strategy (subquery capability) [connectors: capabilities(CorrelatedSubqueries)]
- [ ] `new::relation_load_strategy::queries::test_find_unique_or_throw_lateral_join` — findUniqueOrThrow join strategy (lateral) [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::queries::test_find_unique_or_throw_subquery_join` — findUniqueOrThrow join strategy (subquery) [connectors: capabilities(CorrelatedSubqueries); exclude(Mysql("5.6","5.7","mariadb","mariadb.js.wasm"))]
- [ ] `new::relation_load_strategy::queries::test_find_unique_or_throw_lateral_query` — findUniqueOrThrow query strategy (lateral capability) [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::queries::test_find_unique_or_throw_subquery_query` — findUniqueOrThrow query strategy (subquery capability) [connectors: capabilities(CorrelatedSubqueries)]
- [ ] `new::relation_load_strategy::queries::test_create_lateral_join` — createOne with relationLoadStrategy=join (lateral) [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::queries::test_create_subquery_join` — createOne join strategy (subquery) [connectors: capabilities(CorrelatedSubqueries); exclude(Mysql("5.6","5.7","mariadb","mariadb.js.wasm"))]
- [ ] `new::relation_load_strategy::queries::test_create_lateral_query` — createOne query strategy (lateral capability) [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::queries::test_create_subquery_query` — createOne query strategy (subquery capability) [connectors: capabilities(CorrelatedSubqueries)]
- [ ] `new::relation_load_strategy::queries::test_update_lateral_join` — updateOne with relationLoadStrategy=join (lateral) [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::queries::test_update_subquery_join` — updateOne join strategy (subquery) [connectors: capabilities(CorrelatedSubqueries); exclude(Mysql("5.6","5.7","mariadb","mariadb.js.wasm"))]
- [ ] `new::relation_load_strategy::queries::test_update_lateral_query` — updateOne query strategy (lateral capability) [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::queries::test_update_subquery_query` — updateOne query strategy (subquery capability) [connectors: capabilities(CorrelatedSubqueries)]
- [ ] `new::relation_load_strategy::queries::test_delete_lateral_join` — deleteOne with relationLoadStrategy=join (lateral) [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::queries::test_delete_subquery_join` — deleteOne join strategy (subquery) [connectors: capabilities(CorrelatedSubqueries); exclude(Mysql("5.6","5.7","mariadb","mariadb.js.wasm"))]
- [ ] `new::relation_load_strategy::queries::test_delete_lateral_query` — deleteOne query strategy (lateral capability) [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::queries::test_delete_subquery_query` — deleteOne query strategy (subquery capability) [connectors: capabilities(CorrelatedSubqueries)]
- [ ] `new::relation_load_strategy::queries::test_upsert_lateral_join` — upsertOne with relationLoadStrategy=join (lateral) [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::queries::test_upsert_subquery_join` — upsertOne join strategy (subquery) [connectors: capabilities(CorrelatedSubqueries); exclude(Mysql("5.6","5.7","mariadb","mariadb.js.wasm"))]
- [ ] `new::relation_load_strategy::queries::test_upsert_lateral_query` — upsertOne query strategy (lateral capability) [connectors: capabilities(LateralJoin)]
- [ ] `new::relation_load_strategy::queries::test_upsert_subquery_query` — upsertOne query strategy (subquery capability) [connectors: capabilities(CorrelatedSubqueries)]
- [ ] `new::relation_load_strategy::queries::test_no_strategy_in_nested_relations` — relationLoadStrategy on a nested relation is rejected (error 2009) [connectors: capabilities(schema default)]
- [ ] `new::relation_load_strategy::queries::test_no_strategy_in_aggregate` — relationLoadStrategy on aggregate is rejected (error 2009) [connectors: capabilities(schema default)]
- [ ] `new::relation_load_strategy::queries::test_no_strategy_in_group_by` — relationLoadStrategy on groupBy is rejected (error 2009) [connectors: capabilities(schema default)]
- [ ] `new::relation_load_strategy::queries::test_no_strategy_in_create_many` — relationLoadStrategy on createMany is rejected (error 2009) [connectors: capabilities(schema default)]
- [ ] `new::relation_load_strategy::queries::test_no_strategy_in_update_many` — relationLoadStrategy on updateMany is rejected (error 2009) [connectors: capabilities(schema default)]
- [ ] `new::relation_load_strategy::queries::test_no_strategy_in_delete_many` — relationLoadStrategy on deleteMany is rejected (error 2009) [connectors: capabilities(schema default)]
- [ ] `new::relation_load_strategy::queries::unsupported_join_strategy` — relationLoadStrategy=join errors (2019) on MySQL <8.0.14 / MariaDB [connectors: only(Mysql(5.6,5.7,"mariadb"))]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/update_no_select.rs

- [ ] `new::update_no_select::update_with_no_select` — update without a nested select returns the expected result [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/new/write_conflict.rs

- [ ] `new::write_conflict::simple` — MongoDB write conflict handling (single op) [connectors: only(MongoDb)]
- [ ] `new::write_conflict::batched` — MongoDB write conflict handling in a batch [connectors: only(MongoDb)]

## tests/raw

### query-engine/connector-test-kit-rs/query-engine-tests/tests/raw/sql/casts.rs

- [ ] `raw::sql::casts::query_numeric_casts` — raw SQL numeric casts ($n::type) coerce correctly [connectors: only(Postgres); exclude(Postgres("neon.js.wasm","pg.js.wasm"))]
- [ ] `raw::sql::casts::query_date_casts` — raw SQL date/time casts coerce correctly [connectors: only(Postgres)]
- [ ] `raw::sql::casts::prisma_9949` — issue #9949: raw SQL cast repro [connectors: only(Postgres)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/raw/sql/errors.rs

- [ ] `raw::sql::errors::unsupported_columns` — queryRaw over unsupported column types raises a clear error [connectors: only(Postgres)]
- [ ] `raw::sql::errors::invalid_parameter_count` — mismatched positional-parameter count raises an error [connectors: only(Postgres,Sqlite); exclude(Postgres("neon.js.wasm","pg.js.wasm"),Sqlite("libsql.js.wasm","cfd1","better-sqlite3.js.wasm"))]
- [ ] `raw::sql::errors::list_param_for_scalar_column_should_not_panic_quaint` — passing a list param for a scalar column does not panic (quaint) [connectors: only(Postgres); exclude(Postgres("neon.js.wasm","pg.js.wasm"))]
- [ ] `raw::sql::errors::list_param_for_scalar_column_should_not_panic_pg_js` — same, Postgres js driver [connectors: only(Postgres("neon.js.wasm","pg.js.wasm"))]
- [ ] `raw::sql::errors::list_param_for_scalar_column_should_not_panic_pg_crdb` — same, CockroachDB pg js driver [connectors: only(CockroachDb("pg.js.wasm"))]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/raw/sql/input_coercion.rs

- [ ] `raw::sql::input_coercion::scalar_input_correctly_coerced` — queryRaw scalar inputs are coerced to the correct types [connectors: only(Postgres)]
- [ ] `raw::sql::input_coercion::decimal_input_correctly_coerced` — queryRaw Decimal input is coerced correctly [connectors: only(Postgres)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/raw/sql/scalar_list.rs

- [ ] `raw::sql::scalar_list::null_scalar_lists` — raw SQL returns null scalar-list columns correctly [connectors: only(Postgres,CockroachDb)]
- [ ] `raw::sql::scalar_list::null_native_type_lists` — raw SQL returns null native-type list columns correctly [connectors: only(Postgres,CockroachDb)]
- [ ] `raw::sql::scalar_list::prisma_11339` — issue #11339: raw SQL scalar-list repro [connectors: only(Postgres,CockroachDb)]
- [ ] `raw::sql::scalar_list::empty_scalar_lists` — raw SQL returns empty scalar-list columns correctly [connectors: only(Postgres,CockroachDb)]
- [ ] `raw::sql::scalar_list::null_only_scalar_lists` — raw SQL returns lists containing only nulls correctly [connectors: only(Postgres,CockroachDb)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/raw/sql/typed_output.rs

- [ ] `raw::sql::typed_output::all_scalars_pg` — queryRaw typed output for all scalar types on Postgres [connectors: only(Postgres)]
- [ ] `raw::sql::typed_output::all_scalars_mysql` — queryRaw typed output for all scalar types on MySQL [connectors: only(MySql(5.7),MySql(8))]
- [ ] `raw::sql::typed_output::all_scalars_mariadb` — queryRaw typed output for all scalar types on MariaDB [connectors: only(MySql("mariadb"))]
- [ ] `raw::sql::typed_output::all_scalars_mariadb_js` — queryRaw typed output on MariaDB (js driver) [connectors: only(MySql("mariadb.js.wasm","mariadb-mysql.js.wasm"))]
- [ ] `raw::sql::typed_output::all_scalars_sqlite` — queryRaw typed output for all scalar types on SQLite [connectors: only(Sqlite); exclude(Sqlite("cfd1"))]
- [ ] `raw::sql::typed_output::all_scalars_cfd1` — queryRaw typed output on Cloudflare D1 (quaint executor) [connectors: only(Sqlite("cfd1")); exclude_executors("QueryCompiler")]
- [ ] `raw::sql::typed_output::all_scalars_cfd1_qc` — queryRaw typed output on Cloudflare D1 (QueryCompiler executor) [connectors: only(Sqlite("cfd1")); only_executors("QueryCompiler")]
- [ ] `raw::sql::typed_output::unknown_type_mysql` — queryRaw handling of an unknown column type on MySQL [connectors: only(Mysql)]
- [ ] `raw::sql::typed_output::unknown_type_pg` — queryRaw handling of an unknown column type on Postgres [connectors: only(Postgres)]
- [ ] `raw::sql::typed_output::unknown_type_mssql` — queryRaw handling of an unknown column type on SQL Server [connectors: only(SqlServer("2017","2019","2022"))]
- [ ] `raw::sql::typed_output::unknown_type_mssql_js` — queryRaw handling of an unknown column type on SQL Server (js driver) [connectors: only(SqlServer("mssql.js.wasm"))]

**Total: 323 tests**
