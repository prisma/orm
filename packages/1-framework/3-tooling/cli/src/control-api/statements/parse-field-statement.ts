import type { CliStructuredError } from '@internal/errors/control';
import { notOk, ok, type Result } from '@internal/utils/result';
import { errorStatementInvalid } from '../../utils/cli-errors';
import type { StatementText } from './statement-text';

/** A verb whose statement names one field and asks the plan to fill in its values with code the user writes. */
export type FieldStatementVerb = 'convert' | 'backfill';

export interface ParsedFieldStatement extends StatementText {
  readonly verb: FieldStatementVerb;
  /** `Model.field` or `namespace.Model.field`; for a convert, also `Variant` or `namespace.Variant`. */
  readonly field: readonly [string] | readonly [string, string] | readonly [string, string, string];
}

function formsFix(verb: FieldStatementVerb): string {
  return verb === 'convert'
    ? 'Write the statement as --convert <field>, where the field is Model.field or namespace.Model.field as the destination contract names it, for example --convert User.age, or as --convert <variant>, Variant or namespace.Variant, for a variant whose discriminator value changed.'
    : `Write the statement as --${verb} <field>, where the field is Model.field or namespace.Model.field as the destination contract names it, for example --${verb} User.age.`;
}

/** Parses the text of one convert or backfill statement, `Model.field` or `namespace.Model.field`, or a convert's `Variant`. */
export function parseFieldStatement(
  statement: StatementText & { readonly verb: FieldStatementVerb },
): Result<ParsedFieldStatement, CliStructuredError> {
  const invalid = (why: string) =>
    notOk(errorStatementInvalid(statement, why, formsFix(statement.verb)));
  if (statement.text.includes(':')) {
    return invalid('The statement names one field, not an old and a new name.');
  }
  const segments = statement.text.split('.');
  if (segments.some((segment) => segment === '')) {
    return invalid(`"${statement.text}" has an empty name.`);
  }
  const [first, second, third] = segments;
  if (first === undefined) return invalid(`"${statement.text}" has an empty name.`);
  if (second === undefined && statement.verb !== 'convert') {
    return invalid(
      `"${statement.text}" names a model; a --${statement.verb} statement names a field.`,
    );
  }
  if (segments.length > 3) {
    return invalid(`"${statement.text}" has ${segments.length} names; at most three are allowed.`);
  }
  const field =
    second === undefined
      ? ([first] as const)
      : third === undefined
        ? ([first, second] as const)
        : ([first, second, third] as const);
  return ok({ verb: statement.verb, text: statement.text, field });
}
