import { CliStructuredError } from '../../src/utils/cli-errors';

const URL = 'postgres://user:secret@localhost:5432/appdb';
const MASKED = 'postgres://****:****@localhost:5432/appdb';

/** What a driver throws when the database refuses the connection: a message quoting the URL and a non-dotted `code`. */
export function refusedConnection(): Error {
  return Object.assign(new Error(`connect ECONNREFUSED ${URL}`), { code: 'ECONNREFUSED' });
}

/** The settled error every command reports for {@link refusedConnection}. */
export function reportedRefusedConnection(invocation: string) {
  return {
    code: 'CLI.UNEXPECTED',
    severity: 'error',
    summary: 'Unexpected error',
    why: `Unexpected error during ${invocation}: connect ECONNREFUSED ${MASKED}`,
    nextActions: [{ kind: 'user-choice', label: 'Check the error message and try again' }],
    meta: { code: 'ECONNREFUSED' },
  };
}

/** A structured driver error that carries diagnostics quoting the URL. */
export function refusedWithDiagnostics(): CliStructuredError {
  return new CliStructuredError('DRIVER.CONNECTION_FAILED', 'Database connection failed', {
    why: `The server at ${URL} refused the connection`,
    diagnostics: [
      {
        code: 'DRIVER.CONNECTION_FAILED',
        severity: 'error',
        summary: `No answer from ${URL}`,
        nextActions: [],
      },
    ],
  });
}

/** The diagnostics a command reports for {@link refusedWithDiagnostics}. */
export const reportedDiagnostics = [
  {
    code: 'DRIVER.CONNECTION_FAILED',
    severity: 'error',
    summary: `No answer from ${MASKED}`,
    nextActions: [],
  },
];
