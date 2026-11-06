import { ifDefined } from '@internal/utils/defined';
import type { SqlRuntimeExtensionDescriptor } from './sql-context';
import type { RuntimeExecutionOptions } from './sql-runtime';

/** The options every SQL client takes for how queries run. */
export interface SqlExecutionOptions<TTargetId extends string> extends RuntimeExecutionOptions {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<TTargetId>[];
}

type RuntimeExecutionCopies = {
  readonly [K in keyof RuntimeExecutionOptions]-?: Pick<RuntimeExecutionOptions, K>;
};

export function toRuntimeOptions<TTargetId extends string>(
  options: SqlExecutionOptions<TTargetId>,
): RuntimeExecutionOptions {
  const copies: RuntimeExecutionCopies = {
    verifyMarker: ifDefined('verifyMarker', options.verifyMarker),
    middleware: ifDefined('middleware', options.middleware),
    log: ifDefined('log', options.log),
    mode: ifDefined('mode', options.mode),
  };
  return Object.values(copies).reduce<RuntimeExecutionOptions>(
    (merged, copy) => Object.assign(merged, copy),
    {},
  );
}
