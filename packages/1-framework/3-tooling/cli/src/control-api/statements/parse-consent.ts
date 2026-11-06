import type { CliStructuredError } from '@internal/errors/control';
import { notOk, ok, type Result } from '@internal/utils/result';
import { errorStatementInvalid } from '../../utils/cli-errors';
import type { StatementText } from './statement-text';

/** A verb whose statement consents to what a plan does to its subject. */
export type ConsentVerb = 'delete' | 'allow';

export interface ParsedConsent extends StatementText {
  readonly verb: ConsentVerb;
}

function formsFix(verb: ConsentVerb): string {
  return verb === 'delete'
    ? 'Write the statement as --delete <name>, where the name is Model, namespace.Model, Model.field or namespace.Model.field, or the storage name the refusal gave, for example --delete Legacy or --delete User.nickname.'
    : 'Write the statement as --allow <name>, where the name is the model the refusal gave, for example --allow User.';
}

/**
 * Checks the text of one delete or allow statement. The text stays unresolved: it names what a
 * plan would do to a subject, so it is matched by equality against the plan's subjects, not
 * resolved against the contracts. Any name a subject can have is accepted, since a storage name
 * may contain any character a quoted identifier can.
 */
export function parseConsentStatement(
  statement: StatementText & { readonly verb: ConsentVerb },
): Result<ParsedConsent, CliStructuredError> {
  if (statement.text.trim() === '') {
    return notOk(
      errorStatementInvalid(statement, 'The statement names nothing.', formsFix(statement.verb)),
    );
  }
  return ok({ verb: statement.verb, text: statement.text });
}
