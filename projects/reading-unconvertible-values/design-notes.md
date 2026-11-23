# Reading a stored value the codec cannot convert

Working notes for the design discussion between Will and wilde-23. Nothing here is a recorded decision. Each item is marked **Agreed** (we both said yes in the discussion) or **Open**.

Last updated: 2026-11-21.

## 1. The problem

A typed query reads a field. The stored value cannot be converted to the type the query promises. Example: a MongoDB document holds the text `"hello"` in a field the contract declares as `Int`.

Today each codec decides for itself what to do, and they disagree. Section 7 lists what they do.

## 2. What we agree on

1. **The promise to the application.** A query that type checks against the contract (not a raw query) must succeed, and must return a result in the shape the type system promises. Connection failures and timeouts are a separate matter.
2. **Nobody wraps a read in a try/catch.** So a read that throws is an unhandled error in production.
3. **Nobody reads diagnostics.** A developer who does not catch read errors will not set up a diagnostics handler either. We have no answer to this yet.
4. **Writes are different.** A refused write sends nothing to the database, and the caller gets the error on the line that passed the value. Prisma must never write a value it could not read back.
5. **Constraints come first.** Wherever the database can enforce a type, a constraint keeps the bad value out. The rest of this document is about values no constraint can check.
6. **Who is at fault when a read meets a bad value:**
   - The stored value breaks the database's own schema: a bug in the database.
   - The database's schema allows a value the contract does not: a bug in the ORM.
   - The value fits the contract and the codec still cannot convert it: a bug in the codec.
7. **MongoDB cannot make the first of those guarantees in full.** Neither can any database for a nested JSON value checked against a schema. So bad stored values will always exist somewhere.
8. **Order of handling** for a value the codec cannot convert directly:
   1. Convert it, when the conversion loses nothing (`"42"` to `42`).
   2. Otherwise use a fallback value.
   3. Report what was replaced.
9. **A fallback is used only in a recognised case.** The codec decides "this value is a kind I do not hold". It never falls back because something threw. Any other error is a bug and stays loud.
10. **Fallbacks are off in tests**, so a bug in Prisma fails a test instead of producing a quiet fallback.
11. **Not tied to the environment.** Failing in development and falling back in production was rejected: bad data is in production, not in development databases.
12. **A primary key needs its own rule.** See scenario 8 in section 4.

## 3. Options for what the read does

| Option | What the application receives | Does the value match the promised type? | What is lost or risked |
| --- | --- | --- | --- |
| Fail | An error. No rows. | Not applicable | The whole query fails for one bad field. Nobody catches it. |
| Convert exactly | The same information in the promised type | Yes | Nothing, if the conversion rules are strict |
| Fall back to a value the codec defines | A fixed value of the promised type, such as `0` | Yes | The stored value's meaning. A real `0` and a fallback `0` look the same. |
| Fall back to a value the field declares | The value the developer chose for this field | Yes | The same, but the developer chose it |
| Pass the stored value through unchanged | Whatever is stored, such as text in a number field | No | The application fails later, far from the read, or writes the value somewhere else |
| Read as missing or `null` | `undefined` or `null` | Only if the field is nullable | A required field breaks its type |
| Drop the row | The other rows | Yes | The row vanishes from results without a trace |
| Return the value with a marker in the type | A result that says "unreadable" in its type | Yes, but the type is no longer a plain `number` | Every field's type gets harder to use |

The last four came from the discussion and from other tools. Spark offers "drop the row". Mongoose and Mongoid read the field as missing. GraphQL returns `null` with an error list beside the data.

**Will's position:** every codec has a default fallback, a field may declare its own, and a read never fails. The fallback is part of the public contract: documented, predictable and the same everywhere.

**Open:** whether the developer can choose "fail" instead, and how (an option on the client, with fallback as the default, is wilde-23's proposal).

## 4. Scenarios

"Today" is from a survey of the code on `main` at commit `a766000caf`. It was read, not run.

| # | Scenario | Example | Today | Status |
| --- | --- | --- | --- | --- |
| 1 | Wrong kind, exact conversion exists | `"42"` in an `Int` field | MongoDB `Int` returns the text. `BigInt` throws. `Float` converts. | **Agreed:** convert |
| 2 | Wrong kind, no conversion | `"hello"` in an `Int` field | Same as above; `Float` returns `NaN` | **Agreed:** fall back. **Open:** to what |
| 3 | Right information, wrong form | `"yes"` in a `Boolean` field; `"2024-03-01"` in a date field | MongoDB `Boolean` and `Date` return the text | **Open:** which conversions count as exact |
| 4 | Valid value the application type cannot hold | 2^60 in a `BigInt(as: number)` column | Throws on every target | **Open.** A rounded number is a wrong value. A constraint on the column would prevent it. |
| 5 | Required field is missing | A MongoDB document without the field | Reads as `undefined`, no error | **Open** |
| 6 | Required field holds `null` | | Reads as `null`, no error | **Open** |
| 7 | Unknown enum value | `"archived"` where the enum has `active` and `deleted` | Returned as stored, on every target | **Open.** An enum has no natural fallback member. |
| 8 | Primary key cannot be read | A text `_id` where the contract says `ObjectId` | Throws | **Open.** Two documents would share one fallback id. An update by that id changes nothing, or changes another document. |
| 9 | Foreign key cannot be read | | Throws on MongoDB `ObjectId` | **Agreed:** a fallback id that matches nothing is correct; the result is "not found" |
| 10 | Nullable field cannot be read | | Varies by codec | **Agreed in passing:** `null` is the fallback |
| 11 | Nested JSON does not match its schema | A typed JSON column holding rows from before a schema change | The arktype JSON codec throws on read. It does not check on write. | **Open.** There may be no value we can construct for the schema. |
| 12 | One element of a list is bad | `[1, "x", 3]` in an `Int[]` field | Not surveyed | **Open** |
| 13 | A filter and a fallback disagree | A row reads `age: 0` by fallback, but `where age = 0` does not find it | The database never sees the fallback | **Open** |
| 14 | The codec drops precision by design | A `Date` codec reading a timestamp with microseconds | Microseconds are cut silently | **Open:** is this a fallback, a conversion, or a codec bug? |

## 5. What the application developer wants

1. **A read that works.** A product list should render when one product has a bad field.
2. **A value they can trust.** An account balance must not read as `0` because the stored value was unreadable. For this field a failure is better than a wrong value.
3. **Both, chosen per field.** Which is worse depends on the field. So a default is needed, and a way to change it.
4. **Predictable behaviour.** The same bad value gives the same result on every read, on every target, in every release.
5. **To fail fast while building.** A developer wants to find a mistake in tests, not in production.
6. **To hear about bad data without setting anything up.** A warning in the logs they already read.
7. **To find and repair the bad data later.** A fallback that the application writes back replaces the bad value. After that, no query can find which documents were affected.
8. **Not to need to know what the database guarantees.** The rule should be the same whether or not a constraint backs the field.

## 6. Who is responsible for what

| Part | Its job |
| --- | --- |
| Database | Enforce the schema it was given: column types, check constraints, collection validators. |
| Migration system | Give the database a schema that admits only values the contract's types can hold. Check existing data before it adds a constraint or a validator. Verify the schema matches the contract (`db verify`). |
| ORM query runtime | Never write a value the contract does not allow. Hand each codec the right column. Carry the report of a fallback to the developer. Apply the fail-or-fall-back choice. |
| Codec | Convert every value its column can hold, exactly. Recognise a value of a kind it does not hold. Define its default fallback. |
| Contract author (the developer) | Declare a fallback for a field where the codec's default is wrong for the application. Declare the constraints the data needs. |
| Application code | Nothing on a read. Handle refused writes. |

**Open:** which part owns "exact conversion" rules, so every codec converts the same way.

## 7. What the code does today

- **Writes.** MongoDB and MySQL codecs check the value. Most PostgreSQL and SQLite codecs pass it to the driver. PostgreSQL then refuses or rounds it.
- **Reads on MongoDB.** `Int`, `String`, `Boolean` and `Date` return whatever is stored. `Float` converts with `Number()`. `BigInt`, `Decimal`, `Bytes`, `Json` and the Temporal date types throw.
- **Reads on SQL.** Codecs throw on text they cannot parse and on a value the application type cannot hold. PostgreSQL `Date` codecs cut microseconds silently.
- **No way to tolerate a bad value.** No client option, no per-field fallback, no hook on the read path.
- **Errors.** A failed read fails the whole query. On a plain SQL read the error does not name the table or column.

## 8. Recorded decisions this would change

- The original codec registry decision says a failed decode raises `RUNTIME.DECODE_FAILED`, and that defaults should prefer correctness "over silent coercion".
- The codec authoring guide says `fromWire` refuses a value the column's type does not hold.
- The integer types reference says the `number` codecs for 64-bit integers "guard instead of rounding", on read as well as on write.
- The data types decision says a value a type cannot hold is "refused, never rounded". That rule is about values written in a contract (defaults, enum members). We have not proposed changing it.
- The MongoDB promise document already describes a permissive read mode that reports mismatches. It was never built. This design would deliver it.

## 9. Open questions

1. Can the developer choose "fail" instead of "fall back"? Per client, per field, or both?
2. What is each codec's default fallback? Which codecs have no natural one (enum, id, typed JSON)?
3. What is the rule for a primary key?
4. Which conversions count as exact?
5. How does a fallback reach a developer who set nothing up?
6. How does a developer find the bad data afterwards?
7. Does this apply to SQL as well as MongoDB, or only where the database cannot enforce the type?
8. What happens to a valid value the application type cannot hold (scenario 4)?
9. What do filters and sorting do with a row that reads by fallback (scenario 13)?

## 10. What other tools do

| Behaviour on a value they cannot read | Tools |
| --- | --- |
| Fail the query | Prisma 7, Ecto, Hibernate, SQLAlchemy (enums), Beanie, the typed MongoDB drivers |
| Return something quietly | ActiveRecord (`"abc"` reads as `0`), Mongoose (field unset, error kept on the document), Mongoid (`nil`, raw value still readable), Doctrine |
| Pass the driver's value through | Kysely, Drizzle, TypeORM, mostly Django |

- Almost every tool that converts at all converts `"42"` to `42`.
- A fallback declared per field is common and well regarded: Avro reader defaults, serde `default`, Zod `.catch()`.
- Prisma 7's failing read on MongoDB has an open complaint: [prisma/orm#15871](https://github.com/prisma/orm/issues/15871).
