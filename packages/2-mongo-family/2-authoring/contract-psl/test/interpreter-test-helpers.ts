import type {
  ContractSourceDiagnostic,
  ContractSourceDiagnostics,
} from '@internal/config/config-types';
import type { Result } from '@internal/utils/result';
import { expect } from 'vitest';

export function expectInvalidAttributeSyntax<Success>(
  result: Result<Success, ContractSourceDiagnostics>,
  message: RegExp,
): ContractSourceDiagnostic {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected interpretation to fail');
  const diagnostics = result.failure.diagnostics.filter(
    (diagnostic) => diagnostic.code === 'PSL_INVALID_ATTRIBUTE_SYNTAX',
  );
  expect(diagnostics).toHaveLength(1);
  const diagnostic = diagnostics[0];
  if (!diagnostic) throw new Error('Expected PSL_INVALID_ATTRIBUTE_SYNTAX diagnostic');
  expect(diagnostic.message).toMatch(message);
  return diagnostic;
}
