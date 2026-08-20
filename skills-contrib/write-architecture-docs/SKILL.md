---
name: write-architecture-docs
description: >-
  Write or rewrite architecture subsystem docs, ADRs, and reference material
  for the engineering team. Use when creating, updating, or reviewing docs
  under docs/architecture docs/, or when the user asks you to write
  documentation that describes the system's design.
---

# Writing Architecture Documentation

Architecture docs in this repo serve two audiences: team members working on the system (need precise reference material) and team members seeking context (need an accessible narrative). The doc must work for both without requiring prior project context.

## Before writing

1. **Read at least two sibling docs** in the same directory (e.g., other subsystem docs under `docs/architecture docs/subsystems/`). Calibrate your voice, structure, and level of detail to match them.
2. **Read the ADRs you'll reference.** Don't just link to them — understand them well enough to summarize the key idea inline, so the reader doesn't have to follow the link to understand the doc.

## Voice and framing

**Write about the system, not the project.** These docs describe the intended system as far as we know it. They are not project retrospectives, sprint summaries, or PoC reports.

- State facts: "The execution pipeline generalizes across families" — not "The PoC validated that the execution pipeline generalizes"
- No transient project references: avoid "workstream", "PoC", "sprint", "milestone", "being validated", "current effort"
- No product comparisons: don't reference other products or prior versions. Describe what the system *is*, not what it improves upon.
- Non-goals are architectural boundaries, not "not yet done" items. No `(current)` qualifiers.

**Write for a developer without prior context.** Imagine someone joining the team and reading this doc as their first exposure to this part of the system.

- Explain *why* before *what*. Before introducing a concept like model ownership, explain the problem it solves: "In SQL, related data lives in separate tables and is joined at query time. In MongoDB, the idiomatic pattern is to store related data inside the parent document."
- Let ideas breathe. Don't compress three concepts into one sentence. If a sentence requires the reader to already understand three things to parse it, break it apart.
- Use concrete examples — code snippets, JSON fragments, "a developer writing X gets Y under the hood." Abstract descriptions are hard to pin understanding to.

## Structure

**Lead with a grounding example.** Put a concrete, complete code snippet, JSON example, or diagram near the top of the document — right after the overview — so the reader has a visual reference to pin their understanding to as they read. Abstract explanations are much easier to follow when the reader can refer back to something tangible. Annotate the example with brief callouts that preview the key concepts ("notice that `storage: {}` means this model is embedded"). The detailed sections that follow can then elaborate on what the reader has already seen.

**Articulate design principles early.** If the subsystem's design is shaped by a set of principles or invariants, state them explicitly after the grounding example and before the detailed sections. This gives the reader the reasoning framework they need to understand why specific decisions were made. Each principle should be one or two sentences of plain language, not jargon. Later sections can reference the principles by number (e.g., "see [design principle #5](#design-principles)") to connect specific decisions back to their rationale.

**Narrative flow.** Guide the reader from one concept to the next. Don't list a set of problems and then separately list a set of solutions — pair each problem with its solution so the reader builds understanding incrementally.

**Overview section.** Open with plain language explaining what this part of the system is and why it exists. The first sentence should be immediately understandable by any engineer. Save technical details for later sections.

Good: "Prisma Next supports multiple database families. SQL was the first; MongoDB is the second."
Bad: "MongoDB is a database family in Prisma Next. The contract, ORM, execution pipeline, and plugin framework all generalize across fundamentally different data models — the same `ContractBase` domain structure, the same `Collection` chaining API, and the same plugin lifecycle work for both SQL and MongoDB."

**Inline summaries with ADR links.** When referencing an ADR, summarize the key idea in the text and link the ADR for depth. The doc should be understandable without following any links. The example below shows the link as it must appear in the subsystem doc you are writing, so its path is relative to that doc's location under `docs/architecture docs/subsystems/`.

Good: "An owned model declares `owner: \"User\"` — a domain fact about aggregate membership. Its data lives within the owner's storage. See [ADR 177](../adrs/ADR%20177%20-%20Ownership%20replaces%20relation%20strategy.md)."
Bad: "See [ADR 177](...) for how embedding works."

**References section.** Organize by durability:
1. Architecture decisions (ADRs) — first
2. Durable reference material — second
3. Historical context (planning docs) — last, labeled as such

## Anti-patterns

- **Compressed summaries.** A paragraph that reads like a bulleted list crammed into prose. If you're listing things, use a list.
- **Jargon without introduction.** Don't use terms like "aggregate root", "discriminator narrowing", or "STI" without explaining what they mean in context.
- **ADR-as-explanation.** Pointing to an ADR instead of explaining the concept. ADR links are for depth; the doc must stand alone.
- **Project-process narrative.** "We built X, then discovered Y, which led to Z." Describe what the system *is*, not how we arrived at it.
- **Terse overview + detailed body.** The overview should be the most accessible part of the doc, not the most compressed.

## Quality check

Before finishing, re-read the doc as a developer who has never seen it before. For each paragraph, ask:

- Can I understand this without context from outside this doc?
- Does it explain why before what?
- Would a concrete example help here?
- Am I stating a fact about the system, or narrating a project?
