import type { SqlRuntimeExtensionDescriptor } from './sql-context';
import type { RuntimeExecutionOptions } from './sql-runtime';

/** The options every SQL client takes for how queries run. */
export interface SqlExecutionOptions<TTargetId extends string> extends RuntimeExecutionOptions {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<TTargetId>[];
}

const runtimeExecutionKeys: Record<keyof RuntimeExecutionOptions, true> = {
  verifyMarker: true,
  middleware: true,
  log: true,
  mode: true,
};

export function toRuntimeOptions<TTargetId extends string>(
  options: SqlExecutionOptions<TTargetId>,
): RuntimeExecutionOptions {
  return Object.fromEntries(
    Object.keys(runtimeExecutionKeys).flatMap((key) => {
      const value: unknown = Reflect.get(options, key);
      return value === undefined ? [] : [[key, value]];
    }),
  );
}
