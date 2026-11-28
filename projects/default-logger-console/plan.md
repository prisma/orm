# Plan: the client's default logger writes to the console

One pull request. Spec: [spec.md](spec.md).

## Steps

1. **SQL runtime default.** In `packages/2-sql-family/5-runtime`, replace `noopLog` in `sql-runtime.ts` with a console logger whose `info`, `warn` and `error` call `console.info`, `console.warn` and `console.error` at each call, and which has no `debug`. `warnOfCapabilitiesNotProvided` in `stack-capabilities.ts` uses the same logger when `options.log` is absent. Tests first, in the package's own test files:
   - no `log`: a marker mismatch, a missing marker and an unreadable marker each reach `console.warn` once;
   - no `log`: a middleware `activityEnded` error after a failure reaches `console.error`; a `ctx.log.info` from middleware reaches `console.info`;
   - no `log`: a debug event reaches no console method;
   - no `log`: `warnOfCapabilitiesNotProvided` reaches `console.warn`;
   - a silent `log`: none of the above reaches any console method.
2. **MongoDB runtime and client.** Add `log?: RuntimeLog` to `MongoRuntimeOptions` and the client's `MongoOptionsBase`, pass it through `mongo()`, and default it to the same console logger. Tests first: a throwing `activityFinalized` hook reaches `console.error` with no `log`, reaches the passed `log` when one is given, and reaches no console method with a silent `log`. Type test for the new option.
3. **Docs.** Update in place: the decision record "The runtime's marker check only warns" (its line on the default logger), the Postgres, SQLite and Supabase READMEs ("Without `log`, the runtime drops these events"), the two cache middleware READMEs, the MongoDB client README (the new option), and `skills/prisma-8/references/runtime.md` if it describes the default.
4. **Upgrade instructions.** An `app` fragment under `upgrade-instructions/pending/default-logger-console/`: what now prints, and how to keep silence. An `extension` declaration if the facade changes need one.
5. **API record.** Record the MongoDB option as the API compatibility check requires.
6. **Review and PR.** `/drive-code-review` on the tip, fixes, a fresh-reader review of the description, then the pull request. Update row 17 of the GA plan and item 17 of the rollout checklist on `planning/prisma-8-ga`, and tell the GA compatibility lead.

## Machine load

Run only the touched test files, the touched packages' typecheck and lint. Every build, install, typecheck, lint and test runs under `lockf -t 3600 /Users/Shared/claude-shared/heavy-command.lock <command>`.
