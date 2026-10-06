import { expectTypeOf, test } from 'vitest';
import type { PslDiagnosticCode } from '../src/shared/psl-extension-block';

test('unresolved references are framework PSL diagnostic codes', () => {
  expectTypeOf<PslDiagnosticCode>().not.toBeAny();
  expectTypeOf<'PSL_UNRESOLVED_REFERENCE'>().toExtend<PslDiagnosticCode>();
});
