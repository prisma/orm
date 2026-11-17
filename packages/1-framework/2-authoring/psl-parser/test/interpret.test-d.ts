import type {
  ContractSourceContext,
  ContractSourceDiagnostics,
  ContractSourceProvider,
  PslContractSourceProvider,
} from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import { ok, type Result } from '@internal/utils/result';
import { expectTypeOf, test } from 'vitest';
import {
  hasPslInterpreter,
  type PslInterpretCapable,
  type PslInterpretInput,
} from '../src/interpret';
import type { PslSources } from '../src/source-file';
import type { SymbolTable } from '../src/symbol-table';
import type { DocumentAst } from '../src/syntax/ast/declarations';

test('guard narrows the union to expose a fully typed interpret method', () => {
  const source: ContractSourceProvider = {
    format: 'psl',
    load: async () => ok({} as never),
  };

  if (hasPslInterpreter(source)) {
    expectTypeOf(source).toExtend<PslInterpretCapable>();
    expectTypeOf(source.interpret).parameters.toEqualTypeOf<
      [PslInterpretInput, ContractSourceContext]
    >();
    expectTypeOf(source.interpret).returns.toEqualTypeOf<
      Result<Contract, ContractSourceDiagnostics>
    >();
    expectTypeOf(source.load).toEqualTypeOf<PslContractSourceProvider['load']>();
    expectTypeOf(source.inputs).toEqualTypeOf<readonly string[] | undefined>();
    expectTypeOf(source.format).toEqualTypeOf<'psl'>();
  }
});

test('interpret input carries the parser artifact vocabulary', () => {
  expectTypeOf<PslInterpretInput['documents']>().toEqualTypeOf<readonly DocumentAst[]>();
  expectTypeOf<PslInterpretInput['sources']>().toEqualTypeOf<PslSources>();
  expectTypeOf<PslInterpretInput['symbolTable']>().toEqualTypeOf<SymbolTable>();
});

test('capability carries the full psl provider shape', () => {
  expectTypeOf<PslInterpretCapable>().toExtend<PslContractSourceProvider>();
  expectTypeOf<PslInterpretCapable['format']>().toEqualTypeOf<'psl'>();
});
