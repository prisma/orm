# Saved contracts for the MongoDB hash rules

`hash-rules.fixed-answers.test.ts` holds the storage, profile and execution hashes of these contracts fixed within a major. The test protects only what these files contain, so together they hold every part of the MongoDB family's normal form of `storage` (`normalizeMongoStorage`).

- `mongo.json`: a contract as the MongoDB target emits it, with an execution section and namespace kinds.
- `mongo-every-default-written.json` writes out every field the family leaves out: a collection's empty `indexes`, an index's `unique` and `sparse` of `false`, the collation flags `caseLevel` and `numericOrdering` of `false` on an index and in a collection's options, empty `required` and `properties` in a validator's schema below its top level and inside `patternProperties`, `many: false` and an empty `typeParams` on a value-object field, and an empty entity-kind slot. Its collection's `indexes` are out of order.
- `mongo-every-default-absent.json` is the same contract as the family writes it: every default left out and the indexes in order by name. The test checks that the first file is written as this one and that both have the same hashes.

Both hold values the family keeps as given next to each default: the collation flags `backwards` and `normalization` of `false` (their default depends on the locale), a partial filter expression holding `false`, change stream images that are off, a clustered index with no name, a closed validator schema, a tuple that allows no further items, the empty schema of an unconstrained field, and value set members that are objects.
