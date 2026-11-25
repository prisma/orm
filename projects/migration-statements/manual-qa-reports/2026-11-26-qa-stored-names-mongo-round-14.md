# Manual QA — stored-name renames on MongoDB, round 14

Date: 2026-11-26. Branch `gandhi-65/tml-3840-mongo-stored-name-renames`, commit `33c25ddb54`. Earlier round: `2026-11-25-qa-stored-names-mongo-round-13.md` in this folder. This round checks the fixes for the third CodeRabbit review (`wip/coderabbit/triage-3.md`).

Status: done. One new finding (35, minor). Every other case did what its text said, and every document ended where the text said it would.

## Setup

- Tree already built at the tip; no build run. MongoDB 8.2.6, one-node replica set from mongodb-memory-server (`wip/qa-mongo/startdb.mjs`), stopped at the end.
- Round 13 helpers reused (`setup.sh`, `c.sh`, `q.mjs`, `ins-move.mjs`).
- Projects `wip/qa-mongo/r14a`–`r14j`; contracts `ctr/r14*.prisma`, and TypeScript contracts `ctr/r14a0.ts`, `ctr/r14a1.ts` (PSL has no time-series option).
- To stop an apply, I inserted a document with a wrong type, bypassing validation.

## Results

| # | Item | Projects | Verdict |
| - | ---- | -------- | ------- |
| 1 | Model moves out of a shared collection into a new time-series collection | `r14a` | ⚠️ 35 |
| 2 | Model merges into an existing collection; the source collection stays | `r14b` | ✅ |
| 3 | Int32 enum swap of 2147483647 and 2147483646 | `r14c` | ✅ |
| 4 | Copy whose pipeline changes `_id` is rejected | `r14d`, `r14e`, `r14f` | ✅ |
| 5a | Dropped-source move with a stop and a re-run | `r14g` | ✅ |
| 5b | Move into a shared collection with a stop and a re-run | `r14h` | ✅ |
| 5c | Plain `@@map`, `@map`, enum value change, `migration plan` and `db update` | `r14i`, `r14j` | ✅ |

### 1. Move into a time-series collection

`r14a`: `Event` and `Measurement` in `events`. After: `Event` stays, `Reading` in new `measurements` with `timeseries: { timeField: 'at' }`. `--rename Measurement:Reading` is refused. The route is the hand-written one, with no `rawAggregate` copy, and ends: "Collection "measurements" is a time-series collection, which a $merge stage cannot write into, so no rawAggregate copy can move the documents there: insert them yourself, as insertMany in mongosh does." The fix works as intended. See finding 35 for what happens when you follow it.

The plain plan (without `--rename`) asked nothing: create `measurements`, then update the `events` validator. Applying it fails with `'timeseries' is not allowed with 'validator'`, the known main defect in `deferred.md`. I removed the validator from the create by hand to go on.

### 2. Merge into an existing collection, source kept

`r14b`: `User` and `Admin` in `users`, `Guest` in `members`. After: `Admin` in `users`, `Member` (was `User`) and `Guest` in `members`. The refusal says `User` "is then removed and nothing is asked, since nothing is deleted", and asks for no `--delete`. The plain plan asked nothing. I added the copy and the delete it prints. End: `users` A2, `members` U1 and G9. Next plan empty.

### 3. Int32 enum swap at the top of the range

`r14c`: `@@type("mongo/int32@1")`, `TOP = 2147483647`, `NEAR = 2147483646`, `LOW = 1`; the change swaps `TOP` and `NEAR`. The refusal suggests temporary values 0 and 2, both Int32 values no member stores. I followed both plans. End: the documents hold 2147483646 and 2147483647, still stored as `int`. Next plan empty.

### 4. Copy whose pipeline changes `_id`

User leaves `users` and joins `Guest` in `members`. The copy runs before the validator update, so the old validator rejects it.

- `r14d`, `$set` of `_id`: the error names "the rejected document with _id ObjectId("00000000000000000000000a")" that the copy wrote. It gives no `find` in `users` by that `_id`. I followed the bypass advice and it applied.
- `r14e`, `$group` by `email`: the same; it names `_id "u"` and does not send you to the source. After the bypass, the `members` validator update stopped on the string `_id`. I replaced that document by hand and re-ran: applied.
- `r14f`, `$set` of `_id` with `checkDocuments` removed from the update: the advice says to set `checkDocuments` to true and add the bypass, or change the pipeline. It no longer says to fix the document in its source. Finding 34 from round 13 is fixed too.

### 5. No regression

- 5a `r14g`: `User` and `Staff` leave `users` for `members` and `crew`; `users` is dropped. The refusal asks for `--delete` on both models, and the plain plan asked exactly that. A `Staff` document with `badge: 7` stopped the copy, which named its `_id` and a `find` in `users`. I fixed it there and re-ran: applied. End: `members` U1, `crew` S2 and S4, `users` gone. Next plan empty.
- 5b `r14h`: item 2's case with a `User` document holding `name: 5`. The `members` validator update stopped and named the `_id` and the field. I used the printed bypass update command and re-ran: applied. End: `members` U1, U5, G9; `users` A2. Next plan empty.
- 5c `r14i`: `@@map("items")` → `things`, `title @map("t")` → `ttl` (indexed), enum `"low"` → `"lo"` on a scalar and a list field. Nothing asked; 7 operations; documents and index right; next plan empty. `r14j`: the same with `db update`: 7 operations, same result; the second run had nothing to do.

## Findings

### ⚠️ 35. The time-series route says no `rawAggregate` copy can move the documents, but `$out` can

`r14a`. The text says that because `$merge` cannot write into a time-series collection, "no rawAggregate copy can move the documents there", and sends you to insert them yourself, as `insertMany` in mongosh does. No migration operation inserts documents, so this means doing it outside the migration. That cannot fit in one apply: the plan's validator update on `events` checks documents, so the `Measurement` documents must leave `events` before it, but the insert into `measurements` cannot happen until the create has run. The text does not say how to order that.

A copy inside the migration does work. I added, right after the create:

```ts
dataTransform('move Measurement documents to measurements', {
  run: () => rawAggregate('events', [
    { $match: { at: { $exists: true } } },
    { $out: { db: 'r14a', coll: 'measurements', timeseries: { timeField: 'at' } } },
  ]),
}),
deleteDocuments({ collection: 'events', filter: { at: { $exists: true } } }),
```

The document moved into `measurements` and was deleted from `events`. The apply then stopped only at the schema check, because I had removed the validator to get past the known defect. `$out` replaces the whole target collection, so it is only safe when the collection is new, which is the case here. `$out` into a time-series collection needs MongoDB 7.0.3 or later.

Suggested fix: when the time-series destination is new, offer a `rawAggregate` copy with `$out` and its `timeseries` option, and say it replaces the collection. Otherwise, say how to order an insert done outside the migration.

## Wording preferences, not findings

- `r14a`, `r14b`: "Its documents stay in collection "events", where model "Event" still reads them." That is true because no discriminator tells the models apart, but it reads oddly for documents that lack `Event`'s required `name`.
- `r14e`: the validator check's advice for a wrong `_id` type suggests an update with `$set` of the field. MongoDB cannot change `_id` with an update; the document has to be replaced.

## Cleanup

MongoDB is stopped. Scratch projects and contracts stay under `wip/qa-mongo/` (gitignored). No tracked file other than this report was changed, and nothing was committed.
