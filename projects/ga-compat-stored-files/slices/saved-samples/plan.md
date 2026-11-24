# Plan: later releases are tested against what an earlier release stored

The slice spec is [spec.md](spec.md). The branch starts from the hash branch. Every dispatch runs on Opus: implementers at medium effort, reviewers at high effort. No dispatch runs a whole test suite or any repository-wide command except `pnpm build` when fresh `dist` is needed; CI and the merge queue run the integration suite.

## Dispatches

1. **Samples and tests.** Generate both sample sets with the branch's own CLI from a small project per database (PostgreSQL with pgvector, MongoDB), apply the migrations to an in-process database, and save its marker, ledger and contract records. Write the tests. Write the replacement procedure. Run only the new test files.
2. **Review**, both passes of `/drive-code-review`, and **fixes**.
3. **Pull request**, opened after the earlier pull requests in this project have merged.

## Decisions taken in shaping

- The samples live under `test/integration/test/saved-samples/<release>/<database>/`, because the integration package already runs the in-process PostgreSQL server and MongoDB.
- The database records are saved as the rows themselves (JSON), and the test writes them into the tables the current code creates. A saved SQL dump would tie the test to one server version's dump format.
