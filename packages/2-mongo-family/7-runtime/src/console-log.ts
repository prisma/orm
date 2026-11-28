import type { RuntimeLog } from '@internal/framework-components/runtime';

/** The log a runtime uses when the application passes none: warnings and errors to the console's standard error, info to its standard output, debug events dropped. */
export const consoleLog: RuntimeLog = {
  info: (event) => console.info(event),
  warn: (event) => console.warn(event),
  error: (event) => console.error(event),
};

/** `log`, or the console when it is absent, as a log whose methods never throw: a failing logger must not fail the call that logs. Each call looks the method up on the log, so a log whose methods change later still receives its events; `debug` is present only when the log has one when the runtime is built. */
export function runtimeLog(log: RuntimeLog | undefined): RuntimeLog {
  const target = log ?? consoleLog;
  const guarded = (call: () => void): void => {
    try {
      call();
    } catch {
      // A logger that fails must not stop the application.
    }
  };
  return {
    info: (event) => guarded(() => target.info(event)),
    warn: (event) => guarded(() => target.warn(event)),
    error: (event) => guarded(() => target.error(event)),
    ...(target.debug ? { debug: (event: unknown) => guarded(() => target.debug?.(event)) } : {}),
  };
}
