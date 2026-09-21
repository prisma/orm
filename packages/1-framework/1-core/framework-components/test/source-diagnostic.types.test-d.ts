import { expectTypeOf, test } from 'vitest';
import type { SourceDiagnostic } from '../src/shared/mutation-default-types';

test('mutation default diagnostics require a filename but not a span', () => {
  const diagnostic: SourceDiagnostic = {
    code: 'DEFAULT_INVALID',
    message: 'Invalid default argument',
    sourceId: 'schema.prisma',
  };
  expectTypeOf(diagnostic.sourceId).toEqualTypeOf<string>();

  // @ts-expect-error every source diagnostic requires a filename
  const missingFilename: SourceDiagnostic = {
    code: 'DEFAULT_INVALID',
    message: 'Invalid default argument',
  };
  void missingFilename;
});
