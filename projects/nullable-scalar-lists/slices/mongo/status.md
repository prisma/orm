# Mongo slice status

**Status:** Remaining Mongo review gaps closed; tests and validation gates recorded below.

## Delivered

- PSL element-optional lowering to `ContractField.elementNullable: true` for Mongo scalar and value-object lists.
- Literal-only `.many({ elementsNullable: true | false })` Mongo authoring with an independent builder type-state axis.
- Inferred and emitted input/output nullable-element array types.
- BSON validator `items` nullability for all four list/element cells.
- Per-element scalar-list write encoding with `null` bypass; decode null bypass verified.
- Enum and value-object nullable-element proofs across inferred input/output, emitted channels, PSL lowering, and exact BSON validator shapes.
- Separate wrapping paths for mutation field values and object-filter equality operands. Callback `$set` list replacement wraps each non-null element; scalar `$push` wraps one element; `$unset` remains untouched.
- Nullable value-object list writes preserve null elements and recurse only into non-null objects, wrapping nested scalar leaves.
- Object-filter list equality retains exact array semantics with per-element codec refs, while raw operator expressions retain their operator-owned operand shapes and avoid mutation-style rewrapping.
- Full PSL enum integration uses the production Mongo family entity and block contributions, covering `Role?[]` and `Role?[]?` through parser/symbol table, Mongo interpreter, ContractField lowering, and BSON validator derivation. Both fields carry `many: true` and `elementNullable: true`; only `Role?[]?` carries `nullable: true`; validator items are exactly `{ bsonType: ['null', 'string'], enum: ['user', 'admin', null] }`.
- Contract-derived Mongo result shapes map whole-list nullability and element nullability independently. Query-builder regression coverage proves strict and nullable element leaf shapes, and the ORM consumes the same shared adapter.
- Nullable value-object write command ASTs cover insert, object update, callback `$set`, and top-level nullable value-object callback `set(null)`. `[VO, null, VO]` preserves the middle null while each non-null object's scalar leaves carry `mongo/string@1` refs.
- Raw `$in` ownership is explicit: the ORM preserves the original pre-wrapped operand array and ref identities, and runtime resolution transforms `admin`/`editor` once each, preserves the array and middle null, and records exactly two codec calls.

## Scope

The aggregate branch contains pre-existing framework and SQL changes. Writes for this Mongo findings slice are confined to `packages/2-mongo-family/**` and `projects/nullable-scalar-lists/slices/mongo/**`; this slice does not edit SQL or semantic PSL printer surfaces.

## Validation

- Mongo contract PSL: 5 files / 162 tests passed, including the new full enum PSL-to-validator integration.
- Mongo contract TS: 9 files / 105 tests passed with no type-test errors.
- Mongo emitter: 7 files / 64 tests passed.
- Mongo ORM: 8 files / 240 tests passed with no type-test errors, including 24 memory-server integration tests and the new nullable value-object command-AST matrix.
- Mongo runtime: 29 files / 187 tests passed with no type-test errors, including memory-server integration suites.
- Mongo adapter: 16 files / 327 tests passed; the new `$in` resolver test proves two operands produce exactly two codec calls and the null operand produces none.
- Mongo query builder: 21 files / 436 tests passed with no type-test errors; package typecheck passed. The contract-derived result-shape regression test failed before the adapter fix and passes after it.
- Mongo contract PSL/TS, emitter, ORM, runtime, and adapter package typechecks: passed.
- New/changed review-gap test files lint: passed (`biome check` on the three files).
- Package-wide lint reports only pre-existing no-bare-cast informational findings in Mongo contract PSL/TS, emitter, ORM, runtime, and adapter production files; no new lint error remains and no suppression or unrelated cast cleanup was added.
- `pnpm lint:deps`: passed (1,951 modules / 3,112 dependencies, no violations).
- Workspace `pnpm build`: passed (86/86 tasks).
- Workspace `pnpm typecheck`: passed (168/168 tasks).
- `pnpm fixtures:check`: blocked before fixture comparison because examples could not load the built local `prisma-next` CLI; no fixture diff was produced.
- `git diff --check`: passed.
- No SQL or semantic PSL printer files were changed by this findings pass.
