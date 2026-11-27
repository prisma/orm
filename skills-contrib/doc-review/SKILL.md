---
name: doc-review
description: >-
  Review documentation with two independent readers before it is called done: a
  cold reader who has only the file, and a fact checker who checks every claim
  against the repository. Use whenever you write or rewrite an ADR, a page under
  docs/, a README or a skill reference, when the user asks to review, improve or
  take a fresh-eyes pass on a doc, and when you review a pull request that
  changes docs.
---

# Reviewing documentation

## Why two readers who are not you

The author of a doc cannot judge it. They know what each term means and what was decided, so the text reads as clear to them when it is not. They also wrote the facts from memory, and memory is often of a spec or a draft that the code no longer matches.

On one pull request in this repository, an agent wrote two decision records and changed fifty other docs, and judged them clear. Readers who were given only the files found four kinds of fault, again and again:

- **The mechanism came before the problem.** A record explained a private field before the reader knew why two copies of a package could exist.
- **Terms were used before they were defined,** and some were a private vocabulary: "names", "admits", "holds".
- **Rules were stated and never shown.** One sentence said a range "does not move the lines without the facade". It took a table of what an update installs, line by line, before anyone could follow it.
- **Facts were wrong.** An error said to appear on the first query appears only when a default value is read. A warning said to be printed is not printed by one package manager.

A reader without your context finds the first three. Only a check against the code finds the fourth. So a doc gets both, from two agents that have not seen your session.

## The procedure

1. **Write or rewrite the doc.**
2. **Start the two reviewers,** as separate fresh agents, in parallel. Give each its brief below, word for word, with the file paths filled in. Give the cold reader nothing else: if it needs your explanation to understand the doc, that is the finding.
3. **Fix what they find.** Fix the doc, not the reviewer's understanding. When a finding shows the doc's reasoning has a gap, close the gap or say plainly that it is there.
4. **Send the files back** to fresh agents with the same briefs, until both find nothing that matters. Expect two or three rounds for a long doc.
5. **Report that both ran,** and what they found.

Several docs can go to one reviewer, but give a long one, such as an ADR, a reviewer of its own.

## Brief for the cold reader

> Read this document with fresh eyes, as a member of my team who has none of our context: a capable engineer who knows the language and the common tools, but has never worked on this project. Read only the file or files named below. Open nothing else and run no commands.
>
> The document should start with a concrete example, a code sample or a diagram, then state what it decides or describes, then build the topic up step by step, explaining each term where it is first used. A decision record leads with the decision and ends with the alternatives.
>
> Report, most important first:
>
> 1. Every sentence you had to read twice, or could not understand, quoted, with what confused you.
> 2. Every term used before it is explained, or never explained.
> 3. Every claim that seems wrong, or that contradicts another part of the file or of the other files named here. Work through each example yourself.
> 4. Every place where the order makes you hold a question for more than a paragraph, and every rule that is stated without an example that shows it.
> 5. Every passage that is still a wall of text and should be a list, a table or shorter.
>
> Say plainly which sections read well and need no change. Do not invent problems. Reply with the list only, and write no files.
>
> Files: …

## Brief for the fact checker

> Check every factual claim in the documents named below against this repository. Work read-only. Do not run builds, installs, typechecks, lint or test suites; reading the code, `git`, and a one-line script are enough.
>
> For each document, check:
>
> - every name of a package, file, function, type, field, flag, command and error code, against the source;
> - every code sample, command and example output, against what the code does;
> - every statement of behaviour ("when X, the tool does Y"), by reading the code that does it;
> - every number, version and range;
> - every link and `#anchor`, by resolving it;
> - every statement that something is checked, enforced or printed, by finding the check.
>
> A project spec or plan is not a source: names change while the work is built. A claim you cannot check from the repository is reported as not checkable, with what would be needed.
>
> If the document replaces an earlier version, read that too (`git show <commit>:<path>`) and list every rule or fact the new text dropped or changed.
>
> Report a numbered list: the passage, what the code actually does with file and line, and the correction. Say plainly which claims you checked and found correct. Reply with the list only, and write no files.
>
> Files: …

## What a decision record must not contain

A decision record is read for years. It has no ticket numbers, no pull request numbers, no project milestones, and no account of states the system passed through on the way ("before this refactor", "we used to"). A design that was replaced is an alternative considered, stated as a fact. History stays only where it explains something permanent, such as versions that remain published.

## When you are reviewing someone else's pull request

Run the same two briefs on the docs it changes. A doc change is not reviewed until someone without the author's context has read it and someone has checked its facts.
