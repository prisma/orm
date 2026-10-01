import type { Contract, ControlPolicy } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import type {
  PslContractBuildCapable,
  PslContractDocument,
  PslSourceSettings,
} from '../src/control/control-capabilities';
import type { PslDocumentAst } from '../src/control/psl-ast';

test('building the PSL document of a contract returns the document and the settings its PSL source must carry', () => {
  expectTypeOf<PslContractBuildCapable['buildPslContract']>().parameters.toEqualTypeOf<
    [Contract]
  >();
  expectTypeOf<
    PslContractBuildCapable['buildPslContract']
  >().returns.toEqualTypeOf<PslContractDocument>();
  expectTypeOf<PslContractDocument>().toEqualTypeOf<{
    readonly document: PslDocumentAst;
    readonly sourceSettings: PslSourceSettings;
  }>();
  expectTypeOf<PslSourceSettings>().toEqualTypeOf<{
    readonly defaultControlPolicy?: ControlPolicy;
  }>();
});
