---
changes:
  - id: sql-stack-with-driver-requires-driver
    summary: |
      `SqlExecutionStackWithDriver` now requires its `driver`, and `createSqlExecutionStack(...)` returns it only when given a driver. Without a driver it returns `SqlExecutionStack`, which has no `driver` member. `createToSql(stack, contract)` takes `SqlExecutionStack`. Type a stack built without a driver as `SqlExecutionStack`, and remove checks such as `if (!stack.driver) throw ...` on a stack typed `SqlExecutionStackWithDriver`, which can no longer fail. The framework `ExecutionStack` now declares `driver` optional. The detection matches files that name `SqlExecutionStackWithDriver` or read `driver` from a stack, such as `stack.driver`, `clientStack.driver` or `const { driver } = createSqlExecutionStack(...)`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])SqlExecutionStackWithDriver(?![\w$])'
        - '(?<![\w$.])(?:this\.)?[\w$]*[sS]tack\.driver(?![\w$])'
        - '\{(?:[^{}]*,)?\s*driver(?![\w$])[^{}]*\}\s*=\s*(?:createSqlExecutionStack\s*\(|(?:this\.)?[\w$]*[sS]tack(?![\w$]))'
  - id: runtime-mode-from-framework-components
    summary: |
      No action is needed. `RuntimeMode` is now declared in `@internal/framework-components/runtime` and still exported from `@internal/sql-runtime`.
---

# A SQL stack with a driver always has one

```ts
// Before
const stack: SqlExecutionStackWithDriver<'postgres'> = createSqlExecutionStack({ target, adapter });
if (!stack.driver) throw new Error('Driver descriptor missing from execution stack');

// After
const staticStack: SqlExecutionStack<'postgres'> = createSqlExecutionStack({ target, adapter });
const clientStack = createSqlExecutionStack({ target, adapter, driver });
const driverInstance = clientStack.driver.create();
```
