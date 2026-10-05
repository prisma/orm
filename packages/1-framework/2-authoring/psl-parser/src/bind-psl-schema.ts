import type {
  ContractSourceContext,
  ContractSourceDiagnostic,
} from '@internal/config/config-types';
import type { ControlStack } from '@internal/framework-components/control';
import { ifDefined } from '@internal/utils/defined';
import { type Binder, createBinder } from './binder';
import { mapPslDiagnostics } from './diagnostic';
import { parse } from './parse';
import type { PslSources } from './source-file';
import { buildSymbolTable, type SymbolTable } from './symbol-table';
import type { DocumentAst } from './syntax/ast/declarations';

export function contractSourceContextFromControlStack(
  stack: ControlStack,
  overrides?: Partial<ContractSourceContext>,
): ContractSourceContext {
  return {
    composedExtensions: stack.extensions.map((extension) => extension.id),
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    ...ifDefined('pslDiagnostics', stack.family.pslDiagnostics),
    codecLookup: stack.codecLookup,
    dataTypeLookup: stack.dataTypeLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    resolvedInputs: [],
    capabilities: stack.capabilities,
    ...overrides,
  };
}

export interface BoundPslSchema {
  readonly documents: readonly DocumentAst[];
  readonly sources: PslSources;
  readonly symbolTable: SymbolTable;
  readonly binder: Binder;
  readonly context: ContractSourceContext;
  readonly seedDiagnostics: readonly ContractSourceDiagnostic[];
}

export function bindPslSchema(
  schema: string,
  options: { readonly context: ContractSourceContext; readonly sourceId?: string },
): BoundPslSchema {
  const { context } = options;
  const { document, sources } = parse(schema, options.sourceId ?? 'schema.prisma');
  const documents = [document];
  const { symbolTable, diagnostics: symbolTableDiagnostics } = buildSymbolTable({
    documents,
    sources,
  });
  const { binder, diagnostics: binderDiagnostics } = createBinder({
    symbolTable,
    sources,
    context,
  });
  return {
    documents,
    sources,
    symbolTable,
    binder,
    context,
    seedDiagnostics: mapPslDiagnostics([...symbolTableDiagnostics, ...binderDiagnostics], sources),
  };
}
