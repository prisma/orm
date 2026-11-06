---
changes:
  - id: enum-value-rename-statement
    summary: |
      `ResolvedRenameStatement` from `@prisma/orm-framework/components/control` gains `ResolvedEnumValueRenameStatement`, `{ kind: 'rename', entity: 'enumValue', from, to }`, whose sides are `EnumValueCoordinate`s (`namespaceId`, `enum`, `member`). `MigrationSubject` gains `{ kind: 'enumValue' }` with the same coordinate. Code that switches over a rename's `entity` or a subject's `kind` handles `'enumValue'`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?:ResolvedRenameStatement|ResolvedMigrationStatement|MigrationSubject)(?![\w$])'
  - id: rows-holding-value-and-keep-data-edit
    summary: |
      Two optional fields let a target say how to keep data that a removed enum value would lose. `MigrationRunnerFailureMeta.rowsHoldingValue` (`RowsHoldingValue`: `enumValue`, `value`, `rows`, `operationIndex`, `keepDataEdit?`) reports the rows that still hold a stored value a removal check refused to remove. `MigrationDataLoss.keepDataEdit` (`KeepDataEdit`: `remove`, `replaceWith`, `swapsValues?`) names the edit to `migration.ts` that keeps the data of a planned loss. `MigrationPlannerConflict.leaveOut` lists the statements to leave out of a plan whose `migration.ts` the user finishes by hand. Both are optional: a target that sets neither keeps working, and the CLI then gives only its general advice.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?:MigrationRunnerFailureMeta|MigrationDataLoss|MigrationRunnerFailure|MigrationPlannerConflict|KeepDataEdit)(?![\w$])'
---

# Statements and subjects can name an enum value

## `enum-value-rename-statement`

`--rename Status.ARCHIVED:Status.RETIRED` resolves to a rename statement with `entity: 'enumValue'`, and a data-loss subject can be `{ kind: 'enumValue', namespaceId, enum, member }`, named by the member's name in the contract source. A `switch` or `if` over `statement.entity` or `subject.kind` gains an `'enumValue'` branch. A planner that does not plan enum value renames refuses the statement with a `statementRefused` conflict, as it refuses a namespace rename it cannot plan.

## `rows-holding-value-and-keep-data-edit`

A target that plans the removal of a stored value can tell the user how to keep the data it would lose. Nothing is required: both fields are optional.

- In the runner, when the check before a removal fails because rows still hold the value, count them and set `meta.rowsHoldingValue` on the failure: `enumValue` is the enum value in its JSON form, `{ namespaceId?, enum, member }`, with `namespaceId` left out for the unbound namespace; `value` is the stored value as the database stores it; `rows` is the count; `operationIndex` is the position of the failed operation in its plan; and `keepDataEdit`, when the target can say it, is the edit below. If the count fails, return the plain check failure without the field.
- In the planner, set `keepDataEdit` on a `MigrationDataLoss` entry when an edit to the `migration.ts` the plan writes keeps the data: `remove` is the call as the file writes it, and `replaceWith` is the text that replaces it, which may be several calls separated by `, `. Set `swapsValues: true` when the edit moves values between members that trade them, so the CLI offers no way that renames them in a cycle. The CLI prints the edit beside the question, and leads its next actions with it.
- In the planner, when a refused statement's change can be written by hand, set `leaveOut` on the conflict to the statements to leave out. The CLI then prints the plan without them as the next action, and the conflict's `why` says what to add to its `migration.ts`.
