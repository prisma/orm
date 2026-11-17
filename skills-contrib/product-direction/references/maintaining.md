# Set up and maintain the record

## Set up

When a repository has none of the parts, or only some:

1. Find what exists first, as [The record](../SKILL.md#the-record) describes. Leave existing parts where they are.
2. Copy the missing templates from `assets/` to the repository's layout, or to the default paths in [SKILL.md](../SKILL.md#the-record). Copy [decision-record.md](../assets/decision-record.md) to `decisions/0000-template.md` and [steering-list.md](../assets/steering-list.md) to `decisions/index.md`. Follow the repository's frontmatter and file conventions.
3. Fill each page only from what the maintainers already wrote: the README, architecture documents, published principles, and maintainer comments on issues. Link the source of each rule, decision and quote. Do not add a line you cannot source. Leave out what goes out of date: versions, dates, what is built today.
4. Seed decision records only from nos a maintainer has already decided. Draft each from their words, as in [Record a new no](../SKILL.md#record-a-new-no). Where an existing ADR already records the no, list that ADR on the steering list instead of writing a second record.
5. Add a pointer to the repository's agent instructions file, so agents without this skill still reach the record. For example:

   ```markdown
   ## Product direction

   Before you propose a feature or judge a feature request or pull request, read the [project intent](docs/direction/project-intent.md) and the [steering list](docs/direction/decisions/index.md#steering-list).
   ```

6. Open a pull request. The maintainers review it like any other change.

Do not copy the reading rules into the repository. The vision page links to this skill for them, as the [vision template](../assets/vision.md) does.

## Keep it current

Record a new no, and supersede an old one, as [Record a new no](../SKILL.md#record-a-new-no) says. Two steps that page does not cover:

- When a record is superseded, move the old one from the steering list to Historical.
- When a record no longer changes what the next agent would propose, move it from the steering list to Historical, with the reason.
