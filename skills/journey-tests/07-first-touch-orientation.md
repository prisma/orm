# Journey 07 — First-touch orientation

**Skills under test:** `prisma-next-quickstart` (First-touch orientation path), with hand-offs to `prisma-next-queries` and optionally `prisma-next-contract`.

**Example app:** A Prisma Next project the user is encountering for the first time. Three flavours of this initial state should all pass:

- Freshly scaffolded by `npx createprisma`.
- Freshly scaffolded by `pnpm dlx @prisma/cli orm init` (run by the user themselves, but not yet connected to a DB).
- An existing project (e.g. `examples/prisma-8-demo`) with no migration applied yet — simulate "just got handed a teammate's repo, haven't run anything against the DB yet".

**Acceptance criterion:** This journey complements AC4 from `specs/usage-skill.spec.md` by covering the first-touch orientation entry point — the moment a user arrives at a PN project and asks what they can do with it. The `createprisma` tool produces one specific phrasing of this prompt; the journey tests the broader "first-time user, any arrival path" surface.

## Prompts

The journey should pass on each of:

- *"What can I do with Prisma Next?"* (the canonical first-time-user phrasing)
- *"What can I do next with Prisma?"* (the literal `createprisma` final-step prompt)
- *"Where do I start?"*
- *"I just ran createprisma — what now?"*

## Expected agent behavior

- [ ] Recognises this as orientation, not a request to lecture about Prisma Next, recite features, or list CLI commands.
- [ ] Reads `prisma.config.ts` to confirm target, authoring mode, contract source path, and `db.ts` location.
- [ ] Reads the contract source to see what starter models exist.
- [ ] Reads `.env` / `.env.example` to confirm `DATABASE_URL` is set (or proposes setting it).
- [ ] **Names the contract path back to the user and frames its role**: something equivalent to *"Your contract is at `<path>`. It describes your app — your query types, migrations, and runtime types all flow from it."* This anchors the rest of the response.
- [ ] **Steers the conversation toward running the user's app**, not toward satisfying a prerequisite list. The motivation surfaced to the user is *"let's get you connected to a database so your app can actually run against it"*, not *"let's check the prerequisites for your first arc"*.
- [ ] Proposes the **smallest** first arc consistent with project state — typically: `db init` (if not already initialised), then write a row, then read it back.
- [ ] Writes the write + read snippet using the ORM lane (`db.orm.<Model>.create({...})` for the write, `db.orm.<Model>.select(...).all()` for the read) against an existing scaffold model. The SQL builder and raw lanes are alternatives, not the default first-query lane.
- [ ] Runs the snippet and confirms it round-trips data.
- [ ] Surfaces CLI commands (`db init`, optionally `db update`, `contract emit`) **only when the user's current move requires them** — not as a pre-emptive tour. The *Commands you'll use day-to-day* table is offered as a reference once the first round-trip works, not recited beforehand.
- [ ] Asks the user what they want to build next and routes:
  - More queries → `prisma-next-queries`.
  - Schema changes → `prisma-next-contract`.
  - Runtime config / middleware → `prisma-next-runtime`.
  - Dev-server integration → `prisma-next-build`.

## Success criteria

- [ ] The user has one row written to the DB and one row read back, against a real database connection, within a single short interaction.
- [ ] The user can answer *"where is my data described, and what does that file control?"* — i.e. the contract was named and its role explained.
- [ ] `contract.json` and `contract.d.ts` were not regenerated unnecessarily (the agent didn't re-emit if no contract changes happened).
- [ ] The agent did NOT walk the user through `prisma.config.ts` keys or PSL syntax before the first query landed.
- [ ] The agent did NOT propose adding multiple models, planning a migration, or wiring middleware as the first move.
- [ ] The agent did NOT open with a Prisma Next tour, a "what is an ORM" explanation, a feature inventory, or a list of CLI commands.

## Failure modes

- Agent treats the prompt as a request to explain Prisma Next and produces a tour instead of a first query.
- Agent answers with a capability inventory ("Prisma Next lets you: define a schema, run migrations, write queries, …") instead of orienting the user on *their* project's contract and getting them running.
- Agent opens with a CLI command table or feature list, before any move has been taken.
- Agent skips naming the contract path and its role — the user finishes the interaction not knowing where their schema lives.
- Agent skips reading project state and proposes greenfield-path commands (`prisma orm init`) against a directory that is already scaffolded.
- Agent dives into schema editing as the first move ("let me show you how to add a model") instead of using the scaffold's starter model.
- Agent proposes a migration before the user has run one query against the existing scaffold.
- Agent hand-edits `contract.json` or `contract.d.ts` to "speed things up".
