# Slice spec — The CLI engine asks for a statement, and a verb flag answers it

**Project:** [`projects/migration-statements/`](../../spec.md) · **Engine slice, built in prisma/prisma-cli** (`packages/cli-engine`) · **Linear:** TML-3476 (slice 2 depends on it) · **Branch (prisma-cli):** `engine-statement-prompts`

## At a glance

An ORM command finds that applying its plan would drop the `Legacy` table. It asks the engine:

```ts
const answer = await ctx.prompt.statement(
  'Table "Legacy" would be dropped and its rows lost. What do you mean?',
  {
    subject: 'Legacy',
    verbs: ['rename', 'delete'],
    validate: (verb, text) => resolve(verb, text),   // ok or an error message
  },
);
// answer: { verb: 'delete', text: 'Legacy' } or { verb: 'rename', text: 'Legacy:Archive' }
```

Run by a script or an agent with no answer on the command line, the command fails before it changes anything:

```text
✖ [CLI.CONSENT_REQUIRED] "Legacy" needs a statement, and the session is not interactive.
→ Pass --delete Legacy, or --rename Legacy:<new name>
```

Run with `--delete Legacy`, the question is answered before anything renders and no prompt is shown. Run by a human in a terminal, the question is asked and the human types `delete` or `rename Legacy:Archive`; a wrong answer is explained and asked again. `--yes` never answers it. `--delete Legacy` given to a run that never asks about `Legacy` is an error, not silence.

## Chosen design

### The primitive

`PromptSurface` gains `statement(question, { subject, verbs, validate })`, beside `consent`. It is a consent: structurally undefaultable, never satisfied by `--yes`, never satisfied by Enter.

- `subject` is the string the answer is about, in the command's own vocabulary (for the ORM: a model or field coordinate such as `Legacy` or `User.name`).
- `verbs` lists the verb flags that may answer it, in the order the refusal should print them.
- `validate(verb, text)` returns `undefined` to accept, or a message string to reject. The engine never interprets the text; the command does.
- It returns `{ verb, text }`.

### How it is answered

1. **Command line first.** For each verb in `verbs`, the engine looks through the run's unconsumed values of that verb flag for one that *names the subject*. The subject check is `text === subject` or `text.startsWith(subject + ':')`. The first match is validated; if `validate` accepts it, it is consumed and returned without rendering anything. If `validate` rejects it, the run fails with `CLI.PROMPT_INVALID` carrying the message, because a wrong flag cannot be corrected by re-prompting.
2. **Non-interactive, or `--yes`:** throw `CLI.CONSENT_REQUIRED`. The message names the subject; `nextActions` carries one `user-choice` per verb, written as the flag to pass (`--delete Legacy`, `--rename Legacy:<new name>`); `meta` carries `{ subject, verbs }`.
3. **Interactive:** render the question and read a line. The answer is `<verb> <text>` or just `<verb>` (then `text` is the subject). An unknown verb, or a `validate` rejection, re-prompts under clack with the message; under the line renderer it fails with `CLI.PROMPT_INVALID`, as `consent` does today.

### The batch form

A command that has several questions asks them together: `ctx.prompt.statements([q1, q2, ...])`, each entry the same shape as a `statement` call, returning the answers in order. It exists because a refusal must name every unanswered question at once (project requirement 4), and a command cannot tell whether the session is interactive (the engine owns that).

- Every question is first answered from the command line as above.
- Non-interactively, or under `--yes`, one `CLI.CONSENT_REQUIRED` is thrown that lists every question still unanswered, each with its flag forms in `nextActions`, and `meta.unanswered: [{ subject, verbs }]`.
- Interactively, the unanswered questions are asked one after another, in order.
- `statement(q)` is `statements([q])[0]`.
- `statements(questions, { last: true })` says this is the run's final ask: when it has answered its questions and values are still unconsumed, it throws `CLI.CONSENT_UNUSED` there, before the command does anything with the answers. The end-of-run check stays for commands that never say `last`.
- A verb's `arity` is the number of argv values each occurrence takes; a wrong count is `CLI.INVALID_ARGUMENTS`. Verbs are one lowercase word. A declaration carries a `brief` for help, because the product owns its help text. A `server-command` may not declare statements.

### Taking a verb's values up front

Some statements are inputs to the command's work, not answers to a question: the ORM plans *with* its `rename` statements and only then learns what still loses data. So a handler can take a verb's values before asking anything: `ctx.statements.take('rename')` returns that verb's values in argv order, as `{ verb, values, text }[]`, and consumes them, so the end-of-run leftover check does not report them. A verb not declared by the command is a construction error. Values of other verbs stay for the questions. The ordinary rule that handlers never see consent values holds for `--confirm`; a statement is the command's own declared input.

A question's `subject` may contain `:`. A value answers the question whose subject it equals; failing that, the question with the longest subject the value starts with (followed by `:`). Questions whose subjects are prefixes of one another are asked in one batch so that rule can apply. A verb a handler takes is not listed in a later question's `verbs`, and `take` comes before the `last` batch.

### Verb flags

- The engine knows no verbs. A command declares the statements it may ask for, with their arity: `defineCommand({ statements: { rename: { arity: 1 }, delete: { arity: 1 } }, ... })`. For that command only, the engine parses `--<verb>` followed by `arity` values, repeatable, keeps the values in argv order, and hands them out through `ctx.prompt.statement`. The values stay out of the handler's flags; a handler reads a verb's values only through `ctx.statements.take`. (Will's ruling, 2026-10-07: the verb is the ORM's, declared per command, not registered on the family or the CLI, so no other command parses it.)
- A command cannot declare an ordinary flag with the same name as one of its statements, and a `statement()` call naming a verb the command did not declare is a construction error.
- `arity` is 1 for every ORM verb today; it exists so the engine never assumes the shape of a statement.
- Order across flags is kept: the engine records the position of every verb-flag value in argv, so a product that needs `--rename A:B --delete C` in the order written can read it. This slice only needs to consume values; it exposes the ordered list on the run state so the ORM's statement list can be built from it later.
- At the end of a run that settled successfully, an unconsumed verb-flag value fails the run with a new `CLI.CONSENT_UNUSED`: "`--delete Legacy` was given but nothing in this run asked about `Legacy`". A run that failed for another reason reports that reason only. On a command that declares statements, an unused `--confirm` value is also `CLI.CONSENT_UNUSED` (the ORM's QA found a defensive `--confirm <database>` silently ignored); on every other command a leftover `--confirm` stays silent as before, because shipped commands accept the flag on paths that never ask (a follow-up issue in prisma-cli records them).

### What stays

`consent(question, { token })` and `--confirm` are unchanged. The other products keep using them.

## Coherence rationale

One primitive, its flags and its error codes ship together because a prompt without its flag-driven equivalent breaks the engine's own rule, and a flag that can be given but never consumed is the silent-typo bug the ORM project refuses to ship. Order-keeping is in because it costs one array at parse time now and would cost a second parse of argv later.

## Scope

**In:** `statement` on `PromptSurface` and both renderers (clack, line); verb-flag registration and reservation; consumption and `CLI.CONSENT_UNUSED`; `CLI.CONSENT_REQUIRED` for a statement; tests in `packages/cli-engine/tests/prompts.test.ts` style, with scripted `answers`; the engine `README`, `docs/product/cli-style-guide.md` (consent section: a statement is the second consent form) and `docs/reference/error-reference.md`; `pnpm bump-cli-engine-version minor`.

**Out:** any ORM command; `--confirm` leftovers on commands that declare no statements (prisma/prisma-cli#339); `select`-style menus; help text for the ORM's verbs (the ORM owns its briefs).

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| Two questions about the same subject | Two flag values needed; each `statement` call consumes one. Same as `consent`. |
| A subject that contains `:` | The subject check uses the subject string as given; the command picks subjects without `:`. Documented on the option. |
| `--delete Legacy --json` in a TTY | Format never decides interactivity (engine ruling). Flag answers; nothing is rendered. |
| A verb flag value given twice | Both kept; the second is unconsumed and reported by `CLI.CONSENT_UNUSED`. |
| `validate` throws | Treated as a bug: the engine does not catch it. |

## Slice done conditions

- `pnpm --filter @prisma/cli-engine test`, `typecheck` and `lint` green; the conformance suite (`pnpm check:conformance`) green.
- A probe command in the tests is driven four ways: flag answer, non-interactive refusal naming both verbs, interactive scripted answer `delete`, interactive scripted answer `rename Legacy:Archive`, plus the unused-flag failure and the rejected-flag failure.
- The engine version bumped minor; the published package is what the ORM's slice 2 pins.

## Open questions

None. Will decided on 2026-10-07: consents carry a verb; the answer is a free-text statement the command validates; a human in a terminal is asked interactively.

## References

- Project spec [`../../spec.md`](../../spec.md) decisions 2 and 6, requirement 12; [`../../plan.md`](../../plan.md) § Stretch goal.
- prisma-cli: `packages/cli-engine/src/execution/prompts.ts`, `shared-flags.ts`, `clack-renderer.ts`, `src/context.ts`; `docs/product/cli-style-guide.md` § consent; ADR 0004 (engine version pinning).
- `wip/slice-2-consent-options.md`: the option evaluation Will chose from.
