import type {
  ControlMutationDefaultEntry,
  LoweredDefaultResult,
} from '@internal/framework-components/control';

export type SqlDefaultFunctionName = 'autoincrement' | 'now';

/**
 * The SQL family's default functions, each a database default: `autoincrement()` and `now()`. A value the client generates is a generator function, written `@onCreate(...)`.
 */
export function sqlDefaultFunctions(): Readonly<
  Record<SqlDefaultFunctionName, ControlMutationDefaultEntry>
> {
  return {
    autoincrement: {
      signature: { documentation: 'Generates an increasing integer value in the database.' },
      usageSignatures: ['autoincrement()'],
      lower: () => databaseFunction('autoincrement()'),
    },
    now: {
      signature: { documentation: 'Uses the current database timestamp as the default value.' },
      usageSignatures: ['now()'],
      lower: () => databaseFunction('now()'),
    },
  };
}

function databaseFunction(expression: string): LoweredDefaultResult {
  return { ok: true, value: { kind: 'storage', defaultValue: { kind: 'function', expression } } };
}
