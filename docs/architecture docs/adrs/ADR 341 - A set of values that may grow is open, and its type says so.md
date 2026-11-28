# ADR 341 — A set of values that may grow is open, and its type says so

## At a glance

```ts
export type SqlMigrationRunnerErrorCode =
  | 'MIGRATION.POLICY_VIOLATION'
  | 'MIGRATION.PRECHECK_FAILED'
  // … the other codes …
  | (`MIGRATION.${string}` & {});

function message(code: SqlMigrationRunnerErrorCode): string {
  switch (code) {
    case 'MIGRATION.POLICY_VIOLATION':
      return 'The migration breaks a policy';
    case 'MIGRATION.PRECHECK_FAILED':
      return 'A check before the migration failed';
    default:
      return `Unexpected error ${code}`; // required: `const x: never = code` does not compile
  }
}
```

Every exported type that lists the values of something a user may handle case by case is one of four kinds, and a check in CI fails on an exported set that is not declared:

- **Open.** We may add a value in any release. The type carries a catch-all member, so a user's exhaustiveness check cannot compile and a new value falls to their default branch.
- **Closed.** It changes only in a major version.
- **Input.** Users only pass its values to us. It stays a plain union.
- **Type parameter.** It keys other types, such as the kinds that key a contract view's entries. It stays a plain union.

## Why

From 8.0.0 an application upgrades to any later 8.x with no code changes. A plain union of the values we emit breaks that promise without anyone removing anything. A user who checks exhaustively, as TypeScript's handbook teaches with `never`, has code that compiles against 8.0 and fails against the release that adds a value. Their only fix is a code change.

There are two ways out. We could never add a value within a major, which would stop us reporting a new kind of failure until 9.0. Or the type could say from the first release that it may grow. Rust marks such enums `#[non_exhaustive]`, Kubernetes asks that an enumerated field say in its first release how clients treat an unknown value, Stripe marks each enum open or closed, Relay adds `'%future added value'` to every generated enum, and the AWS SDK adds `$UnknownMember` to every union. They all reach the same conclusion: it has to be decided when the set is first published, because adding the catch-all later breaks the same code the catch-all protects.

## What decides a set's kind

The direction its values flow.

- A set users **receive** from us (error codes, refusal kinds, statuses) is open or closed. It is open when we may need a new value: error and refusal codes are open, and so is any set an extension can add to. It is closed when the values are fixed by something outside the release, such as SQL's sort directions or PostgreSQL's referential actions, or when a new value is our own change that we make only in a major. The aggregate alphabet `AggregateFn` is closed because a new SQL aggregate arrives as a contributed operation ([ADR 020](ADR%20020%20-%20Result%20Typing%20Rules.md)). The unions of syntax-tree nodes are closed because an extension adds an operation, raw SQL or a raw command, never a node kind, and their visitors have one required method per kind, so a new kind would break every visitor anyway. `CodecTrait` is closed because [ADR 214](ADR%20214%20-%20Extension%20operator%20surface%20namespaced%20replacement%20operators.md) relies on it staying closed.
- A set users only **pass in** (an option, a codec's `jsonType`) is an input. Adding a value never breaks them, and a catch-all member would take away the compiler's check of their spelling: `jsonType: 'date'` would compile and fail at run time.
- A set that is a **type parameter** of other types is not something users switch over. A catch-all member would make the types built from it accept any key.

## The catch-all member

- A union of strings gets `(string & {})`. Unlike plain `string`, it keeps the named values in editor completion.
- A union of codes under a prefix gets a template, such as `` (`MIGRATION.${string}` & {}) ``, where a framework type requires the prefix.
- A union of numbers gets `(number & {})`.
- A union of objects told apart by `kind` gets a member whose `kind` is `'%future added value'`, carrying the members every kind shares, such as `reason`. A member with `kind: string & {}` would stop narrowing on `kind` altogether; the sentinel keeps it. It suits only a union users receive: on one they pass in, it would let them pass a value that cannot exist. It cannot carry a class's methods, which is a second reason the unions of syntax-tree classes are closed.

Where our own code switches over an open set, it has a real default branch. A path a user can reach returns an ordinary error. A path the same release cannot reach throws `InternalError`.

## How it is checked

`pnpm api:sets`, run in CI, reads each published package's `api.txt` listing. It finds unions of literals, unions derived from a constant (`(typeof X)[number]`, `keyof typeof X`), unions of objects told apart by a literal `kind`, generic aliases of these, and such unions written on an exported type's property. A set without a catch-all member must be listed in `packages/9-public/value-sets.json` with its kind and a reason. The check also fails on an entry that names no exported set, names an open set, or repeats another entry. How to read its report is in [Public API Compatibility](../../Public%20API%20Compatibility.md#sets-of-values).

## Consequences

- A user writes a default branch for every open set from the start. They lose the compiler's help in noticing a new value they might want to handle. In return, no release breaks their build by adding one.
- Adding a value to an open set is a compatible change. Adding one to a closed set is a breaking change, made only in a major.
- A set we publish later must be declared in the pull request that publishes it, because the check fails until it is.
- The check reads the API listings, so a union it does not recognise is not checked. The shapes it reads are listed above.

## Alternatives considered

- **Never add a value within a major.** Rejected: a new failure would have to reuse an existing code until 9.0, and a code that means two things is worse for users than a default branch.
- **Plain `string` for open sets.** Rejected: users lose completion of the named values and the compiler's check of a value's spelling where they compare.
- **Open every set.** Rejected: an input set would lose its spelling check, and a type parameter would make the types built from it accept anything.
- **Document which sets may grow, without changing the types.** Rejected: nothing would stop a user writing the exhaustiveness check that the next release breaks.
