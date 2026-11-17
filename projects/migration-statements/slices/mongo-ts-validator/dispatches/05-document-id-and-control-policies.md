# Dispatch 5 — the document id takes its declared type; control policies follow ADR 224

**Slice:** [`../spec.md`](../spec.md) · **Branch:** `tml-3553-ts-validator-pr2` (prisma/orm#30773) · **Reviews:** `reviews/pr2/` round 4

## The document id (Will, 2026-10-19, replacing his earlier ruling of the same day)

The earlier rule ("a field stored as `_id` must be an ObjectId") rested on a wrong premise. MongoDB allows `_id` of any BSON type except an array, a regular expression or `undefined`; it generates an ObjectId only for a document inserted without one. The rule is now:

1. **A model that declares no field stored as `_id`:** its validator requires `_id` as BSON type `objectId`, because MongoDB generates one. Unchanged from today.
2. **A model that declares a field stored as `_id`:** its validator requires `_id` with that field's BSON type, as for any other field. A string, int, long, date, binData, UUID or document `_id` builds, on PSL and TypeScript.
3. **What stays refused:** a field stored as `_id` that is a list (MongoDB rejects an array `_id`) or nullable (every document has an id), and one whose codec stores no BSON type a validator can name, as for any field. In PSL, `@id` stays on the field stored as `_id`, at most one per model.
4. **Remove** the "is not an ObjectId" refusal (`PSL_MONGO_ID_NOT_OBJECTID`, the TypeScript `CONTRACT.COLLECTION_INVALID` `_id` case, the shared reason), its docs and error-reference entries, and the upgrade note section "Keeping documents whose `_id` is not an ObjectId". Keep the QA report's record of that section's runs, marked as superseded.
5. Spec decision 3, the MongoDB Family doc, the error reference, the PSL README and the upgrade notes say the new rule. The "Alternatives considered" of the PR records the ObjectId-only rule as rejected, with the reason: MongoDB allows other types, and existing data has them.
6. Tests: a string `_id` and an int `_id` build on both surfaces, their validators require `_id` with that type, and a real-MongoDB test inserts and reads back a document with a string `_id` through the ORM with the validator installed. `test/integration/test/mongo/orm-create-returns.test.ts` gets back its test of an `_id` that is a date, bytes or a BSON document (removed earlier on this branch; see `git log -p` for it), now with the validator installed.

## Control policies (architect round 4, CodeRabbit)

7. **ADR 224 precedence:** a contract whose `defaultControlPolicy` is `external` cannot be overridden by a per-collection `managed`. The SQL planner enforces this in `controlPolicyForCall`. Move that function next to `effectiveControlPolicy` in `@internal/contract` (it depends only on framework types; SQL keeps using it), and use it at both MongoDB sites: the builder's managed-only validator rule and the planner's per-collection gate. Test the `external` default with a `managed` model on both sites.
8. **The managed-only validator rule** moves from the TypeScript builder into `deriveCollectionValidators`, so PSL gets it when it gains control policies.
9. **A collection removed from the contract:** the planner must use the origin contract's policy for it, so a collection that was `external` (or `observed`) is never dropped. Mirror how the SQL planner decides a dropped table's policy. Regression test: an `external` collection in the origin contract, absent from the destination.
10. **Refusal reasons true for every collection:** the enum listability refusal says a validator cannot list the values. Run it only for models in collections that get a validator, or give it a reason that holds without one; say which and why.
11. **Warnings for skipped changes:** when a control policy stops the MongoDB planner from changing a collection, it returns a warning for each change it leaves out, as the Postgres planner does (find how Postgres words and returns them, and mirror it). A planner test checks the warnings.
12. **Optional, if small:** the shared-collection reach rule reads the MongoDB filter back to learn the discriminator value. Carry the selection as a typed value instead and write the filter from it at the end.

## Done when

- All of the above, tests first (red before each change).
- Checks: build, typecheck, `lint:deps`, `fixtures:check`, `check:error-reference`, `lint:throws`, `lint:casts`, `check:upgrade-coverage` (`--prev` set to the merge base with `origin/main`), `lint:docs`; lint and tests with coverage in every touched package; every integration and e2e file that mentions MongoDB, listed with `git ls-files 'test/*.test.ts' 'test/**/*.test.ts' | xargs grep -il mongo` inside `test/integration`, by name in groups of about 20 with each file as its own argument; the MongoDB journeys with `pnpm test:journeys` and each file as its own argument.
