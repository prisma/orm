import { type } from 'arktype';
import { mysqlClientError } from '../errors';

const streamOptionSchema = type('boolean | undefined');

/** Checks `stream` when the factory is called, as the Postgres facade checks `cursor`. */
export function validateStreamOption(stream: boolean | undefined): boolean {
  const result = streamOptionSchema(stream);
  if (result instanceof type.errors) {
    throw mysqlClientError('RUNTIME.ARGUMENT_INVALID', 'Invalid stream option', {
      why: result.summary,
      fix: 'Pass stream: true to stream rows as they arrive, or leave stream unset to read each whole result first.',
      meta: { extension: 'mysql', helper: 'mysql', argument: 'stream', received: stream },
    });
  }
  return result ?? false;
}
