import { structuredError } from '@internal/utils/structured-error';

const savepointNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateSavepointName(value: unknown): string {
  if (typeof value !== 'string' || !savepointNamePattern.test(value)) {
    throw structuredError('RUNTIME.ARGUMENT_INVALID', 'Invalid savepoint name', {
      why: 'A savepoint name must start with a letter or underscore and contain only letters, digits and underscores',
      fix: 'Use a plain identifier such as sp_1.',
      meta: { argument: 'name', received: value },
    });
  }
  return value;
}
