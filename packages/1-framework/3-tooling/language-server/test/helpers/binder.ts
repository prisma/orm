import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { type Binder, createBinder, type SymbolTable } from '@internal/psl-parser';
import type { PslSources } from '@internal/psl-parser/syntax';
import { binderContextFromStack, type LspControlStack } from '../../src/lsp-control-stack';

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
  const pslBlockDescriptors = input.pslBlockDescriptors ?? {};
  const context = binderContextFromStack({ ...input, scalarTypes: [], pslBlockDescriptors });
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
