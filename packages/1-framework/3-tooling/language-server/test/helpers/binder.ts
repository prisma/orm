import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { EMPTY_GENERATOR_FUNCTIONS } from '@internal/framework-components/components';
import { type Binder, createBinder, type SymbolTable } from '@internal/psl-parser';
import type { PslSources } from '@internal/psl-parser/syntax';
import { binderContextFromStack, type LspControlStack } from '../../src/lsp-control-stack';

export function testTypeConstructors(names: readonly string[]): AuthoringTypeNamespace {
  return Object.fromEntries(
    names.map((name) => [name, { kind: 'typeConstructor', output: { codecId: 'fixture/scalar' } }]),
  );
}

export function testBinder(
  input: Partial<LspControlStack> & {
    readonly sources: PslSources;
    readonly symbolTable: SymbolTable;
  },
): Binder {
  const pslBlockDescriptors = input.pslBlockDescriptors ?? {};
  const context = binderContextFromStack({
    ...input,
    scalarTypes: [],
    defaultNamespaceId: input.symbolTable.defaultNamespace.id,
    pslBlockDescriptors,
    generatorFunctions: input.generatorFunctions ?? EMPTY_GENERATOR_FUNCTIONS,
  });
  const contributions = context.authoringContributions;
  return createBinder({
    sources: input.sources,
    symbolTable: input.symbolTable,
    context: {
      ...context,
      authoringContributions: {
        ...contributions,
        type: { ...testTypeConstructors(input.scalarTypes ?? []), ...contributions.type },
        pslBlockDescriptors,
      },
    },
  }).binder;
}
