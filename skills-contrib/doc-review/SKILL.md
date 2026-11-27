---
name: doc-review
description: >-
  Review documentation with independent readers before it is called done: a
  cold reader who has only the file, a fact checker who checks every claim
  against the repository, or both, depending on the change. Use whenever you write or rewrite an ADR, a page under
  docs/, a README, a skill or a rule, when the user asks to review, improve or
  take a fresh-eyes pass on a doc, and when you review a pull request that
  changes docs.
---

# Reviewing documentation

## Why two readers who are not you

The author of a doc cannot judge it. They know what each term means and what was decided, so the text reads as clear to them when it is not. They also wrote the facts from memory, and the memory is often of a spec or a draft that the code no longer matches.

On one pull request in this repository, an agent wrote two decision records and changed fifty other docs, and judged them clear. Readers who were given only the files found four kinds of fault, again and again:

- **The mechanism came before the problem.** A record opened by explaining how the framework marks its values, before the reader knew what could go wrong or why they should care.
- **Terms were used before they were defined,** and some were the author's own shorthand. A package "names" another, where the reader needed "lists it as a peer dependency". A version range "admits" a version, where they needed "accepts".
- **Rules were stated and never shown.** One sentence said that an application "has a tilde even on its GA lines, so that an update does not move them without the facade". Nobody could follow it. What worked was a table with one row for each dependency in `package.json`, showing what an update installs for it.
- **Facts were wrong.** The text said an error appears on the first query. It appears only when a default value is read. The text said every package manager prints a warning. One of them prints none.

A reader without your context finds the first three. Only a check finds the fourth: against the code, or, for a claim about another tool, against evidence (see "Claims the repository cannot settle" below). So a doc gets both, from agents that have not seen your session.

## When a change needs this

The question is whether the change adds or alters something a reader has to understand or rely on: an explanation, a rule, a statement of behaviour, a code sample, a command, a number.

| The change | What it needs |
| --- | --- |
| A new or rewritten explanation: an ADR, a policy page, a guide, a section of one | Both reviews: a cold reader and a fact checker. |
| A small change that states something: up to about a paragraph, a changed example, command or number | A fact checker only, who also quotes any sentence it could not follow. One changed sentence can state a wrong fact, but it rarely needs a second reader. |
| A typo, formatting, a moved or renamed file, a link repointed to where the same content now lives | `pnpm lint:doc-links` only. |
| A link whose target no longer exists | The sentence around it is now a claim about something that is gone. Rewrite the sentence, and treat it as a small change that states something. |
| The same mechanical edit across many files, such as a renamed term | `pnpm lint:doc-links`. If the term is a name in the code, search the code to confirm the new name exists. Then one cold reader on the two or three files where the term matters most. If the edit changes what the term means, it is not mechanical: use the first row. |
| A generated doc | Change the generator or its template, never the output. Then give the cold reader a freshly generated sample, and have the fact checker check the template's own statements. |
| One section of a long doc | Name the changed part in both briefs. The cold reader reads the whole file but reports on your part and how it fits. The fact checker checks only your part. You are done when your part is clean. A fault they notice elsewhere you fix if it is small; otherwise mention it in your report and leave it. |
| A working file under `projects/` (spec, plan, notes) | Nothing. It has to be correct, but it is not documentation. |

The reviewers only read files and search the code, so they do not load the machine. They do cost time and tokens, which is why a small change gets one of them and not both. When the pull request will also get a code review, that reviewer can take the fact checker brief for the docs in the diff.

## The procedure

1. **Write or rewrite the doc.**
2. **Start the reviewers that the table above calls for,** as separate fresh agents, in parallel when there are two. Fill in the brief below for each and hand it over as it stands. Give the cold reader nothing else: if it needs your explanation to understand the doc, that is the finding.
3. **Fix what they find.**
   - For the cold reader's findings, change the doc. Do not explain the text to the reviewer, or argue it out of a finding: the next reader will not have you there. You may decline a finding that is only a matter of taste, and say that you did.
   - For the fact checker's findings, look at the code it cites before you change the text. A reviewer can be wrong too.
   - When a finding shows that the doc's reasoning has a gap, close the gap, or say plainly in the doc that it is there.
4. **Go round again.** Give the next round's cold read to a new agent, because the previous one now knows what the text means, as you do. For the facts, message the same fact checker with the passages you changed; it does not need to check everything again.
5. **Stop when neither finds anything that would keep a reader from understanding the doc or acting on it correctly.** A cold reader can always find something, so that judgement is yours. "I could not tell which of two things this sentence means" and "I would not know what to do in this case" are findings that count. "I would have used a different word" is not. A long doc usually takes two or three rounds. If your own text still draws findings that count after four rounds, its structure is wrong: rewrite it instead of patching it.
6. **Check a decision record for what it must not contain** (the section below), yourself, since neither reviewer is asked to.
7. **Report which reviewers ran,** what they found, and anything you declined: in your report to whoever asked for the work, and in the pull request description.

**How many agents.** Several short docs can share one cold reader and one fact checker. Give a doc its own pair when it is the main explanation of something, such as an ADR or a policy page. Thirty changed docs do not need thirty pairs: group them, and use the table above to leave out the ones that teach and claim nothing.

**Claims the repository cannot settle.** Some statements are about another tool: what a package manager does, what a database returns. The fact checker will report them as not checkable. Then you either point to evidence, such as a test in the repository, a recorded trial or the tool's own documentation, or you take the claim out.

## Brief for the cold reader

Fill in the four lines at the end. For "Kind", say what the doc is for, because the right shape depends on it:

- **A decision record** follows the order in [`adr-writing.mdc`](../../.agents/rules/adr-writing.mdc): a concrete example and the decision first, then why, how and the consequences, and the alternatives last. Within the "why", what goes wrong comes before how the fix works.
- **An explanation or a guide** starts with a concrete example and builds up step by step.
- **A reference page, an index or a checklist** is complete and easy to scan.
- **Guidance for agents,** such as a rule or a skill, says what went wrong and why before it says what to do.

> Read the document below with fresh eyes, as one of its intended readers who has none of the author's context. Read only the file or files named. Open nothing else and run no commands.
>
> Judge it as the kind of document it is. A term counts as explained if the document explains it or links to its definition. If a changed part is named, read the whole file, but report on that part and on how it fits the rest.
>
> Report, most important first:
>
> 1. Every sentence you had to read twice, or could not understand, quoted, with what confused you.
> 2. Every term used before it is explained, or never explained.
> 3. Every claim that seems wrong, or that contradicts another part of the file or of the other files named here. Work through each example yourself.
> 4. Every place where the order makes you hold a question for more than a paragraph, and every rule that is stated without an example that shows it.
> 5. Every passage that is still a wall of text and should be a list, a table or shorter.
> 6. Anything you would not know how to do after reading it, if the document is meant to be acted on.
>
> Say plainly which sections read well and need no change. Do not invent problems. Reply with the list only, and write no files.
>
> Readers: …
> Kind of document: …
> Changed part: … (or "the whole document")
> Files: …

## Brief for the fact checker

Fill in the lines at the end. "Checkout" is the folder that holds the code the doc describes, including changes that are not committed yet. "Earlier version" is the commit before your rewrite, or "none" for a new doc. "Changed part" limits the check to the text you changed.

> Check every factual claim in the documents named below against the repository checkout named below. If a changed part is named, check only the claims in that part, and report anything elsewhere in the file that contradicts it. Work read-only. Do not run builds, installs, typechecks, lint or test suites; reading the code, `git`, and a one-line script are enough.
>
> For each document, check:
>
> - every name that the document presents as this repository's: a package, file, function, type, field, flag, command, script or error code;
> - every code sample, command and example output, by reading the code it uses;
> - every statement of behaviour ("when X, the tool does Y"), by reading the code that does it;
> - every number, version and range;
> - every link and `#anchor`, by resolving it;
> - every statement that something is checked, enforced or printed, by finding the check.
>
> A project spec or plan is not a source: names change while the work is built. Report a claim you cannot check from the repository, such as the behaviour of another tool, as not checkable, with what would settle it.
>
> If an earlier version is named, read it (`git show <commit>:<path>`) and list every rule or fact that the new text dropped or changed.
>
> Also quote every sentence in the text you checked that you could not follow. You may be its only reviewer.
>
> Report a numbered list: the passage, what the code actually does with file and line, and the correction. Say plainly which claims you checked and found correct. Reply with the list only, and write no files.
>
> Checkout: …
> Earlier version: …
> Changed part: … (or "the whole document")
> Files: …

## What a decision record must not contain

A decision record is read for years, so [`adr-writing.mdc`](../../.agents/rules/adr-writing.mdc) forbids ticket numbers, pull request numbers, milestones, and any account of states the system passed through on the way ("before this refactor", "we used to"). It says which history may stay. Neither reviewer's brief covers this, which is why step 6 gives the check to you.

## When you are reviewing someone else's pull request

A doc change is not reviewed until it has had the review the table above calls for, from someone other than its author.

- **You can be the cold reader yourself,** if you did not write the docs and have not been following the work. Read as the brief says.
- **Check the facts** as the fact checker brief says, or hand that to an agent.
- **Use the table above** to decide which changed docs need it. A contributor's typo fix does not.
- **Put your findings in review comments** on the pull request, as you would for code. When the author has answered them, check that each one is settled; you do not need a new reader for that.
- **A review bot's comments add to this and do not replace it.** The bot does not trace a claim through the code the way the fact checker brief asks.
