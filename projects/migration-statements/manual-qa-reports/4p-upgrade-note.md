# Manual QA — the 4p app upgrade note, followed as printed

**Date:** 2026-10-19 · **Branch:** `tml-3553-ts-validator-pr2` · **Note:** `upgrade-instructions/pending/mongo-typescript-contract-validator/app/instructions.md`

## Result

The note works as printed on both paths. Each path ends with `prisma db verify` clean: "Database marker and schema match contract", exit 0. A document with an undeclared field is then refused with code 121. Following the note led to one change in it: step 4 now says to plan from the migration the database is at.

## Setup

- MongoDB: a one-node replica set started with mongodb-memory-server on port 27931 (`wip/pr2-d3/mongod.mjs`).
- Project: `qa-4p`, inside the CLI e2e test app, so `@prisma/orm-mongo` and the `prisma` bin resolve to the workspace build. It was deleted afterwards. `prisma.config.ts` uses `@prisma/orm-mongo/config` with `contract: './contract.ts'` and `output: './generated'`. The contract has one model, `User`, in collection `users`: `_id: field.objectId()`, `email: field.string()`, `name: field.string().optional()`, and a unique index on `email`.
- The "before" state: the pre-change builder (`contract-builder.ts` at `c318b87524`) was checked out and built temporarily. With it, `prisma contract emit` wrote storage hash `6c6134e3…` and no validator. The source was then restored and rebuilt.
- Step 2 was run in real `mongosh` 2.13.0 (`pnpm dlx mongosh@2`, with Will's approval on 2026-10-19), against the same kind of replica set, with the TypeScript-emitted `test/integration/test/mongo/fixtures/generated/contract.json` in the current directory. The snippet was copied from the note unchanged and run both with `--file` and as pasted text (`--eval`). With one valid `users` document and one with an extra `nickname` field, it printed `tasks 0 []` and `users 1 [ { …, name: 'Bad User', nickname: 'extra' } ]`. `require('fs')`, the relative path and mongosh's implicit awaiting all work as the note assumes. The earlier Node driver run is kept below for the full upgrade path.

## Path A: `db update`

| Step | Command | Output |
| --- | --- | --- |
| Before | old builder: `prisma contract emit`, `prisma db update --no-interactive` | Applied 1 operation; the `users` options have no validator |
| Before | insert 4 documents: one valid, one with extra field `nickname`, one with `email: 42`, one without `email` | inserted |
| 1 | `prisma contract emit` (new builder) | hash `778f20d8…`; `users.validator` is closed, `required: ['_id', 'email']` |
| 2 | the note's snippet, from `generated/` | `users 3 [ {…nickname:"bobby"}, {…email:42}, {…name:"no email"} ]` |
| 3 | fix the three documents (`$unset` nickname, set the two emails), run step 2 again | `users 0 []` |
| 4 | `prisma db update --no-interactive` | `validator.users.add`, class `widening`; "Applied 1 operation(s) … signature updated" |
| 5 | `prisma db verify` | exit 0, "Database marker and schema match contract", "Schema matches contract" |

The collection options afterwards hold the derived `$jsonSchema` with `validationLevel: strict` and `validationAction: error`.

## Path B: `migration plan` and `db migrate`

| Step | Command | Output |
| --- | --- | --- |
| Before | old builder: `prisma contract emit`, `prisma migration plan --name initial`, `prisma db migrate` | `20261019T0752_initial`; no validator |
| Before | insert 2 documents, one with extra field `nickname` | inserted |
| 1 | `prisma contract emit` (new builder) | hash `778f20d8…` |
| 2 | the note's snippet | `users 1 [ {…nickname:"bobby"} ]` |
| 3 | `$unset` `nickname`, run step 2 again | `users 0 []` |
| 4 | `prisma migration plan` | exit 2, `MIGRATION.PLAN_ORIGIN_UNKNOWN`: the project has no `db` ref. This is the CLI's usual behaviour, not specific to this change. The note now says to plan from the migration the database is at. |
| 4 | `prisma migration plan --name validators --from 20261019T0752_initial` | `validator.users.add`, class `widening` |
| 4 | `prisma db migrate` | "Applied 1 migration(s) (1 operation(s))" |
| 5 | `prisma db verify` | exit 0, "Database marker and schema match contract" |
| After | insert `{ email, extra: 1 }` | refused, code 121 |

Logs: `wip/pr2-d3/qa-*.log`.

## Path C: keeping documents whose `_id` is not an ObjectId

**Superseded (2026-10-19).** Will replaced the rule that an `_id` must be an ObjectId: a declared `_id` now keeps its own BSON type. The note's section this path followed was removed, so this record and "Path C in real mongosh" below describe a section the note no longer has.

**Date:** 2026-10-19. The note's section "Keeping documents whose `_id` is not an ObjectId" was followed on a TypeScript project, against mongodb-memory-server on port 27932. It now works as printed, after three changes to the note, which are listed after the table.

**How the `mongosh` steps were run.** I did not run `mongosh` myself: downloading it needs Will's approval given to me directly, and the approval came to me only through the coordinator. Each `mongosh` snippet was copied from the note unchanged and run through the Node driver with a small shim (`wip/pr2-id-qa/mongosh-shim.mjs`). The shim does three things mongosh does on its own:
- it waits for every database call before the script ends;
- it gives `db.<collection>` and `db.getCollection(name)`;
- it maps mongosh's `renameCollection(target, dropTarget)` to the driver's `rename(target, { dropTarget })`.

The step-2 query used the same shim as in paths A and B. Running the section's three snippets once in real `mongosh` would close this gap.

**Before.** The builder from `main` was checked out and built temporarily, then restored:
- `Event`, in collection `events`, has `_id: field.string()` and `name`.
- `Ticket`, in collection `tickets`, has an objectId `_id`, `seat`, `eventId: field.string()`, and `event: rel.belongsTo(Event, { from: 'eventId', to: Event.ref('_id') })`.
- `prisma contract emit` and `prisma db update` ran on that contract; neither collection has a validator.
- Inserted: events `launch` and `party`, and tickets `A1` and `B2` referring to them.
- Through the ORM, `tickets.include('event')` returns `A1 → Launch` and `B2 → Party`.

| Step | Command | Output |
| --- | --- | --- |
| Upgrade | `prisma contract emit` (new builder, old contract) | exit 2: `Model "Event" field "_id" holds the document id as BSON type string, but an _id must be stored as BSON type objectId: …` |
| Keeping 1, as first printed | `_id: field.objectId()`, add `legacyId: field.string()` | contract changed |
| Keeping 2 | the note's copy snippet | `events_copy` holds both events, each with a new ObjectId `_id` and `legacyId` `launch` or `party` |
| Keeping 3 | the note had no command; ran `db.events_copy.find().forEach(…updateMany({ eventId: event.legacyId }, { $set: { eventId: event._id } }))` | both tickets now hold the new ObjectIds |
| Keeping 4 | `db.events_copy.renameCollection('events', true)` | `events` holds the copied documents; `events_copy` is gone |
| Steps 1 | `prisma contract emit` | exit 0 |
| Steps 2 | the note's query | `events 0`, `tickets 2`: `eventId` is now an ObjectId, but the contract still says string. **The note misled here.** |
| Fix | `eventId: field.objectId()`; `prisma contract emit`; the query again | `events 0`, `tickets 0` |
| Steps 4 | `prisma db update --no-interactive` | `validator.events.add` and `validator.tickets.add`, class `widening`; "Applied 2 operation(s)" |
| Steps 5 | `prisma db verify` | exit 0, "Database marker and schema match contract", "Schema matches contract" |
| ORM | `tickets.include('event')` | `A1 → Launch`, `B2 → Party` |
| New data | made `legacyId` optional, emitted, `db update` (`validator.events.update`, class `widening`); then `events.create({ name: 'Closing' })` and a ticket for it | `A1 → Launch`, `B2 → Party`, `C3 → Closing`; `db verify` clean |

**Changes to the note:**
1. Step 1 now says to change every field that refers to the model by its id to `field.objectId()`, with the `belongsTo` example.
2. Step 1 now adds `legacyId` as `.optional()`. A required `legacyId` would make every new document, which has no old id, fail the validator.
3. Step 3 now gives the `updateMany` snippet.

Not covered: the claim that `db update` creates the contract's indexes again after the rename. This contract declared no indexes on `events`.

Logs: `wip/pr2-id-qa/`.

## Path C in real mongosh

**Superseded (2026-10-19)**, as Path C above.

Run on 2026-10-19 by the orchestrator with `mongosh` 2.13.0 (`pnpm dlx mongosh@2`, approved by Will), against a one-node replica set from mongodb-memory-server. The three snippets of "Keeping documents whose `_id` is not an ObjectId" were copied from the note unchanged and run in order with `--eval`.

| Step | Input | Result |
| --- | --- | --- |
| Seed | `events`: `{ _id: "evt-1", name: "Launch" }`, `{ _id: "evt-2", name: "Meetup" }`, index `name_1`; `tickets`: A1 → evt-1, B2 and B3 → evt-2 | seeded |
| 2 | copy snippet | exit 0; `events_copy` holds both events with new ObjectId `_id` and `legacyId` |
| 3 | `updateMany` snippet | exit 0; every ticket's `eventId` is the new ObjectId |
| 4 | `db.events_copy.renameCollection('events', true)` | `{ ok: 1 }`; collections are `tickets` and `events`; `events` has only `_id_`, so `name_1` was dropped as the note says |
| Check | `$lookup` from `tickets` to `events` on `eventId` | A1 → Launch, B2 → Meetup, B3 → Meetup |

Not covered here: `db update` recreating the contract's indexes after the rename. Path C's ORM run covers the rest of the upgrade.

### Path C, second run: stopping writes, collection options and indexes

**Date:** 2026-10-19. The note now says three more things: stop writes first, create the copy with the old collection's options, and what to do for a time-series collection. This run checks them, on mongodb-memory-server (MongoDB 8.2.6, port 27933). As in the first run, the `mongosh` snippets ran through the Node driver shim. The new first line of step 2 (`db.createCollection('events_copy', db.getCollectionInfos({ name: 'events' })[0].options)`) ran as its driver equivalent, `createCollection('events_copy', (await listCollections({ name: 'events' }).toArray())[0].options)`. It still needs one run in real `mongosh`.

**Which options copy.** For each of these, I created a collection with the option, read its options back, created a second collection with them, and renamed the second over the first with `dropTarget`:

| Option | Copied | Renamed over the old collection |
| --- | --- | --- |
| collation | yes, with MongoDB's defaults filled in | yes |
| `capped` with `size` | yes | yes |
| clustered index | yes | yes |
| clustered index with `expireAfterSeconds` | yes | yes |
| change stream pre- and post-images | yes | yes |
| time series | yes | **no:** `cannot rename view`. The note now says to drop `events`, create it again with the saved options, copy the documents back and drop the copy. I ran that through the driver: the documents came back with ObjectId `_id`s and the time-series options were kept. |

**Indexes come back after the rename.**
- Before: `events` had string `_id`s and a unique index on `name`; `tickets` referred to the events by their old id. This state was created directly in the database.
- Steps 1 to 4 of the section: the copy, the reference update and the rename all succeeded. After the rename, `events` had only its `_id` index.
- The note's Steps: `contract emit`; the query listed `events 0` and `tickets 0`; `db update` planned `index.events.create(name:1)` (additive) and `validator.events.add` and `validator.tickets.add` (widening), and reported "Applied 3 operation(s)".
- After: `events` has its unique index on `name` again. `db verify` is clean, and `tickets.include('event')` through the ORM returns `A1 → Launch` and `B2 → Party`.

**A defect this run found, which this change does not cause.** A TypeScript contract with `collectionOptions: { collation: … }` on a collection cannot be applied:
- With the builder from `main`, and with this branch, on a fresh database, the first `db update` fails with "Operation index.events.create(name:1) failed during postcheck" when the collection also declares an index.
- A second `db update` then fails with "Cannot change immutable collection option 'collation' on events".
- With the collation removed, both runs succeed. With the index removed but the collation kept, the second run still fails.

The planner seems to compare the collation the contract states with the full collation MongoDB reports back, which MongoDB fills with defaults. This needs its own ticket.

Logs: `wip/pr2-r2-qa/`.

## Path C, updated steps, in real mongosh

Run on 2026-10-19 by the orchestrator with `mongosh` 2.13.0 against a one-node replica set, after the note gained "stop writes" and the copy with the old collection's options. Snippets copied from the note unchanged.

| Step | Input | Result |
| --- | --- | --- |
| Seed | `events` created with collation `{ locale: 'en', strength: 2 }`, two events with string `_id`; `tickets` A1 → evt-1, B2 → evt-2 | seeded |
| 2 | `createCollection` with the options of `events`, then the copy | exit 0 |
| 3 | `updateMany` snippet | exit 0 |
| 4 | `db.events_copy.renameCollection('events', true)` | `{ ok: 1 }` |
| Check | collation of the new `events`; ids; `$lookup`; `countDocuments({ name: 'launch' })` | `en/2`, so the collation was copied; ObjectId `_id` with `legacyId`; A1 → Launch, B2 → Meetup; `1`, so the case-insensitive collation is in effect |
