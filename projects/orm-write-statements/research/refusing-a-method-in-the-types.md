# How the types can refuse `deleteAll()` on a contract without `returning`

Spike, 2026-11-24. TypeScript 5.9.3 with the repo's base compiler options, compiled through the compiler library by `probe.mjs`. Raw output: `probe-output.txt`, `pretty-output.txt`. Scratch files: `base.ts`, `option-*.ts`, `usage-*.ts`, `lock-today.ts`.

The call tested is `db.Post.where(x).deleteAll()` on a contract whose type has no `sql.returning`.

| Option | Compiler error | In editor completion | A helper written for any contract / for contracts with `returning` | A user's subclass and `this` chaining |
| --- | --- | --- | --- | --- |
| A. The property's type is `never` (what the SQL query builder does for `.returning()`) | `TS2349: This expression is not callable. Type 'never' has no call signatures.` | Yes | Any contract: compiles with no error, so the call fails at run time. With `returning`: compiles | Works |
| B. The rest parameter's type is `never` (what the lock methods do today) | `TS2345: Argument of type '[]' is not assignable to parameter of type 'never'.` | Yes | Both fail | Works |
| C3. A `this:` marker named for the requirement, checked against a view of the capabilities whose missing value is a message | `TS2684 … method's 'this' of type 'Collection<MySqlContract> & HasWhere & DatabaseReturnsRows'` … `Type '"this database does not return written rows (no RETURNING); use deleteAndCount() or updateAndCount()"' is not assignable to type 'true'.` | Yes | Any contract: error ending with the message. With `returning`: compiles | Works |
| D1. The method removed with a conditional type and `Omit` | No error: `where()` brings the method back | Not after `db.Post.`, yes after `.where(x).` | Not reached | Broken (`TS2509`) |
| D2. A second class that adds the method, chosen per contract | `TS2339: Property 'deleteAll' does not exist on type 'Filtered<Collection<MySqlContract>>'.` | No | Both fail | A user's `extends Collection` loses the method on every database |
| E1. `this` intersected with an object whose key is the message | `Property ''deleteAll() needs a database that returns written rows (RETURNING); use deleteAndCount()'' is missing in type …` | Yes | Both fail | Works |
| E2. The message as a required argument's name | `TS2554: Expected 1 arguments, but got 0.` | Yes | Both fail | Works |

Today's `forUpdate()` on a contract without `sql.forUpdate` gives option B's error.

Findings:

- Only option D takes the name out of editor completion, and it cannot be built on a class that users extend.
- Only option C3 states the reason and the alternative in the compiler's text while helpers written over contracts still work.
- In C3, an unfiltered `db.Post.deleteAll()` reports only the missing filter; the `returning` message appears once the call has a `where()`.
- C3 is the mechanism the collection already uses for `HasNoUniqueFilter`.
- The message is on the last line of a four-line error, so the marker's name has to read well alone.
