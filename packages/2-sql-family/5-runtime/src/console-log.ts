import type { RuntimeLog } from '@internal/framework-components/runtime';

/** The log a runtime uses when the application passes none: warnings and errors to the console's standard error, info to its standard output, debug events dropped. */
export const consoleLog: RuntimeLog = {
  info: (event) => console.info(event),
  warn: (event) => console.warn(event),
  error: (event) => console.error(event),
};

/** `log`, or the console when it is absent, as a log whose methods never throw: a failing logger must not fail the call that logs. */
export function runtimeLog(log: RuntimeLog | undefined): RuntimeLog {
  const target = log ?? consoleLog;
  const guard =
    (method: (event: unknown) => void) =>
    (event: unknown): void => {
      try {
        method.call(target, event);
      } catch {
        // A logger that fails must not stop the application.
      }
    };
  const { debug } = target;
  return {
    info: guard(target.info),
    warn: guard(target.warn),
    error: guard(target.error),
    ...(debug ? { debug: guard(debug) } : {}),
  };
}
