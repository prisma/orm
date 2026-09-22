# Design

Durable design reference material for Prisma 8, organised per the `docs-framework` skill's layout. User-facing docs (onboarding, tutorials, the CLI reference, the glossary) derive from material here.

## Current state

This directory is **partially populated**. The slots currently in use:

- [`04-inspirations/migrations/`](04-inspirations/migrations/) — vendor research and established-system conventions that informed the migration domain model (Atlas, Active Record, and a six-system synthesis).
- [`10-domains/migration/`](10-domains/migration/) — the conceptual domain reference for the migration system: ubiquitous language, entities, operations, mental model (Git as the anchor), and CLI mapping.

The framework's other slots (`00-purpose/`, `01-principles/`, `03-domain-model/`, `05-infrastructure/`, `06-operations/`, `90-decisions/`, `99-process/`) are not yet created. They will be added when there is durable content to put in them; empty scaffolds imply false completeness. Wholesale framework adoption is a separate, future decision.

ADRs continue to live under [`../architecture docs/adrs/`](../architecture%20docs/adrs/). The implementation-facing subsystem docs live under [`../architecture docs/subsystems/`](../architecture%20docs/subsystems/). The user-facing glossary lives at [`../glossary.md`](../glossary.md). None of those have moved.

## Layout (when fully populated)

The full per-slot layout is documented in the `docs-framework` skill. The naming convention is intentional: numeric prefixes order the directories in a reading-progression sense (purpose → principles → example app → domain → inspirations → infrastructure → operations → per-domain deep dives → decisions → process). Read the slots in order if you want the conceptual scaffolding; jump directly to `10-domains/<area>/` if you already have context and need the domain reference.

## Adding to this directory

Two cases:

1. **New content for an existing slot.** Add the file under the slot directory; cross-link from the relevant domain doc or framework slot if useful.
2. **New slot.** Create the slot directory when you have the first piece of durable content for it — not preemptively. Empty slots are deliberately avoided.
