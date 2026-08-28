# Testing Guide

## Testing Philosophy

Our testing approach is guided by four core principles:

1. **Conciseness without obscurity** - Shorter code that's still clear
2. **Separation of concerns** - Test logic separate from infrastructure
3. **Maintainability** - Easy to update when requirements change
4. **Readability** - Tests should tell a story of what they verify

These principles drive all testing decisions, from test structure to helper design.

---

## Testing Pyramid

Prisma Next follows the testing pyramid model with three layers:

### Unit Tests

**Purpose:** Test individual components in isolation

**Characteristics:**
- Fast execution (no external dependencies)
- Test single functions, classes, or modules
- Use mocks/stubs for dependencies
- Located in `**/*.test.ts` files alongside source code

**Example:**
```typescript
// packages/runtime/test/runtime.test.ts
it('creates runtime with contract and adapter', () => {
  const runtime = createRuntime({ contract, adapter });
  expect(runtime).toBeDefined();
});
```

### Integration Tests

**Purpose:** Test interactions between multiple components

**Characteristics:**
- Test real interactions between packages
- May use real database connections
- Verify end-to-end flows within the system
- Located in `**/*.integration.test.ts` files

**Why they matter:** Many system components depend on each other. Unit tests verify isolation, but integration tests prove components work together.

**Example:**
```typescript
// test/integration/test/contract-emission.test.ts
it('emits contract and executes query', async () => {
  const { contractJson, contractDts } = await emit(ir, options, sqlEmission);
  const contract = validateContract<Contract>(JSON.parse(contractJson));
  const runtime = createRuntime({ contract, adapter });
  const plan = sql({ contract, adapter }).from(tables.user).select({ id: t.user.id }).build();
  const results = await collectAsync(runtime.execute(plan));
  expect(results).toHaveLength(1);
});
```

### End-to-End Tests

**Purpose:** Test complete execution paths from user input to database and back

**Characteristics:**
- Test high-value execution paths
- Use real database (Postgres via dev server)
- Test complete flows: CLI → emission → validation → query building → execution
- Located in `test/e2e/framework/test/`

**Why they matter:** E2E tests verify the entire system works together, catching integration issues that unit and integration tests might miss.

**Contract Loading Strategy:**
- **Load from committed fixtures** - E2E tests load contracts from `test/fixtures/generated/contract.json` rather than emitting on every test run
- **Single emission test** - One test (`emitAndVerifyContract`) verifies that contract emission produces the expected artifacts
- **Benefits:** Faster test execution, stable contract artifacts, reduced duplication

**Example:**
```typescript
// test/e2e/framework/test/runtime.e2e.test.ts
import { withDevDatabase, withClient } from '@repo/test-utils';
import {
  setupE2EDatabase,
  createTestRuntimeFromClient,
  executePlanAndCollect,
} from '@internal/runtime/test/utils';
import { loadContractFromDisk } from './utils';

it('returns multiple rows with correct types', async () => {
  // Load contract from committed fixtures (not emit on every test)
  const contract = await loadContractFromDisk<Contract>(contractJsonPath);

  await withDevDatabase(
    async ({ connectionString }) => {
      await withClient(connectionString, async (client) => {
        // Setup database with test-specific schema/data
        await setupE2EDatabase(client, contract, async (c) => {
          await c.query('create table "user" ...');
          await c.query('insert into "user" ...');
        });

        // Create runtime and execute plan
        const adapter = createPostgresAdapter();
        const runtime = createTestRuntimeFromClient(contract, client, adapter);
        try {
          const tables = schema<Contract, CodecTypes>(contract).tables;
          const plan = sql<Contract, CodecTypes>({ contract, adapter })
            .from(tables.user)
            .select({ id: tables.user.columns.id, email: tables.user.columns.email })
            .build();

          const rows = await executePlanAndCollect(runtime, plan);
          expect(rows.length).toBeGreaterThan(0);
          expect(rows[0]).toHaveProperty('id');
          expect(rows[0]).toHaveProperty('email');
        } finally {
          await runtime.close();
        }
      });
    },
  );
});

// Single test to verify contract emission
import { emitAndVerifyContract } from './utils';

it('emits contract and verifies it matches on-disk artifacts', async () => {
  await emitAndVerifyContract(cliPath, contractTsPath, adapterPath, outputDir, contractJsonPath);
});
```

### Test Distribution

**Target distribution:**
- **70% Unit Tests** - Fast feedback on individual components
- **20% Integration Tests** - Verify component interactions
- **10% E2E Tests** - Verify complete execution paths

**Current state:** Many components are unit tested in isolation, but they must be integration tested together to prove they work. E2E tests cover high-value paths all the way to the database and back.

---

## Package coverage

Package coverage policy lives in each Vitest project's adjacent `coverage.config.json`. `pnpm coverage:packages` first builds the same package-only prerequisites as `pnpm test:packages`, then runs every package Vitest project with coverage in one root process. Ordinary `pnpm test` and `pnpm test:packages` remain the faster noncoverage paths.

CI divides that same root project set into four Vitest shards. Each shard uploads a native blob report with coverage thresholds disabled for the partial run. The `Coverage` job downloads all matching artifacts into one directory, verifies all four expected blobs are present, runs `pnpm coverage:packages:merge`, and only then applies the full coverage policy. A final lightweight `Test` job preserves the required status name and requires package shards, coverage, and examples to pass. Missing or failed shards therefore cannot produce a passing gate.

Each entry in the merged `coverage/coverage-final.json` is attributed to the package that owns the entry's source path, not to a test project. Examples are not coverage projects and remain separately exercised by `pnpm test:examples`.

`pnpm coverage:report` reads `coverage/coverage-final.json`, prints package-level threshold diagnostics, and exits nonzero when the policy fails. CI runs this report in `Coverage` after the native Vitest merge even when merged tests or coverage failed, so available diagnostics are still shown. Root `coverage.config.json` warning-only entries temporarily relax coverage thresholds only; they never suppress assertion failures, which block both their shard and the final `Test` gate. Fix a threshold miss by covering genuinely untested branches, never by lowering the threshold.

---

## DRY Test Patterns

### The Problem: Repetition

Repeated patterns in tests make them:
- Hard to maintain (changes require updates in many places)
- Hard to read (boilerplate obscures intent)
- Error-prone (copy-paste mistakes)

### The Solution: Helper Functions

Extract common patterns into helper functions with clear names and JSDoc comments.

**❌ WRONG: Repeated pattern throughout test file**

```typescript
// Repeated 20+ times throughout the file
for await (const _row of runtime.execute(mockPlan)) {
  void _row;
  break;
}
```

**✅ CORRECT: Extract to helper function with documentation**

```typescript
/**
 * Executes a plan and consumes the first row from the result iterator.
 * This helper DRYs up the common test pattern of executing a plan and breaking
 * after the first row to trigger execution without consuming all results.
 */
const executePlan = async (runtime: ReturnType<typeof createRuntime>, plan: Plan): Promise<void> => {
  for await (const _row of runtime.execute(plan)) {
    void _row;
    break;
  }
};

// Use the helper throughout tests
await executePlan(runtime, mockPlan);
```

### When to Create Helpers

**Create a helper when:**
- ✅ Same pattern appears 3+ times in a test file
- ✅ Pattern involves multiple steps (setup, execution, cleanup)
- ✅ Pattern obscures test intent with boilerplate
- ✅ Pattern is likely to change (encapsulate change in one place)

**Don't create a helper when:**
- ❌ Pattern appears only 1-2 times
- ❌ Helper would be more complex than the pattern itself
- ❌ Pattern is specific to a single test

### Helper Characteristics

Good test helpers:

**✅ Hide implementation details**
- Database connection setup
- Error handling boilerplate
- Type assertions and conversions
- Resource cleanup

**✅ Express intent clearly**
- `executePlan(runtime, plan)` vs raw iterator handling
- `createTestContract()` vs manual contract construction
- `withDevDatabase(fn)` vs manual database lifecycle

**✅ Reduce line count significantly**
- 4 lines → 1 line (75% reduction)
- 3 lines → 1 line (66% reduction)

**✅ Maintain test independence**
- Helpers don't introduce hidden state
- Each test remains self-contained
- Failures are still easy to debug

### Helper Examples from Codebase

**Test utilities are organized across multiple locations to avoid circular dependencies:**
- **`@repo/test-utils`**: Generic database and async iterable utilities with zero dependencies on other `@internal/*` packages
- **`@internal/runtime/test/utils`**: Runtime-specific test utilities (plan execution, runtime creation, contract markers)
- **`test/e2e/framework/test/utils.ts`**: Contract-related utilities for E2E tests (contract loading, emission verification)

#### Shared Test Utilities

**Note**: The `@repo/test-utils` package has zero dependencies on other `@internal/*` packages. For runtime-specific utilities, import from `@internal/sql-runtime/test/utils`. For contract-related utilities in E2E tests, import from `test/e2e/framework/test/utils.ts`.

```typescript
// Import from generic utilities
import {
  withDevDatabase,
  withClient,
  collectAsync,
  drainAsyncIterable,
} from '@repo/test-utils';

// Import from runtime-specific utilities
import {
  executePlanAndCollect,
  drainPlanExecution,
  setupTestDatabase,
  createTestRuntime,
  createTestRuntimeFromClient,
  setupE2EDatabase,
} from '@internal/runtime/test/utils';

// Import from contract utilities (in e2e-tests only)
import { loadContractFromDisk, emitAndVerifyContract } from './utils';

// Database helpers (generic)
await withDevDatabase(async ({ connectionString }) => {
  await withClient(connectionString, async (client) => {
    // ... test code
  });
});

// Iterator helpers (generic)
const results = await collectAsync(someAsyncIterable);
await drainAsyncIterable(someAsyncIterable);

// Plan execution helpers (runtime-specific)
const rows = await executePlanAndCollect(runtime, plan);
await drainPlanExecution(runtime, plan);

// E2E helpers (contract-related, in e2e-tests only)
const contract = await loadContractFromDisk<Contract>(contractJsonPath);
await setupE2EDatabase(client, contract, async (c) => {
  // Test-specific schema/data setup
});
const runtime = createTestRuntimeFromClient(contract, client, adapter);
```

**Architecture**: The base functions in `@repo/test-utils` accept dependencies as parameters (e.g., `validateContractFn`, `markerStatements`). Wrapper files in consuming packages inject these dependencies, preventing cyclic dependencies and keeping test utilities lightweight.

#### Package-Specific Helpers

**Only create helpers in test files when they're specific to that package:**

```typescript
// packages/sql-query/test/sql.test.ts

/**
 * Creates a stub adapter for testing query building.
 * Package-specific helper - not used elsewhere.
 */
function createStubAdapter(): Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement> {
  return {
    profile: {
      target: 'postgres',
      targetFamily: 'sql',
      capabilities: {},
      codecs: emptyCodecRegistry(),
    },
    lower: () => ({ sql: '', params: [] }),
  };
}
```

**When to add to shared package:**
- ✅ Pattern is used across multiple test suites
- ✅ Pattern involves common infrastructure (database, contracts, runtime)
- ✅ Pattern would benefit from centralized maintenance

**When to keep in test file:**
- ✅ Pattern is specific to one package's tests
- ✅ Pattern involves package-specific mocks or stubs
- ✅ Pattern is unlikely to be reused elsewhere

## Behavioral Invariant Testing

Low-level helper tests (for IR builders, planners, CLI glue, etc.) should prove **observable behavior**, not just restate implementation details. Use these patterns when exercising migration helpers and similar utilities:

1. **Test behaviors, not trivia.** Assert what callers rely on (e.g., “plan creation clones and freezes inputs,” “planner helpers don’t leak conflict metadata”), instead of repeatedly checking `Object.isFrozen` on every field.
2. **Use minimal fixtures.** Build the smallest plan/operation needed to demonstrate the invariant so future refactors don’t drag a wall of mock data along.
3. **Prove immutability via mutation attempts.** Mutate the original inputs after calling the helper and verify the returned value is unchanged, and that it rejects further mutations (e.g., pushing into a frozen array). This catches accidental reference sharing.
4. **Keep type assertions targeted.** Use `expectTypeOf` only when it validates a public generic contract (such as `target.details`), not to reassert obvious structural facts.
5. **Document helper responsibilities.** Each helper-oriented test file should briefly state the behavior it defends so future additions follow the same scenario-driven style.

---

## Test Structure

### File Organization

**Unit tests:** `src/**/*.test.ts` (alongside source code) **Integration tests:** `test/**/*.integration.test.ts` or `src/**/*.integration.test.ts` **Type tests:** `src/**/*.test-d.ts` (type-level tests using `expectTypeOf`) **E2E tests:** `test/e2e/framework/test/**/*.test.ts`

### Test File Structure

```typescript
// 1. Imports
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { createRuntime } from '../src/runtime';
import { createTestContract, executePlan } from './utils';

// 2. Test fixtures and helpers (if file-specific)
const createMockPlan = () => ({ /* ... */ });

// 3. Test suite
describe('Runtime execution', () => {
  // 4. Setup/teardown
  let runtime: ReturnType<typeof createRuntime>;

  beforeAll(() => {
    runtime = createRuntime({ contract: createTestContract(), adapter });
  });

  afterAll(async () => {
    await runtime.close();
  });

  // 5. Test cases
  it('executes plan and returns results', async () => {
    const plan = createMockPlan();
    const results = await collectAsync(runtime.execute(plan));
    expect(results).toHaveLength(1);
  });
});
```

### Test Descriptions

**✅ CORRECT: Concise, direct descriptions**

```typescript
it('creates runtime with contract and adapter');
it('executes plan and returns results');
it('handles null input');
it('throws error when contract is invalid');
```

**❌ WRONG: Verbose descriptions with "should"**

```typescript
it('should create runtime with contract and adapter');
it('should execute plan and return results');
it('should handle null input');
it('should throw error when contract is invalid');
```

**Why?** The word "should" adds no information. Test descriptions should be direct and action-oriented.

---

## Test Fixtures

### Contract Fixtures

**Location:** `test/fixtures/contract.json` + `contract.d.ts`

**Pattern:** Use fully qualified type IDs, validate with `validateContract`

```typescript
// ✅ CORRECT: Load and validate contract
import contractJson from './fixtures/contract.json' assert { type: 'json' };
import type { Contract } from './fixtures/contract.d';

const contract = validateContract<Contract>(contractJson);
```

**Why?** Contracts must have fully qualified type IDs (`pg/int4@1`, not `int4`). Validation ensures structure is correct.

### Database Fixtures

**Pattern:** Use `withDevDatabase` or `withClient` for automatic cleanup

```typescript
// ✅ CORRECT: Automatic cleanup
await withDevDatabase(async (database) => {
  const client = new Client({ connectionString: database.connectionString });
  await client.connect();
  // ... test code
});

// ✅ CORRECT: Client helper
await withClient(connectionString, async (client) => {
  // ... test code
});
```

**Why?** Automatic cleanup prevents resource leaks and test interference.

**Single Connection Rule:** `@prisma/dev` only accepts one active connection at a time and immediately rejects a second connection until the first is closed. Chain helpers sequentially (finish a `withClient` block before calling another helper that connects) to avoid hangs or timeouts.

### Port Management

**Automatic Port Allocation:** Ports are automatically allocated using `get-port` to find available ports in the range 10,000-65,000. This eliminates port conflicts in parallel test execution without requiring manual port assignment.

```typescript
// Ports are automatically allocated - no need to specify them
await withDevDatabase(async ({ connectionString }) => {
  await withClient(connectionString, async (client) => {
    // ... test code
  });
});

// Or for createDevDatabase
const database = await createDevDatabase();
```

**Benefits:**
- No port conflicts: Ports are checked for availability before use
- No manual assignment: No need to track and assign port ranges
- Better parallel execution: Multiple tests can run simultaneously without conflicts
- Simpler code: Less boilerplate in test files

### AST Node Creation

**Pattern:** Use the rich AST classes and static helpers instead of manual object creation

**Available AST helpers from `@internal/sql-relational-core/ast`:**
- `ColumnRef.of(table, column)` - Creates a `ColumnRef`
- `ParamRef.of(index, name?)` - Creates a `ParamRef`
- `LiteralExpr.of(value)` - Creates a `LiteralExpr`
- `TableSource.named(name, alias?)` - Creates a table source
- `BinaryExpr.eq(left, right)` and the related static constructors - Create a `BinaryExpr`

```typescript
// ✅ CORRECT: Use AST classes and helpers
import { BinaryExpr, ColumnRef, LiteralExpr, ParamRef, TableSource } from '@internal/sql-relational-core/ast';

const colRef = ColumnRef.of('user', 'id');
const paramRef = ParamRef.of(1, 'userId');
const literalExpr = LiteralExpr.of('test');
const table = TableSource.named('user');
const predicate = BinaryExpr.eq(colRef, paramRef);
```

```typescript
// ❌ WRONG: Manual object creation
const colRef: ColumnRef = { kind: 'col', table: 'user', column: 'id' };
const paramRef: ParamRef = { kind: 'param', index: 1, name: 'userId' };
const literalExpr: LiteralExpr = { kind: 'literal', value: 'test' };
```

**Why?** The rich AST helpers ensure consistency, type safety, and make refactoring easier. Manual object creation duplicates AST structure definitions and is error-prone.

### Contract Factory Functions

When creating `Contract` values in tests, use `createContract` from `@repo/test-utils` (or a local helper such as `createTestContract` in package test `utils`) instead of manual object creation:

```typescript
// ✅ CORRECT: Use factory function
import { createContract } from '@repo/test-utils';

const contract = createContract({
  storage: {
    tables: {
      user: {
        columns: {
          id: { type: 'pg/int4@1', nullable: false },
        },
      },
    },
  },
});
```

```typescript
// ❌ WRONG: Manual object creation
import type { Contract } from '@internal/contract/types';

const contract: Contract = {
  target: 'postgres',
  targetFamily: 'sql',
  roots: {},
  models: {},
  storage: { tables: {} } as Contract['storage'],
  capabilities: {},
  extensions: {},
  profileHash: 'stub' as Contract['profileHash'],
  meta: {},
};
```

**Why?** Factory functions ensure required fields (including nested hashes such as `storage.storageHash`) are present with proper defaults, making tests more maintainable and less error-prone.

**Note:** The `capabilities` field in `Contract` is typed as `Record<string, Record<string, boolean>>`, not `Record<string, unknown>`. Extension pack metadata is represented as a simple object map (`contract.extensions`) keyed by descriptor ID—there is no manifest/path wrapper in tests.

See `.cursor/rules/use-contract-ir-factories.mdc` for detailed guidelines.

---

## Type Testing

### Type-Level Tests

**Purpose:** Verify TypeScript types are correct

**Location:** `**/*.test-d.ts` files

**Pattern:** Use `expectTypeOf` from Vitest

```typescript
import { expectTypeOf, test } from 'vitest';
import type { Contract } from './fixtures/contract.d';
import type { ResultType, Plan } from '@internal/sql-relational-core/types';

test('Contract types are correct', () => {
  type UserTable = Contract['storage']['tables']['user'];
  expectTypeOf<UserTable>().toHaveProperty('id');
});

test('Plan type inference works', () => {
  const plan = sql({ contract, adapter })
    .from(tables.user)
    .select({ id: t.user.id, email: t.user.email })
    .build();

  type Row = ResultType<typeof plan>;
  expectTypeOf(plan).toExtend<Plan<Row>>();
});
```

**✅ CORRECT: Use `expectTypeOf` for type assertions**

```typescript
test('Type IDs are literal types', () => {
  type TextTypeId = 'pg/text@1';
  expectTypeOf<TextTypeId>().toEqualTypeOf<'pg/text@1'>();
});
```

**❌ WRONG: Don't use manual type checks**

```typescript
// Don't do this
const _check: TextTypeId extends 'pg/text@1' ? true : false = true;
```

**Why?** `expectTypeOf` provides better error messages and integrates with Vitest's test runner.

See `.cursor/rules/vitest-expect-typeof.mdc` for detailed guidance.

---

## Testing Anti-Patterns

### Anti-Pattern 1: Copy-Paste Cascade

**Symptom:** Same code block appears 5+ times in a single test

**Example:**
```typescript
// ANTI-PATTERN: Repeated throughout test
for await (const _row of runtime.execute(plan)) {
  void _row;
  break;
}
```

**Solution:** Extract to helper function

**Impact:** One change requires updating multiple locations

### Anti-Pattern 2: Implementation Detail Exposure

**Symptom:** Tests directly manipulate internal state or implementation details

**Example:**
```typescript
// ANTI-PATTERN: Test knows about internal structure
runtime['codecRegistry'].register(codec);
```

**Solution:** Use public API or create helper that encapsulates the pattern

**Impact:** Tests become fragile when implementation changes

### Anti-Pattern 3: Pyramid of Setup

**Symptom:** More lines of setup than actual test verification

**Example:**
```typescript
// ANTI-PATTERN: 30 lines of setup for 5 lines of test
it('executes query', async () => {
  // Setup: 30 lines
  const database = await createDevDatabase({ /* ... */ });
  const client = new Client({ connectionString: database.connectionString });
  await client.connect();
  await client.query('CREATE TABLE ...');
  // ... 25 more lines

  // Actual test: 5 lines
  const plan = sql({ contract, adapter }).from(tables.user).select({ id: t.user.id }).build();
  const results = await collectAsync(runtime.execute(plan));
  expect(results).toHaveLength(1);
});
```

**Solution:** Extract setup to helper or `beforeAll`/`beforeEach`

**Impact:** Test intent gets lost in boilerplate

### Anti-Pattern 4: Error Handling Everywhere

**Symptom:** `require.NoError(t, err)` or `expect(error).toBeUndefined()` appears after every operation

**Example:**
```typescript
// ANTI-PATTERN: Error checking dominates the test
const database = await createDevDatabase();
expect(database).toBeDefined();

const client = new Client({ connectionString: database.connectionString });
const err = await client.connect();
expect(err).toBeUndefined();
```

**Solution:** Helper methods handle errors internally

**Impact:** Obscures the actual test logic

### Anti-Pattern 5: Conditional Expectations

**Symptom:** `if` conditions are used to conditionally run `expect()` calls in test files

**Example:**
```typescript
// ANTI-PATTERN: Conditional expectations
it('processes user data', () => {
  const result = processUser(input);

  if (result.status === 'success') {
    expect(result.data).toBeDefined();
    expect(result.data.email).toBe('test@example.com');
  } else {
    expect(result.error).toBeDefined();
  }
});
```

**Solution:** Split into separate tests, each verifying one specific behavior

**✅ CORRECT: Separate tests for each behavior**

```typescript
it('returns success with user data when processing succeeds', () => {
  const result = processUser(validInput);
  expect(result.status).toBe('success');
  expect(result.data).toBeDefined();
  expect(result.data.email).toBe('test@example.com');
});

it('returns error when processing fails', () => {
  const result = processUser(invalidInput);
  expect(result.status).toBe('error');
  expect(result.error).toBeDefined();
});
```

**Impact:** Conditional expectations make tests unpredictable, harder to debug, and reduce test coverage accuracy. Each test should verify one specific behavior with all expectations executing unconditionally.

### Anti-Pattern 6: Manual try/catch for Error Assertions

**Symptom:** A try/catch block captures an error into a variable, then assertions run against it. Sometimes the throwing function is even called twice — once inside `expect().toThrow()` and again inside a try/catch.

**Example:**

```typescript
// ANTI-PATTERN: manual try/catch
let caughtError: unknown;
try {
  buildPlan(contract, node);
} catch (error) {
  caughtError = error;
}
expect(caughtError).toBeInstanceOf(MyError);
expect(caughtError).toMatchObject({
  code: 'INVALID_REF',
  message: 'Unknown column "user.emali"',
});
```

```typescript
// ANTI-PATTERN: calling the function twice
expect(() => buildPlan(contract, node)).toThrow(MyError);

let caughtError: unknown;
try {
  buildPlan(contract, node);
} catch (error) {
  caughtError = error;
}
expect((caughtError as MyError).code).toBe('INVALID_REF');
```

**Solution:** Use `expect(() => ...).toThrow(...)` with `expect.objectContaining` for structured error properties

**✅ CORRECT: Single `toThrow` with structured matching**

```typescript
expect(() => buildPlan(contract, node)).toThrow(
  expect.objectContaining({
    code: 'INVALID_REF',
    message: 'Unknown column "user.emali"',
    details: expect.objectContaining({ table: 'user', column: 'emali' }),
  }),
);
```

**Impact:** Manual try/catch is verbose, requires a type cast to access error properties, and silently passes if the function doesn't throw (unless you add `expect.assertions(n)` bookkeeping). Calling the function twice is wasteful and can mask non-deterministic failures. `toThrow` runs the function exactly once and fails automatically if no error is thrown.

---

## Common Mistakes and Corrections

### Importing from `@repo/test-utils` directly

**❌ WRONG: Importing directly from `@repo/test-utils`**

```typescript
import { executePlanAndCollect } from '@repo/test-utils';
```

**✅ CORRECT: Import from package-specific wrapper files**

```typescript
// For runtime tests
import { executePlanAndCollect } from '@internal/runtime/test/utils';

// For e2e tests
import { executePlanAndCollect } from './utils';
```

**Why?** The `@repo/test-utils` package uses dependency injection with no dependencies on other `@internal/*` packages. Wrapper files inject dependencies to prevent cyclic dependencies and enable proper type inference.

### Type inference in `executePlanAndCollect`

**❌ WRONG: Manually specifying type parameter**

```typescript
const rows = await executePlanAndCollect<Row>(runtime, plan);
```

**✅ CORRECT: Let TypeScript infer the return type**

```typescript
const rows = await executePlanAndCollect(runtime, plan);
type Row = ResultType<typeof plan>;  // Optional: for type tests
```

**Why?** The wrapper functions use `ResultType<P>` from `@internal/sql-query/types` to automatically infer the return type from the plan. Manual type parameters are unnecessary and can cause type inference issues.

### Bundling external dependencies

**Issue:** When bundling packages that use dependencies with native modules or data files (e.g., `@prisma/dev` with pglite), bundling can cause runtime errors like `ENOENT: no such file or directory, open '.../pglite.data'`.

**Solution:** Mark dependencies as external in `tsdown.config.ts`:

```typescript
export default defineConfig({
  // ... other config
  external: ['@prisma/dev'],
});
```

### Test timeout configuration

**Issue:** Database setup in tests can take time, causing timeout errors like `Hook timed out in 3000ms`.

**Solution:** Set appropriate timeouts for `describe` blocks and `beforeAll` hooks:

```typescript
describe('test suite', { timeout: 30000 }, () => {
  beforeAll(async () => {
    // Database setup
  }, 30000);
});
```

### SQL table name quoting

**Issue:** Some table names are PostgreSQL reserved keywords (e.g., `user`), causing SQL syntax errors like `syntax error at or near "user"`.

**Solution:** Always quote table names in SQL statements:

```typescript
// ❌ WRONG
await client.query(`drop table if exists ${table}`);

// ✅ CORRECT
await client.query(`drop table if exists "${table}"`);
```

### Literal type preservation tests

**Issue:** Type-level tests that verify literal type preservation (e.g., `TableKeys extends 'user' ? true : false`) may fail due to TypeScript limitations in preserving literal types through complex generic manipulations.

**Solution:** These tests can be commented out with a note explaining the limitation, as the runtime behavior is still correct:

```typescript
// Note: Type-level literal preservation check is disabled due to type system limitations
// type TableKeys = keyof typeof contract.storage.tables;
// const _tableKeysCheck: TableKeys extends 'user' ? true : false =
//   true as TableKeys extends 'user' ? true : false;
// expectTypeOf(_tableKeysCheck).toEqualTypeOf<true>();
```

---

## Best Practices

### 1. Test Behavior, Not Implementation

**✅ CORRECT: Test what the system does**

```typescript
it('returns user by id', async () => {
  const plan = sql({ contract, adapter })
    .from(tables.user)
    .where(t.user.id.eq(param('id')))
    .select({ id: t.user.id, email: t.user.email })
    .build({ params: { id: 1 } });

  const results = await collectAsync(runtime.execute(plan));
  expect(results[0].email).toBe('user@example.com');
});
```

**❌ WRONG: Test how the system does it**

```typescript
it('calls adapter.lower with correct AST', () => {
  const lowerSpy = vi.spyOn(adapter, 'lower');
  // ... test implementation details
  expect(lowerSpy).toHaveBeenCalledWith(expect.objectContaining({ /* ... */ }));
});
```

### 2. Use Descriptive Test Names

**✅ CORRECT: Clear, specific names**

```typescript
it('returns empty array when no users match filter');
it('throws error when contract has invalid type IDs');
it('handles null values in nullable columns');
```

**❌ WRONG: Vague names**

```typescript
it('works');
it('test 1');
it('handles edge case');
```

### 3. One Assertion Per Test (When Possible)

**✅ CORRECT: Single, focused assertion**

```typescript
it('returns user by id', async () => {
  const results = await collectAsync(runtime.execute(plan));
  expect(results[0].id).toBe(1);
});
```

**When multiple assertions are needed:** Group related assertions that test a single behavior

```typescript
it('returns user with all fields', async () => {
  const results = await collectAsync(runtime.execute(plan));
  expect(results[0].id).toBe(1);
  expect(results[0].email).toBe('user@example.com');
  expect(results[0].createdAt).toBeInstanceOf(Date);
});
```

### 4. Test Edge Cases

**Important edge cases to test:**
- Empty results
- Null values in nullable columns
- Invalid inputs (contracts, plans, parameters)
- Boundary conditions (limits, offsets)
- Error conditions (database errors, validation failures)

### 5. Keep Tests Independent

**✅ CORRECT: Each test is self-contained**

```typescript
it('creates user', async () => {
  const plan = sql({ contract, adapter })
    .from(tables.user)
    .insert({ email: 'new@example.com' })
    .build();
  await executePlan(runtime, plan);
});

it('reads user', async () => {
  const plan = sql({ contract, adapter })
    .from(tables.user)
    .select({ id: t.user.id, email: t.user.email })
    .build();
  const results = await collectAsync(runtime.execute(plan));
  expect(results).toHaveLength(1);
});
```

**❌ WRONG: Tests depend on execution order**

```typescript
let userId: number;

it('creates user', async () => {
  // ... creates user
  userId = result.id;  // Shared state
});

it('reads user', async () => {
  // Depends on previous test
  expect(userId).toBeDefined();
});
```

### 6. Use Appropriate Test Level

**Unit test:** Test a single function in isolation **Integration test:** Test multiple components working together **E2E test:** Test complete execution path to database and back

**When in doubt:** Start with a unit test. If you need to test interactions, create an integration test. If you need to test the complete flow, create an E2E test.

---

## Running Tests

### Test Commands

```bash
# Run all tests (packages + examples)
pnpm test

# Run only package tests (exclude examples)
pnpm test:packages

# Run only example tests
pnpm test:examples

# Run tests for a specific package
pnpm --filter @internal/sql-runtime test

# Run tests in watch mode
pnpm --filter @internal/sql-runtime test --watch
```

### Coverage Commands

```bash
# Build package prerequisites and run one root package-coverage process
pnpm coverage:packages

# Alias for the same package-only coverage path
pnpm test:coverage

# CI fan-in only: merge native shard blobs and generate coverage-final.json
pnpm coverage:packages:merge

# Report policy results from coverage/coverage-final.json
pnpm coverage:report
```

Examples do not contribute to package coverage and continue to run separately with `pnpm test:examples`.

### Type Checking Tests

```bash
# Type check all packages
pnpm typecheck:packages

# Type check a specific package
pnpm --filter @internal/sql-runtime typecheck
```

---

## Summary

**Testing Philosophy:**
- Conciseness without obscurity
- Separation of concerns
- Maintainability
- Readability

**Testing Pyramid:**
- 70% Unit Tests (fast, isolated)
- 20% Integration Tests (component interactions)
- 10% E2E Tests (complete execution paths)

**DRY Patterns:**
- Extract helpers when pattern appears 3+ times
- Helpers should hide implementation details
- Helpers should express intent clearly
- Helpers should reduce line count significantly

**Test Structure:**
- Clear file organization
- Descriptive test names (no "should")
- One assertion per test (when possible)
- Test behavior, not implementation
- Keep tests independent

**Remember:** Tests are documentation. They should tell the story of what your system does, not how it does it.

---

## MongoDB Testing Infrastructure

MongoDB tests use `mongodb-memory-server` to run a real MongoDB instance in-process. This provides fast, isolated integration tests without requiring an external MongoDB installation.

### Dependencies

- `mongodb-memory-server` (`^10.4.0`) — in-process MongoDB server
- `mongodb` (`^6.16.0`, via pnpm catalog) — MongoDB driver
- Listed in `pnpm-workspace.yaml` under `allowBuilds`

### Test setup helpers

**Integration tests** (`test/integration/test/mongo/setup.ts`):

```typescript
import { describeWithMongoDB } from './setup';

describeWithMongoDB('my feature', (ctx) => {
  it('does something', async () => {
    const db = ctx.client.db('test');
    // db is a clean database (dropped before each test)
  });
});
```

`describeWithMongoDB` manages the full lifecycle: starts a `MongoMemoryReplSet` (single-node replica set with WiredTiger), creates a `MongoClient`, drops the database before each test, and cleans up after all tests.

**Package-level tests** (`packages/2-mongo-family/7-runtime/test/setup.ts`):

```typescript
import { withMongod } from './setup';

it('does something', async () => {
  await withMongod(async (ctx) => {
    const db = ctx.client.db('test');
    // ...
  });
});
```

`withMongod` is a callback-style helper with `try`/`finally` teardown.

### Configuration

Vitest config for MongoDB tests must set:
- `testTimeout` and `hookTimeout` to `timeouts.spinUpDbServer` (30s base, scalable via `TEST_TIMEOUT_MULTIPLIER`)
- `fileParallelism: false` — MongoDB tests cannot run in parallel within a single file

Timeouts are available from `@repo/test-utils`:

```typescript
import { timeouts } from '@repo/test-utils';
```

### Where tests live

| Test type | Location | Command |
|---|---|---|
| Package unit tests | `packages/*/test/*.test.ts` | `pnpm test` in the package |
| Mongo integration tests | `test/integration/test/mongo/*.test.ts` | `pnpm test:integration` |
| Mongo example tests | `examples/mongo-demo/test/*.test.ts` | `pnpm test:examples` |

### Replica set mode

Always use `MongoMemoryReplSet` (not `MongoMemoryServer`) — replica set mode is required for transactions and change streams.

```typescript
const replSet = await MongoMemoryReplSet.create({
  instanceOpts: [{ launchTimeout: timeouts.spinUpDbServer, storageEngine: 'wiredTiger' }],
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});
```

## Related Documentation

- **Test Descriptions:** `.cursor/rules/omit-should-in-tests.mdc`
- **Type Testing:** `.cursor/rules/vitest-expect-typeof.mdc`
- **TypeScript Patterns:** `.cursor/rules/typescript-patterns.mdc` (DRY Test Patterns section)
- **Error Assertions:** `.cursor/rules/prefer-to-throw.mdc`
- **Object Matchers:** `.cursor/rules/prefer-object-matcher.mdc`
- **Agent Reference:** `AGENTS.md`
