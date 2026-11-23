# Handover: what a read does with a stored value the codec cannot convert

Written 2026-11-24 by wilde-23 for the next agent. Read this file, then `design-notes.md` beside it, before you reply to Will.

## What this work is

A design discussion with Will, the operator. It is not a build. Will's words: "Your job is not to create a solution. It is to help me and you together reason through and produce an optimal design solution/outcome." You are his design partner, in the role of an experienced principal engineer.

Nothing has been built. There is no ticket, no pull request and no Drive project. Do not start one, write an ADR, or change code until Will says to build. Agreement in discussion is not a go-ahead.

## The problem

A typed query reads a field, and the stored value cannot be converted to the type the query promises. Example: a MongoDB document holds the text `"hello"` in a field the contract declares as `Int`.

Today each codec decides for itself, and they disagree. On MongoDB, `Int`, `String`, `Boolean` and `Date` return whatever is stored, `Float` converts with `Number()` and can return `NaN`, and `BigInt`, `Decimal`, `Bytes`, `Json` and the Temporal types throw. A throw fails the whole query for one bad field. No application wraps a read in a try/catch, so that is an unhandled production error. There is no client option, no per-field fallback and no hook on the read path.

The original question was wider: what codecs do when a value cannot be converted safely in either direction (integers, dates and times, JSON, arbitrary JavaScript types). The discussion narrowed to reads, because a refused write is recoverable (nothing is sent, and the caller gets the error on the line that passed the value) and a failed read is not.

## The outcome Will wants

One general rule, documented for users and codec authors and reflected in the errors. Existing codecs may be revisited to follow it.

## Where the discussion stands

`design-notes.md` holds the full state: the read options, 14 scenarios each marked Agreed or Open, what an application developer wants, who is responsible for what, what the code does today, the recorded decisions this would change, nine open questions, and what other tools do.

The main agreed points:

- A query that type checks against the contract must succeed and must return the shape the types promise. Connection failures are out of scope.
- Constraints in the database are the first defence. MongoDB, and nested JSON checked against a schema on any database, will always let some bad values through.
- Order of handling on a read: convert when the conversion loses nothing (`"42"` to `42`); otherwise use a fallback value; report what was replaced.
- A fallback applies only when the codec positively recognises "a value of a kind I do not hold". It never applies because something threw. Fallbacks are off in tests, so bugs in Prisma stay loud.
- Failing in development and falling back in production was dropped, because bad data lives in production.
- A primary key needs its own rule: two documents would share one fallback id.
- Which failure is worse depends on the field. A product list should still render; an account balance must not read as `0`.
- A foreign key that falls back to an id matching nothing is correct. A nullable field falls back to `null`.

Will's position: every codec has a public, documented default fallback, a field may declare its own, and a read never fails. He rejected requiring developers to declare a fallback for every required field: "I don't expect application developers to know whether the database can guarantee a value or not".

## What is waiting

1. Will has not replied to the working doc. He was asked to check whether any item marked Agreed is still open for him, and whether the "contract author" row in the responsibility table is right.
2. One point of mine he has not answered. He said writing a fallback back to the database heals the data. My concern: unreadable values often hold the right information in the wrong form (`"yes"`, `"2024-03-01"`). Once a fallback overwrites them, the information is gone and nobody can find the affected rows. This is why the exact-conversion step should stay.
3. The next open question, which I had just put to him: can a developer choose "fail" instead of "fall back", and at what level (per client, per field, or both)? My recommendation was fallback as the default, with an option to fail on the client and on the field.
4. The other eight open questions are in section 9 of the notes. Take them in order, one per message.

## What this would change

Say so plainly whenever a proposal touches these:

- The codec registry decision (`docs/architecture docs/adrs/ADR 030 - Result decoding & codecs registry.md`): a failed decode raises `RUNTIME.DECODE_FAILED`, and defaults prefer correctness "over silent coercion".
- The codec authoring guide (`docs/reference/codec-authoring-guide.md`): `fromWire` refuses a value the column's type does not hold.
- The integer types reference (`docs/reference/integer-representation-types.md`): the `number` codecs for 64-bit integers "guard instead of rounding", on reads too.
- The data types decision (`ADR 254 - Data types and casts.md`): a value a type cannot hold is "refused, never rounded". That is about values written in a contract. We have not proposed changing it.
- The decision that validations are not in the core (`ADR 293`), and the project value that the core does not include what an extension can build.
- `docs/reference/mongodb-user-promise.md` (the schema validation part) already describes an unbuilt permissive read mode that reports mismatches. This design would deliver it.
- The codec interface is in `packages/1-framework/1-core/framework-components/src/shared/codec.ts`. The repository rule is never to change the framework domain without telling Will first. A fallback on the codec interface would be such a change.

## How to work with Will on this

He corrected me on each of these, so they matter:

- Write short, full, plain sentences. He could not read my compressed paragraphs and asked me to rewrite them.
- Never suggest an application catches a read error. He rejected that in strong terms.
- He does not care about computed values such as `sum()`; the subject is ordinary stored values. He also dismissed database features that might close the gap later: "There will always be cases where we can't rely on the data matching expectations."
- Agree goals and requirements before mechanisms, and lay options side by side. Do not ask him to accept one mechanism early. Do not invent names for things.
- Take a position and argue it. He asks for critical evaluation and for the opposite case.
- One question per message. No question UI.
- The design notes were written as a record of what was said. Before the next edit, reframe from what the developer fears and wants, not as minutes. After any edit, have an independent reviewer agent (Opus, high effort) check the doc before you report it.

## Sources

- My transcript, with the full discussion, the code survey spot-checks and the three prior-art research reports: `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-codex-type-conversion-strategy-4e73d9/43bbede0-1c41-46f7-88d7-9f87d24eba8e.jsonl`
- The session before mine (goya-38, started in the wrong repository) holds the original codec-by-codec code survey: session id `local_08f80c5f-bb45-4d7a-9e66-1c361ed4029f`, readable with the session management `list_events` tool.
- The code survey was made at commit `a766000caf` on `main`. It was read, not run. Check the code again before you state any of it as fact.
- Related finished work: the scalar convenience types project (its last pull request was prisma/orm#31126), which set what each convenience type means on every target.

## Files and branch

- Branch `design/reading-unconvertible-values`, pushed to the `bot` remote. It adds only this folder. No pull request, and none is wanted yet.
- `projects/reading-unconvertible-values/design-notes.md`: the working doc.
- `projects/reading-unconvertible-values/handover.md`: this file.
