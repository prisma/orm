import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';

const GUIDE_PATH =
  'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.21-to-8.0.0-rc.22/instructions.md';
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const id = 'sql-stack-with-driver-requires-driver';

function detects(content: string): boolean {
  const guide = readFileSync(join(repoRoot, GUIDE_PATH), 'utf-8');
  const entry = guide.split(/\n {2}- id: /).find((block) => block.startsWith(`${id}\n`));
  if (entry === undefined) throw new Error(`The guide has no change ${id}`);
  const patterns = [...entry.matchAll(/^ {8}- '(.*)'$/gm)].map(
    ([, pattern]) => new RegExp((pattern ?? '').replaceAll("''", "'")),
  );
  if (patterns.length === 0) throw new Error(`The change ${id} has no detection`);
  return patterns.some((pattern) => pattern.test(content));
}

describe('the extension detection for a required stack driver', () => {
  it.each([
    ['the type name', 'function build(stack: SqlExecutionStackWithDriver<T>) {}'],
    ['a missing-driver check', 'if (!stack.driver) throw new Error();'],
    ['a stack with a longer name', 'const driver = clientStack.driver.create();'],
    ['a stack on this', 'if (!this.stack.driver) throw new Error();'],
    [
      'driver destructured from the stack factory',
      'const { driver } = createSqlExecutionStack({ target, adapter });',
    ],
    ['driver destructured from a stack', 'const { driver, adapter } = stack;'],
    ['driver renamed while destructured', 'const { adapter, driver: d } = clientStack;'],
  ])('finds %s', (_name, content) => {
    expect(detects(content)).toBe(true);
  });

  it.each([
    ['the stack with no driver', 'function build(stack: SqlExecutionStack<T>) {}'],
    ['a longer name', 'type MySqlExecutionStackWithDriverFactory = () => void;'],
    ['another member', 'const d = runtimeStack.driverName;'],
    ['the driver on this', 'this.driver.close();'],
    ['the driver option', 'const d = options.driver;'],
    ['driver destructured from options', 'const { driver } = options;'],
    ['another member destructured from a stack', 'const { adapter } = stack;'],
    ['another member renamed to driver', 'const { adapter: driver } = stack;'],
  ])('skips %s', (_name, content) => {
    expect(detects(content)).toBe(false);
  });
});
