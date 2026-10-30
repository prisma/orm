import type { ContractWithDomain } from '@internal/contract/types';
import {
  fieldStatementText,
  type MigrationSubject,
  type MigrationTemporaryValue,
  valueObjectFieldStatementText,
} from '@internal/framework-components/control';

/** A new required field whose existing rows a plan gives one temporary value, as a statement names it. */
export interface TemporaryValueReport {
  readonly field: string;
  /** The value as the target writes it: SQL text, such as `''` or `0`, or JSON text for a value object field, such as `""`. */
  readonly value: string;
}

function statementText(
  subject: MigrationSubject,
  destination: ContractWithDomain,
): string | undefined {
  switch (subject.kind) {
    case 'field':
      return fieldStatementText(destination, subject);
    case 'valueObjectField':
      return valueObjectFieldStatementText(destination, subject);
    default:
      return undefined;
  }
}

/** The fields of `values` named as `destination` names them; a column no field stores is left out. */
export function reportTemporaryValues(
  values: readonly MigrationTemporaryValue[],
  destination: ContractWithDomain,
): readonly TemporaryValueReport[] {
  return values.flatMap(({ subject, value }) => {
    const field = statementText(subject, destination);
    return field === undefined ? [] : [{ field, value }];
  });
}
