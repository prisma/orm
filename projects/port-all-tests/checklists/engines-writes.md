# Checklist — prisma-engines query-engine tests (writes/)

Source: prisma/prisma-engines@e922089b7d7502aff4249d5da3420f6fa55fc6ad — query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/

Protocol: each line is one source test. `[ ]` = not yet dispositioned. The Opus reviewer sub-agent checks `[x]` ONLY when satisfied that the test is (a) faithfully ported and passing, (b) faithfully ported as `test.fails` with a `failing.md` entry, or (c) covered by a justified individual `non-ported.md` entry. Implementer sub-agents never check boxes.

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/composites/common.rs
- [ ] `writes::composites::common::all_required_types_work` — creates a model with all required composite scalar types (str, bool, int, bInt, float, dt, json, bytes, enum) and asserts they round-trip [connectors: only:mongodb]
- [ ] `writes::composites::common::all_optional_types_work` — creates optional composite types with values, with explicit nulls, and with an empty object, asserting each resolves correctly [connectors: only:mongodb]
- [ ] `writes::composites::common::all_list_types_work` — creates list composite types (empty, with values) and pushes items via list and single syntax [connectors: only:mongodb]
- [ ] `writes::composites::edge_cases::same_composite` — same composite type used as both to-one and to-many works (guards past schema-caching bug blocking array-set) [connectors: only:mongodb]
- [ ] `writes::composites::edge_cases::non_nullable_list_set` — setting a required composite list to null (directly or via set:null) errors 2009 "A value is required but not set" [connectors: only:mongodb]
- [ ] `writes::composites::edge_cases::non_nullable_update` — updating a required composite list to null (directly or via set:null) errors 2009 "A value is required but not set" [connectors: only:mongodb]
- [ ] `writes::composites::edge_cases::schema_override_regression` — upsert on optional composite prop with content set:null succeeds (schema override regression) [connectors: only:mongodb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/composites/list.rs
- [ ] `writes::composites::create_list::set_create` — creates composite lists via explicit `set` using single-object shorthand, list wrapper, and many items [connectors: only:mongodb]
- [ ] `writes::composites::create_list::shorthand_set_create` — creates deeply nested composite lists via shorthand (no set), single object, list wrapper, and many items [connectors: only:mongodb]
- [ ] `writes::composites::create_list::mixed_set_create` — creates composites mixing explicit `set` and shorthand syntax together [connectors: only:mongodb]
- [ ] `writes::composites::create_list::explicit_set_empty_object` — explicit `set` with empty/partial objects applies field defaults [connectors: only:mongodb]
- [ ] `writes::composites::create_list::shorthand_set_empty_object` — shorthand with empty objects applies field defaults on nested composites [connectors: only:mongodb]
- [ ] `writes::composites::create_list::missing_lists_coerced_to_empty` — missing composite list fields coerce to empty list, missing optional to-one to null [connectors: only:mongodb]
- [ ] `writes::composites::update_list::update_set_explicit` — updates composite list and to-one via explicit `set` [connectors: only:mongodb]
- [ ] `writes::composites::update_list::update_set_shorthand` — updates composite list and to-one via shorthand syntax [connectors: only:mongodb]
- [ ] `writes::composites::update_list::fails_on_nested_update_after_a_set` — nested `update` inside a `set` errors 2009 "Invalid argument type" for both checked and unchecked types [connectors: only:mongodb]
- [ ] `writes::composites::update_list::update_push_explicit` — pushes items to composite lists via array and object syntax, with nested upsert push [connectors: only:mongodb]
- [ ] `writes::composites::update_list::update_push_with_dollar_string` — pushing string values starting with `$` works via array and object syntax [connectors: only:mongodb]
- [ ] `writes::composites::update_list::update_push_explicit_with_default` — pushing empty objects applies defaults on pushed composites [connectors: only:mongodb]
- [ ] `writes::composites::update_list::update_push_explicit_nested` — nested `push` on to-many composite via object and array syntax, with and without defaults [connectors: only:mongodb]
- [ ] `writes::composites::update_list::fails_push_on_non_list_field` — `push` on a to-one composite or scalar errors 2009 "Field does not exist in enclosing type." [connectors: only:mongodb]
- [ ] `writes::composites::update_list::fails_unset_on_list_field` — `unset` on a composite list field errors 2009 "Field does not exist in enclosing type." [connectors: only:mongodb]
- [ ] `writes::composites::update_list::fails_upsert_on_list_field` — `upsert` on a composite list field errors 2009 "Field does not exist in enclosing type." [connectors: only:mongodb]
- [ ] `writes::composites::update_list::update_many_simple` — `updateMany` on composite list exercising set, upsert, numeric updates, push, nested updateMany, deleteMany, and unset [connectors: only:mongodb]
- [ ] `writes::composites::update_list::update_many_in_upsert` — nested `updateMany` inside `upsert` on a to-one composite (set then update branches) [connectors: only:mongodb]
- [ ] `writes::composites::update_list::update_many_with_nested_updates` — `updateMany` with nested to-one `update` chains down composite hierarchy [connectors: only:mongodb]
- [ ] `writes::composites::update_list::update_many_with_nested_unsets` — `updateMany` with nested multiple `unset`s (with and without other updates, and within upsert) [connectors: only:mongodb]
- [ ] `writes::composites::update_list::update_many_with_nested_upserts` — `updateMany` with deeply nested `upsert`s down optional composite chain [connectors: only:mongodb]
- [ ] `writes::composites::update_list::update_many_complex` — complex combination: top-level updateMany, nested upsert/updateMany/unset, set/push/numeric updates [connectors: only:mongodb]
- [ ] `writes::composites::update_list::delete_many_explicit` — `deleteMany` on composite list at top level and within upsert (set and update branches) [connectors: only:mongodb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/composites/native_types.rs
- [ ] `writes::composites::on_composites::native_types_work` — creating a composite with an ObjectId-typed field accepts a valid hex string [connectors: only:mongodb]
- [ ] `writes::composites::on_composites::invalid_objectid_must_error` — creating a composite with an invalid ObjectId errors 2023 "Malformed ObjectID" [connectors: only:mongodb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/composites/single.rs
- [ ] `writes::composites::create_single::set_create` — creates deeply nested to-one composites via explicit `set` [connectors: only:mongodb]
- [ ] `writes::composites::create_single::shorthand_set_create` — creates deeply nested to-one composites via shorthand only [connectors: only:mongodb]
- [ ] `writes::composites::create_single::mixed_set_create` — creates to-one composites mixing explicit `set` and shorthand [connectors: only:mongodb]
- [ ] `writes::composites::create_single::explicit_set_empty_object` — explicit `set` with empty nested objects applies defaults [connectors: only:mongodb]
- [ ] `writes::composites::create_single::shorthand_set_empty_object` — shorthand with empty nested objects applies defaults [connectors: only:mongodb]
- [ ] `writes::composites::create_single::fails_when_missing_required_fields` — missing required fields error 2009 on both envelope ("Expected exactly one field") and inner type ("A value is required but not set") [connectors: only:mongodb]
- [ ] `writes::composites::update_single::update_set_envelope` — `set` on required and optional to-one composites via envelope syntax, incl. nested empty defaults [connectors: only:mongodb]
- [ ] `writes::composites::update_single::update_set_shorthand` — `set` on required and optional to-one composites via shorthand, incl. nested empty defaults [connectors: only:mongodb]
- [ ] `writes::composites::update_single::update_set_mixed` — top-level `set` mixing explicit and shorthand on to-one composites [connectors: only:mongodb]
- [ ] `writes::composites::update_single::update_nested_envelope` — nested `update` on to-one composites with numeric increment/decrement [connectors: only:mongodb]
- [ ] `writes::composites::update_single::mixed_update_set` — nested `update` with empty object applying defaults [connectors: only:mongodb]
- [ ] `writes::composites::update_single::update_unset_explicit` — `unset` on nested composite, top-level composite, nested scalar, and top-level scalar [connectors: only:mongodb]
- [ ] `writes::composites::update_single::update_unset_false_is_noop` — `unset:false` on composite and optional scalar is a no-op [connectors: only:mongodb]
- [ ] `writes::composites::update_single::ensure_unset_unavailable_on_fields` — `unset` on a required scalar errors 2009 "Field does not exist in enclosing type." [connectors: only:mongodb]
- [ ] `writes::composites::update_single::update_upsert_explicit` — nested and top-level `upsert` on to-one composites (set then update branches) [connectors: only:mongodb]
- [ ] `writes::composites::update_single::mixed_upsert_update_set_unset` — deeply nested mix of update, upsert, set, increment, and unset on to-one composites [connectors: only:mongodb]
- [ ] `writes::composites::update_single::fails_unset_on_required_field` — `unset` on a required to-one composite errors 2009 "Field does not exist in enclosing type." [connectors: only:mongodb]
- [ ] `writes::composites::update_single::fails_upsert_on_required_field` — `upsert` on a required to-one composite errors 2009 "Field does not exist in enclosing type." [connectors: only:mongodb]
- [ ] `writes::composites::update_single::fails_on_nested_update_after_a_set` — nested `update` after a `set` errors 2009 "Field does not exist in enclosing type." (explicit and shorthand) [connectors: only:mongodb]
- [ ] `writes::composites::update_single::fails_set_when_missing_required_fields` — updating with missing required fields errors 2009 on envelope and inner type [connectors: only:mongodb]
- [ ] `writes::composites::update_single::fails_update_on_optional_composite` — `update` on an optional to-one composite errors 2009 "Field does not exist in enclosing type." [connectors: only:mongodb]
- [ ] `writes::composites::update_single::fails_update_many_on_to_one` — `updateMany` on required and optional to-one composites errors 2009 "Field does not exist in enclosing type." [connectors: only:mongodb]
- [ ] `writes::composites::update_single::fails_delete_many_on_to_one` — `deleteMany` on required and optional to-one composites errors 2009 "Field does not exist in enclosing type." [connectors: only:mongodb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/data_types/bigint.rs
- [ ] `writes::data_types::bigint::using_bigint_field` — create with BigInt default, update to max BigInt string, and set null all round-trip [connectors: exclude:sqlite(cfd1)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/data_types/bytes.rs
- [ ] `writes::bytes::using_bytes_field` — create with Bytes default, update to new base64, and set null round-trip [connectors: exclude:sqlserver(mssql.js.wasm)]
- [ ] `writes::bytes::byte_id_coercion` — create a record with a Bytes @id coerces the base64 id correctly [connectors: exclude:mysql,vitess,sqlserver]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/data_types/datetime/created_at.rs
- [ ] `writes::data_types::datetime::created_at::created_at_should_stay_consistent` — created_dt equals updated_dt on create for parent and all nested children [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/data_types/datetime/datetime.rs
- [ ] `writes::data_types::datetime::datetime::before_1970` — DateTime value before 1970 stores and reads back correctly [connectors: exclude:sqlite]
- [ ] `writes::data_types::datetime::datetime::ms_in_date_before_1970` — DateTime with milliseconds before 1970 round-trips [connectors: exclude:sqlite]
- [ ] `writes::data_types::datetime::datetime::date_after_1970` — DateTime value after 1970 round-trips [connectors: all]
- [ ] `writes::data_types::datetime::datetime::ms_in_date_after_1970` — DateTime with milliseconds after 1970 round-trips [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/data_types/datetime/non_embed_updated_at_should_change.rs
- [ ] `writes::data_types::datetime::non_embed_updated_at::update_nested_item` — updating a nested item changes its updatedAt value [connectors: all]
- [ ] `writes::data_types::datetime::non_embed_updated_at::upsert_nested_item` — upserting a nested item changes its updatedAt value [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/data_types/datetime/updated_at_should_change.rs
- [ ] `writes::data_types::datetime::updated_at::update_should_change_updated_at` — update mutation changes the record's updatedAt [connectors: caps:scalarlists]
- [ ] `writes::data_types::datetime::updated_at::upsert_should_change_updated_at` — upsert mutation changes the record's updatedAt [connectors: caps:scalarlists]
- [ ] `writes::data_types::datetime::updated_at::update_many_should_change_updated_at` — updateMany changes the record's updatedAt [connectors: caps:scalarlists]
- [ ] `writes::data_types::datetime::updated_at::update_sclr_list_should_change_updt_at` — updating scalar list values changes updatedAt [connectors: caps:scalarlists]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/data_types/datetime/where_and_datetime.rs
- [ ] `writes::data_types::datetime::where_and_datetime::test_1` — same DateTime input usable as where in create then update, nested update works [connectors: all]
- [ ] `writes::data_types::datetime::where_and_datetime::test_2` — same DateTime for inner and outer usable as where in create then update [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/data_types/datetime/where_and_update.rs
- [ ] `writes::data_types::datetime::where_and_update::update_unique_val` — updating the unique value used to find an item works [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/data_types/decimal.rs
- [ ] `writes::data_types::decimal::using_decimal_field` — create with Decimal default, update to new value, and set null round-trip with full precision [connectors: caps:decimaltype; exclude:sqlserver,sqlite,mongodb]
- [ ] `writes::data_types::decimal::using_decimal_as_id` — create a record with a Decimal @id [connectors: caps:decimaltype; exclude:sqlserver(mssql.js.wasm)]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/data_types/json.rs
- [ ] `writes::json::json_float_accuracy` — Json float value preserves accuracy on create [connectors: caps:json; exclude:sqlserver,mysql,vitess,sqlite]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/data_types/native_types/mongodb.rs
- [ ] `writes::mongodb::native_types` — create with all MongoDB native types (Int, Long, Double, ObjectId, String, Bool, BinData) round-trips [connectors: only:mongodb]
- [ ] `writes::mongodb::m2m_syntax_workaround` — m2m relation workaround with ObjectId scalar-list foreign keys creates and connects [connectors: only:mongodb]
- [ ] `writes::mongodb::objectid_list_operations` — set/push single and array operations on an ObjectId scalar list [connectors: only:mongodb]
- [ ] `writes::mongodb::default_int_type_is_long` — default Int native type stores as Long (accepts max i64) [connectors: only:mongodb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/data_types/native_types/mysql.rs
- [ ] `writes::mysql::native_int_int` — create with autoincrement Int id and Int/SmallInt/MediumInt/BigInt native columns [connectors: only:mysql]
- [ ] `writes::mysql::native_int_smallint` — create with autoincrement SmallInt id and int native columns [connectors: only:mysql]
- [ ] `writes::mysql::native_int_mediumint` — create with autoincrement MediumInt id and int native columns [connectors: only:mysql]
- [ ] `writes::mysql::native_bigint_bigint` — create with autoincrement BigInt id and int native columns [connectors: only:mysql]
- [ ] `writes::mysql::native_decimal_type` — MySQL Float/Double/Decimal native types round-trip with expected precision [connectors: only:mysql]
- [ ] `writes::mysql::native_decimal_vitess_precision` — large Decimal(20,10) preserves precision on Vitess [connectors: only:mysql,vitess]
- [ ] `writes::mysql::native_string_types` — MySQL Char/VarChar/TinyText/Text/MediumText/LongText round-trip [connectors: only:mysql]
- [ ] `writes::mysql::native_date_types` — MySQL Date/Time/DateTime/Timestamp/Year native types round-trip [connectors: only:mysql]
- [ ] `writes::mysql::native_binary_types` — MySQL Bit/Binary/VarBinary/Blob variants round-trip [connectors: only:mysql]
- [ ] `writes::mysql::other_native_types` — MySQL TinyInt and Bit(1) map to Boolean [connectors: only:mysql]
- [ ] `writes::mysql::fixed_size_char_native_type` — fixed-size Char id handled correctly wrt padding for relation comparisons [connectors: only:mysql]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/data_types/native_types/postgres.rs
- [ ] `writes::postgres::native_int_types` — Postgres Integer/SmallInt/BigInt/Oid and autoincrement variants round-trip [connectors: only:postgres]
- [ ] `writes::postgres::native_decimal_types` — Postgres Real/DoublePrecision/Decimal/Money native types round-trip [connectors: only:postgres; exclude:cockroachdb]
- [ ] `writes::postgres::native_decimal_types_cockroach` — Cockroach Float4/Float8/Decimal native types round-trip (no money) [connectors: only:postgres,cockroachdb]
- [ ] `writes::postgres::native_string` — Postgres Char/VarChar/Text/Bit/VarBit/Uuid/Inet native types round-trip [connectors: only:postgres]
- [ ] `writes::postgres::native_other_types` — Postgres Boolean/ByteA/Xml/Json/JsonB native types round-trip [connectors: only:postgres; exclude:cockroachdb]
- [ ] `writes::postgres::native_other_types_cockroach` — Cockroach Bool/Bytes/JsonB native types round-trip (no XML) [connectors: only:postgres,cockroachdb]
- [ ] `writes::postgres::native_date` — Postgres Date/Time/Timetz/Timestamp/Timestamptz with timezone offsets round-trip [connectors: only:postgres]
- [ ] `writes::postgres::native_fixed_size_char` — fixed-size Char id returns padded strings and relation comparison works [connectors: only:postgres]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/data_types/native_types/sql_server.rs
- [ ] `writes::sql_server::native_int_int` — create with autoincrement Int id and Int/SmallInt/TinyInt/BigInt/Bit native columns [connectors: only:sqlserver]
- [ ] `writes::sql_server::native_int_tinyint` — create with autoincrement TinyInt id and int native columns [connectors: only:sqlserver]
- [ ] `writes::sql_server::native_int_smallint` — create with autoincrement SmallInt id and int native columns [connectors: only:sqlserver]
- [ ] `writes::sql_server::native_bigint_bigint` — create with autoincrement BigInt id and int native columns [connectors: only:sqlserver]
- [ ] `writes::sql_server::native_decimal_type` — SQL Server Real/Float/Money/SmallMoney/Decimal native types round-trip [connectors: only:sqlserver]
- [ ] `writes::sql_server::native_string_types` — SQL Server Char/NChar/VarChar/NVarChar/Text/NText round-trip incl. unicode [connectors: only:sqlserver]
- [ ] `writes::sql_server::native_date_types` — SQL Server Date/Time/DateTime/DateTime2/DateTimeOffset/SmallDateTime round-trip [connectors: only:sqlserver]
- [ ] `writes::sql_server::native_binary_types` — SQL Server Binary/VarBinary/Image native types round-trip [connectors: only:sqlserver]
- [ ] `writes::sql_server::other_native_types` — SQL Server Xml and UniqueIdentifier native types round-trip [connectors: only:sqlserver]
- [ ] `writes::sql_server::fixed_size_char_native_type` — fixed-size Char id returns padded strings and relation comparison works [connectors: only:sqlserver]
- [ ] `writes::sql_server::fixed_size_n_char_native_type` — fixed-size NChar id returns padded strings and relation comparison works [connectors: only:sqlserver]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/data_types/scalar_list/base.rs
- [ ] `writes::basic_types::set_base` — create scalar lists of all base types via set: notation round-trips [connectors: caps:scalarlists]
- [ ] `writes::basic_types::behave_like_regular_val_for_create_and_update` — scalar lists behave like regular values across create, set-update, and push (single and array) [connectors: caps:scalarlists; exclude:cockroachdb]
- [ ] `writes::basic_types::create_mut_work_with_list_vals` — create returns list values using shorthand (non-set) notation [connectors: caps:scalarlists]
- [ ] `writes::basic_types::create_mut_return_items_with_empty_lists` — create returns items with empty list values [connectors: caps:scalarlists]
- [ ] `writes::basic_types::create_mut_empty_scalar_should_fail` — create with empty scalar-list input object returns error 2009 [connectors: caps:scalarlists]
- [ ] `writes::basic_types::update_mut_empty_scalar_should_fail` — update with empty scalar-list input object returns error 2009 [connectors: caps:scalarlists]
- [ ] `writes::basic_types::update_mut_push_empty_enum_array` — push single and array enum values onto empty enum lists [connectors: caps:scalarlists; exclude:cockroachdb]
- [ ] `writes::basic_types::update_mut_push_empty_scalar_list` — push single and array values onto empty scalar lists [connectors: caps:scalarlists]
- [ ] `writes::basic_types::cockroachdb_doesnot_support_enum_push` — CockroachDB enum push returns error 2009 [connectors: caps:scalarlists; only:cockroachdb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/data_types/scalar_list/decimal.rs
- [ ] `writes::decimal::behave_like_regular_val_for_create_and_update` — Decimal lists behave like regular values across create, set-update, and push [connectors: caps:scalarlists,decimaltype; exclude:cockroachdb]
- [ ] `writes::decimal::create_mut_work_with_list_vals` — create returns Decimal list values using shorthand notation [connectors: caps:scalarlists,decimaltype]
- [ ] `writes::decimal::create_mut_return_items_with_empty_lists` — create returns items with empty Decimal list [connectors: caps:scalarlists,decimaltype]
- [ ] `writes::decimal::update_mut_push_empty_scalar_list` — push single and array Decimal values onto empty lists [connectors: caps:scalarlists,decimaltype; exclude:cockroachdb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/data_types/scalar_list/defaults.rs
- [ ] `writes::basic::basic_write` — scalar-list defaults of all base types applied on create [connectors: caps:scalarlists]
- [ ] `writes::basic::basic_empty_write` — empty-list defaults of all base types applied on create [connectors: caps:scalarlists]
- [ ] `writes::decimal::basic_write` — Decimal-list defaults (string and numeric forms) applied on create [connectors: caps:scalarlists,decimaltype]
- [ ] `writes::decimal::basic_empty_write` — empty Decimal-list default applied on create [connectors: caps:scalarlists,decimaltype]
- [ ] `writes::json::basic_write` — Json-list default applied on create [connectors: caps:scalarlists,json,jsonlists]
- [ ] `writes::json::basic_empty_write` — empty Json-list default applied on create [connectors: caps:scalarlists,json,jsonlists]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/data_types/scalar_list/json.rs
- [ ] `writes::json::behave_like_regular_val_for_create_and_update` — Json lists behave like regular values across create, set-update, and push (with MongoDB divergence) [connectors: caps:scalarlists,json,jsonlists; exclude:cockroachdb]
- [ ] `writes::json::create_mut_work_with_list_vals` — create returns Json list values using shorthand notation [connectors: caps:scalarlists,json,jsonlists]
- [ ] `writes::json::create_mut_return_items_with_empty_lists` — create returns items with empty Json list [connectors: caps:scalarlists,json,jsonlists]
- [ ] `writes::json::update_mut_push_empty_scalar_list` — push single and array Json values onto empty lists (with MongoDB divergence) [connectors: caps:scalarlists,json,jsonlists; exclude:cockroachdb]
- [ ] `writes::json::push_json_protocol` — push Json values via JSON protocol typed-value syntax [connectors: caps:scalarlists,json,jsonlists]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/filters/delete_many_rel_filter.rs
- [ ] `writes::filters::delete_many_rel_filter::delete_items_matching_where_rel_filter` — deleteMany deletes only items matching a `bottom: { is: null }` relation filter [connectors: exclude:sqlserver]
- [ ] `writes::filters::delete_many_rel_filter::delete_all_items_if_filter_empty` — deleteMany with no where deletes all rows [connectors: exclude:sqlserver]
- [ ] `writes::filters::delete_many_rel_filter::works_with_deeply_nested_filters` — deleteMany works with deeply nested relation filters (bottom→veryBottom) [connectors: exclude:sqlserver]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/filters/update_many_rel_filter.rs
- [ ] `writes::filters::update_many_rel_filter::update_items_matching_where_rel_filter` — updateMany updates only items matching a `bottom: { is: null }` relation filter [connectors: exclude:sqlserver]
- [ ] `writes::filters::update_many_rel_filter::update_all_items_if_filter_empty` — updateMany with empty filter updates all items [connectors: exclude:sqlserver]
- [ ] `writes::filters::update_many_rel_filter::works_with_deeply_nested_filters` — updateMany works with deeply nested relation filters [connectors: exclude:sqlserver]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/ids/auto_inc_create.rs
- [ ] `writes::ids::auto_inc_create::non_primary_key_autoinc_idx` — creates Mail with non-PK autoincrement `id` plus a plain `@@index`, expects id/messageId 1 [connectors: caps:autoincrement,autoincrementnonindexedallowed; exclude:cockroachdb]
- [ ] `writes::ids::auto_inc_create::non_primary_key_autoinc_uniq_idx` — creates Mail with non-PK autoincrement `id` marked `@unique`, expects id/messageId 1 [connectors: caps:autoincrement,autoincrementallowedonnonid; exclude:cockroachdb]
- [ ] `writes::ids::auto_inc_create::non_primary_key_autoinc_without_idx` — creates Mail with non-PK autoincrement `id` and no index, expects id/messageId 1 [connectors: caps:autoincrement,autoincrementnonindexedallowed,autoincrementallowedonnonid; exclude:cockroachdb]
- [ ] `writes::ids::auto_inc_create_cockroachdb::non_primary_key_autoinc_idx` — CockroachDB variant using `sequence()` default with `@@index`, expects id/messageId 1 [connectors: only:cockroachdb]
- [ ] `writes::ids::auto_inc_create_cockroachdb::non_primary_key_autoinc_uniq_idx` — CockroachDB variant using `sequence()` default with `@unique`, expects id/messageId 1 [connectors: only:cockroachdb]
- [ ] `writes::ids::auto_inc_create_cockroachdb::non_primary_key_autoinc_without_idx` — CockroachDB variant using `sequence()` default with no index, expects id/messageId 1 [connectors: only:cockroachdb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/ids/byoid.rs
- [ ] `writes::ids::byoid::create_and_return_item_woi_1` — create returns item with user-supplied String id (child-owns-FK schema); duplicate id yields 2002 [connectors: only:mysql,postgres,sqlite,vitess]
- [ ] `writes::ids::byoid::create_and_return_item_woi_2` — same as woi_1 but with parent-owns-FK schema variant; duplicate id yields 2002 [connectors: only:mysql,postgres,sqlite,vitess]
- [ ] `writes::ids::byoid::error_for_invalid_id_2_1` — create with boolean id errors 2009 "Invalid argument type" (schema_1) [connectors: only:mysql,postgres,sqlite,vitess]
- [ ] `writes::ids::byoid::error_for_invalid_id_2_2` — create with boolean id errors 2009 "Invalid argument type" (schema_2) [connectors: only:mysql,postgres,sqlite,vitess]
- [ ] `writes::ids::byoid::nested_create_return_item_woi_1` — nested create returns parent+child with own ids; duplicate child id yields 2002 (schema_1) [connectors: only:mysql,postgres,sqlite,vitess]
- [ ] `writes::ids::byoid::nested_create_return_item_woi_2` — nested create returns parent+child with own ids; duplicate child id yields 2002 (schema_2) [connectors: only:mysql,postgres,sqlite,vitess]
- [ ] `writes::ids::byoid::upsert_should_work_1` — upsert (create branch) with own id returns created parent (schema_1) [connectors: only:mysql,postgres,sqlite,vitess]
- [ ] `writes::ids::byoid::upsert_should_work_2` — upsert (create branch) with own id returns created parent (schema_2) [connectors: only:mysql,postgres,sqlite,vitess]
- [ ] `writes::ids::byoid::nested_upsert_should_work_1` — nested upsert creates child with own id under existing parent (schema_1) [connectors: only:mysql,postgres,sqlite,vitess]
- [ ] `writes::ids::byoid::nested_upsert_should_work_2` — nested upsert creates child with own id under existing parent (schema_2) [connectors: only:mysql,postgres,sqlite,vitess]
- [ ] `writes::ids::byoid::id_field_custom_name_should_work` — create Blog whose id field is custom-named `myId` works [connectors: only:mysql,postgres,sqlite,vitess]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/ids/byoid_mongo.rs
- [ ] `writes::ids::byoi_mongo::create_and_return_item_woi_1` — create returns item with own ObjectId-string id; duplicate id yields 2002 `_id_` (schema_1) [connectors: only:mongodb]
- [ ] `writes::ids::byoi_mongo::create_and_return_item_woi_2` — create returns item with own ObjectId-string id; duplicate id yields 2002 `_id_` (schema_2) [connectors: only:mongodb]
- [ ] `writes::ids::byoi_mongo::error_for_invalid_id_1_1` — create with numeric id 12 errors 2009 "Invalid argument type" (schema_1) [connectors: only:mongodb]
- [ ] `writes::ids::byoi_mongo::error_for_invalid_id_1_2` — create with numeric id 12 errors 2009 "Invalid argument type" (schema_2) [connectors: only:mongodb]
- [ ] `writes::ids::byoi_mongo::error_for_invalid_id_2_1` — create with boolean id errors code 0 "'id' String or Int value expected" (schema_1) [connectors: only:mongodb]
- [ ] `writes::ids::byoi_mongo::nested_create_return_item_woi_1` — nested create returns parent+child with own ids; duplicate child id yields 2002 `_id_` (schema_1) [connectors: only:mongodb]
- [ ] `writes::ids::byoi_mongo::nested_create_return_item_woi_2` — nested create returns parent+child with own ids; duplicate child id yields 2002 `_id_` (schema_2) [connectors: only:mongodb]
- [ ] `writes::ids::byoi_mongo::upsert_should_work_1` — upsert with own id returns parent (schema_1) [connectors: only:mongodb]
- [ ] `writes::ids::byoi_mongo::upsert_should_work_2` — upsert with own id returns parent (schema_2) [connectors: only:mongodb]
- [ ] `writes::ids::byoi_mongo::nested_upsert_should_work_1` — nested upsert creates child with own id under existing parent (schema_1) [connectors: only:mongodb]
- [ ] `writes::ids::byoi_mongo::nested_upsert_should_work_2` — nested upsert creates child with own id under existing parent (schema_2) [connectors: only:mongodb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/ids/int_id_create.rs
- [ ] `writes::ids::int_id_create::create_id_int_without_default` — create Todo supplying Int id (no default) returns given id [connectors: all]
- [ ] `writes::ids::int_id_create::create_id_int_without_default_without_id` — create Todo omitting required Int id (no default) errors 2009 [connectors: all]
- [ ] `writes::ids::int_id_create::create_id_int_static_default` — create Todo with Int id static default 0; supplied id honored, omitted falls to 0 [connectors: all]
- [ ] `writes::ids::int_id_create::create_id_int_with_autoinc` — create Todo with autoincrement Int id, omitting id returns 1 [connectors: caps:autoincrement; exclude:cockroachdb]
- [ ] `writes::ids::int_id_create::create_id_int_autoinc_providing_id` — providing explicit id to autoincrement field via checked input errors 2009 [connectors: caps:autoincrement; exclude:cockroachdb]
- [ ] `writes::ids::int_id_create_cockroachdb::create_id_int_with_autoinc` — CockroachDB BigInt autoincrement id, returned id is a string [connectors: only:cockroachdb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/ids/int_id_update.rs
- [ ] `writes::ids::int_id_update::update_id_int_without_default` — update Todo (Int id, no default) sets title, id unchanged [connectors: all]
- [ ] `writes::ids::int_id_update::update_id_int_static_default` — update Todo (Int id static default) sets title, id unchanged [connectors: all]
- [ ] `writes::ids::int_id_update::update_id_int_autoinc` — update Todo (autoincrement Int id) sets title, id unchanged [connectors: caps:autoincrement; exclude:cockroachdb]
- [ ] `writes::ids::int_id_update::update_id_int_autoinc_cockroachdb` — CockroachDB `sequence()` id, update sets title, id unchanged [connectors: only:cockroachdb]
- [ ] `writes::ids::int_id_update::update_non_uniq_int_field_autoinc` — update a non-unique autoincrement Int counter field via set [connectors: caps:autoincrement,autoincrementnonindexedallowed,writableautoincfield; exclude:cockroachdb]
- [ ] `writes::ids::int_id_update::update_non_uniq_int_field_autoinc_cockroachdb` — CockroachDB non-unique `sequence()` counter field update via set [connectors: only:cockroachdb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/ids/named_compounds.rs
- [ ] `writes::ids::named_compound_uniques::using_named_compounds_works` — create/update using named `@@id` (CompoundId) and named `@@unique` (CompoundUnique) where-inputs [connectors: caps:compoundids]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/ids/nanoid.rs
- [ ] `writes::ids::nanoid::create_base_nanoid_id_should_work` — create Todo with `nanoid()` default id, asserts 21-char id [connectors: all]
- [ ] `writes::ids::nanoid::create_nanoid_id_with_length_should_work` — create Todo with `nanoid(7)` default id, asserts 7-char id [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/ids/relation_pks/compound_pk_rel_field.rs
- [ ] `writes::ids::relation_pks::compound_pk_rel::cpd_1_1_single_field_rel` — full CRUD+nested-mutation coverage over compound `@@id` including a 1!:1 single-field relation [connectors: caps:compoundids]
- [ ] `writes::ids::relation_pks::compound_pk_rel::cpd_1_1_multi_field_rel` — full CRUD+nested coverage over compound `@@id` including a 1!:1 multi-field relation [connectors: caps:compoundids]
- [ ] `writes::ids::relation_pks::compound_pk_rel::cpd_1_m_single_field_rel` — full CRUD+nested coverage (incl. updateMany/deleteMany) over compound `@@id` with 1!:M single-field relation [connectors: caps:compoundids]
- [ ] `writes::ids::relation_pks::compound_pk_rel::cpd_1_m_multi_field_rel` — full CRUD+nested coverage over compound `@@id` with 1!:M multi-field relation [connectors: caps:compoundids]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/ids/relation_pks/single_pk_rel_field.rs
- [ ] `writes::ids::relation_pks::single_pk_rel_field::id_also_1_1_single_field_rel` — full CRUD+nested coverage where the `@id` is itself a 1!:1 single-field relation field [connectors: all]
- [ ] `writes::ids::relation_pks::single_pk_rel_field::id_also_1_1_multi_field_rel` — full CRUD+nested coverage where the compound `@@id` is a 1!:1 multi-field relation [connectors: caps:compoundids]
- [ ] `writes::ids::relation_pks::single_pk_rel_field::id_also_1_m_single_field_rel` — full CRUD+nested coverage where the `@id` is a 1!:M single-field relation field [connectors: all]
- [ ] `writes::ids::relation_pks::single_pk_rel_field::id_also_1_m_multi_field_rel` — full CRUD+nested coverage where the compound `@@id` is a 1!:M multi-field relation [connectors: caps:compoundids]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/ids/required_own_id.rs
- [ ] `writes::ids::required_own_id::create_mut_return_item` — create ScalarModel supplying required own String id returns it [connectors: all]
- [ ] `writes::ids::required_own_id::error_if_required_id_not_provided` — create omitting required id errors 2009 [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/ids/upsert_uuid.rs
- [ ] `writes::ids::upsert_uuid::upsert_id_uuid_should_work` — upsert (create branch) on Todo with `uuid()` id, title returned and id parses as valid UUID [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/ids/uuid_create_graphql.rs
- [ ] `writes::ids::uuid_create_graphql::create_uuid_id_should_work` — create Todo with `uuid()` default, id parses as valid UUID [connectors: all]
- [ ] `writes::ids::uuid_create_graphql::fetch_null_uuid_should_work` — findMany returns null for an optional unique field on a uuid-id model [connectors: all]
- [ ] `writes::ids::uuid_create_graphql::create_uuid_v7_and_retrieve_it_should_work` — create with `uuid(7)`, validates UUIDv7 version and roundtrips via findMany/findUnique [connectors: all]
- [ ] `writes::ids::uuid_create_graphql::create_cuid_v1_and_retrieve_it_should_work` — create with `cuid(1)`, validates CUIDv1 and roundtrips via findMany/findUnique [connectors: all]
- [ ] `writes::ids::uuid_create_graphql::create_cuid_v2_and_retrieve_it_should_work` — create with `cuid(2)`, validates CUIDv2 and roundtrips via findMany/findUnique [connectors: all]
- [ ] `writes::ids::uuid_create_graphql::create_ulid_and_retrieve_it_should_work` — create with `ulid()`, validates 26-char Crockford base32 ULID and roundtrips [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/already_converted/nested_connect_inside_create.rs
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::p1_c1_connect_by_id_already_in_rel` — P1 to C1 with child already in a relation is connectable by id via nested create connect (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::p1_c1_connect_by_id` — P1 to C1 with child without a relation is connectable by id (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::p1_c1_connect_by_id_and_filters` — P1 to C1 with child without a relation is connectable by id and additional filters (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::p1_c1_error_if_filter_dont_match` — P1 to C1 connect errors (2025) when the additional filter does not match the child (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::pm_to_c1_req_connect_by_uniq` — PM to C1! with child already in a relation is connectable by unique (on_parent=ToMany, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::p1_to_c1_req_connect_by_uniq` — P1 to C1! with child already in a relation is connectable by unique (on_parent=ToOneOpt, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::p1_to_c1_req_by_uniq_and_filters` — P1 to C1! with child already in a relation is connectable by unique and filters (on_parent=ToOneOpt, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::pm_to_c1_connect_by_uniq` — PM to C1 connectable by unique, resilient against duplicate connects (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::pm_to_c1_by_uniq_and_filters` — PM to C1 connectable by unique with additional filters, resilient against duplicates (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::pm_to_c1_without_rel_connect_by_uniq` — PM to C1 with child without a relation is connectable by unique (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::pm_to_c1_rel_fail_connect_no_node` — PM to C1 errors (2018) when also connecting to a non-existing node (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::pm_to_c1_rel_fail_filter_dont_match` — PM to C1 connect errors (2018) when additional filter does not match (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::p1_req_to_cm_connect_by_uniq` — P1! to CM with child already in a relation is connectable by unique (on_parent=ToOneReq, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::p1_req_to_cm_no_rel_connect_by_uniq` — P1! to CM with child not already in a relation is connectable by unique (on_parent=ToOneReq, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::p1_to_cm_connect_by_uniq` — P1 to CM with child already in a relation is connectable by unique (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::p1_to_cm_no_rel_connect_by_uniq` — P1 to CM with child not already in a relation is connectable by unique (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::pm_to_cm_connect_by_uniq` — PM to CM with children already in a relation is connectable by unique (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::pm_to_cm_no_rel_connect_by_uniq` — PM to CM with child not already in a relation is connectable by unique (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::pm_to_cm_rel_fail_filter_dont_match` — PM to CM connect errors (2025) when additional filter does not match (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::pm_to_c1_fail_if_wrong_id` — PM to C1 throws error (2018) if connected by a wrong id [connectors: exclude:cockroachdb]
- [ ] `writes::nested_mutations::already_converted::connect_inside_create::p1_to_cm_fail_if_wrong_id_other_side` — P1 to CM throws error (2025) if connected by a wrong id the other way around [connectors: exclude:cockroachdb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/already_converted/nested_connect_inside_update.rs
- [ ] `writes::nested_mutations::already_converted::connect_inside_update::p1_c1_child_in_rel_connect_mut` — P1 to C1 with child already in a relation is connectable through nested update, leaving other relations intact (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb,sqlserver] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_update::p1_c1_wo_parent_connect_mut` — P1 to C1 with child and parent without a relation is connectable through nested update (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_update::p1_c1_child_wo_rel_connect_mut` — P1 to C1 with child without a relation is connectable through nested update (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb,sqlserver] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_update::p1_c1_parnt_wo_rel_connect_mut` — P1 to C1 with parent without a relation is connectable through nested update (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb,sqlserver] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_update::pm_cm_rel_connect_twice_error` — PM to CM connecting two nodes twice does not error (idempotent) (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_update::pm_c1req_child_in_rel_connect` — PM to C1! with child already in a relation is connectable through nested update, preserving prior data (on_parent=ToMany, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_update::p1_c1req_rel_child_parnt_error` — P1 to C1! with child and parent already in a relation errors (2014, required relation violation) (on_parent=ToOneOpt, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_update::p1_c1_rel_child_idempotent` — P1 to C1 connecting to the same record it is already connected to does not error (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_update::p1_c1req_rel_child_idempotent` — P1 to C1! connecting to the same record it is already connected to does not error (on_parent=ToOneOpt, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_update::p1_c1req_child_in_rel_no_error` — P1 to C1! with child already in a relation does not error when switching to a different parent (on_parent=ToOneOpt, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_update::pm_c1_child_in_rel_connect_mut` — PM to C1 with child already in a relation is connectable through nested update, moving the child from its prior parent (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_update::pm_c1_child_wo_rel_connect_mut` — PM to C1 with child without a relation is connectable through nested update (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_update::p1req_cm_child_inrel_connect` — P1! to CM with child already in a relation is connectable through nested update, keeping both parents (on_parent=ToOneReq, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_update::p1req_cm_child_norel_connect` — P1! to CM with child not already in a relation is connectable through nested update (on_parent=ToOneReq, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_update::p1_cm_child_in_rel_connect_mut` — P1 to CM with child already in a relation is connectable through nested update (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_update::p1_cm_child_norel_connect_mut` — P1 to CM with child not already in a relation is connectable through nested update (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_update::pm_cm_child_inrel_connect_mut` — PM to CM with children already in a relation is connectable through nested update, accumulating all parents (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_update::pm_cm_child_norel_connect_mut` — PM to CM with child not already in a relation is connectable through nested update (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::connect_inside_update::p1_c1_child_compound_unique` — regression (prisma/prisma#18173): connect a child by compound unique on nested update (on_parent P1 to C1) [connectors: exclude:cockroachdb,mongodb,sqlserver]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/already_converted/nested_create_inside_create.rs
- [ ] `writes::nested_mutations::already_converted::create_inside_create::p1_c1` — P1 to C1 nested create inside create works (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::create_inside_create::pm_c1_req` — PM to C1! nested create of multiple children inside create works (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::create_inside_create::p1_c1_req` — P1 to C1! nested create inside create works (on_parent=ToOneOpt, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::create_inside_create::pm_c1` — PM to C1 nested create of multiple children inside create works (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::create_inside_create::p1_req_cm` — P1! to CM nested create inside create works (on_parent=ToOneReq, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::create_inside_create::p1_cm` — P1 to CM nested create inside create works and is traversable in the opposite direction (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::create_inside_create::pm_cm` — PM to CM nested create of multiple children inside create works (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/already_converted/nested_create_inside_update.rs
- [ ] `writes::nested_mutations::already_converted::create_inside_update::p1_c1` — P1! to C1 nested create inside update works (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::create_inside_update::p1_c1_parent_wo_rel` — P1 to C1 with parent without a relation, nested create inside update works (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::create_inside_update::pm_c1_req_child_in_rel` — PM to C1! with a child already in a relation, nested create inside update adds another child (on_parent=ToMany, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::create_inside_update::p1_c1_req_par_child_in_rel_fail` — P1 to C1! with parent and child already in a relation errors (2014, required relation violation) (on_parent=ToOneOpt, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::create_inside_update::p1_c1_req_par_not_in_rel` — P1 to C1! with parent not already in a relation, nested create inside update works (on_parent=ToOneOpt, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::create_inside_update::pm_c1_parent_in_rel` — PM to C1 with parent already in a relation, nested create inside update adds a child (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::create_inside_update::p1_req_cm_parent_in_rel` — P1! to CM with parent already in a relation, nested create inside update replaces the required child (on_parent=ToOneReq, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::create_inside_update::p1_cm_child_in_rel` — P1 to CM with child already in a relation, nested create inside update replaces the child and detaches the old one (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::create_inside_update::pm_cm_child_in_rel_disconnect` — PM to CM with children already in a relation, nested create inside update adds a child (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/already_converted/nested_delete_inside_update.rs
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::p1_c1_mut_by_id` — P1 to C1 nested delete inside update by id works and leaves other parent's child intact (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::p1_c1_mut_by_id_and_filters` — P1 to C1 nested delete inside update by id and additional filters works (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::p1_c1_error_if_not_connected` — P1 to C1 nested delete errors (2025) if the nodes are not connected (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::p1_c1_error_if_filter_not_match` — P1 to C1 nested delete errors (2025) if connected but additional filters do not match (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::pm_c1_req_by_id_should_work` — PM to C1! nested delete inside update by id works (on_parent=ToMany, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::pm_c1_req_by_id_and_fiters_should_work` — PM to C1! nested delete by id and additional filters works (on_parent=ToMany, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::pm_c1_req_error_if_filter_not_match` — PM to C1! nested delete errors (2017) if connected but additional filters do not match (on_parent=ToMany, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::p1_c1_req_by_id_should_work` — P1 to C1! nested delete inside update by id works (on_parent=ToOneOpt, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::p1_c1_req_by_filters_should_work` — P1 to C1! nested delete by additional filters works (on_parent=ToOneOpt, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::p1_c1_req_error_if_filter_not_match` — P1 to C1! nested delete errors (2025) if connected but additional filters do not match (on_parent=ToOneOpt, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::pm_c1_by_id_should_work` — PM to C1 nested delete inside update by id works (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::pm_c1_by_id_and_filter_should_work` — PM to C1 nested delete by id and additional filter works (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::pm_c1_error_if_filter_not_match` — PM to C1 nested delete errors (2017) if connected but additional filters do not match (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::p1_req_cm_should_error` — P1! to CM nested delete errors (2009, field does not exist) since delete is not offered on a required side (on_parent=ToOneReq, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::p1_cm_by_id_should_work` — P1 to CM nested delete inside update by id works and removes the child (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb,sqlserver] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::p1_cm_by_id_and_filters_should_work` — P1 to CM nested delete by id and additional filters works (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb,sqlserver] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::p1_cm_error_if_not_connected` — P1 to CM nested delete errors (2025) if nodes are not connected (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb,sqlserver] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::p1_cm_error_if_filter_not_match` — P1 to CM nested delete errors (2025) if connected but additional filters do not match (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb,sqlserver] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::pm_cm_by_id_should_work` — PM to CM nested delete errors (2017) for a non-connected child, then works for a connected one (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::pm_cm_by_id_and_filters_should_work` — PM to CM nested delete by id and filters: errors (2017) for unconnected or non-matching filter, works when connected and filter matches (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::pm_cm_error_invalid_child` — PM to CM nested delete errors (2017) on an invalid (non-connected) child in the list (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_update::pm_cm_work_correct_children` — PM to CM nested delete works for correct connected children, leaving other parent's children intact (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/already_converted/nested_delete_inside_upsert.rs
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::p1_c1_should_work` — P1 to C1 nested delete inside upsert (update branch) by id works (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb,mongodb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::p1_c1_by_filters_should_work` — P1 to C1 nested delete inside upsert by additional filters works (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb,mongodb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::p1_c1_error_if_not_connected` — P1 to C1 nested delete inside upsert errors (2025) if the nodes are not connected (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::p1_c1_error_if_filter_dont_match` — P1 to C1 nested delete inside upsert errors (2025) if additional filters do not match (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::pm_c1_req_should_work` — PM to C1! nested delete inside upsert works (on_parent=ToMany, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::pm_c1_req_by_id_and_filter_should_work` — PM to C1! nested delete inside upsert by id and additional filter works (on_parent=ToMany, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::pm_c1_req_error_if_not_connected` — PM to C1! nested delete inside upsert errors (2017) if nodes are not connected (on_parent=ToMany, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::pm_c1_req_error_if_filters_dont_match` — PM to C1! nested delete inside upsert errors (2017) if filters do not match a connected node (on_parent=ToMany, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::p1_c1_req_should_work` — P1 to C1! nested delete inside upsert works (on_parent=ToOneOpt, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::p1_c1_req_by_filters_should_work` — P1 to C1! nested delete inside upsert by additional filters works (on_parent=ToOneOpt, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::p1_c1_req_error_if_not_connected` — P1 to C1! nested delete inside upsert errors (2025) if nodes are not connected (on_parent=ToOneOpt, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::p1_c1_req_error_if_filter_dont_match` — P1 to C1! nested delete inside upsert errors (2025) if additional filters do not match (on_parent=ToOneOpt, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::pm_c1_should_work` — PM to C1 nested delete inside upsert works (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::pm_c1_by_id_and_filter_should_work` — PM to C1 nested delete inside upsert by id and additional filter works (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::pm_c1_error_if_not_connected` — PM to C1 nested delete inside upsert errors (2017) if nodes are not connected (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::pm_c1_error_if_filters_dont_match` — PM to C1 nested delete inside upsert errors (2017) if filters do not match a connected node (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::p1_req_cm_should_error` — P1! to CM nested delete inside upsert errors (2009, field does not exist) on the required side (on_parent=ToOneReq, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::p1_req_cm_by_filter_should_error` — P1! to CM nested delete inside upsert by filter errors (2009, field does not exist) (on_parent=ToOneReq, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::p1_cm_should_work` — P1 to CM nested delete inside upsert works and removes the child (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::p1_cm_by_id_and_filters_should_work` — P1 to CM nested delete inside upsert by id and additional filters works (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::pm_cm_should_work` — PM to CM nested delete inside upsert removes both children (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::pm_cm_by_id_and_filters_should_work` — PM to CM nested delete inside upsert by id and additional filters removes both children (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::pm_cm_error_if_not_connected` — PM to CM nested delete inside upsert errors (2017) if nodes are not connected (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_inside_upsert::pm_cm_error_if_filters_dont_match` — PM to CM nested delete inside upsert errors (2017) if filters do not match a connected node (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/already_converted/nested_delete_many_inside_update.rs
- [ ] `writes::nested_mutations::already_converted::delete_many_inside_update::o2n_rel_fail` — a 1-n relation (on_parent=ToOneOpt, on_child=ToOneOpt) errors when using nested deleteMany, expecting error 2009 "Field does not exist in enclosing type." [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_many_inside_update::pm_c1_req` — a PM to C1! relation (on_parent=ToMany, on_child=ToOneReq) deleteMany with contains filter works, removing matched children [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_many_inside_update::pm_cm_should_work` — a PM to CM relation (on_parent=ToMany, on_child=ToMany) deleteMany with contains filter works [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_many_inside_update::pm_c1_req_many_delete_manys` — a PM to C1! relation (on_parent=ToMany, on_child=ToOneReq) works with several deleteManys in one update [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_many_inside_update::pm_c1_req_work_empty_filter` — a PM to C1! relation (on_parent=ToMany, on_child=ToOneReq) deleteMany with empty filter deletes all children [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::delete_many_inside_update::pm_c1_req_no_change_if_no_hit` — a PM to C1! relation (on_parent=ToMany, on_child=ToOneReq) deleteMany changes nothing when no filter hits [connectors: exclude:cockroachdb] [matrix: relation_link]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/already_converted/nested_disconnect_inside_update.rs
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_update::p1_c1_by_id_should_work` — a P1 to C1 relation (on_parent=ToOneOpt, on_child=ToOneOpt) child disconnectable via nested mutation by id, childOpt becomes null [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_update::p1_c1_by_filters_should_work` — a P1 to C1 relation (on_parent=ToOneOpt, on_child=ToOneOpt) child disconnectable via a matching filter [connectors: exclude:cockroachdb; caps:filteredinlinechildnestedtoonedisconnect] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_update::p1_c1_by_fails_if_filters_no_match` — a P1 to C1 relation (on_parent=ToOneOpt, on_child=ToOneOpt) disconnect is noop when filter does not match, child stays connected [connectors: exclude:cockroachdb; caps:filteredinlinechildnestedtoonedisconnect] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_update::p1_c1_child_wo_rel` — a P1 to C1 relation with child and parent without a relation (on_parent=ToOneOpt, on_child=ToOneOpt), disconnect is a noop [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_update::p1_c1_req_child_par_inrel_error` — a P1 to C1! relation with child and parent in relation (on_parent=ToOneOpt, on_child=ToOneReq), disconnect errors 2014 required relation violation [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_update::pm_c1_child_inrel` — a PM to C1 relation with child in relation (on_parent=ToMany, on_child=ToOneOpt), disconnectable by unique [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_update::pm_c1_child_inrel_with_filters` — a PM to C1 relation with child in relation (on_parent=ToMany, on_child=ToOneOpt), disconnect works when filters match and silently fails when they don't [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_update::p1_cm_child_inrel` — a P1 to CM relation with child in relation (on_parent=ToOneOpt, on_child=ToMany), disconnectable by unique [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_update::pm_cm_child_inrel` — a PM to CM relation with children in relation (on_parent=ToMany, on_child=ToMany), disconnect by unique (incl. empty-list noop and multi-child disconnect) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_update::pm_cm_child_inrel_2` — a PM to CM relation with children in relation (on_parent=ToMany, on_child=ToMany), disconnectable by unique variant 2 [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_update::pm_cm_child_inrel_3` — a PM to CM relation with children in relation (on_parent=ToMany, on_child=ToMany), disconnectable by unique variant 3, verifying remaining parent links [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_update::fks_should_be_resolved` — disconnecting a to-one relation updates the foreign key (parentId) in the result, and updating parent's referenced key propagates [connectors: exclude:cockroachdb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/already_converted/nested_disconnect_inside_upsert.rs
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_upsert::p1_c1_by_id_should_work` — a P1 to C1 relation (on_parent=ToOneOpt, on_child=ToOneOpt) child disconnectable via nested disconnect in upsert update branch [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_upsert::p1_c1_by_filters_should_work` — a P1 to C1 relation (on_parent=ToOneOpt, on_child=ToOneOpt) disconnectable via matching filter in upsert [connectors: exclude:cockroachdb; caps:filteredinlinechildnestedtoonedisconnect] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_upsert::p1_c1_by_fails_if_filter_no_match` — a P1 to C1 relation (on_parent=ToOneOpt, on_child=ToOneOpt) disconnect noop when filter no match in upsert; excludes MongoDb (no joins on top-level updates) [connectors: exclude:cockroachdb,mongodb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_upsert::p1_c1_child_parnt_wo_rel` — a P1 to C1 relation with child and parent without a relation (on_parent=ToOneOpt, on_child=ToOneOpt), disconnect in upsert is a noop [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_upsert::pm_c1_req_child_inrel_noop` — a PM to C1! relation with child in relation (on_parent=ToMany, on_child=ToOneReq), disconnect in upsert errors 2014 required relation violation [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_upsert::p1_c1_req_child_parnt_inrel_error` — a P1 to C1! relation with child and parent in relation (on_parent=ToOneOpt, on_child=ToOneReq), disconnect in upsert errors 2014 required relation violation [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_upsert::pm_c1_child_inrel` — a PM to C1 relation with child in relation (on_parent=ToMany, on_child=ToOneOpt), disconnectable by unique in upsert [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_upsert::p1_cm_child_inrel` — a P1 to CM relation with child in relation (on_parent=ToOneOpt, on_child=ToMany), disconnectable by unique in upsert [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::disconnect_inside_upsert::pm_cm_child_inrel` — a PM to CM relation with children in relation (on_parent=ToMany, on_child=ToMany), disconnectable by unique in upsert [connectors: exclude:cockroachdb] [matrix: relation_link]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/already_converted/nested_set_inside_update.rs
- [ ] `writes::nested_mutations::already_converted::set_inside_update::pm_c1_child_inrel` — a PM to C1 relation with child in relation (on_parent=ToMany, on_child=ToOneOpt), setable by unique (dedupes duplicates) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::set_inside_update::pm_c1_child_inrel_with_filters` — a PM to C1 relation with child in relation (on_parent=ToMany, on_child=ToOneOpt), setable by unique with additional filters [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::set_inside_update::pm_c1_child_inrel_fails_if_no_match` — a PM to C1 relation (on_parent=ToMany, on_child=ToOneOpt), set silently sets empty when filter does not match [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::set_inside_update::pm_c1_child_wo_rel` — a PM to C1 relation with child without a relation (on_parent=ToMany, on_child=ToOneOpt), setable by unique [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::set_inside_update::pm_cm_child_inrel` — a PM to CM relation with children in relation (on_parent=ToMany, on_child=ToMany), setable by unique, moving children between parents [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::set_inside_update::pm_cm_child_notinrel` — a PM to CM relation with child not in a relation (on_parent=ToMany, on_child=ToMany), setable by unique [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::set_inside_update::pm_cm_child_inrel_set_empty` — a PM to CM relation with children in relation (on_parent=ToMany, on_child=ToMany), setable to empty list [connectors: exclude:cockroachdb] [matrix: relation_link]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/already_converted/nested_update_many_inside_update.rs
- [ ] `writes::nested_mutations::already_converted::um_inside_update::one2n_rel_error_nested_um` — a 1-n relation (on_parent=ToOneOpt, on_child=ToOneOpt) errors when using nested updateMany, expecting error 2009 "Field does not exist in enclosing type." [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::um_inside_update::pm_c1_req_should_work` — a PM to C1! relation (on_parent=ToMany, on_child=ToOneReq) updateMany with contains filter sets non_unique on matched children [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::um_inside_update::pm_c1_should_work` — a PM to C1 relation (on_parent=ToMany, on_child=ToOneOpt) updateMany with contains filter works [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::um_inside_update::pm_cm_should_work` — a PM to CM relation (on_parent=ToMany, on_child=ToMany) updateMany with contains filter works [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::um_inside_update::pm_c1_req_many_ums` — a PM to C1! relation (on_parent=ToMany, on_child=ToOneReq) works with several updateManys in one update [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::um_inside_update::pm_c1_req_empty_filter` — a PM to C1! relation (on_parent=ToMany, on_child=ToOneReq) updateMany with empty filter updates all children [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::um_inside_update::pm_c1_req_noop_no_hit` — a PM to C1! relation (on_parent=ToMany, on_child=ToOneReq) updateMany changes nothing when no filter hits [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::um_inside_update::pm_c1_req_many_filters` — a PM to C1! relation (on_parent=ToMany, on_child=ToOneReq) works when multiple overlapping filters hit, last write wins per child [connectors: exclude:cockroachdb] [matrix: relation_link]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/already_converted/nested_upsert_inside_update.rs
- [ ] `writes::nested_mutations::already_converted::upsert_inside_update::pm_c1req_child_in_req` — a PM to C1! relation with child in relation (on_parent=ToMany, on_child=ToOneReq), nested upsert updates existing matched child [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::upsert_inside_update::pm_c1_parnt_in_rel_create` — a PM to C1 relation with parent in relation (on_parent=ToMany, on_child=ToOneOpt), nested upsert creates child when where does not match [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::upsert_inside_update::pm_c1_parnt_in_rel_update` — a PM to C1 relation with parent in relation (on_parent=ToMany, on_child=ToOneOpt), nested upsert updates child when where matches [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::upsert_inside_update::pm_cm_child_inrel_update` — a PM to CM relation with children in relation (on_parent=ToMany, on_child=ToMany), nested upsert updates matched child by unique [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::already_converted::upsert_inside_update::pm_cm_child_inrel_create` — a PM to CM relation with children in relation (on_parent=ToMany, on_child=ToMany), nested upsert creates child when where does not exist [connectors: exclude:cockroachdb] [matrix: relation_link]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/combining_different_nested_mutations.rs
- [ ] `writes::nested_mutations::many_nested_muts::create_then_update` — nested create followed by nested update on children works (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::many_nested_muts::create_then_delete` — nested create combined with update/delete of children works (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::many_nested_muts::create_then_set` — nested create followed by set replaces child list (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::many_nested_muts::create_then_upsert` — nested create followed by upsert (update + create branches) works (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::many_nested_muts::create_then_disconnect` — nested create followed by disconnect detaches child (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/nested_atomic_number_ops.rs
- [ ] `writes::nested_mutations::atomic_number_ops::update_number_ops_on_child` — updateOne with number ops on top and nested child update handles id changes (inlined child) [connectors: caps:updateableid]
- [ ] `writes::nested_mutations::atomic_number_ops::update_number_ops_on_parent` — updateOne with number ops on top and nested child update handles id changes (inlined parent) [connectors: caps:updateableid]
- [ ] `writes::nested_mutations::atomic_number_ops::nested_update_int_ops` — nested updateOne applies all Int number ops (increment/decrement/multiply/divide/set/set null) [connectors: exclude:cockroachdb]
- [ ] `writes::nested_mutations::atomic_number_ops::nested_update_int_ops_cockroach` — nested Int number ops on CockroachDB (no divide operator) [connectors: only:cockroachdb]
- [ ] `writes::nested_mutations::atomic_number_ops::nested_update_float_ops` — nested updateOne applies all Float number ops [connectors: exclude:mongodb]
- [ ] `writes::nested_mutations::atomic_number_ops::nested_update_float_ops_mongo` — nested Float number ops on MongoDB [connectors: only:mongodb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/not_using_schema_base/nested_connect_inside_upsert.rs
- [ ] `writes::nested_mutations::connect_inside_upsert::p1_cm_upsert_in_create` — P1-to-CM relation connectable by id within upsert create case [connectors: all]
- [ ] `writes::nested_mutations::connect_inside_upsert::p1_cm_upsert_in_update` — P1-to-CM relation connectable by id within upsert update case [connectors: all]
- [ ] `writes::nested_mutations::connect_inside_upsert::p1_cm_uniq_upsert_update` — P1-to-CM relation connectable by unique field within upsert update case [connectors: all]
- [ ] `writes::nested_mutations::connect_inside_upsert::one2m_fail_upsert_update` — one-to-many connect by unique in upsert update throws error 2025 for missing record [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/not_using_schema_base/nested_connect_or_create.rs
- [ ] `writes::nested_mutations::connect_or_create::m2n_connect_or_create` — m:n relation connectOrCreate works for new and existing records [connectors: all]
- [ ] `writes::nested_mutations::connect_or_create::one_req_2m_connect_or_create` — 1!:m relation connectOrCreate works inlined in parent and child [connectors: all]
- [ ] `writes::nested_mutations::connect_or_create::one2m_connect_or_create` — 1:m relation connectOrCreate works inlined in parent and child [connectors: all]
- [ ] `writes::nested_mutations::connect_or_create::query_reordering_works` — query reordering does not break connectOrCreate (compound id regression) [connectors: caps:compoundids]
- [ ] `writes::nested_mutations::connect_or_create::one2one_update_if_no_child_connected_yet` — 1:1 update connectOrCreate when no child connected yet (issue 16090) [connectors: all]
- [ ] `writes::nested_mutations::connect_or_create::one2one_upsert_if_no_child_connected_yet` — 1:1 upsert connectOrCreate when no child connected yet (issue 16090) [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/not_using_schema_base/nested_create_many.rs
- [ ] `writes::nested_mutations::nested_create_many::create_many_on_create` — basic nested createMany on top-level create works [connectors: all]
- [ ] `writes::nested_mutations::nested_create_many::create_many_shorthand_on_create` — nested createMany shorthand (single object data) on create works [connectors: all]
- [ ] `writes::nested_mutations::nested_create_many::nested_createmany_fail_dups` — nested createMany errors on duplicates by default (2002) [connectors: exclude:mongodb]
- [x] `writes::nested_mutations::nested_create_many::no_error_on_dups_when_skip_dups` — nested createMany with skipDuplicates true ignores duplicates [connectors: exclude:sqlite,sqlserver,mongodb] → non-ported `test/integration/test/ports/engines/non-ported.md`
- [ ] `writes::nested_mutations::nested_create_many::allow_create_large_number_records` — nested createMany allows creating 1000 records (horizontal partitioning/batching) [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/nested_mutations/not_using_schema_base/nested_update_inside_update.rs
- [ ] `writes::nested_mutations::update_inside_update::p1_cm_should_work` — P1-to-CM nested update of child works (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::update_inside_update::p1_cm_by_id_and_filters_should_work` — P1-to-CM nested update by id plus additional filters works (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::update_inside_update::p1_cm_error_if_not_connected` — P1-to-CM nested update errors (2025) if nodes not connected (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::update_inside_update::p1_cm_error_if_filter_not_match` — P1-to-CM nested update errors if connected but filters don't match (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::update_inside_update::pm_c1_should_work` — PM-to-C1 nested update of child works (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::update_inside_update::pm_c1_by_id_and_filters_should_work` — PM-to-C1 nested update by id plus filters works (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::update_inside_update::pm_c1_error_if_not_connected` — PM-to-C1 nested update errors (2025) if nodes not connected (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::update_inside_update::pm_c1_error_if_filter_not_match` — PM-to-C1 nested update errors if connected but filters don't match (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::update_inside_update::pm_cm_should_work` — PM-to-CM nested update of child works (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::update_inside_update::pm_cm_by_id_and_filters_should_work` — PM-to-CM nested update by id plus filters works (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::update_inside_update::pm_cm_error_if_not_connected` — PM-to-CM nested update errors (2025) if nodes not connected (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::update_inside_update::pm_cm_error_if_filter_not_match` — PM-to-CM nested update errors if connected but filters don't match (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::nested_mutations::update_inside_update::tx_m2m_fail_wrong_where` — transactional m:n update fails gracefully on wrong where and does not partially execute [connectors: exclude:cockroachdb,sqlite]
- [ ] `writes::nested_mutations::update_inside_update::no_tx_m2m_fail_gracefully` — non-transactional m:n update fails gracefully on wrong where [connectors: exclude:cockroachdb]
- [ ] `writes::nested_mutations::update_inside_update::m2m_reject_null_in_uniq` — m:n nested update rejects null in unique where fields (2009) [connectors: exclude:cockroachdb]
- [ ] `writes::nested_mutations::update_inside_update::deep_nested_mutation_exec_all_muts` — deeply nested update executes all levels when only node edges on path [connectors: exclude:cockroachdb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/regressions/graph_reorder_regression.rs
- [ ] `writes::graph_reorder::test` — 1:1 relation check does not null out a newly created nested item when updating Visit with nested payment create + company connect (issue 3081) [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/regressions/if_node_siblig_dep_regression.rs
- [ ] `writes::if_node_sibling::test` — if-node sibling reordering includes all non-if siblings so a create with connect + connectOrCreate branches succeeds (issue 4230) [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/regressions/prisma_11731.rs
- [ ] `writes::connect_or_create::one2one_inlined_child` — connectOrCreate on 1:1 (inlined child) does not create a duplicate when connecting an existing ID (issue 11731) [connectors: all]
- [ ] `writes::connect_or_create::one2one_inlined_parent` — connectOrCreate on 1:1 (inlined parent) does not create a duplicate when connecting an existing ID [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/regressions/prisma_12105.rs
- [ ] `writes::validate::check` — createOnePost with empty data returns null mapped authorId (`@map("author")`) without error (issue 12105) [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/relations/compound_fks_mixed_requiredness.rs
- [ ] `writes::compound_fks::one2m_mix_required_writable_readable` — 1:M relation with mixed-requiredness compound FK is writable/readable; asserts null-constraint (2011) and FK (2003) violations [connectors: exclude:mysql(5.6),mongodb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/relations/deeply_nested_self_rel.rs
- [ ] `writes::deep_nested_rel::deep_nested_create_should_work` — deeply nested self-relation create (A→B→C children) executes completely [connectors: exclude:sqlserver]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/relations/optional_rel.rs
- [ ] `writes::opt_rel::update_opt_rel_with_null_should_fail` — updating an optional relation with `todo: null` returns error 2009 [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/relations/rel_defaults.rs
- [ ] `writes::rel_defaults::no_val_for_required_relation` — omitting a required relation field with a default value works [connectors: all]
- [ ] `writes::rel_defaults::no_val_required_rel_one_default_val` — omitting a required multi-field relation with only one field defaulted fails with 2009 [connectors: caps:compoundids]
- [ ] `writes::rel_defaults::no_val_required_rel_multiple_fields` — omitting one defaulted field in a required multi-field relation works [connectors: caps:compoundids]
- [ ] `writes::rel_defaults::no_val_required_rel_default_vals` — omitting required relation fields that all have defaults works [connectors: caps:compoundids]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/relations/rel_design.rs
- [ ] `writes::rel_design::delete_parent_model` — deleting a parent (List) node removes it from the relation [connectors: all]
- [ ] `writes::rel_design::delete_child_node` — deleting a child (Todo) node removes it from the relation [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/relations/rel_graphql.rs
- [ ] `writes::rel_graphql::one2one_rel_allow_one_item_per_side` — 1:1 relation allows only one item per side; connecting a new owner moves the cat off the old owner [connectors: exclude:sqlserver]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/relations/rel_names.rs
- [ ] `writes::rel_names::relation_names_are_resolved_correctly_in_create` — named relation resolves correctly so nested create writes child_b not child_a (issue 14696) [connectors: exclude:mongodb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/relations/required_rel.rs
- [ ] `writes::required_rel::update_with_null` — updating a required relation with `todo: null` returns error 2009 [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/relations/same_model_self_rel_without_back_rel.rs
- [ ] `writes::self_rel_no_back_rel::m2m_self_rel` — M:N self relation accessible from only one side (connect + read) [connectors: all]
- [ ] `writes::self_rel_no_back_rel::one2one_self_rel` — 1:1 self relation accessible from only one side [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/top_level_mutations/create.rs
- [ ] `writes::top_level_mutations::create::create_should_work` — creates ScalarModel with all scalar/enum/datetime fields set and asserts create + findMany return them (retries for CockroachDB flakiness) [connectors: caps:enums]
- [ ] `writes::top_level_mutations::create::return_item_empty_str` — creates item with empty-string optString, other opt fields null [connectors: caps:enums]
- [ ] `writes::top_level_mutations::create::return_item_explicit_null_attrs` — creates item with all optional attrs explicitly null [connectors: exclude:cockroachdb; caps:enums]
- [ ] `writes::top_level_mutations::create::return_item_implicit_null_attr` — creates item with only id; implicit nulls and createdAt default set (no null-constraint violation) [connectors: caps:enums]
- [ ] `writes::top_level_mutations::create::return_item_non_null_attrs_then_explicit_null_attrs` — creates non-null item then a second item with explicit nulls [connectors: exclude:cockroachdb; caps:enums]
- [ ] `writes::top_level_mutations::create::fail_when_datetime_invalid` — errors (2009) on invalid DateTime input [connectors: caps:enums]
- [ ] `writes::top_level_mutations::create::fail_when_int_invalid` — errors (2009) when an Int field gets a non-int value [connectors: caps:enums]
- [ ] `writes::top_level_mutations::create::gracefully_fails_when_uniq_violation` — second create with duplicate optUnique fails with 2002 [connectors: exclude:mongodb; caps:enums]
- [ ] `writes::top_level_mutations::create::return_enums_passed_as_strings` — accepts enum value passed as string "A" [connectors: exclude:cockroachdb; caps:enums]
- [ ] `writes::top_level_mutations::create::fail_if_string_dont_match_enum_val` — errors (2009) when string enum value isn't a valid variant [connectors: caps:enums]
- [ ] `writes::top_level_mutations::create::reject_opt_rel_set_to_null` — errors (2009) when an optional relation is set to null [connectors: caps:enums]
- [ ] `writes::top_level_mutations::create::create_with_opt_rel_omitted` — creates with optional relation omitted, relId null [connectors: caps:enums]
- [ ] `writes::top_level_mutations::create::create_with_datetime_ident` — creates a model whose id is a DateTime [connectors: caps:enums]
- [ ] `writes::top_level_mutations::json_create::create_json` — creates JSON field with object/"null" string/null/omitted values (Mongo behavior) [connectors: only:mongodb; exclude:mysql(5.6); caps:json]
- [ ] `writes::top_level_mutations::json_create::create_json_adv` — creates JSON with JsonNull vs DbNull vs omitted, advanced nullability [connectors: exclude:mysql(5.6); caps:json,advancedjsonnullability]
- [ ] `writes::top_level_mutations::json_create::create_json_errors` — errors (2009) when JSON field given AnyNull [connectors: exclude:mysql(5.6); caps:json,advancedjsonnullability]
- [ ] `writes::top_level_mutations::mapped_create::mapped_name_with_space_does_not_break_returning` — creates across models with @map names containing spaces, returning works [connectors: exclude:mongodb,cockroachdb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/top_level_mutations/create_list.rs
- [ ] `writes::top_level_mutations::create_list::create_not_accept_null_in_set` — rejects null in scalar-list set (2009); omitted list defaults to [] [connectors: caps:scalarlists]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/top_level_mutations/create_many.rs
- [ ] `writes::top_level_mutations::create_many::basic_create_many` — createMany with 3 rows returns count 3 [connectors: caps:createmany]
- [ ] `writes::top_level_mutations::create_many::basic_create_many_shorthand` — createMany with single object (non-array) returns count 1 [connectors: caps:createmany]
- [ ] `writes::top_level_mutations::create_many::basic_create_many_autoincrement` — createMany with autoincrement id, some rows omit id, count 3 [connectors: exclude:cockroachdb,sqlite(cfd1); caps:createmany,createmanywriteableautoincid]
- [ ] `writes::top_level_mutations::create_many::basic_create_many_autoinc_cockroachdb` — createMany autoincrement (BigInt id) on CockroachDB, count 3 [connectors: only:cockroachdb; caps:createmany]
- [ ] `writes::top_level_mutations::create_many::create_many_defaults_nulls` — omitted field uses default, explicit null stays null [connectors: caps:createmany]
- [ ] `writes::top_level_mutations::create_many::create_many_error_dups` — duplicate ids error with 2002 by default [connectors: caps:createmany]
- [x] `writes::top_level_mutations::create_many::create_many_no_error_skip_dup` — skipDuplicates:true dedupes, count 1 [connectors: caps:createmany,createskipduplicates] → PASS `test/integration/test/ports/engines/writes/top_level_mutations/create_many/create_many.test.ts` › `skipping duplicates dedupes the batch and counts one row`
- [ ] `writes::top_level_mutations::create_many::large_num_records_horizontal` — creates 1000 records (row-count batching), count 1000 [connectors: caps:createmany]
- [ ] `writes::top_level_mutations::create_many::large_num_records_vertical` — creates 2000 4-param rows (param batching), count 2000 [connectors: caps:createmany]
- [ ] `writes::top_level_mutations::create_many::create_many_map_behavior` — createMany with @map DateTime column, count 2 [connectors: caps:createmany]
- [ ] `writes::top_level_mutations::create_many::create_many_by_shape` — powerset of field-shape combinations to exercise insert grouping [connectors: only:sqlite; caps:createmany]
- [ ] `writes::top_level_mutations::create_many::create_many_by_shape_counter_1` — verifies number of INSERT statements by row shape vs max bind values [connectors: only:sqlite; caps:createmany]
- [ ] `writes::top_level_mutations::create_many::create_many_by_shape_counter_2` — verifies INSERT count with static defaults grouping [connectors: only:sqlite; caps:createmany]
- [ ] `writes::top_level_mutations::create_many::create_many_by_shape_counter_3` — verifies INSERT count across 6 mixed-shape rows [connectors: only:sqlite; caps:createmany]
- [ ] `writes::top_level_mutations::create_many::create_many_with_many_fields` — createMany with 12-field model (asserts batching < field count), count 4 [connectors: caps:createmany]
- [ ] `writes::top_level_mutations::json_create_many::create_many_json` — createMany JSON with object/"null"/null/omitted, then findMany check (Mongo) [connectors: only:mongodb; exclude:mysql(5.6); caps:createmany,json]
- [ ] `writes::top_level_mutations::json_create_many::create_many_json_adv` — createMany JSON with JsonNull/DbNull advanced nullability, findMany check [connectors: exclude:mysql(5.6); caps:createmany,json,advancedjsonnullability]
- [ ] `writes::top_level_mutations::json_create_many::create_many_json_errors` — errors (2009) when createMany JSON given AnyNull [connectors: exclude:mysql(5.6); caps:createmany,json,advancedjsonnullability]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/top_level_mutations/create_many_and_return.rs
- [ ] `writes::top_level_mutations::create_many_and_return::basic_create_many` — createManyAndReturn returns 3 rows with defaults/nulls resolved [connectors: caps:createmany,insertreturning]
- [ ] `writes::top_level_mutations::create_many_and_return::basic_create_many_shorthand` — createManyAndReturn with single object returns one-item array [connectors: caps:createmany,insertreturning]
- [ ] `writes::top_level_mutations::create_many_and_return::basic_create_many_autoincrement` — createManyAndReturn autoincrement id, sorts, matches one of two valid outputs [connectors: exclude:cockroachdb; caps:createmany,insertreturning,createmanywriteableautoincid]
- [ ] `writes::top_level_mutations::create_many_and_return::basic_create_many_autoinc_cockroachdb` — createManyAndReturn autoincrement (BigInt) on CockroachDB [connectors: only:cockroachdb; caps:createmany,insertreturning]
- [ ] `writes::top_level_mutations::create_many_and_return::create_many_defaults_nulls` — omitted uses default, explicit null stays null, returned + findMany [connectors: caps:createmany,insertreturning]
- [ ] `writes::top_level_mutations::create_many_and_return::create_many_error_dups` — duplicate ids error 2002 [connectors: caps:createmany,insertreturning]
- [x] `writes::top_level_mutations::create_many_and_return::create_many_no_error_skip_dup` — skipDuplicates:true returns single row [connectors: caps:createmany,insertreturning,createskipduplicates] → PASS `test/integration/test/ports/engines/writes/top_level_mutations/create_many/create_many_and_return.test.ts` › `skipping duplicates returns the single row the database inserted`
- [ ] `writes::top_level_mutations::create_many_and_return::large_num_records_horizontal` — createManyAndReturn 1000 records, array length 1000 [connectors: caps:createmany,insertreturning]
- [ ] `writes::top_level_mutations::create_many_and_return::large_num_records_vertical` — createManyAndReturn 2000 4-param rows, array length 2000 [connectors: caps:createmany,insertreturning]
- [ ] `writes::top_level_mutations::create_many_and_return::create_many_map_behavior` — createManyAndReturn with @map DateTime column, returns both rows [connectors: caps:createmany,insertreturning]
- [ ] `writes::top_level_mutations::create_many_and_return::create_many_11_inline_rel_read_works` — createManyAndReturn can read back inline 1:1 relation [connectors: caps:createmany,insertreturning]
- [ ] `writes::top_level_mutations::create_many_and_return::create_many_11_non_inline_rel_read_fails` — reading non-inline 1:1 relation field fails (2009 field not found) [connectors: caps:createmany,insertreturning]
- [ ] `writes::top_level_mutations::create_many_and_return::create_many_1m_inline_rel_read_works` — createManyAndReturn can read back inline 1:m (parent) relation [connectors: caps:createmany,insertreturning]
- [ ] `writes::top_level_mutations::create_many_and_return::create_many_1m_non_inline_rel_read_fails` — reading non-inline 1:m relation (children) fails 2009 [connectors: caps:createmany,insertreturning]
- [ ] `writes::top_level_mutations::create_many_and_return::create_many_m2m_rel_read_fails` — reading m2m relation fields fails 2009 on both sides [connectors: caps:createmany,insertreturning]
- [ ] `writes::top_level_mutations::create_many_and_return::create_many_self_rel_read_fails` — reading self-relation students field fails 2009 [connectors: caps:createmany,insertreturning]
- [ ] `writes::top_level_mutations::create_many_and_return::create_many_by_shape` — createManyAndReturn across mixed field shapes, sorted result snapshot [connectors: caps:createmany,insertreturning]
- [ ] `writes::top_level_mutations::create_many_and_return::create_many_by_shape_combinations` — powerset of field combinations to exercise insert grouping [connectors: only:sqlite; caps:createmany,insertreturning]
- [ ] `writes::top_level_mutations::create_many_and_return::create_many_by_shape_counter_1` — asserts INSERT statement count by shape vs max bind values [connectors: only:sqlite; caps:createmany,insertreturning]
- [ ] `writes::top_level_mutations::create_many_and_return::create_many_by_shape_counter_2` — asserts INSERT count with static defaults grouping [connectors: only:sqlite; caps:createmany,insertreturning]
- [ ] `writes::top_level_mutations::create_many_and_return::create_many_by_shape_counter_3` — asserts INSERT count across 6 mixed-shape rows [connectors: only:sqlite; caps:createmany,insertreturning]
- [ ] `writes::top_level_mutations::json_create_many_and_return::create_many_json_adv` — createManyAndReturn JSON JsonNull/DbNull advanced nullability, findMany check [connectors: exclude:mysql(5.6); caps:json,advancedjsonnullability,createmany,insertreturning]
- [ ] `writes::top_level_mutations::json_create_many_and_return::create_many_json_errors` — errors (2009) when createManyAndReturn JSON given AnyNull [connectors: exclude:mysql(5.6); caps:json,advancedjsonnullability,createmany,insertreturning]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/top_level_mutations/default_value.rs
- [ ] `writes::top_level_mutations::default_value::default_field_omitted_in_data` — create with empty data `{}` succeeds using cuid default id [connectors: all]
- [ ] `writes::top_level_mutations::default_value::default_field_omitted_without_data` — create with no data argument at all succeeds [connectors: all]
- [ ] `writes::top_level_mutations::default_value::non_list_field` — non-list String field uses @default value when omitted [connectors: all]
- [ ] `writes::top_level_mutations::default_value::int_field` — Int field uses @default(1) when omitted [connectors: all]
- [ ] `writes::top_level_mutations::default_value::enum_field` — enum field uses @default(Yes) when omitted [connectors: exclude:sqlite,sqlserver,cockroachdb]
- [ ] `writes::top_level_mutations::default_value::updated_at_created_at` — explicit createdAt/updatedAt values on create override the defaults [connectors: all]
- [ ] `writes::top_level_mutations::default_value::remapped_enum_field` — @map'd enum default value works on create and in filters/reads [connectors: exclude:sqlite,sqlserver,cockroachdb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/top_level_mutations/delete.rs
- [ ] `writes::top_level_mutations::delete::should_delete_and_return_item` — deletes an item by id and returns it; verifies findMany is empty after [connectors: all]
- [ ] `writes::top_level_mutations::delete::should_fail_non_exist_id` — deleteOne on non-existing id errors 2025 (record not found) and leaves data intact [connectors: all]
- [ ] `writes::top_level_mutations::delete::should_delete_return_non_id_uniq_field` — deletes and returns item matched on non-id unique field [connectors: all]
- [ ] `writes::top_level_mutations::delete::should_fail_non_existent_value_non_id_uniq_field` — deleteOne on non-existent value of non-id unique field errors 2025 [connectors: all]
- [ ] `writes::top_level_mutations::delete::should_fail_delete_null_value` — deleteOne with null value for unique field errors 2012 (value required but not set) [connectors: all]
- [ ] `writes::top_level_mutations::delete::delete_fails_if_filter_dont_match` — deleteOne with extra non-matching field filter errors 2025 [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/top_level_mutations/delete_many.rs
- [ ] `writes::top_level_mutations::delete_many::should_delete_items` — deleteMany deletes only items matching the where clause (count 1) [connectors: all]
- [ ] `writes::top_level_mutations::delete_many::should_delete_all_if_where_empty` — deleteMany with empty where deletes all items [connectors: all]
- [ ] `writes::top_level_mutations::delete_many::should_delete_all_using_in` — deleteMany with `in` filter deletes matching items [connectors: all]
- [ ] `writes::top_level_mutations::delete_many::should_delete_all_using_notin` — deleteMany with `not in` filter deletes all non-matching items [connectors: all]
- [ ] `writes::top_level_mutations::delete_many::should_delete_using_or` — deleteMany with OR filter deletes matching items [connectors: all]
- [ ] `writes::top_level_mutations::delete_many::should_delete_using_and` — deleteMany with AND filter matching nothing deletes 0 [connectors: all]
- [ ] `writes::top_level_mutations::delete_many::should_delete_max_limit_items` — deleteMany respects limit param (deletes max limit items) [connectors: all]
- [ ] `writes::top_level_mutations::delete_many::should_fail_with_negative_limit` — deleteMany with negative limit errors 2019 (limit must be positive) [connectors: all]
- [ ] `writes::top_level_mutations::delete_many::nested_delete_many` — nested deleteMany within updateOneParent removes matching children [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/top_level_mutations/delete_many_relations.rs
- [ ] `writes::top_level_mutations::delete_many_rels::p1_c1` — P1-to-C1: deleteManyParent succeeds deleting parent with a child (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb,sqlite] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_many_rels::p1_c1_no_children` — P1-to-C1: deleteManyParent succeeds when parent has no child (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_many_rels::pm_c1_req_no_children` — PM-to-C1!: deleteManyParent succeeds if no child requires the parent (on_parent=ToMany, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_many_rels::p1_c1_req_no_children` — P1-to-C1!: deleteManyParent succeeds when parent has no child (on_parent=ToOneOpt, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_many_rels::pm_c1` — PM-to-C1: deleteManyParent succeeds deleting parent with children (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb,sqlite] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_many_rels::pm_c1_no_children` — PM-to-C1: deleteManyParent succeeds when parent has no child (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_many_rels::p1_req_cm_no_children` — P1!-to-CM: deleteManyParent succeeds deleting parent with a child (on_parent=ToOneReq, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_many_rels::p1_cm` — P1-to-CM: deleteManyParent succeeds deleting parent with a child (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_many_rels::p1_cm_no_children` — P1-to-CM: deleteManyParent succeeds when parent has no child (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_many_rels::pm_cm` — PM-to-CM: deleteManyParent succeeds deleting parent with children (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb,sqlite] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_many_rels::pm_cm_no_children` — PM-to-CM: deleteManyParent succeeds when parent has no child (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_many_rels::pm_cm_other_relations` — PM-to-CM: deleteManyParent also removes parent from its other (m2m + stepchild) relations [connectors: exclude:cockroachdb,sqlite]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/top_level_mutations/delete_mutation_relations.rs
- [ ] `writes::top_level_mutations::delete_mutation_relations::p1_c1` — P1-to-C1: deleteOneParent succeeds deleting parent with a child (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_mutation_relations::p1_c1_no_children` — P1-to-C1: deleteOneParent succeeds when parent has no child (on_parent=ToOneOpt, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_mutation_relations::pm_c1_req_no_children` — PM-to-C1!: deleteOneParent succeeds if no child requires the parent (on_parent=ToMany, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_mutation_relations::p1_c1_req_no_children` — P1-to-C1!: deleteOneParent succeeds when parent has no child (on_parent=ToOneOpt, on_child=ToOneReq) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_mutation_relations::pm_c1` — PM-to-C1: deleteOneParent succeeds deleting parent with children (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_mutation_relations::pm_c1_no_children` — PM-to-C1: deleteOneParent succeeds when parent has no child (on_parent=ToMany, on_child=ToOneOpt) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_mutation_relations::p1_req_cm` — P1!-to-CM: deleteOneParent succeeds deleting parent with a child (on_parent=ToOneReq, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_mutation_relations::p1_cm` — P1-to-CM: deleteOneParent succeeds deleting parent with a child (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_mutation_relations::p1_cm_no_children` — P1-to-CM: deleteOneParent succeeds when parent has no child (on_parent=ToOneOpt, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_mutation_relations::pm_cm` — PM-to-CM: deleteOneParent succeeds deleting parent with children (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_mutation_relations::pm_cm_no_children` — PM-to-CM: deleteOneParent succeeds when parent has no child (on_parent=ToMany, on_child=ToMany) [connectors: exclude:cockroachdb] [matrix: relation_link]
- [ ] `writes::top_level_mutations::delete_mutation_relations::pm_cm_other_relations_1` — PM-to-CM (stepchild owns FK): deleteOneParent also removes parent from other relations [connectors: exclude:cockroachdb]
- [ ] `writes::top_level_mutations::delete_mutation_relations::pm_cm_other_relations_2` — PM-to-CM (parent owns stepchild FK): deleteOneParent also removes parent from other relations [connectors: exclude:cockroachdb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/top_level_mutations/insert_null_in_required_field.rs
- [ ] `writes::top_level_mutations::insert_null::update_required_val_to_null` — updating a required field to null errors 2009 (value required but not set) [connectors: exclude:mysql]
- [ ] `writes::top_level_mutations::insert_null::create_required_value_as_null` — creating with a required field set to null errors 2009 [connectors: all]
- [ ] `writes::top_level_mutations::insert_null::update_optional_val_null` — updating an optional field to null succeeds [connectors: all]
- [ ] `writes::top_level_mutations::insert_null::create_optional_val_null` — creating with an optional field set to null succeeds [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/top_level_mutations/non_embedded_upsert.rs
- [ ] `writes::top_level_mutations::non_embedded_upsert::nested_connect_in_create` — top-level upsert executes a nested connect in the create branch [connectors: all]
- [ ] `writes::top_level_mutations::non_embedded_upsert::nested_connect_in_update` — top-level upsert executes a nested connect in the update branch [connectors: all]
- [ ] `writes::top_level_mutations::non_embedded_upsert::nested_disconnect_in_update` — top-level upsert executes a nested disconnect in the update branch [connectors: all]
- [ ] `writes::top_level_mutations::non_embedded_upsert::nested_delete_in_update` — top-level upsert executes a nested delete in the update branch [connectors: exclude:sqlserver]
- [ ] `writes::top_level_mutations::non_embedded_upsert::execute_nested_create_of_correct_branch` — top-level upsert runs nested create only from the correct (update) branch [connectors: all]
- [ ] `writes::top_level_mutations::non_embedded_upsert::nested_connect_in_correct_create_branch` — nested upsert runs nested connect from the correct create branch [connectors: all]
- [ ] `writes::top_level_mutations::non_embedded_upsert::nested_connect_in_correct_update_branch` — nested upsert runs nested connect from the correct update branch [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/top_level_mutations/update.rs
- [ ] `writes::top_level_mutations::update::updated_at_with_default` — updating one field bumps both @updatedAt fields (with/without default) past createdAt [connectors: all]
- [ ] `writes::top_level_mutations::update::update_an_item` — updateOne sets String/Int/Float/Boolean/DateTime via `set` [connectors: all]
- [ ] `writes::top_level_mutations::update::update_noop` — updateOne with empty data returns the record unchanged [connectors: all]
- [ ] `writes::top_level_mutations::update::update_with_shorthand_notation` — updateOne sets scalar fields using shorthand (no `set`) [connectors: all]
- [ ] `writes::top_level_mutations::update::update_by_uniq_field` — updateOne selects the record by a unique field [connectors: all]
- [ ] `writes::top_level_mutations::update::update_enums` — updateOne sets an enum field [connectors: caps:enums; exclude:cockroachdb]
- [ ] `writes::top_level_mutations::update::update_fail_uniq_field_inexistant_value` — updateOne by unique field with non-existing value fails with P2025 [connectors: all]
- [ ] `writes::top_level_mutations::update::update_updated_at_datetime` — updateOne advances @updatedAt so it differs from createdAt [connectors: all]
- [ ] `writes::top_level_mutations::update::updated_created_at_mutable_with_update` — createdAt and updatedAt can be explicitly set via update [connectors: all]
- [ ] `writes::top_level_mutations::update::update_apply_number_ops_for_int` — updateOne applies increment/decrement/multiply/divide/set/set-null on Int [connectors: exclude:cockroachdb]
- [ ] `writes::top_level_mutations::update::update_apply_number_ops_for_int_cockroach` — Int number ops on CockroachDB (no divide) [connectors: only:cockroachdb]
- [ ] `writes::top_level_mutations::update::update_apply_number_ops_for_float` — updateOne applies all number ops on Float [connectors: exclude:mongodb]
- [ ] `writes::top_level_mutations::update::update_apply_number_ops_for_float_mongo` — Float number ops on MongoDB [connectors: only:mongodb]
- [ ] `writes::top_level_mutations::update::update_number_ops_handle_id_change` — number ops on compound-id fields handle the id change correctly [connectors: caps:compoundids]
- [ ] `writes::top_level_mutations::update::update_fails_if_filter_dont_match` — updateOne with a non-matching non-unique filter fails with P2025 [connectors: all]
- [ ] `writes::top_level_mutations::json_update::update_json` — updateOne sets Json field to object/"null"/null (Mongo semantics) [connectors: only:mongodb; exclude:mysql(5.6); caps:json]
- [ ] `writes::top_level_mutations::json_update::update_json_adv` — updateOne Json with JsonNull vs DbNull nullability [connectors: exclude:mysql(5.6); caps:json,advancedjsonnullability]
- [ ] `writes::top_level_mutations::json_update::update_json_errors` — updateOne Json with AnyNull fails with P2009 [connectors: exclude:mysql(5.6); caps:json,advancedjsonnullability]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/top_level_mutations/update_many.rs
- [ ] `writes::top_level_mutations::update_many::update_recs_matching_where` — updateMany updates only records matching the where clause [connectors: all]
- [ ] `writes::top_level_mutations::update_many::update_recs_matching_where_shorthands` — updateMany updates matching records using shorthand data [connectors: all]
- [ ] `writes::top_level_mutations::update_many::update_all_items_if_where_empty` — updateMany with empty where updates all records [connectors: all]
- [ ] `writes::top_level_mutations::update_many::update_max_limit_items` — updateMany respects the `limit` argument (count 2 of 3) [connectors: all]
- [ ] `writes::top_level_mutations::update_many::should_fail_with_negative_limit` — updateMany with negative limit fails with P2019 [connectors: all]
- [ ] `writes::top_level_mutations::update_many::apply_number_ops_for_int` — updateMany applies all Int number ops across records [connectors: exclude:cockroachdb]
- [ ] `writes::top_level_mutations::update_many::apply_number_ops_for_int_cockroach` — updateMany Int number ops on CockroachDB (no divide) [connectors: only:cockroachdb]
- [ ] `writes::top_level_mutations::update_many::apply_number_ops_for_float` — updateMany applies all Float number ops across records [connectors: all]
- [ ] `writes::top_level_mutations::json_update_many::update_json` — updateMany sets Json to object/"null"/null returning count (Mongo) [connectors: only:mongodb; exclude:mysql(5.6); caps:json]
- [ ] `writes::top_level_mutations::json_update_many::update_json_adv` — updateMany Json with JsonNull vs DbNull returning count [connectors: exclude:mysql(5.6); caps:json,advancedjsonnullability]
- [ ] `writes::top_level_mutations::json_update_many::update_json_errors` — updateMany Json with AnyNull fails with P2009 [connectors: exclude:mysql(5.6); caps:json,advancedjsonnullability]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/top_level_mutations/update_many_and_return.rs
- [ ] `writes::top_level_mutations::update_many_and_return::update_recs_matching_where` — updateManyAndReturn returns updated records matching where [connectors: caps:updatereturning]
- [ ] `writes::top_level_mutations::update_many_and_return::update_recs_matching_where_shorthands` — updateManyAndReturn with shorthand data returns updated records [connectors: caps:updatereturning]
- [ ] `writes::top_level_mutations::update_many_and_return::update_all_items_if_where_empty` — updateManyAndReturn with empty where returns all updated records [connectors: caps:updatereturning]
- [ ] `writes::top_level_mutations::update_many_and_return::apply_number_ops_for_int` — updateManyAndReturn applies all Int number ops and returns results [connectors: caps:updatereturning; exclude:cockroachdb]
- [ ] `writes::top_level_mutations::update_many_and_return::apply_number_ops_for_int_cockroach` — updateManyAndReturn Int number ops on CockroachDB (no divide) [connectors: caps:updatereturning; only:cockroachdb]
- [ ] `writes::top_level_mutations::update_many_and_return::apply_number_ops_for_float` — updateManyAndReturn applies all Float number ops and returns results [connectors: caps:updatereturning]
- [ ] `writes::top_level_mutations::update_many_and_return::update_many_11_inline_rel_read_works` — updateManyAndReturn can read an inline 1:1 relation in the selection [connectors: caps:updatereturning]
- [ ] `writes::top_level_mutations::update_many_and_return::update_many_11_non_inline_rel_read_fails` — updateManyAndReturn reading a non-inline 1:1 relation fails with P2009 [connectors: caps:updatereturning]
- [ ] `writes::top_level_mutations::update_many_and_return::update_many_1m_inline_rel_read_works` — updateManyAndReturn can read the inline side of a 1:m relation [connectors: caps:updatereturning]
- [ ] `writes::top_level_mutations::update_many_and_return::update_many_1m_non_inline_rel_read_fails` — updateManyAndReturn reading the non-inline 1:m relation fails with P2009 [connectors: caps:updatereturning]
- [ ] `writes::top_level_mutations::update_many_and_return::update_many_m2m_rel_read_fails` — updateManyAndReturn reading m2m relations fails with P2009 (both sides) [connectors: caps:updatereturning]
- [ ] `writes::top_level_mutations::update_many_and_return::update_many_self_rel_read_fails` — updateManyAndReturn reading a self-relation list fails with P2009 [connectors: caps:updatereturning]
- [ ] `writes::top_level_mutations::json_update_many_and_return::update_json_adv` — updateManyAndReturn Json with JsonNull vs DbNull returns values [connectors: caps:advancedjsonnullability,updatereturning]
- [ ] `writes::top_level_mutations::json_update_many_and_return::update_json_errors` — updateManyAndReturn Json with AnyNull fails with P2009 [connectors: caps:advancedjsonnullability,updatereturning]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/top_level_mutations/upsert.rs
- [ ] `writes::top_level_mutations::upsert::item_should_be_upserted` — upsert creates the record when it does not exist [connectors: all]
- [ ] `writes::top_level_mutations::upsert::create_with_many_fields_of_diff_types` — upsert create branch sets multiple fields of different types [connectors: all]
- [ ] `writes::top_level_mutations::upsert::create_if_not_exist_with_default_val` — upsert create branch uses field default when value omitted [connectors: all]
- [ ] `writes::top_level_mutations::upsert::no_create_required_val_null` — upsert create with required field set to null fails with P2009 [connectors: all]
- [ ] `writes::top_level_mutations::upsert::update_if_already_exists` — upsert updates the existing record found by id [connectors: all]
- [ ] `writes::top_level_mutations::upsert::update_shorthand_already_exists` — upsert update branch works with shorthand data on existing record [connectors: all]
- [ ] `writes::top_level_mutations::upsert::should_update_if_uniq_already_exists` — upsert updates existing record matched by a unique field [connectors: all]
- [ ] `writes::top_level_mutations::upsert::only_update_if_uniq_field_change` — upsert only updates (not creates) when update changes the unique where field [connectors: all]
- [ ] `writes::top_level_mutations::upsert::only_update_if_update_changes_nothing` — upsert only updates when the update is a no-op change [connectors: all]
- [ ] `writes::top_level_mutations::upsert::upsert_called_twice_does_nothing` — calling the same upsert twice creates once then updates (relation_mode prisma) [connectors: all]
- [ ] `writes::top_level_mutations::upsert::upsert_apply_number_ops_for_int` — upsert update branch applies all Int number ops [connectors: exclude:cockroachdb]
- [ ] `writes::top_level_mutations::upsert::upsert_apply_number_ops_for_int_cockroach` — upsert Int number ops on CockroachDB (no divide) [connectors: only:cockroachdb]
- [ ] `writes::top_level_mutations::upsert::upsert_apply_number_ops_for_float` — upsert update branch applies all Float number ops [connectors: exclude:mongodb]
- [ ] `writes::top_level_mutations::upsert::upsert_apply_number_ops_for_float_mongo` — upsert Float number ops on MongoDB [connectors: only:mongodb]
- [ ] `writes::top_level_mutations::upsert::upsert_fails_if_filter_dont_match` — upsert with a non-matching extra filter fails with P2002 [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/unchecked_writes/unchecked_create.rs
- [ ] `writes::unchecked_create::allow_writing_inlined_rel_scalars` — unchecked create allows writing inlined compound relation scalars (incl. null) [connectors: caps:anyid]
- [ ] `writes::unchecked_create::disallow_write_inline_rel_regularly` — unchecked create disallows regular nested write of an inlined relation (2009) [connectors: all]
- [ ] `writes::unchecked_create::required_write_required_rel_scalars` — unchecked create requires required relation scalars, allows optionals omitted [connectors: all]
- [ ] `writes::unchecked_create::allow_write_non_inlined_rel` — unchecked create allows writing non-inlined relations normally [connectors: all]
- [ ] `writes::unchecked_create::honor_defaults_make_req_rel_sclrs_opt` — unchecked create honors defaults, making required relation scalars optional [connectors: all]
- [ ] `writes::unchecked_create::allow_write_autoinc_ids` — unchecked create allows writing autoincrement IDs directly [connectors: exclude:cockroachdb; caps:autoincrement,writableautoincfield]
- [ ] `writes::unchecked_create::allow_write_autoinc_ids_cockroachdb` — unchecked create allows writing autoincrement IDs directly (CockroachDB BigInt variant) [connectors: only:cockroachdb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/unchecked_writes/unchecked_nested_create.rs
- [ ] `writes::unchecked_nested_create::allow_write_non_prent_inline_rel_sclrs` — unchecked nested create allows writing non-parent inlined relation scalars, rejects parent scalar (2009) [connectors: all]
- [ ] `writes::unchecked_nested_create::fail_if_req_rel_sclr_not_provided` — unchecked nested create fails if required relation scalars not provided (2009) [connectors: all]
- [ ] `writes::unchecked_nested_create::disallow_writing_inline_rel` — unchecked nested create disallows writing inlined relations regularly (2009) [connectors: all]
- [ ] `writes::unchecked_nested_create::allow_write_non_parent` — unchecked nested create allows writing non-parent non-inlined relations normally [connectors: all]
- [ ] `writes::unchecked_nested_create::honor_defaults_make_req_rel_sclrs_opt` — unchecked nested create honors defaults, making required relation scalars optional [connectors: all]
- [ ] `writes::unchecked_nested_create::allow_write_autoinc_ids` — unchecked nested create allows writing autoincrement IDs directly [connectors: exclude:cockroachdb; caps:autoincrement,writableautoincfield]
- [ ] `writes::unchecked_nested_create::allow_write_autoinc_ids_cockroachdb` — unchecked nested create allows writing autoincrement IDs directly (CockroachDB variant) [connectors: only:cockroachdb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/unchecked_writes/unchecked_nested_update.rs
- [ ] `writes::nested_unchecked_update::allow_write_non_prent_inline_rel_sclrs` — unchecked nested update allows writing non-parent inlined relation scalars (incl. nulling) [connectors: all]
- [ ] `writes::nested_unchecked_update::disallow_write_parent_inline_rel_sclrs` — unchecked nested update disallows writing parent inlined relation scalars (2009) [connectors: all]
- [ ] `writes::nested_unchecked_update::disallow_write_inline_rel` — unchecked nested update disallows writing inlined relations regularly (2009) [connectors: all]
- [ ] `writes::nested_unchecked_update::disallow_write_non_parent` — unchecked nested update allows writing non-parent, non-inlined relations normally [connectors: all]
- [ ] `writes::nested_unchecked_update::allow_write_autoinc_id` — unchecked nested update allows writing autoincrement IDs directly [connectors: exclude:sqlserver]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/unchecked_writes/unchecked_nested_update_many.rs
- [ ] `writes::unchecked_nested_um::allow_write_non_prent_inline_rel_sclrs` — unchecked nested updateMany allows writing non-parent inlined relation scalars (incl. nulling) [connectors: all]
- [ ] `writes::unchecked_nested_um::disallow_write_parent_inline_rel_sclrs` — unchecked nested updateMany disallows writing parent inlined relation scalars (2009) [connectors: all]
- [ ] `writes::unchecked_nested_um::allow_write_autoinc_id` — unchecked nested updateMany allows writing autoincrement IDs directly [connectors: exclude:cockroachdb; caps:autoincrement,writableautoincfield]
- [ ] `writes::unchecked_nested_um::allow_write_autoinc_id_cockroachdb` — unchecked nested updateMany allows writing autoincrement IDs directly (CockroachDB variant) [connectors: only:cockroachdb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/unchecked_writes/unchecked_update_many.rs
- [ ] `writes::unchecked_update_many::allow_write_non_prent_inline_rel_sclrs` — unchecked updateMany allows writing inlined relation scalars (incl. nulling) across all rows [connectors: all]
- [ ] `writes::unchecked_update_many::allow_write_autoinc_id` — unchecked updateMany allows writing autoincrement field directly [connectors: exclude:sqlserver,sqlite]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/unchecked_writes/unchecked_update_spec.rs
- [ ] `writes::unchecked_update::allow_write_non_prent_inline_rel_sclrs` — unchecked update allows writing inlined relation scalars (incl. nulling) [connectors: all]
- [ ] `writes::unchecked_update::disallow_write_inline_rels` — unchecked update disallows writing inlined relations regularly (2009) [connectors: all]
- [ ] `writes::unchecked_update::allow_write_non_inline_rels` — unchecked update allows writing non-inlined relations normally [connectors: all]
- [ ] `writes::unchecked_update::allow_write_autoinc_ids` — unchecked update allows writing autoincrement IDs directly [connectors: exclude:cockroachdb; caps:autoincrement,writableautoincfield]
- [ ] `writes::unchecked_update::allow_write_autoinc_ids_cockroachdb` — unchecked update allows writing autoincrement IDs directly (CockroachDB sequence variant) [connectors: only:cockroachdb]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/uniques_and_node_selectors/multi_field_uniq_mutation.rs
- [ ] `writes::multi_field_uniq_mut::nested_connect_one2one_rel` — nested connect on 1:1 relation via multi-field unique works [connectors: all]
- [ ] `writes::multi_field_uniq_mut::nested_connect_one2m_rel` — nested connect on 1:M relation via multi-field unique works [connectors: all]
- [ ] `writes::multi_field_uniq_mut::nested_disconnect_multi_field_uniq` — nested disconnect via multi-field unique works [connectors: all]
- [ ] `writes::multi_field_uniq_mut::update_multi_field_uniq` — update selecting by multi-field unique works [connectors: all]
- [ ] `writes::multi_field_uniq_mut::nested_update_multi_uniq_field` — nested update via multi-field unique works [connectors: all]
- [ ] `writes::multi_field_uniq_mut::delete_multi_field_uniq` — delete selecting by multi-field unique works [connectors: all]
- [ ] `writes::multi_field_uniq_mut::nested_delete_multi_field_uniq` — nested delete via multi-field unique works [connectors: all]
- [ ] `writes::multi_field_uniq_mut::upsert_multi_field_uniq` — upsert selecting by multi-field unique (create then update) works [connectors: all]
- [ ] `writes::multi_field_uniq_mut::nested_upsert_multi_field_uniq` — nested upsert via multi-field unique works [connectors: all]
- [ ] `writes::multi_field_uniq_mut::nested_set_multi_field_uniq` — nested set via multi-field unique works [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/uniques_and_node_selectors/non_embedded_setting_node_selector_to_null.rs
- [ ] `writes::non_embedded_node_sel_to_null::where_val_to_null` — setting a where node-selector value to null updates only one of several null rows (with nested relation update) [connectors: exclude:sqlserver]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/uniques_and_node_selectors/relation_uniques/compound_uniq_rel_field.rs
- [ ] `writes::uniques_and_node_selectors::relation_uniques::compound_uniq_rel_field::compound_uniq_with_1_1_single_rel` — compound unique including a 1!:1 single-field relation works across create/update/delete/upsert/connect/nested-delete [connectors: all]
- [ ] `writes::uniques_and_node_selectors::relation_uniques::compound_uniq_rel_field::compound_uniq_with_1_1_multi_rel` — compound unique including a 1!:1 multi-field relation works across the full mutation set [connectors: all]
- [ ] `writes::uniques_and_node_selectors::relation_uniques::compound_uniq_rel_field::compound_uniq_with_1_m_single_rel` — compound unique including a 1!:M single-field relation works (incl. nested updateMany/deleteMany) [connectors: all]
- [ ] `writes::uniques_and_node_selectors::relation_uniques::compound_uniq_rel_field::compound_uniq_with_1_m_multi_rel` — compound unique including a 1!:M multi-field relation works (incl. nested updateMany/deleteMany) [connectors: all]
- [ ] `writes::uniques_and_node_selectors::relation_uniques::compound_uniq_rel_field::compound_uniq_same_field_diff_models` — compound uniques reusing the same field names across different models resolve correctly [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/uniques_and_node_selectors/setting_node_selector_to_null.rs
- [ ] `writes::node_sel_to_null::where_val_to_null` — setting a where value to null works when there is no further nesting [connectors: all]

### query-engine/connector-test-kit-rs/query-engine-tests/tests/writes/views.rs
- [ ] `writes::views::no_create_one_mutation` — createOne on a view is rejected (2009/P2009) [connectors: all]
- [ ] `writes::views::no_update_one_mutation` — updateOne on a view is rejected (2009/P2009) [connectors: all]
- [ ] `writes::views::no_delete_one_mutation` — deleteOne on a view is rejected (2009/P2009) [connectors: all]
- [ ] `writes::views::no_upsert_one_mutation` — upsertOne on a view is rejected (2009/P2009) [connectors: all]
- [ ] `writes::views::no_create_many_mutation` — createMany on a view is rejected (2009/P2009) [connectors: all]
- [ ] `writes::views::no_update_many_mutation` — updateMany on a view is rejected (2009/P2009) [connectors: all]
- [ ] `writes::views::no_delete_many_mutation` — deleteMany on a view is rejected (2009/P2009) [connectors: all]


**Total: 638 tests**
