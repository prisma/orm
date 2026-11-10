---
name: product-direction
description: Judges feature requests, feature pull requests and your own proposals against a repository's written product direction, gives a cited verdict, and records each new no. Use when triaging, labelling or replying to a feature request or a feature pull request, including as an autonomous triage agent; when asked whether a request fits the project; when a maintainer says the project will not build something; when asked about the project's vision, direction or what it will not do; before proposing or adding a feature, API, command, config option, dependency or abstraction, even when nobody mentions direction; and when asked to set up or update a project intent page, a vision page, decision records or a steering list.
metadata:
  author: Prisma
  version: "2026.10.22"
---

# Product direction

Judge a request, and your own proposals, against what the maintainers wrote down. Give a verdict with the line it rests on. Leave the decision to a maintainer. A wrong no drives away the person who asked. A wrong yes commits the maintainers to work they never chose.

Every rule and heading here names its source in [references/sources.md](references/sources.md).

## The record

The record has five parts. Four are pages in the repository. The fifth is the reading rules in this file.

| Part             | What it holds                                                                                                       | Default path                        | Template                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------- |
| Project intent   | What the project is, who it is for, what it optimises for and does not need to, what not to assume, agent guidance. | `docs/direction/project-intent.md`  | [project-intent.md](assets/project-intent.md)   |
| Vision           | Values and durable themes. Nothing about current work.                                                              | `docs/direction/vision.md`          | [vision.md](assets/vision.md)                   |
| Decision records | One record per no: what to use instead, and what would reopen it.                                                   | `docs/direction/decisions/`         | [decision-record.md](assets/decision-record.md) |
| Steering list    | The accepted nos, one line each, with what to use instead. Read before proposing anything.                          | `docs/direction/decisions/index.md` | [steering-list.md](assets/steering-list.md)     |
| Reading rules    | How to turn the record into a verdict.                                                                              | This file                           |                                                 |

To find the record in a repository:

1. Read its agent instructions file (`AGENTS.md`, `CLAUDE.md` or similar). Follow any pointer to the project intent, the vision or the steering list.
2. Otherwise, look for those pages by name, and for the repository's ADR index.
3. Use the default paths only when you create a part that does not exist.

A repository's existing layout wins. If it keeps ADRs, a decision record is an ADR in its house format and numbering, and the steering list goes at the top of its ADR index.

The reading rules exist only here. A repository's vision page links to this skill; it does not copy the rules.

## Judge a request

Do this for a feature request, a feature pull request, and anything you are about to propose: a feature, API, option, dependency or abstraction. Decide direction before a detailed code review.

1. Read the project intent and the vision. Open the steering list, and every record whose title touches the request.
2. If no record covers the request, search earlier issues, closed issues and maintainer comments for a maintainer's position on it.
3. Check whether a shipped feature already does what the request asks.
4. Give one verdict, with one sentence and the anchor it rests on.

```text
visionFit: aligned | rejected | unclear | not_applicable
visionFitReason: <one sentence, in your own words>
visionFitEvidence: <the anchor: a link, and a quote>
bestSolution: <the best end state for the project, in one or two sentences>
```

| Verdict          | When                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aligned`        | The work advances a stated value or durable theme.                                                                                                                  |
| `rejected`       | It conflicts with a value or an accepted record, or it belongs elsewhere: an extension, user code, another repository. A decline needs more: see the reading rules. |
| `unclear`        | The record does not clearly speak to it.                                                                                                                            |
| `not_applicable` | A bug, or anything where a judgment about direction means nothing. This is the answer for most bugs.                                                                |

## The reading rules

1. **Be conservative.** Prefer `unclear` or `not_applicable` unless the record speaks directly to the request. A broad value or theme speaks directly only when it names the kind of work asked for. A record that only says how a feature would be built, if it were built, does not say it is wanted. When the anchors point different ways, or you need your own reading to connect them to the request, give `unclear` and name the question a maintainer must answer.
2. **If a part of the record is missing, say which one.** Treat what it would have said as unknown.
3. **A decline needs one of two grounds:** an `Accepted` record that covers the request, or a maintainer's own earlier words on an issue or pull request, linked. A value, a theme or the project intent is never grounds, even where it quotes a maintainer. Neither is your own reading of them. A proposed decline states your confidence: high, medium or low. High means the record or the maintainer's words cover the whole request, directly. Below high, propose no decline and give `unclear`.
4. **A `rejected` verdict without grounds for a decline proposes no decline.** The verdict describes fit; it is not a decision. Say in `bestSolution` where the work belongs, such as "belongs in an extension", and leave the request open for a maintainer.
5. **A `Proposed` record never grounds a verdict.** It is not a decision yet. Say it exists, and ask a maintainer to accept it or delete it.
6. **If the request already exists, say so and name the feature.** When a shipped feature covers the central ask, the answer is "already exists, use X". Start `bestSolution` with "Already exists:" and name X exactly. Judge `visionFit` as usual. If X covers only part of the ask, say what it does and does not do. This is not a decline, and it needs no record: the feature named is the citation.
7. **An earlier not-planned decision is precedent only if its reasoning covers the full scope of the new request.** If it covers part, it decides nothing.
8. **Never decline a change that a maintainer in the thread proposed or accepted,** unless a later maintainer comment in the thread declines it. Name the maintainer's direction in `bestSolution`. The verdict is never `rejected`. If a record says no, give `unclear` and flag the conflict; the record changes only when a maintainer supersedes it.
9. **Two maintainers who contradict each other, in the same thread or in different ones, are not an established position.** Give `unclear` and flag the conflict.
10. **Never propose a decline for an item a maintainer filed, an item with a milestone, or a security item.** An item a maintainer filed is one whose author GitHub shows as `MEMBER`, `OWNER` or `COLLABORATOR`. The verdict still follows the record; only the proposal to decline is barred.
11. **If the thing to use instead does not exist yet, say so.** Do not point at a feature that is not shipped.
12. **A decline reply has five parts, in this order:** the verdict in one sentence; the evidence, linked (the record, or the maintainer's earlier comment); a workaround the person can use today; what the maintainers would accept instead; and an invitation to reopen, with what would change the answer.
13. **The verdict is evidence, not the decision.** Propose; do not act. Give the verdict and any draft reply to a maintainer. Do not close, label or comment unless a maintainer asked you to.

For your own proposal: if an accepted record covers it, use what the record names instead. If a maintainer asks you to build something an accepted record rules out, quote the record and ask whether they want to supersede it.

Five worked verdicts on prisma/orm requests are in [references/worked-example.md](references/worked-example.md).

## Record a new no

When anyone declines a request for a reason no record covers, whoever declines drafts the record. Without this the next reader starts over.

1. Draft it from the maintainer's words, with their name and the date. Do not add reasons they did not give.
2. In a repository with ADRs, write an ADR in its house format and numbering. Otherwise copy [the template](assets/decision-record.md) to the next unused number.
3. The title states the no. The decision says what to use instead. The consequences say what would reopen it, or "No revisit-if condition is recorded."
4. Set the status to `Proposed`. Open a pull request, in the same pull request as the change that carries the decision when there is one.
5. A maintainer's approval of that pull request accepts it. Set the status to `Accepted` and add a one-line entry to the steering list.

After acceptance, never edit a record. To change a decision, write a new record and mark the old one superseded.

## Set up the record

To create the record in a repository that has none, read [references/maintaining.md](references/maintaining.md).
