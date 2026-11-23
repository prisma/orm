---
changes:
  - id: engine-pin-moves-to-0-10-2
    summary: |
      The toolchain now requires `@prisma/cli-engine@0.10.2` (up from 0.10.0). A project that depends on `@prisma/cli-engine` itself must move to `0.10.2`.
    detection:
      glob: "**/{package.json,pnpm-workspace.yaml}"
      matches:
        - '"@prisma/cli-engine":\s*"[^"]*(?<![\d.])0\.(?:\d|10\.[01])(?!\d)'
        - '[''"]?@prisma/cli-engine[''"]?:\s*[''"]?(?:[\^~]|[<>]=?\s*)?0\.(?:\d|10\.[01])(?!\d)'
  - id: consent-required-summary-names-no-subject
    summary: |
      When `prisma migration plan` or `prisma db update` cannot ask a statement question, the first line of `CLI.CONSENT_REQUIRED` is now one fixed sentence that names no subject. Code that matched the old first line must check the error's `code` and `meta.unanswered` instead.
    detection:
      glob: "**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx,snap,json,sh,bash,yml,yaml}"
      matches:
        - 'needs? a statement'
        - '--yes cannot give'
        - 'session is not interactive'
---

## `engine-pin-moves-to-0-10-2`

For every file matched by `detection`, change the `@prisma/cli-engine` version (`0.10.1`, `0.10.0` or any earlier 0.x) to `0.10.2` and reinstall. Projects assembled by the `prisma` CLI resolve the engine automatically.

## `consent-required-summary-names-no-subject`

When `prisma migration plan` or `prisma db update` would lose data or change access, and the run cannot ask (it is not interactive, or `--yes` is set), it fails with `CLI.CONSENT_REQUIRED`. Only the first line (the `summary`) changed:

- Before: `"User.nick" needs a statement, and the session is not interactive.`, or `2 subjects need a statement, and the session is not interactive: "Bug", "Task".` for several questions. Under `--yes`, the end of the line was `which --yes cannot give.`
- After: `This command requires explicit consent, but it was not provided.` Under `--yes`: `This command requires explicit consent, and --yes does not give it.` The sentence is the same for one question and for several.

`why` (the questions), the next actions, `meta`, the code and the exit code (2) are unchanged.

For every file matched by `detection`, stop matching the first line of this error. A match on `session is not interactive` needs a change only where it is for this error: the error for a missing `--confirm` still ends with those words. Branch on the error's `code` (`CLI.CONSENT_REQUIRED`) and read the unanswered subjects from `meta.unanswered` (each with its `subject` and `verbs`).
