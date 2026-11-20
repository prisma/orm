---
changes:
  - id: consent-required-output-reworded
    summary: |
      When `migration plan` or `db update` stops because a plan would lose data or change access and nobody can answer, the `CLI.CONSENT_REQUIRED` error is worded differently. Its summary says what the change would do, its `why` says what the plan would run, and each next action gives what a flag means followed by the flag. The code, the exit code and `meta` (`subject`, `verbs`, `unanswered`, `unmatched`, `confirm`) do not change. The detection matches sources and scripts that match the old summary or next-action text.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,sh,bash,yml,yaml}"
      matches:
        - 'needs a statement'
        - 'need a statement'
        - 'Run the command again with --(delete|rename|allow|convert)'
---

# The `CLI.CONSENT_REQUIRED` output when a plan stops to ask

A script or test that reads the text of this error needs to change. Before:

```text
✘ [CLI.CONSENT_REQUIRED] "Shop.legacy" needs a statement, and the session is not interactive.
  why: Drop column "legacy" from "Store Front" would lose the values of field "Shop.legacy".
→ Run the command again with --rename Shop.legacy:Shop.rating
→ Run the command again with --delete Shop.legacy
```

After:

```text
✘ [CLI.CONSENT_REQUIRED] Removing field "Shop.legacy" would delete its values.
  why: The plan would run: Drop column "legacy" from "Store Front".
→ If the field was renamed to "rating", keep its values: --rename Shop.legacy:Shop.rating
→ If the values can go: --delete Shop.legacy
```

In every file the detection matches, stop reading the summary or the next-action labels to find out what was asked. Read `meta.unanswered` instead, which is unchanged: one entry per open question, each with the `subject` a flag names and the `verbs` that answer it, so `--<verb> <subject>` answers it, and `--rename` takes `<subject>:<new name>`. To find the flag in a next action, take the text after the last `: ` of its label; the label no longer starts with `Run the command again with`.

Two access changes on one model now give one next action with the flag once per change, `--allow User --allow User`, because each `--allow` answers one change.
