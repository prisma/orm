---
name: adr-review
description: >-
  Review one or more ADRs with fresh eyes (as a team member without prior
  context), identify narrative and structural issues, then rewrite them. Use
  when the user asks to review, improve, rewrite, or take a fresh-eyes pass on
  an ADR or a set of ADRs (Architecture Decision Records).
---

# Reviewing and rewriting ADRs

Follow the [`doc-review`](../doc-review/SKILL.md) skill. It explains why the author's own reading is not enough, and gives the two briefs to hand to fresh agents: a cold reader, and a fact checker.

For an ADR, do this around those two reviews:

1. **Give your own analysis in chat first.** List the issues you see, per ADR, before you change a file.
2. **Rewrite each ADR** so that it:
   - starts with a concrete example the reader can pin their understanding to;
   - states the decision before the reasoning;
   - builds the topic up step by step, explaining each term where it is first used;
   - ends with the alternatives considered.
3. **Run the two reviews** from `doc-review` on the rewrite, fix what they find, and repeat until both find nothing.
4. **Report** your analysis, what the reviewers found, and what you changed.

An ADR has no ticket numbers, no milestones, and no account of states the system passed through; `doc-review` says why.
