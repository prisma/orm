import { ifDefined } from '@internal/utils/defined';
import type { SqlRuntimeExtensionDescriptor } from './sql-context';
import type { RuntimeExecutionOptions } from './sql-runtime';

/** The options every SQL client takes for how queries run. */
export interface SqlExecutionOptions<TTargetId extends string> extends RuntimeExecutionOptions {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<TTargetId>[];
}

export function toRuntimeOptions<TTargetId extends string>(
  options: SqlExecutionOptions<TTargetId>,
): RuntimeExecutionOptions {
  return {
    ...ifDefined('verifyMarker', options.verifyMarker),
    ...ifDefined('middleware', options.middleware),
    ...ifDefined('log', options.log),
    ...ifDefined('mode', options.mode),
  };
}
