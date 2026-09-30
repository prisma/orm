import type { SQLInputValue } from 'node:sqlite';
import { blindCast } from '@internal/utils/casts';
import { structuredError } from '@internal/utils/structured-error';

/**
 * The parameters to bind to a SQLite statement. SQLite cannot store NaN and binds it as NULL, so a NaN parameter is refused here, where every statement's parameters are bound, whichever codec encoded it.
 */
export function sqliteParams(params: readonly unknown[] | undefined): SQLInputValue[] {
  const values = params ?? [];
  const nanIndex = values.findIndex((value) => Number.isNaN(value));
  if (nanIndex !== -1) {
    throw structuredError(
      'RUNTIME.ENCODE_FAILED',
      `Parameter ${nanIndex + 1} is NaN, which SQLite cannot store: it would bind it as NULL. Pass null to store no value.`,
      { meta: { paramIndex: nanIndex, received: 'NaN' } },
    );
  }
  return blindCast<
    SQLInputValue[],
    'the runtime encodes each parameter to a value node:sqlite binds'
  >(values);
}
