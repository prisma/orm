---
changes:
  - id: engine-pin-moves-to-0-10-3
    summary: |
      The toolchain now peers `@prisma/cli-engine@0.10.3` (up from 0.10.0). An extension package that depends on `@prisma/cli-engine` for its tests or tooling must move to `0.10.3`.
    detection:
      glob: "**/{package.json,pnpm-workspace.yaml}"
      matches:
        - '"@prisma/cli-engine":\s*"[^"]*(?<![\d.])0\.(?:\d|10\.[012xX*])(?!\d)'
        - '[''"]?@prisma/cli-engine[''"]?:\s*[''"]?(?:[\^~]|[<>]=?\s*)?0\.(?:\d|10\.[012xX*])(?!\d)'
  - id: consent-required-summary-is-one-fixed-sentence
    summary: |
      The first line of `CLI.CONSENT_REQUIRED` is now one fixed sentence. It no longer names the subject of a statement question, and it no longer quotes the question of a consent that `--confirm` answers. Code that matched the old first line must read the error's `code`, `why` and `meta` instead.
    detection:
      glob: "**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,snap,json,sh,bash,yml,yaml}"
      matches:
        - 'needs? a statement'
        - '--yes cannot give'
        - '--yes cannot grant'
        - 'requires explicit consent, (?:and|which)'
        - 'Grant it by passing --confirm'
        - 'session is not interactive'
---

## `engine-pin-moves-to-0-10-3`

For every file matched by `detection`, change the `@prisma/cli-engine` version (`0.10.2`, `0.10.1`, `0.10.0` or any earlier 0.x) to `0.10.3` and reinstall.

## `consent-required-summary-is-one-fixed-sentence`

Two errors have the code `CLI.CONSENT_REQUIRED`. Both are raised when the run cannot ask (it is not interactive, or `--yes` is set). Only the first line (the `summary`) of each changed, and both now have the same one:

- `This command requires explicit consent, but it was not provided.`
- Under `--yes`: `This command requires explicit consent, and --yes does not give it.`

**A statement question nobody answered.** `prisma migration plan` or `prisma db update` would lose data or change access, and no `--rename`, `--delete` or similar flag answers the question.

- Before: `"User.nick" needs a statement, and the session is not interactive.`, or `2 subjects need a statement, and the session is not interactive: "Bug", "Task".` for several questions. Under `--yes`, the end of the line was `which --yes cannot give.`
- `why` (the questions), the next actions, `meta`, the code and the exit code (2) are unchanged. Read the unanswered subjects from `meta.unanswered` (each with its `subject` and `verbs`).

**A consent that `--confirm` answers.** For example `prisma init` over a project it would replace.

- Before: `"<question>" requires explicit consent, and the session is not interactive.`, or `…, which --yes cannot grant.` under `--yes`. When the consent has a token, the line ended `Grant it by passing --confirm <token>.`
- The question is now in `why`. The next action, `meta.consentToken`, the code and the exit code (2) are unchanged. Read the token from `meta.consentToken`.

For every file matched by `detection`, stop matching the first line of this error. A match on `session is not interactive` needs a change only where it is for this error; other errors still use those words. Branch on the error's `code` (`CLI.CONSENT_REQUIRED`). The code alone does not tell the two errors apart: the first has `meta.unanswered`, and the second does not.
