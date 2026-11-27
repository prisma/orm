---
name: adr-review
description: >-
  Review one or more existing ADRs with fresh eyes (as a team member without
  prior context), identify narrative and structural issues, then rewrite them.
  Use when the user asks to review, improve, rewrite, or take a fresh-eyes pass
  on an ADR or a set of ADRs (Architecture Decision Records).
---

# Reviewing and rewriting ADRs

This skill is for an ADR that already exists and that someone has asked you to review. If you are writing a new ADR, write it and then follow the [`doc-review`](../doc-review/SKILL.md) skill directly.

`doc-review` explains why the author's own reading is not enough, and gives the two briefs to hand to fresh agents: a cold reader, and a fact checker. For a review the user asked for, do this around them:

1. **Give your own analysis in chat first.** List the issues you see, for each ADR, before you change a file. The user asked for a review, so they want to see it.
2. **Rewrite what needs it.** Leave an ADR that reads well alone, and say so. A rewritten ADR:
   - starts with a concrete example the reader can pin their understanding to;
   - states the decision before the reasoning;
   - builds the topic up step by step, explaining each term where it is first used;
   - ends with the alternatives considered.
3. **Run the two reviews** from `doc-review` on each rewrite, and stop where that skill says to stop.
4. **Report** your analysis, what the reviewers found, and what you changed.

An ADR has no ticket numbers, no pull request numbers, no milestones, and no account of states the system passed through. `doc-review` says why, and which history may stay.
