import type { Contract, ControlPolicy } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import type {
  PrintedPslContract,
  PslContractPrintCapable,
  PslSourceSettings,
} from '../src/control/control-capabilities';
import type { PslDocumentAst } from '../src/control/psl-ast';

test('printing a contract returns the PSL document and the settings its PSL source must carry', () => {
  expectTypeOf<PslContractPrintCapable['printPslContract']>().parameters.toEqualTypeOf<
    [Contract]
  >();
  expectTypeOf<
    PslContractPrintCapable['printPslContract']
  >().returns.toEqualTypeOf<PrintedPslContract>();
  expectTypeOf<PrintedPslContract>().toEqualTypeOf<{
    readonly document: PslDocumentAst;
    readonly sourceSettings: PslSourceSettings;
  }>();
  expectTypeOf<PslSourceSettings>().toEqualTypeOf<{
    readonly defaultControlPolicy?: ControlPolicy;
  }>();
});
