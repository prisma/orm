import { isStructuredError } from '@internal/utils/structured-error';

/**
 * The meta of a contract that failed to load because the family refused it, such as the columns whose defaults it refused, for the command to report: the refusal's own meta, or the `refusedDefaults` a migration-tools error kept from it.
 */
export function contractValidationMeta(error: unknown): Record<string, unknown> | undefined {
  if (!isStructuredError(error)) return undefined;
  if (error.code === 'CONTRACT.VALIDATION_FAILED') return error.meta;
  const refusedDefaults = error.meta?.['refusedDefaults'];
  return refusedDefaults === undefined ? undefined : { refusedDefaults };
}
