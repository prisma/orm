import type { RuntimeLog } from '@internal/framework-components/runtime';

/** The log a runtime uses when the application passes none: warnings and errors to the console's standard error, info to its standard output, debug events dropped. */
export const consoleLog: RuntimeLog = {
  info: (event) => console.info(event),
  warn: (event) => console.warn(event),
  error: (event) => console.error(event),
};
