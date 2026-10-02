import type {
  ContractSourceContext,
  ContractSourceDiagnostic,
} from '@internal/config/config-types';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import type { ControlStack } from '@internal/framework-components/control';
import type { Binder, SymbolTable } from '@internal/psl-parser';
import { buildSymbolTable, createBinder, mapPslDiagnostics } from '@internal/psl-parser';
import type { DocumentAst, PslSources } from '@internal/psl-parser/syntax';
import { parse } from '@internal/psl-parser/syntax';
import type { InterpretPslDocumentToSqlContractInput } from './interpreter';

/**
 * Derives the `ContractSourceContext` `bindPslSchema` (and
 * `createBinder`) need from a `ControlStack` a test assembled with
 * `createControlStack`. Mirrors the mapping `loadContractSourceWithStack`
 * applies in production, minus the parts only a running command has
 * (`resolvedInputs`, `reportWarning`).
 */
export function contractSourceContextFromControlStack(
  stack: ControlStack,
  overrides?: Partial<ContractSourceContext>,
): ContractSourceContext {
  return {
    composedExtensions: stack.extensions.map((extension) => extension.id),
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    dataTypeLookup: stack.dataTypeLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    resolvedInputs: [],
    capabilities: stack.capabilities,
    ...overrides,
  };
}

export type SqlContextInput = Pick<
  InterpretPslDocumentToSqlContractInput,
  | 'authoringContributions'
  | 'scalarColumnDescriptors'
  | 'composedExtensions'
  | 'composedExtensionContracts'
  | 'controlMutationDefaults'
  | 'capabilities'
  | 'codecLookup'
  | 'dataTypeLookup'
>;

export interface BoundPslSchema {
  readonly documents: readonly DocumentAst[];
  readonly sources: PslSources;
  readonly symbolTable: SymbolTable;
  readonly binder: Binder;
  readonly context: ContractSourceContext;
  readonly seedDiagnostics: readonly ContractSourceDiagnostic[];
  readonly contextInput: SqlContextInput;
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
    contextInput: {
      authoringContributions: context.authoringContributions,
      scalarColumnDescriptors: collectScalarTypeConstructors(context.authoringContributions.type),
      ...(context.composedExtensions.length > 0
        ? { composedExtensions: [...context.composedExtensions] }
        : {}),
      composedExtensionContracts: context.composedExtensionContracts,
      controlMutationDefaults: context.controlMutationDefaults,
      capabilities: context.capabilities,
      codecLookup: context.codecLookup,
      dataTypeLookup: context.dataTypeLookup,
    },
  };
}
