# Additions never break user code: spec

Project 5 of the Prisma 8 GA compatibility stream (`projects/ga-compatibility/plan.md` on branch `ga-compatibility`).

## At a glance

Three things a later `8.x` release may add, and what happens to code a user already wrote:

```ts
// 1. A new error code. Today this compiles against 8.0 and stops compiling when 8.1 adds a code.
function message(code: EmitFailureCode): string {
  switch (code) {
    case 'CONTRACT_SOURCE_INVALID': return '…';
    // … every other code …
    default: { const unreachable: never = code; throw new Error(unreachable); }
  }
}
// After this project the type is `'CONTRACT_SOURCE_INVALID' | … | (string & {})`,
// so the `never` check never compiles and the user writes a real default from the start.

// 2. A new built-in beside the user's names. Today a namespace named `fragment` hides it.
db.orm.fragment(fields, body);   // today
db.fragment(fields, body);       // after: `db.orm` holds only the user's namespaces or models

// 3. A new builder method with an extension's name. Today `orm()` throws
//    ORM.AGGREGATE_OPERATION_RESERVED for an extension operation named like a builder method,
//    so adding the method would make a working extension throw.
```

## Purpose

A release may add features at any time, and an addition must not affect an application that does not use it. This is section 5.1 of the stream's policy (`projects/ga-compatibility/spec.md`). Two of the fixes change published types, so they land before `8.0.0`.

## Requirements

1. **Open and closed sets.** Every exported type that lists the possible values of something a user may handle case by case (a union of string literals, such as `EmitFailureCode`, or a union of objects told apart by a `kind`) is declared open or closed.
   - An open set's type has a catch-all member, `(string & {})` for a union of strings. A new value may arrive in any release.
   - A closed set changes only in a major version. Each closed set is listed with its reason, in a file the check reads.
   - A set whose values users only pass to us, such as an option, is an input. Adding a value to it never breaks a user, and a catch-all member would only take away the compiler's check of their spelling. So an input set stays a plain union and is listed as an input.
   - A set that is a type parameter of other types, such as the kinds that key a contract view's entries, is not a set users switch over. A catch-all member there would empty the types built from it. It is listed with that reason.
   - A check in CI fails when an exported set is none of these.
   - Error codes are an open set. So is every set of `kind` values that an extension can add to.
2. **Error codes do not disappear.** A check in CI fails when a code that appears in the last release's published code no longer appears in the build, unless the removal is recorded with its reason and the code that replaces it, if one does. A package recorded as removed covers its codes. Within a major, removing a code is a break the policy does not allow; a record is for a deliberate break, such as before `8.0.0`, as `api-breaks.json` is for an API. The check reads text, so a code that is no longer raised but is still compared somewhere passes; the docs say so.
3. **Our names and names chosen by users or extensions do not share a space.** The rule is in "The name rule" below. It removes the two cases the stream plan names: `fragment` on `db.orm`, and `ORM.AGGREGATE_OPERATION_RESERVED`.
4. **Interfaces users implement.** A new required member on an exported interface that users implement is reported as a break by the API check. See "Interfaces users implement" below: the check already does this, and the list the stream plan asked for is not built.

## The name rule

A name we add later must never change what a name the user or an extension already wrote refers to, and must never make code that works start failing.

1. **Keep the spaces apart.** Each surface holds either only names we choose or only names a user or an extension chooses. `db` and a collection's own members hold our names. `db.orm` (namespaces on PostgreSQL, models on SQLite and MongoDB), `db.sql`, `db.enums` and a collection's `using` hold theirs.
2. **Where a space is shared on purpose, the user's name wins, and ours has a qualified spelling.** PSL type names are the case: a schema's own `model Ulid` means that model, and the built-in is written `sql.Ulid` (ADR 310). A custom collection class's member wins over a contributed reducer (ADR 020).

Our name never takes precedence in a shared space. If it did, adding it would change the meaning of code already written, which is exactly what the policy forbids.

What exists already and agrees:

- ADR 210 keeps the `sql({ context })` proxy "pristine for user-defined names" and puts `prepare` on the facade instead.
- Release candidate 4 moved the raw-SQL tag from `db.sql.raw` to `db.raw.sql`, so that "nothing a contract declares can collide with it", and ended the `raw` reservation (`ORM.NAMESPACE_RESERVED`).
- ADR 272 puts contributed collection methods under `using` so a contributed name "can never collide with a collection method … whatever either side adds later".
- ADR 259 records the `fragment` case as a known limitation, to be fixed by "put[ting] the namespaces or the client's methods under a member of their own".

What it changes:

- `db.orm.fragment(fields, body)` becomes `db.fragment(fields, body)` on every facade client and transaction (`tx.fragment`). The ORM client returned by `orm()` holds only the contract's namespaces or models. The SQLite facade's special case (`fragment` beside the models unless a model is named `fragment`) goes away.
- A reducer for an aggregate operation an extension contributes is reached under `using` on a collection, not beside the builder methods. `ORM.AGGREGATE_OPERATION_RESERVED` is removed. Operations our target packages contribute (`count`, `sum`, …) stay beside the builder methods, because both are our names.
- Spaces our packages and extensions both add to (column operators, aggregate operations, `using` methods) are refused at start-up today when two contributions clash. For these the slice decides, with evidence, between making the prefix convention of ADR 214 a check and splitting the space. This is recorded in the decision record.

## Interfaces users implement

ADR 336 decided how the API check sees a new required member on an interface users implement: through the test of every exported function that accepts the interface, which fails because a value written against the last release no longer fits. It rejected a hand-kept list of such interfaces because it "would go out of date without anyone noticing". The stream plan's item predates that decision. This project builds no list. It checks the decision holds for our real interfaces: it plants a required member on one interface users implement (for example the middleware interface), in a package that few others depend on, and confirms the check fails. An interface users implement that no exported function accepts would escape the check; the inventory in slice 1 looks for one, and if it finds one, the fix is decided then.

## Non-goals

- New features. Nothing here adds a capability.
- Exports that project 3 removes. Only types still exported after project 3 are declared.
- PSL resolution. Section 5.1 of the stream spec already states it, and it agrees with the rule above. The slice adds a test that a user's own type name wins over a built-in one, if none exists.

## Done when

- Each requirement is built, merged, and covered by a test that fails without it.
- The name rule is written in a decision record, ADRs 020, 259 and 272 are updated to it, and section 5.1 of the stream spec states the client half of it.
- The stream plan shows project 5 done.
