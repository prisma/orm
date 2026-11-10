export interface DriverRuntimeError extends Error {
  readonly code: 'DRIVER.NOT_CONNECTED' | 'DRIVER.ALREADY_CONNECTED' | 'DRIVER.PREPARE_FAILED';
  readonly category: 'DRIVER';
  readonly severity: 'error';
  readonly details?: Record<string, unknown>;
}

export function driverError(
  code: DriverRuntimeError['code'],
  message: string,
  details?: Record<string, unknown>,
): DriverRuntimeError {
  const error = new Error(message);
  Object.defineProperty(error, 'name', {
    value: 'RuntimeError',
    configurable: true,
  });
  return details === undefined
    ? Object.assign(error, {
        code,
        category: 'DRIVER' as const,
        severity: 'error' as const,
      })
    : Object.assign(error, {
        code,
        category: 'DRIVER' as const,
        severity: 'error' as const,
        details,
      });
}
