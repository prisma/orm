# Saved contracts for the SQL hash rules

`hash-rules.fixed-answers.test.ts` holds the storage, profile and execution hashes of these contracts fixed within a major. The test protects only what these files contain, so together they hold every part of the SQL family's normal form of `storage` (`normalizeSqlStorage`).

- `postgres.json`, `mysql.json`, `sqlite.json`: contracts as each target emits them, with an execution section, namespace kinds and capabilities.
- `postgres-every-default-written.json` writes out every field the family leaves out: `many: false` on a column and on a value-object field, an empty `typeParams` on a column, a value-object field's type and a storage type, empty `checks`, an index's empty `columns` and `options`, a foreign key's `index` of `true` and of `false`, `onDelete` and `onUpdate` of `noAction`, and an empty entity-kind slot. Its `checks`, `foreignKeys`, `indexes` and `uniques` are out of order, with named and unnamed foreign keys and unnamed uniques.
- `postgres-every-default-absent.json` is the same contract as the family writes it: every default left out and every ordered list in order. The test checks that the first file is written as this one and that both have the same hashes.

Both hold values the family keeps as given next to each default: type parameters holding `false`, index options holding `false`, a literal column default of `false`, foreign keys with `cascade`, `setNull` and a named index, a restrictive policy with `permissive: false` and empty `roles`, value set members that are objects, and a pack's own entry holding an empty map.
