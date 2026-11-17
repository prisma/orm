---
changes:
  - id: access-changes-rename
    summary: |
      `accessWidening` is renamed `accessChanges`, because it also lists changes that do not widen access. The `db update --dry-run --json` output key and `DbUpdateSuccess.accessWidening` become `accessChanges`, and the `executeDbUpdate` and control client `dbUpdate` option `acceptAccessWidening` becomes `acceptAccessChanges`. There is no alias for the old names.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs,sh,bash,yml,yaml}"
      matches:
        - '(?<![\w$])(?:acceptAccessWidening|accessWidening)(?![\w$])'
---

# `accessWidening` is renamed `accessChanges`

`db update` asks about each operation that changes who can read or write a model's data. Such an operation does not always widen access, so the list of them is now `accessChanges`, and the option that answers all of them is `acceptAccessChanges`. Rename each use:

```ts
// Before
const result = await client.dbUpdate({ contract, mode: 'apply', migrationsDir, acceptAccessWidening: true, answerQuestions });
if (result.ok) console.log(result.value.accessWidening);

// After
const result = await client.dbUpdate({ contract, mode: 'apply', migrationsDir, acceptAccessChanges: true, answerQuestions });
if (result.ok) console.log(result.value.accessChanges);
```

A script that reads `prisma db update --dry-run --json` reads `accessChanges` in place of `accessWidening`. The output is one JSON object per line, and the result is in the last one:

```bash
prisma db update --dry-run --json | jq -s 'last | .envelope.result.accessChanges'
```

The question `db update` asks now ends with "who can read and write its data" in place of "who can read and write its rows". A script that matches the question text changes the same way.
