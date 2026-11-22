---
changes:
  - id: engine-pin-moves-to-0-10-1
    summary: |
      The toolchain now requires `@prisma/cli-engine@0.10.1` (up from 0.10.0). A project that depends on `@prisma/cli-engine` itself must move to `0.10.1`.
    detection:
      glob: "**/{package.json,pnpm-workspace.yaml}"
      matches:
        - '"@prisma/cli-engine":\s*"[^"]*(?<![\d.])0\.(?:\d|10\.0)(?!\d)'
        - '[''"]?@prisma/cli-engine[''"]?:\s*[''"]?[\^~]?0\.(?:\d|10\.0)(?!\d)'
  - id: consent-required-summary-is-the-question
    summary: |
      When `prisma migration plan` or `prisma db update` cannot ask a statement question, `CLI.CONSENT_REQUIRED` now has new text. With one question, its summary is the question itself; with several, the summary is `N choices are needed, and this run cannot ask you.` Code that matched the old text, or read the question from `why`, must check the error's `code` and `meta.unanswered` instead.
    detection:
      glob: "**/*.{js,mjs,cjs,ts,mts,cts,sh,bash,yml,yaml}"
      matches:
        - 'needs a statement, and the session is not interactive'
        - 'subjects? need a statement, and the session is not interactive'
        - 'needs a statement, which --yes cannot give'
        - 'need a statement, which --yes cannot give'
        - 'answers no question; the questions are about'
        - 'answers no consent in this run'
        - 'CONSENT_REQUIRED'
---

## `engine-pin-moves-to-0-10-1`

For every file matched by `detection`, change the `@prisma/cli-engine` version (`0.10.0` or any earlier 0.x) to `0.10.1` and reinstall. Projects assembled by the `prisma` CLI resolve the engine automatically.

## `consent-required-summary-is-the-question`

When `prisma migration plan` or `prisma db update` would lose data or change access, and the run cannot ask (it is not interactive, or `--yes` is set), it fails with `CLI.CONSENT_REQUIRED`. The code, the exit code (2), the next actions and `meta` are unchanged. The text is new:

- One unanswered question: the summary was `"User.nick" needs a statement, and the session is not interactive.` and `why` held the question. Now the summary is the question, such as `Drop column "nick" from "people" would lose the values of field "User.nick".`, and `why` is `You have to choose what happens, and this run cannot ask you.` Under `--yes`, `why` is `You have to choose what happens, and --yes does not choose for you.`
- Several unanswered questions: the summary was `2 subjects need a statement, and the session is not interactive: "Bug", "Task".` Now it is `2 choices are needed, and this run cannot ask you.` (under `--yes`, `2 choices are needed, and --yes does not choose for you.`). `why` still lists the questions, one per line.
- When the question names ways to keep the data, those sentences are left out of the summary and given first in the next actions.
- A flag that answers nothing is reported on a line of its own in `why`. The old lines were `--delete Legcy answers no question; the questions are about A, B.` and `--confirm tok answers no consent in this run; a statement flag is what answers these questions.` They are now worded as `--delete Legcy does not name A or B.` and `--confirm tok does not choose what happens; --rename or --delete does.`

For every file matched by `detection`, stop reading the summary or `why` of this error. Branch on the error's `code` (`CLI.CONSENT_REQUIRED`) and read the unanswered questions from `meta.unanswered` (each with its `subject` and `verbs`). The summary and `why` are text for people, and their layout may change in any release. A file that only checks `code` needs no change.
