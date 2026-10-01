import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import {
  assembleAttributeSpecs,
  type Binder,
  createBinder,
  type SymbolTable,
} from '@internal/psl-parser';
import type { PslSources } from '@internal/psl-parser/syntax';
import type { LspControlStack } from '../../src/lsp-control-stack';

export function testTypeConstructors(names: readonly string[]): AuthoringTypeNamespace {
  return Object.fromEntries(
    names.map((name) => [
      name,
      { kind: 'typeConstructor', output: { codecId: 'fixture/scalar', nativeType: name } },
    ]),
  );
}

export function testBinder(
  input: Partial<LspControlStack> & {
    readonly sources: PslSources;
    readonly symbolTable: SymbolTable;
  },
): Binder {
  const scalarTypes = testTypeConstructors(input.scalarTypes ?? []);
  return createBinder({
    sources: input.sources,
    symbolTable: input.symbolTable,
    typeConstructors: { ...scalarTypes, ...input.authoringContributions?.type },
    attributeSpecs:
      input.authoringContributions === undefined
        ? { model: {}, field: {} }
        : assembleAttributeSpecs(input.authoringContributions),
    pslBlockDescriptors: input.pslBlockDescriptors ?? {},
    controlMutationDefaults: {
      defaultFunctionRegistry: input.controlMutationDefaults?.defaultFunctionRegistry ?? new Map(),
      dataTypeEntries: input.authoringContributions?.dataTypes ?? {},
    },
  }).binder;
}
